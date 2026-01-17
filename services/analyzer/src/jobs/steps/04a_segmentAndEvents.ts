/**
 * Step 04a: Segment and Events Detection (Hybrid Pipeline Call 1)
 *
 * ハイブリッドパイプライン - Call 1
 * 1回のGemini API呼び出しでセグメント分割とイベント検出を同時に実行
 */

import type {
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  ShotEventDoc,
  SetPieceEventDoc,
  TeamId,
  Point2D,
} from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import {
  getValidCacheOrFallback,
  getCacheManager,
} from "../../gemini/cacheManager";
import { analyzeSegmentAndEvents } from "../../gemini/segmentAndEvents";
import type { SegmentAndEventsResponse } from "../../gemini/schemas/segmentAndEvents";
import { defaultLogger as logger, ILogger } from "../../lib/logger";

// ============================================================
// Types
// ============================================================

export interface SegmentAndEventsOptions {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  version: string;
  logger?: ILogger;
}

export interface VideoSegmentDoc {
  segmentId: string;
  matchId: string;
  version: string;
  createdAt: string;
  startSec: number;
  endSec: number;
  type: string;
  subtype?: string;
  description: string;
  attackingTeam?: string | null;
  importance?: number;
  confidence: number;
  visualEvidence?: string;
}

export interface SegmentAndEventsResult {
  matchId: string;
  segmentCount: number;
  passCount: number;
  carryCount: number;
  turnoverCount: number;
  shotCount: number;
  setPieceCount: number;
  totalDurationSec: number;
  videoQuality: string;
  skipped: boolean;
  error?: string;
}

// ============================================================
// Main Step
// ============================================================

