/**
 * Step 04: Comprehensive Analysis
 *
 * 統合動画分析ステップ（Call 1）
 * 1回のGemini API呼び出しで以下を全て取得:
 * - segments（セグメント）
 * - events（イベント）
 * - scenes（重要シーン）
 * - players（選手識別）
 * - clipLabels（クリップラベル）
 *
 * これにより20+回のAPI呼び出しを1回に統合
 */

import { getDb } from "../../firebase/admin";
import {
  callComprehensiveAnalysis,
  calculateEventStatsFromAnalysis,
} from "../../gemini/comprehensiveAnalysis";
import type { ComprehensiveAnalysisResponse } from "../../gemini/schemas";
import { getValidCacheOrFallback, getCacheManager } from "../../gemini/cacheManager";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import type { CostTrackingContext } from "../../gemini/gemini3Client";

// Firestore batch limit
const BATCH_LIMIT = 450;

/**
 * Delete documents in batches to avoid Firestore 500-item batch limit
 */
async function deleteInBatches(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  db: FirebaseFirestore.Firestore
): Promise<void> {
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_LIMIT);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

export const COMPREHENSIVE_VERSION = "comprehensive_v1";

export type ComprehensiveAnalysisStepOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type ComprehensiveAnalysisStepResult = {
  matchId: string;
  success: boolean;
  skipped?: boolean;
  segmentCount?: number;
  eventCount?: number;
  sceneCount?: number;
  playerCount?: number;
  clipLabelCount?: number;
  error?: string;
};

/**
 * Run comprehensive analysis step
 */
