/**
 * Step 07c: Deduplicate Events (Phase 2.3)
 *
 * Takes raw events from windowed detection (step 07b) and deduplicates them
 * before saving to Firestore. Events detected in overlapping windows are
 * merged to avoid duplicate event entries.
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
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import {
  deduplicateEvents,
  calculateDeduplicationStats,
  type RawEvent,
  type DeduplicatedEvent,
  type DeduplicationConfig,
  DEFAULT_DEDUPLICATION_CONFIG,
} from "../../lib/deduplication";

export type DeduplicateEventsOptions = {
  matchId: string;
  version: string;
  /** Raw events from windowed detection */
  rawEvents: RawEvent[];
  /** Optional deduplication configuration */
  config?: Partial<DeduplicationConfig>;
  /** Video FPS for frame number calculation (default: 30) */
  fps?: number;
  logger?: ILogger;
};

export type DeduplicateEventsResult = {
  matchId: string;
  /** Count before deduplication */
  rawEventCount: number;
  /** Count after deduplication */
  deduplicatedEventCount: number;
  /** Number of events that were merged */
  mergedCount: number;
  /** Breakdown by event type */
  passCount: number;
  carryCount: number;
  turnoverCount: number;
  shotCount: number;
  setPieceCount: number;
  skipped: boolean;
};

/**
 * Deduplicate events and save to Firestore.
 *
 * This step:
 * 1. Takes raw events from overlapping time windows
 * 2. Clusters events by time, type, and team
 * 3. Merges duplicate detections
 * 4. Converts to final event documents
 * 5. Saves to appropriate Firestore collections
 */
