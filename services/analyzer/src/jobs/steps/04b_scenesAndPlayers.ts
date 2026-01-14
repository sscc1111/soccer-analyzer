/**
 * Step 04b: Scenes and Players Detection (Hybrid Pipeline Call 2)
 *
 * ハイブリッドパイプライン - Call 2
 * Call 1の結果をコンテキストとして、シーン抽出と選手識別を同時に実行
 */

import type {
  ImportantSceneDoc,
  SceneType,
  SceneTeam,
  TeamId,
  TrackTeamMeta,
  TrackPlayerMapping,
} from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import {
  getValidCacheOrFallback,
  getCacheManager,
} from "../../gemini/cacheManager";
import { analyzeScenesAndPlayers } from "../../gemini/scenesAndPlayers";
import type { SegmentAndEventsResponse } from "../../gemini/schemas/segmentAndEvents";
import { defaultLogger as logger, ILogger } from "../../lib/logger";

// ============================================================
// Types
// ============================================================

export interface ScenesAndPlayersOptions {
  matchId: string;
  version: string;
  call1Result?: SegmentAndEventsResponse; // Optional - can be loaded from Firestore
  logger?: ILogger;
}

export interface ScenesAndPlayersResult {
  matchId: string;
  sceneCount: number;
  goalScenes: number;
  shotScenes: number;
  homePlayerCount: number;
  awayPlayerCount: number;
  refereeCount: number;
  skipped: boolean;
  error?: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Load Call 1 results from Firestore
 */
async function loadCall1ResultFromFirestore(
  matchId: string,
  version: string,
  log: ILogger
): Promise<SegmentAndEventsResponse | null> {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Load segments
  const segmentsSnap = await matchRef
    .collection("segments")
    .where("version", "==", version)
    .get();

  if (segmentsSnap.empty) {
    log.warn("No segments found for Call 1 context", { matchId, version });
    return null;
  }

  // Load events from all collections
  const [passSnap, carrySnap, turnoverSnap, shotSnap, setPieceSnap] =
    await Promise.all([
      matchRef.collection("passEvents").where("version", "==", version).get(),
      matchRef.collection("carryEvents").where("version", "==", version).get(),
      matchRef.collection("turnoverEvents").where("version", "==", version).get(),
      matchRef.collection("shotEvents").where("version", "==", version).get(),
      matchRef.collection("setPieceEvents").where("version", "==", version).get(),
    ]);

  // Load metadata from match document
  const matchDoc = await matchRef.get();
  const matchData = matchDoc.data();
  const segmentationMetadata = matchData?.segmentationMetadata;
  const teamInfo = matchData?.teamInfo;

  // Map segments to response format
  const segments = segmentsSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      startSec: d.startSec,
      endSec: d.endSec,
      type: d.type,
      subtype: d.subtype,
      description: d.description,
      attackingTeam: d.attackingTeam,
      importance: d.importance,
      confidence: d.confidence,
      visualEvidence: d.visualEvidence,
    };
  });

  // Map events to response format
  const events = [
    ...passSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        timestamp: d.timestamp,
        type: "pass" as const,
        team: d.kicker?.teamId || "home",
        player: d.kicker?.playerId || undefined,
        zone: undefined,
        details: { passType: d.passType, outcome: d.outcome },
        confidence: d.confidence,
      };
    }),
    ...carrySnap.docs.map((doc) => {
      const d = doc.data();
      return {
        timestamp: d.startTime,
        type: "carry" as const,
        team: d.teamId || "home",
        player: d.playerId || undefined,
        zone: undefined,
        details: { distance: d.distanceMeters },
        confidence: d.confidence,
      };
    }),
    ...turnoverSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        timestamp: d.timestamp,
        type: "turnover" as const,
        team: d.player?.teamId || "home",
        player: d.player?.playerId || undefined,
        zone: undefined,
        details: { turnoverType: d.context },
        confidence: d.confidence,
      };
    }),
    ...shotSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        timestamp: d.timestamp,
        type: "shot" as const,
        team: d.team || "home",
        player: d.player || undefined,
        zone: undefined,
        details: { shotResult: d.result },
        confidence: d.confidence,
      };
    }),
    ...setPieceSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        timestamp: d.timestamp,
        type: "setPiece" as const,
        team: d.team || "home",
        player: d.player || undefined,
        zone: undefined,
        details: { setPieceType: d.setPieceType },
        confidence: d.confidence,
      };
    }),
  ];

  return {
    metadata: {
      totalDurationSec: segmentationMetadata?.totalDurationSec || 0,
      videoQuality: segmentationMetadata?.videoQuality || "fair",
      qualityIssues: [],
    },
    teams: {
      home: {
        primaryColor: teamInfo?.home?.colors || "#FFFFFF",
        attackingDirection: teamInfo?.home?.attackingDirection,
      },
      away: {
        primaryColor: teamInfo?.away?.colors || "#000000",
        attackingDirection: teamInfo?.away?.attackingDirection,
      },
    },
    segments: segments as SegmentAndEventsResponse["segments"],
    events: events as SegmentAndEventsResponse["events"],
  };
}