export async function stepSegmentAndEvents(
  options: SegmentAndEventsOptions
): Promise<SegmentAndEventsResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child
    ? log.child({ step: "segment_and_events" })
    : log;

  stepLogger.info("Starting hybrid segment and events detection", {
    matchId,
    version,
  });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing data (idempotency)
  const [existingSegments, existingPassEvents] = await Promise.all([
    matchRef.collection("segments").where("version", "==", version).limit(1).get(),
    matchRef.collection("passEvents").where("version", "==", version).limit(1).get(),
  ]);

  if (!existingSegments.empty && !existingPassEvents.empty) {
    stepLogger.info("Segments and events already exist for this version, skipping", {
      matchId,
      version,
    });

    // Get counts from existing data
    const [
      segmentSnap,
      passSnap,
      carrySnap,
      turnoverSnap,
      shotSnap,
      setPieceSnap,
    ] = await Promise.all([
      matchRef.collection("segments").where("version", "==", version).get(),
      matchRef.collection("passEvents").where("version", "==", version).get(),
      matchRef.collection("carryEvents").where("version", "==", version).get(),
      matchRef.collection("turnoverEvents").where("version", "==", version).get(),
      matchRef.collection("shotEvents").where("version", "==", version).get(),
      matchRef.collection("setPieceEvents").where("version", "==", version).get(),
    ]);

    const matchDoc = await matchRef.get();
    const matchData = matchDoc.data();

    return {
      matchId,
      segmentCount: segmentSnap.size,
      passCount: passSnap.size,
      carryCount: carrySnap.size,
      turnoverCount: turnoverSnap.size,
      shotCount: shotSnap.size,
      setPieceCount: setPieceSnap.size,
      totalDurationSec: matchData?.segmentationMetadata?.totalDurationSec || 0,
      videoQuality: matchData?.segmentationMetadata?.videoQuality || "unknown",
      skipped: true,
    };
  }

  // Get cache info (with fallback to direct file URI)
  const cache = await getValidCacheOrFallback(matchId, options.videoId, "segment_and_events");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found", { matchId });
    return {
      matchId,
      segmentCount: 0,
      passCount: 0,
      carryCount: 0,
      turnoverCount: 0,
      shotCount: 0,
      setPieceCount: 0,
      totalDurationSec: 0,
      videoQuality: "unknown",
      skipped: true,
      error: "No video file URI available",
    };
  }

  stepLogger.info("Using video for segment and events detection", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
  });

  // Call Gemini API for combined analysis
  const result = await analyzeSegmentAndEvents({
    matchId,
    cache,
    promptVersion: "v1",
    logger: stepLogger,
  });

  // Categorize events
  const passEvents = result.events.filter((e) => e.type === "pass");
  const carryEvents = result.events.filter((e) => e.type === "carry");
  const turnoverEvents = result.events.filter((e) => e.type === "turnover");
  const shotEvents = result.events.filter((e) => e.type === "shot");
  const setPieceEvents = result.events.filter((e) => e.type === "setPiece");

  // Save all data to Firestore
  const BATCH_LIMIT = 450;
  const now = new Date().toISOString();

  // Collect all documents
  type DocWrite = { collection: string; id: string; data: unknown };
  const allDocs: DocWrite[] = [];

  // Prepare segment documents
  for (let i = 0; i < result.segments.length; i++) {
    const segment = result.segments[i];
    const segmentDoc: VideoSegmentDoc = {
      segmentId: `${matchId}_segment_${i}`,
      matchId,
      version,
      createdAt: now,
      startSec: segment.startSec,
      endSec: segment.endSec,
      type: segment.type,
      subtype: segment.subtype ?? undefined,
      description: segment.description,
      attackingTeam: segment.attackingTeam ?? null,
      importance: segment.importance,
      confidence: segment.confidence,
      visualEvidence: segment.visualEvidence,
    };
    allDocs.push({ collection: "segments", id: segmentDoc.segmentId, data: segmentDoc });
  }

  // Prepare pass events
  for (let i = 0; i < passEvents.length; i++) {
    const e = passEvents[i];
    const eventDoc: PassEventDoc = {
      eventId: `${matchId}_pass_${i}`,
      matchId,
      type: "pass",
      frameNumber: Math.floor(e.timestamp * 30),
      timestamp: e.timestamp,
      kicker: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: { x: 0, y: 0 } as Point2D,
        confidence: e.confidence,
      },
      receiver: e.details?.targetPlayer
        ? {
            trackId: null,
            playerId: e.details.targetPlayer,
            teamId: e.team as TeamId,
            position: null,
            confidence: e.confidence,
          }
        : null,
      outcome: (e.details?.outcome || "complete") as "complete" | "incomplete" | "intercepted",
      outcomeConfidence: e.confidence,
      passType: e.details?.passType,
      confidence: e.confidence,
      needsReview: e.confidence < 0.7,
      source: "auto",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "passEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare carry events
  for (let i = 0; i < carryEvents.length; i++) {
    const e = carryEvents[i];
    const eventDoc: CarryEventDoc = {
      eventId: `${matchId}_carry_${i}`,
      matchId,
      type: "carry",
      trackId: "",
      playerId: e.player || null,
      teamId: e.team as TeamId,
      startFrame: Math.floor(e.timestamp * 30),
      endFrame: Math.floor(e.timestamp * 30) + 30,
      startTime: e.timestamp,
      endTime: e.timestamp + 1,
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 0, y: 0 },
      carryIndex: 0,
      progressIndex: 0,
      distanceMeters: e.details?.distance,
      confidence: e.confidence,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "carryEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare turnover events
  for (let i = 0; i < turnoverEvents.length; i++) {
    const e = turnoverEvents[i];
    const eventDoc: TurnoverEventDoc = {
      eventId: `${matchId}_turnover_${i}`,
      matchId,
      type: "turnover",
      turnoverType: "lost",
      frameNumber: Math.floor(e.timestamp * 30),
      timestamp: e.timestamp,
      player: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: { x: 0, y: 0 },
      },
      context: e.details?.turnoverType as
        | "tackle"
        | "interception"
        | "bad_touch"
        | "out_of_bounds"
        | "other"
        | undefined,
      confidence: e.confidence,
      needsReview: e.confidence < 0.7,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "turnoverEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare shot events
  for (let i = 0; i < shotEvents.length; i++) {
    const e = shotEvents[i];
    const eventDoc: ShotEventDoc = {
      eventId: `${matchId}_shot_${i}`,
      matchId,
      type: "shot",
      timestamp: e.timestamp,
      team: e.team as TeamId,
      player: e.player,
      result: (e.details?.shotResult || "missed") as
        | "goal"
        | "saved"
        | "blocked"
        | "missed"
        | "post",
      confidence: e.confidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "shotEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare set piece events
  for (let i = 0; i < setPieceEvents.length; i++) {
    const e = setPieceEvents[i];
    const eventDoc: SetPieceEventDoc = {
      eventId: `${matchId}_setpiece_${i}`,
      matchId,
      type: "setPiece",
      timestamp: e.timestamp,
      team: e.team as TeamId,
      player: e.player,
      setPieceType: (e.details?.setPieceType || "free_kick") as
        | "corner"
        | "free_kick"
        | "penalty"
        | "throw_in"
        | "goal_kick",
      confidence: e.confidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "setPieceEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Commit in batches
  const totalBatches = Math.ceil(allDocs.length / BATCH_LIMIT);
  stepLogger.info("Writing segments and events to Firestore", {
    totalDocs: allDocs.length,
    totalBatches,
    batchLimit: BATCH_LIMIT,
  });

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, allDocs.length);

    for (let i = startIdx; i < endIdx; i++) {
      const doc = allDocs[i];
      batch.set(matchRef.collection(doc.collection).doc(doc.id), doc.data);
    }

    await batch.commit();
    stepLogger.debug("Batch committed", {
      batchIdx: batchIdx + 1,
      totalBatches,
      docsInBatch: endIdx - startIdx,
    });
  }

  // Save metadata to match document
  await matchRef.update({
    segmentationMetadata: {
      totalDurationSec: result.metadata.totalDurationSec,
      videoQuality: result.metadata.videoQuality,
      qualityNotes: result.metadata.qualityIssues?.join(", ") || null,
      version,
      createdAt: now,
    },
    teamInfo: {
      home: {
        colors: result.teams.home.primaryColor,
        attackingDirection: result.teams.home.attackingDirection,
      },
      away: {
        colors: result.teams.away.primaryColor,
        attackingDirection: result.teams.away.attackingDirection,
      },
    },
  });

  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Segment and events detection complete", {
    matchId,
    segmentCount: result.segments.length,
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
    setPieceCount: setPieceEvents.length,
    totalDuration: result.metadata.totalDurationSec,
    videoQuality: result.metadata.videoQuality,
  });

  return {
    matchId,
    segmentCount: result.segments.length,
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
    setPieceCount: setPieceEvents.length,
    totalDurationSec: result.metadata.totalDurationSec,
    videoQuality: result.metadata.videoQuality,
    skipped: false,
  };
}