export async function stepDeduplicateEvents(
  options: DeduplicateEventsOptions
): Promise<DeduplicateEventsResult> {
  const { matchId, version, rawEvents } = options;
  const fps = options.fps ?? 30; // Default to 30fps if not provided
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "deduplicate_events" }) : log;

  stepLogger.info("Starting event deduplication", {
    matchId,
    version,
    rawEventCount: rawEvents.length,
  });

  // Check for existing events (idempotency)
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  const existingPassEvents = await matchRef
    .collection("passEvents")
    .where("version", "==", version)
    .limit(1)
    .get();

  if (!existingPassEvents.empty) {
    stepLogger.info("Events already exist for this version, skipping deduplication", {
      matchId,
      version,
    });

    // Get counts from existing data
    const [passSnap, carrySnap, turnoverSnap, shotSnap, setPieceSnap] = await Promise.all([
      matchRef.collection("passEvents").where("version", "==", version).get(),
      matchRef.collection("carryEvents").where("version", "==", version).get(),
      matchRef.collection("turnoverEvents").where("version", "==", version).get(),
      matchRef.collection("shotEvents").where("version", "==", version).get(),
      matchRef.collection("setPieceEvents").where("version", "==", version).get(),
    ]);

    return {
      matchId,
      rawEventCount: 0,
      deduplicatedEventCount: passSnap.size + carrySnap.size + turnoverSnap.size + shotSnap.size + setPieceSnap.size,
      mergedCount: 0,
      passCount: passSnap.size,
      carryCount: carrySnap.size,
      turnoverCount: turnoverSnap.size,
      shotCount: shotSnap.size,
      setPieceCount: setPieceSnap.size,
      skipped: true,
    };
  }

  // Merge configuration with defaults
  const config: DeduplicationConfig = {
    ...DEFAULT_DEDUPLICATION_CONFIG,
    ...options.config,
  };

  // Perform deduplication
  const deduplicatedEvents = deduplicateEvents(rawEvents, config);
  const stats = calculateDeduplicationStats(rawEvents, deduplicatedEvents);

  stepLogger.info("Deduplication complete", {
    before: stats.totalRawEvents,
    after: stats.totalDeduplicatedEvents,
    merged: stats.mergedCount,
    unique: stats.uniqueCount,
    averageClusterSize: stats.averageClusterSize.toFixed(2),
    byType: stats.byType,
  });

  // Categorize deduplicated events by type
  const passEvents = deduplicatedEvents.filter((e) => e.type === "pass");
  const carryEvents = deduplicatedEvents.filter((e) => e.type === "carry");
  const turnoverEvents = deduplicatedEvents.filter((e) => e.type === "turnover");
  const shotEvents = deduplicatedEvents.filter((e) => e.type === "shot");
  const setPieceEvents = deduplicatedEvents.filter((e) => e.type === "setPiece");

  // Convert to Firestore documents and save
  const BATCH_LIMIT = 450; // Leave buffer for safety (Firestore max is 500)
  const now = new Date().toISOString();

  type DocWrite = { collection: string; id: string; data: unknown };
  const allDocs: DocWrite[] = [];

  // Convert pass events
  for (let i = 0; i < passEvents.length; i++) {
    const e = passEvents[i];
    const eventDoc: PassEventDoc = {
      eventId: `${matchId}_pass_${i}`,
      matchId,
      type: "pass",
      frameNumber: Math.floor(e.absoluteTimestamp * fps),
      timestamp: e.absoluteTimestamp,
      kicker: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: { x: 0, y: 0 } as Point2D,
        confidence: e.adjustedConfidence,
      },
      receiver: e.details?.targetPlayer
        ? {
            trackId: null,
            playerId: e.details.targetPlayer as string,
            teamId: e.team as TeamId,
            position: null,
            confidence: e.adjustedConfidence,
          }
        : null,
      outcome: (e.details?.outcome || "complete") as "complete" | "incomplete" | "intercepted",
      outcomeConfidence: e.adjustedConfidence,
      passType: e.details?.passType as "short" | "medium" | "long" | "through" | "cross" | undefined,
      confidence: e.adjustedConfidence,
      needsReview: e.adjustedConfidence < 0.7,
      source: "auto",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "passEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert carry events
  for (let i = 0; i < carryEvents.length; i++) {
    const e = carryEvents[i];
    const eventDoc: CarryEventDoc = {
      eventId: `${matchId}_carry_${i}`,
      matchId,
      type: "carry",
      trackId: "",
      playerId: e.player || null,
      teamId: e.team as TeamId,
      startFrame: Math.floor(e.absoluteTimestamp * fps),
      endFrame: Math.floor(e.absoluteTimestamp * fps) + fps, // Assume 1 second duration
      startTime: e.absoluteTimestamp,
      endTime: e.absoluteTimestamp + 1,
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 0, y: 0 },
      carryIndex: 0,
      progressIndex: 0,
      distanceMeters: e.details?.distance as number | undefined,
      confidence: e.adjustedConfidence,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "carryEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert turnover events
  for (let i = 0; i < turnoverEvents.length; i++) {
    const e = turnoverEvents[i];
    const eventDoc: TurnoverEventDoc = {
      eventId: `${matchId}_turnover_${i}`,
      matchId,
      type: "turnover",
      turnoverType: "lost",
      frameNumber: Math.floor(e.absoluteTimestamp * fps),
      timestamp: e.absoluteTimestamp,
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
      confidence: e.adjustedConfidence,
      needsReview: e.adjustedConfidence < 0.7,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "turnoverEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert shot events
  for (let i = 0; i < shotEvents.length; i++) {
    const e = shotEvents[i];
    const eventDoc: ShotEventDoc = {
      eventId: `${matchId}_shot_${i}`,
      matchId,
      type: "shot",
      timestamp: e.absoluteTimestamp,
      team: e.team as TeamId,
      player: e.player,
      result: (e.details?.shotResult || "missed") as "goal" | "saved" | "blocked" | "missed" | "post",
      confidence: e.adjustedConfidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "shotEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert set piece events
  for (let i = 0; i < setPieceEvents.length; i++) {
    const e = setPieceEvents[i];
    const eventDoc: SetPieceEventDoc = {
      eventId: `${matchId}_setpiece_${i}`,
      matchId,
      type: "setPiece",
      timestamp: e.absoluteTimestamp,
      team: e.team as TeamId,
      player: e.player,
      setPieceType: (e.details?.setPieceType || "free_kick") as
        | "corner"
        | "free_kick"
        | "penalty"
        | "throw_in"
        | "goal_kick",
      confidence: e.adjustedConfidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "setPieceEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Commit in batches to respect Firestore 500 operation limit
  const totalBatches = Math.ceil(allDocs.length / BATCH_LIMIT);
  stepLogger.info("Writing deduplicated events to Firestore", {
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

  stepLogger.info("Event deduplication and save complete", {
    matchId,
    rawEvents: stats.totalRawEvents,
    deduplicatedEvents: stats.totalDeduplicatedEvents,
    reductionPercent: (
      ((stats.totalRawEvents - stats.totalDeduplicatedEvents) / stats.totalRawEvents) *
      100
    ).toFixed(1),
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
    setPieceCount: setPieceEvents.length,
  });

  return {
    matchId,
    rawEventCount: stats.totalRawEvents,
    deduplicatedEventCount: stats.totalDeduplicatedEvents,
    mergedCount: stats.mergedCount,
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
    setPieceCount: setPieceEvents.length,
    skipped: false,
  };
}