// ============================================================
// Main Step
// ============================================================

export async function stepScenesAndPlayers(
  options: ScenesAndPlayersOptions
): Promise<ScenesAndPlayersResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child
    ? log.child({ step: "scenes_and_players" })
    : log;

  stepLogger.info("Starting hybrid scenes and players detection", {
    matchId,
    version,
  });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing data (idempotency)
  const [existingScenes, matchDoc] = await Promise.all([
    matchRef.collection("importantScenes").where("version", "==", version).limit(1).get(),
    matchRef.get(),
  ]);

  const existingPlayerData = matchDoc.data()?.geminiPlayerData;

  if (!existingScenes.empty && existingPlayerData?.version === version) {
    stepLogger.info("Scenes and players already exist for this version, skipping", {
      matchId,
      version,
    });

    const allScenesSnap = await matchRef
      .collection("importantScenes")
      .where("version", "==", version)
      .get();

    const scenes = allScenesSnap.docs.map((doc) => doc.data());

    return {
      matchId,
      sceneCount: scenes.length,
      goalScenes: scenes.filter((s) => s.type === "goal").length,
      shotScenes: scenes.filter((s) => s.type === "shot").length,
      homePlayerCount: existingPlayerData.homePlayerCount || 0,
      awayPlayerCount: existingPlayerData.awayPlayerCount || 0,
      refereeCount: existingPlayerData.refereeCount || 0,
      skipped: true,
    };
  }

  // Get cache info
  const cache = await getValidCacheOrFallback(matchId, "scenes_and_players");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found", { matchId });
    return {
      matchId,
      sceneCount: 0,
      goalScenes: 0,
      shotScenes: 0,
      homePlayerCount: 0,
      awayPlayerCount: 0,
      refereeCount: 0,
      skipped: true,
      error: "No video file URI available",
    };
  }

  // Get Call 1 results (from parameter or Firestore)
  let call1Result: SegmentAndEventsResponse;
  if (options.call1Result) {
    call1Result = options.call1Result;
  } else {
    const loadedResult = await loadCall1ResultFromFirestore(matchId, version, stepLogger);
    if (!loadedResult) {
      stepLogger.error("Could not load Call 1 results", { matchId, version });
      return {
        matchId,
        sceneCount: 0,
        goalScenes: 0,
        shotScenes: 0,
        homePlayerCount: 0,
        awayPlayerCount: 0,
        refereeCount: 0,
        skipped: true,
        error: "Call 1 results not found",
      };
    }
    call1Result = loadedResult;
  }

  stepLogger.info("Using video for scenes and players detection", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
    call1SegmentCount: call1Result.segments.length,
    call1EventCount: call1Result.events.length,
  });

  // Call Gemini API for combined analysis
  const result = await analyzeScenesAndPlayers({
    matchId,
    cache,
    call1Result,
    promptVersion: "v1",
    logger: stepLogger,
  });

  // Save scenes to Firestore
  const BATCH_LIMIT = 450;
  const now = new Date().toISOString();

  type DocWrite = { collection: string; id: string; data: unknown };
  const allDocs: DocWrite[] = [];

  // Prepare scene documents
  for (let i = 0; i < result.scenes.length; i++) {
    const scene = result.scenes[i];
    const sceneDoc: ImportantSceneDoc = {
      sceneId: `${matchId}_scene_${i}`,
      matchId,
      startSec: scene.startSec,
      endSec: scene.endSec || scene.startSec + 5,
      type: scene.type as SceneType,
      importance: scene.importance,
      description: scene.description,
      team: (scene.team || "unknown") as SceneTeam,
      confidence: scene.confidence,
      version,
      createdAt: now,
    };

    // Add suggested clip info if available
    if (scene.suggestedClip) {
      (sceneDoc as Record<string, unknown>).suggestedClip = scene.suggestedClip;
    }

    allDocs.push({ collection: "importantScenes", id: sceneDoc.sceneId, data: sceneDoc });
  }

  // Prepare player documents
  for (let i = 0; i < result.players.identified.length; i++) {
    const player = result.players.identified[i];
    const trackId = `${matchId}_gemini_player_${i}`;

    // Track team meta
    const teamMeta: TrackTeamMeta = {
      trackId,
      teamId: player.team as TeamId,
      teamConfidence: player.confidence,
      dominantColor:
        player.team === "home"
          ? result.players.teams.home.primaryColor
          : result.players.teams.away.primaryColor,
      classificationMethod: "color_clustering",
    };
    allDocs.push({ collection: "trackTeamMetas", id: trackId, data: teamMeta });

    // Player mapping if jersey number detected
    if (player.jerseyNumber !== null) {
      const mapping: TrackPlayerMapping = {
        trackId,
        playerId: null,
        jerseyNumber: player.jerseyNumber,
        ocrConfidence: player.confidence,
        source: "ocr",
        needsReview: player.confidence < 0.8,
        reviewReason: player.confidence < 0.8 ? "low_confidence" : undefined,
      };
      allDocs.push({ collection: "trackMappings", id: trackId, data: mapping });
    }
  }

  // Prepare referee documents
  if (result.players.referees) {
    for (let i = 0; i < result.players.referees.length; i++) {
      const referee = result.players.referees[i];
      allDocs.push({
        collection: "referees",
        id: `ref_${i}`,
        data: {
          refereeId: `ref_${i}`,
          role: referee.role,
          uniformColor: referee.uniformColor,
          version,
          createdAt: now,
        },
      });
    }
  }

  // Commit in batches
  const totalBatches = Math.ceil(allDocs.length / BATCH_LIMIT);
  stepLogger.info("Writing scenes and players to Firestore", {
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

  // Update match document with player data
  const homePlayers = result.players.identified.filter((p) => p.team === "home");
  const awayPlayers = result.players.identified.filter((p) => p.team === "away");

  await matchRef.set(
    {
      settings: {
        teamColors: {
          home: result.players.teams.home.primaryColor,
          away: result.players.teams.away.primaryColor,
        },
      },
      geminiPlayerData: {
        version,
        teams: result.players.teams,
        homePlayerCount: homePlayers.length,
        awayPlayerCount: awayPlayers.length,
        refereeCount: result.players.referees?.length || 0,
        createdAt: now,
      },
    },
    { merge: true }
  );

  // Update cache usage if using actual cache
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  const goalScenes = result.scenes.filter((s) => s.type === "goal").length;
  const shotScenes = result.scenes.filter((s) => s.type === "shot").length;

  stepLogger.info("Scenes and players detection complete", {
    matchId,
    sceneCount: result.scenes.length,
    goalScenes,
    shotScenes,
    homePlayerCount: homePlayers.length,
    awayPlayerCount: awayPlayers.length,
    refereeCount: result.players.referees?.length || 0,
  });

  return {
    matchId,
    sceneCount: result.scenes.length,
    goalScenes,
    shotScenes,
    homePlayerCount: homePlayers.length,
    awayPlayerCount: awayPlayers.length,
    refereeCount: result.players.referees?.length || 0,
    skipped: false,
  };
}
