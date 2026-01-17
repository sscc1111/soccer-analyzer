/**
 * Step 10: Detect pass, carry, and turnover events
 *
 * This step will:
 * 1. Analyze ball-player proximity to determine possession
 * 2. Detect passes (ball transfer between players)
 * 3. Detect carries (ball movement while in possession)
 * 4. Detect turnovers (possession change between teams)
 * 5. Flag low-confidence events for user review
 *
 * Status: INTEGRATED - Using detection/events.ts module
 */

import { getDb } from "../../firebase/admin";
import type {
  TrackDoc,
  TrackTeamMeta,
  BallTrackDoc,
  TrackPlayerMapping,
  PossessionSegment,
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  PendingReviewDoc,
  TrackingProcessingStatus,
  MatchSettings,
  TeamId,
} from "@soccer/shared";
import { createStepLogger, type ILogger } from "../../lib/logger";
import { wrapError } from "../../lib/errors";
import {
  detectAllEvents,
  extractPendingReviews,
  convertTracksForDetection,
  convertBallForDetection,
  DEFAULT_EVENT_CONFIG,
} from "../../detection/events";

type StepOptions = {
  matchId: string;
  videoId?: string;
  version: string;
  logger?: ILogger;
};

/**
 * Update tracking processing status in Firestore
 */