export async function stepComprehensiveAnalysis(
  options: ComprehensiveAnalysisStepOptions
): Promise<ComprehensiveAnalysisStepResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "comprehensive_analysis" }) : log;

  stepLogger.info("Starting comprehensive analysis", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing analysis with same version
  const existingDoc = await matchRef.collection("comprehensiveAnalysis").doc("current").get();
  if (existingDoc.exists && existingDoc.data()?.version === version) {
    stepLogger.info("Comprehensive analysis already exists for this version", {
      matchId,
      version,
    });
    return { matchId, success: true, skipped: true };
  }

  // Get match data for video info
  const matchSnap = await matchRef.get();
  const matchData = matchSnap.data();
  const durationSec = matchData?.video?.durationSec;

  // Get cache info (with fallback to direct file URI)
  const cache = await getValidCacheOrFallback(matchId, "comprehensive_analysis");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found", { matchId });
    return {
      matchId,
      success: false,
      error: "No video file URI available",
    };
  }

  const fileUri = cache.storageUri || cache.fileUri;

  if (!fileUri) {
    stepLogger.error("No file URI in cache", { matchId });
    return {
      matchId,
      success: false,
      error: "No video file URI available in cache",
    };
  }

  stepLogger.info("Using video for comprehensive analysis", {
    matchId,
    fileUri,
    hasCaching: cache.version !== "fallback",
    durationSec,
  });

  // Get project config
  const projectId = process.env.GCP_PROJECT_ID;
  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  if (!projectId) {
    throw new Error("GCP_PROJECT_ID environment variable is required");
  }

  // Cost tracking context
  const costContext: CostTrackingContext = {
    matchId,
    step: "comprehensive_analysis",
  };

  try {
    // Call comprehensive analysis
    const result = await callComprehensiveAnalysis({
      projectId,
      modelId,
      fileUri,
      mimeType: "video/mp4",
      durationSec,
      matchId,
      costContext,
    });

    const response = result.response;

    // Save all results to Firestore
    await saveComprehensiveResults(matchRef, response, version, stepLogger);

    // Calculate and save event stats for use by Call 2
    const eventStats = calculateEventStatsFromAnalysis(response);
    await matchRef.collection("comprehensiveAnalysis").doc("current").set({
      version,
      eventStats,
      metadata: response.metadata,
      teams: response.teams,
      createdAt: new Date().toISOString(),
    });

    // Update cache usage if using actual cache (not fallback)
    if (cache.version !== "fallback") {
      await getCacheManager().updateCacheUsage(matchId);
    }

    stepLogger.info("Comprehensive analysis complete", {
      matchId,
      segmentCount: response.segments.length,
      eventCount: response.events.length,
      sceneCount: response.scenes.length,
      playerCount: response.players.players.length,
      clipLabelCount: response.clipLabels?.length ?? 0,
    });

    return {
      matchId,
      success: true,
      segmentCount: response.segments.length,
      eventCount: response.events.length,
      sceneCount: response.scenes.length,
      playerCount: response.players.players.length,
      clipLabelCount: response.clipLabels?.length ?? 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    stepLogger.error("Comprehensive analysis failed", error, { matchId });
    return {
      matchId,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Save comprehensive analysis results to Firestore
 */
async function saveComprehensiveResults(
  matchRef: FirebaseFirestore.DocumentReference,
  response: ComprehensiveAnalysisResponse,
  version: string,
  log: ILogger
): Promise<void> {
  const db = getDb();
  const matchId = matchRef.id;

  // Save segments
  await saveSegments(matchRef, response.segments, version, log);

  // Save events by type
  await saveEvents(matchRef, response.events, version, log);

  // Save important scenes
  await saveScenes(matchRef, response.scenes, version, log);

  // Save players identification
  await savePlayers(matchRef, response.players, version, log);

  // Save clip labels (if any)
  if (response.clipLabels && response.clipLabels.length > 0) {
    await saveClipLabels(matchRef, response.clipLabels, version, log);
  }

  log.info("All comprehensive results saved", { matchId });
}

/**
 * Save segments to Firestore
 */
async function saveSegments(
  matchRef: FirebaseFirestore.DocumentReference,
  segments: ComprehensiveAnalysisResponse["segments"],
  version: string,
  log: ILogger
): Promise<void> {
  const db = getDb();
  const segmentsRef = matchRef.collection("segments");

  // Delete existing segments for this version (in batches to avoid 500-item limit)
  const existingSnap = await segmentsRef.where("version", "==", version).get();
  if (!existingSnap.empty) {
    await deleteInBatches(existingSnap.docs, db);
  }

  // Save in batches
  for (let i = 0; i < segments.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = segments.slice(i, i + BATCH_LIMIT);

    for (const segment of chunk) {
      const docRef = segmentsRef.doc();
      batch.set(docRef, {
        segmentId: docRef.id,
        ...segment,
        matchId: matchRef.id,
        version,
        createdAt: new Date().toISOString(),
      });
    }

    await batch.commit();
  }

  log.info("Saved segments", { matchId: matchRef.id, count: segments.length });
}

/**
 * Save events by type to Firestore
 */
async function saveEvents(
  matchRef: FirebaseFirestore.DocumentReference,
  events: ComprehensiveAnalysisResponse["events"],
  version: string,
  log: ILogger
): Promise<void> {
  const db = getDb();
  const matchId = matchRef.id;

  // Group events by type
  const eventsByType: Record<string, typeof events> = {};
  for (const event of events) {
    const collectionName = `${event.type}Events`;
    if (!eventsByType[collectionName]) {
      eventsByType[collectionName] = [];
    }
    eventsByType[collectionName].push(event);
  }

  // Save each type to its collection
  for (const [collectionName, typeEvents] of Object.entries(eventsByType)) {
    const eventsRef = matchRef.collection(collectionName);

    // Delete existing events for this version (in batches to avoid 500-item limit)
    const existingSnap = await eventsRef.where("version", "==", version).get();
    if (!existingSnap.empty) {
      await deleteInBatches(existingSnap.docs, db);
    }

    // Save in batches
    for (let i = 0; i < typeEvents.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = typeEvents.slice(i, i + BATCH_LIMIT);

      for (const event of chunk) {
        const docRef = eventsRef.doc();
        batch.set(docRef, {
          eventId: docRef.id,
          matchId,
          ...event,
          version,
          source: "gemini",
          createdAt: new Date().toISOString(),
        });
      }

      await batch.commit();
    }

    log.info(`Saved ${collectionName}`, { matchId, count: typeEvents.length });
  }
}

/**
 * Save important scenes to Firestore
 */
async function saveScenes(
  matchRef: FirebaseFirestore.DocumentReference,
  scenes: ComprehensiveAnalysisResponse["scenes"],
  version: string,
  log: ILogger
): Promise<void> {
  const db = getDb();
  const scenesRef = matchRef.collection("importantScenes");

  // Delete existing scenes for this version (in batches to avoid 500-item limit)
  const existingSnap = await scenesRef.where("version", "==", version).get();
  if (!existingSnap.empty) {
    await deleteInBatches(existingSnap.docs, db);
  }

  // Save in batches
  for (let i = 0; i < scenes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = scenes.slice(i, i + BATCH_LIMIT);

    for (const scene of chunk) {
      const docRef = scenesRef.doc();
      batch.set(docRef, {
        sceneId: docRef.id,
        matchId: matchRef.id,
        startSec: scene.startSec,
        endSec: scene.endSec ?? scene.startSec + 5, // Default 5 sec duration
        type: scene.type,
        team: scene.team,
        description: scene.description,
        importance: scene.importance,
        confidence: scene.confidence,
        suggestedClip: scene.suggestedClip,
        version,
        createdAt: new Date().toISOString(),
      });
    }

    await batch.commit();
  }

  log.info("Saved important scenes", { matchId: matchRef.id, count: scenes.length });
}

/**
 * Save players identification to Firestore
 */
async function savePlayers(
  matchRef: FirebaseFirestore.DocumentReference,
  players: ComprehensiveAnalysisResponse["players"],
  version: string,
  log: ILogger
): Promise<void> {
  await matchRef.collection("players").doc("current").set({
    matchId: matchRef.id,
    version,
    teams: players.teams,
    players: players.players,
    referees: players.referees ?? [],
    createdAt: new Date().toISOString(),
  });

  log.info("Saved players identification", {
    matchId: matchRef.id,
    playerCount: players.players.length,
  });
}

/**
 * Save clip labels to Firestore
 */
async function saveClipLabels(
  matchRef: FirebaseFirestore.DocumentReference,
  clipLabels: NonNullable<ComprehensiveAnalysisResponse["clipLabels"]>,
  version: string,
  log: ILogger
): Promise<void> {
  const db = getDb();
  const clipsRef = matchRef.collection("clips");

  // For each clip label, we need to find or create the clip document
  // Since comprehensive analysis doesn't have clipIds yet (clips are generated from scenes),
  // we store them temporarily in a separate collection
  const clipLabelsRef = matchRef.collection("clipLabels");

  // Clear existing (in batches to avoid 500-item limit)
  const existingSnap = await clipLabelsRef.where("version", "==", version).get();
  if (!existingSnap.empty) {
    await deleteInBatches(existingSnap.docs, db);
  }

  // Save clip labels
  for (let i = 0; i < clipLabels.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = clipLabels.slice(i, i + BATCH_LIMIT);

    for (const label of chunk) {
      const docRef = clipLabelsRef.doc();
      batch.set(docRef, {
        labelId: docRef.id,
        matchId: matchRef.id,
        timestamp: label.timestamp,
        label: label.label,
        confidence: label.confidence,
        title: label.title,
        summary: label.summary,
        tags: label.tags ?? [],
        coachTips: label.coachTips ?? [],
        version,
        createdAt: new Date().toISOString(),
      });
    }

    await batch.commit();
  }

  log.info("Saved clip labels", {
    matchId: matchRef.id,
    count: clipLabels.length,
  });
}