async function updateTrackingStatus(
  matchId: string,
  status: Partial<TrackingProcessingStatus>
) {
  const db = getDb();
  await db
    .collection("matches")
    .doc(matchId)
    .collection("trackingStatus")
    .doc("current")
    .set(
      {
        matchId,
        ...status,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
}

/**
 * Detect events from tracking data using the event detection module
 */
export async function stepDetectEvents({
  matchId,
  videoId,
  version,
  logger,
}: StepOptions) {
  const stepLog = logger ? createStepLogger(logger, "detect_events") : null;
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  try {
    await updateTrackingStatus(matchId, {
      stage: "detecting_events",
      progress: 0,
    });

    // Get match settings
    const matchSnap = await matchRef.get();
    const matchData = matchSnap.data() as { settings?: MatchSettings } | undefined;
    const attackDirection = matchData?.settings?.attackDirection ?? null;

    // Get tracking data
    const [tracksSnap, teamMetasSnap, ballTrackSnap, mappingsSnap] = await Promise.all([
      matchRef.collection("tracks").get(),
      matchRef.collection("trackTeamMetas").get(),
      matchRef.collection("ballTrack").doc("current").get(),
      matchRef.collection("trackMappings").get(),
    ]);

    const tracks = tracksSnap.docs.map((doc) => doc.data() as TrackDoc);
    const teamMetas = new Map<string, TeamId>(
      teamMetasSnap.docs.map((doc) => {
        const meta = doc.data() as TrackTeamMeta;
        return [doc.id, meta.teamId];
      })
    );
    const ballTrack = ballTrackSnap.exists ? (ballTrackSnap.data() as BallTrackDoc) : null;
    const mappings = new Map<string, string | null>(
      mappingsSnap.docs.map((doc) => {
        const mapping = doc.data() as TrackPlayerMapping;
        return [doc.id, mapping.playerId];
      })
    );

    stepLog?.info("Starting event detection", {
      trackCount: tracks.length,
      ballDetectionCount: ballTrack?.detections.length ?? 0,
      attackDirection: attackDirection ?? "not_set",
    });

    await updateTrackingStatus(matchId, { progress: 10 });

    // Check if we have enough data to detect events
    if (tracks.length === 0 || !ballTrack || ballTrack.detections.length === 0) {
      stepLog?.info("Insufficient data for event detection", {
        trackCount: tracks.length,
        hasBallTrack: !!ballTrack,
        ballDetectionCount: ballTrack?.detections.length ?? 0,
      });

      // Save empty results
      await updateTrackingStatus(matchId, {
        stage: "done",
        progress: 100,
        completedAt: new Date().toISOString(),
      });

      return {
        matchId,
        version,
        possessionCount: 0,
        passCount: 0,
        carryCount: 0,
        turnoverCount: 0,
        reviewCount: 0,
      };
    }

    // Convert data to detection format
    const trackData = convertTracksForDetection(
      tracks.map((t) => ({
        trackId: t.trackId,
        frames: t.frames,
      })),
      teamMetas,
      mappings
    );
    const ballData = convertBallForDetection(ballTrack.detections);

    stepLog?.info("Data converted for detection", {
      trackDataCount: trackData.length,
      ballFrameCount: ballData.frames.size,
    });

    await updateTrackingStatus(matchId, { progress: 30 });

    // Run event detection pipeline
    const detectedEvents = detectAllEvents(
      trackData,
      ballData,
      matchId,
      mappings,
      attackDirection,
      DEFAULT_EVENT_CONFIG
    );

    stepLog?.info("Events detected", {
      possessionSegments: detectedEvents.possessionSegments.length,
      passEvents: detectedEvents.passEvents.length,
      carryEvents: detectedEvents.carryEvents.length,
      turnoverEvents: detectedEvents.turnoverEvents.length,
    });

    await updateTrackingStatus(matchId, { progress: 70 });

    // Extract events that need user review
    const pendingReviews = extractPendingReviews(detectedEvents, matchId, videoId);

    stepLog?.info("Pending reviews extracted", {
      reviewCount: pendingReviews.length,
    });

    await updateTrackingStatus(matchId, { progress: 80 });

    // Save all events to Firestore
    await Promise.all([
      saveCollection(
        matchRef,
        "possessionSegments",
        detectedEvents.possessionSegments,
        (s) => `pos_${s.trackId}_${s.startFrame}`
      ),
      saveCollection(
        matchRef,
        "passEvents",
        detectedEvents.passEvents,
        (e) => e.eventId
      ),
      saveCollection(
        matchRef,
        "carryEvents",
        detectedEvents.carryEvents,
        (e) => e.eventId
      ),
      saveCollection(
        matchRef,
        "turnoverEvents",
        detectedEvents.turnoverEvents,
        (e) => e.eventId
      ),
      saveCollection(
        matchRef,
        "pendingReviews",
        pendingReviews,
        (r) => r.eventId
      ),
    ]);

    await updateTrackingStatus(matchId, {
      stage: "done",
      progress: 100,
      completedAt: new Date().toISOString(),
    });

    stepLog?.complete("Event detection completed", {
      possessionCount: detectedEvents.possessionSegments.length,
      passCount: detectedEvents.passEvents.length,
      carryCount: detectedEvents.carryEvents.length,
      turnoverCount: detectedEvents.turnoverEvents.length,
      reviewCount: pendingReviews.length,
    });

    return {
      matchId,
      version,
      possessionCount: detectedEvents.possessionSegments.length,
      passCount: detectedEvents.passEvents.length,
      carryCount: detectedEvents.carryEvents.length,
      turnoverCount: detectedEvents.turnoverEvents.length,
      reviewCount: pendingReviews.length,
    };
  } catch (error) {
    const wrapped = wrapError(error, { matchId, step: "detect_events" });
    stepLog?.error("Event detection failed", wrapped);
    throw wrapped;
  }
}

/**
 * Helper to save a collection of documents in batches
 */
async function saveCollection<T extends Record<string, unknown>>(
  matchRef: FirebaseFirestore.DocumentReference,
  collectionName: string,
  items: T[],
  getDocId: (item: T) => string
) {
  if (items.length === 0) return;

  const db = getDb();
  const collRef = matchRef.collection(collectionName);

  const BATCH_SIZE = 400;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = items.slice(i, i + BATCH_SIZE);

    for (const item of chunk) {
      batch.set(collRef.doc(getDocId(item)), item);
    }

    await batch.commit();
  }
}
