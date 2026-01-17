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
import {
  getPositionFromZone,
  type EventZone,
  type PositionSource,
  type PositionWithMetadata,
} from "../../lib/zoneToCoordinate";
import {
  matchBallPositionsToEvents,
  ballMatchToPositionMetadata,
  selectBestPosition,
} from "../../lib/ballPositionMatcher";
import {
  validateEvents,
  summarizeValidationResult,
  type ValidationResult,
} from "../../lib/eventValidation";
import {
  enrichEvents,
  detectPassChains,
  calculateEnrichmentStats,
  type EnrichedEvent,
} from "../../lib/eventEnrichment";
import {
  calculatePerformerIdentificationConfidence,
} from "../../lib/playerConfidenceCalculator";
import {
  analyzeSetPieceOutcomes,
  type SetPieceOutcomeAnalysis,
} from "../../lib/setPieceOutcomeAnalysis";

export type DeduplicateEventsOptions = {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
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
  /** Validation result (if validation was performed) */
  validation?: {
    valid: boolean;
    errorCount: number;
    warningCount: number;
    warningsByType: Record<string, number>;
  };
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
  const { matchId, videoId, version, rawEvents } = options;
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

  // Categorize deduplicated events by type (will be replaced with enriched events after enrichment)
  const passEventsBase = deduplicatedEvents.filter((e) => e.type === "pass");
  const carryEventsBase = deduplicatedEvents.filter((e) => e.type === "carry");
  const turnoverEvents = deduplicatedEvents.filter((e) => e.type === "turnover");
  const shotEventsBase = deduplicatedEvents.filter((e) => e.type === "shot");
  const setPieceEvents = deduplicatedEvents.filter((e) => e.type === "setPiece");

  // Option 3: Get ball positions for all events
  const eventTimestamps = deduplicatedEvents.map((e) => e.absoluteTimestamp);
  const ballPositions = await matchBallPositionsToEvents(matchId, eventTimestamps);

  stepLogger.info("Ball position matching complete", {
    matchId,
    totalEvents: eventTimestamps.length,
    matchedWithBall: Array.from(ballPositions.values()).filter((p) => p !== null).length,
  });

  // Run validation on deduplicated events
  const validationResult: ValidationResult = validateEvents(deduplicatedEvents);

  // Log validation summary
  const validationSummary = summarizeValidationResult(validationResult);
  stepLogger.info("Event validation complete", {
    matchId,
    valid: validationResult.valid,
    errorCount: validationResult.errors.length,
    warningCount: validationResult.warnings.length,
  });

  // Log detailed warnings by type
  if (validationResult.warnings.length > 0) {
    const warningsByType: Record<string, number> = {};
    for (const warning of validationResult.warnings) {
      warningsByType[warning.type] = (warningsByType[warning.type] || 0) + 1;
    }
    stepLogger.info("Validation warnings by type", {
      matchId,
      warningsByType,
    });

    // Log high-severity warnings
    const highSeverityWarnings = validationResult.warnings.filter((w) => w.severity === "high");
    if (highSeverityWarnings.length > 0) {
      stepLogger.warn("High-severity validation warnings detected", {
        matchId,
        count: highSeverityWarnings.length,
        warnings: highSeverityWarnings.map((w) => ({
          type: w.type,
          message: w.message,
          eventIndex: w.eventIndex,
        })),
      });
    }
  }

  // Log validation errors
  if (validationResult.errors.length > 0) {
    stepLogger.error("Validation errors detected", {
      matchId,
      count: validationResult.errors.length,
      errors: validationResult.errors.map((e) => ({
        type: e.type,
        message: e.message,
        eventIndex: e.eventIndex,
      })),
    });
  }

  // Enrich events with additional calculated data (pass direction, xG, etc.)
  const enrichedEvents = enrichEvents(deduplicatedEvents);
  const passChains = detectPassChains(deduplicatedEvents);
  const enrichmentStats = calculateEnrichmentStats(enrichedEvents, passChains);

  // Section 3.2.2: Analyze set piece outcomes
  const setPieceOutcomes = analyzeSetPieceOutcomes(
    deduplicatedEvents.filter((e) => e.type === "setPiece"),
    deduplicatedEvents
  );

  stepLogger.info("Event enrichment complete", {
    matchId,
    totalEvents: enrichmentStats.totalEvents,
    passEvents: {
      total: enrichmentStats.passEvents.total,
      forward: enrichmentStats.passEvents.forward,
      backward: enrichmentStats.passEvents.backward,
      lateral: enrichmentStats.passEvents.lateral,
    },
    carryEvents: {
      total: enrichmentStats.carryEvents.total,
      dribbles: enrichmentStats.carryEvents.dribbles,
      simpleCarries: enrichmentStats.carryEvents.simpleCarries,
      averageDistance: enrichmentStats.carryEvents.averageDistance.toFixed(1),
      averageDribbleConfidence: enrichmentStats.carryEvents.averageDribbleConfidence.toFixed(2),
    },
    shotEvents: {
      total: enrichmentStats.shotEvents.total,
      totalXG: enrichmentStats.shotEvents.totalXG.toFixed(2),
      averageXG: enrichmentStats.shotEvents.averageXG.toFixed(2),
      inPenaltyArea: enrichmentStats.shotEvents.inPenaltyArea,
    },
    passChains: {
      total: enrichmentStats.passChains.total,
      averageLength: enrichmentStats.passChains.averageLength.toFixed(1),
      maxLength: enrichmentStats.passChains.maxLength,
    },
  });

  // Section 3.2.2: Log set piece outcome statistics
  const setPieceOutcomeStats = {
    total: setPieceOutcomes.length,
    goals: setPieceOutcomes.filter((o) => o.resultType === "goal").length,
    shots: setPieceOutcomes.filter((o) => o.resultType === "shot").length,
    cleared: setPieceOutcomes.filter((o) => o.resultType === "cleared").length,
    turnovers: setPieceOutcomes.filter((o) => o.resultType === "turnover").length,
    continuedPlay: setPieceOutcomes.filter((o) => o.resultType === "continued_play").length,
    scoringChances: setPieceOutcomes.filter((o) => o.scoringChance).length,
    averageTimeToOutcome:
      setPieceOutcomes.length > 0
        ? (
            setPieceOutcomes.reduce((sum, o) => sum + o.timeToOutcome, 0) /
            setPieceOutcomes.length
          ).toFixed(1)
        : 0,
  };

  stepLogger.info("Set piece outcome analysis complete", {
    matchId,
    setPieceOutcomes: setPieceOutcomeStats,
  });

  // Categorize enriched events by type (for pass and shot events with enriched data)
  const passEvents = enrichedEvents.filter((e) => e.type === "pass");
  const carryEvents = enrichedEvents.filter((e) => e.type === "carry");
  const shotEvents = enrichedEvents.filter((e) => e.type === "shot");

  // Helper function to fetch player identification data from Firestore
  const getPlayerData = async (playerId: string | undefined): Promise<{ jerseyNumber: number | null; confidence: number } | null> => {
    if (!playerId) return null;

    try {
      // Try to find player in trackMappings by jersey number match
      const mappingsSnap = await matchRef.collection("trackMappings").get();

      for (const doc of mappingsSnap.docs) {
        const mapping = doc.data();
        // Match by jersey number (playerId might be "#10" format)
        const jerseyMatch = playerId.match(/#?(\d+)/);
        if (jerseyMatch && mapping.jerseyNumber === parseInt(jerseyMatch[1], 10)) {
          return {
            jerseyNumber: mapping.jerseyNumber,
            confidence: mapping.ocrConfidence || 0.5,
          };
        }
      }

      stepLogger.debug("No player mapping found for player identifier", {
        matchId,
        playerId,
      });
      return null;
    } catch (error) {
      stepLogger.warn("Failed to fetch player data", {
        matchId,
        playerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  // Helper function to calculate position proximity
  // Returns a value between 0 and 1, where 1 means perfect proximity
  const calculatePositionProximity = (
    playerPosition: Point2D | null | undefined,
    eventPosition: Point2D
  ): number => {
    if (!playerPosition) {
      // If no player position available, use default proximity
      return 0.5;
    }

    // Calculate Euclidean distance (both positions are normalized 0-1)
    const dx = playerPosition.x - eventPosition.x;
    const dy = playerPosition.y - eventPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Convert distance to proximity score
    // Max distance in normalized space is ~1.414 (diagonal of unit square)
    // We use a threshold of 0.2 (20% of field) as reasonable proximity
    const proximityThreshold = 0.2;

    if (distance <= proximityThreshold) {
      // Linear decay: 1.0 at distance 0, 0.5 at threshold
      return 1.0 - (distance / proximityThreshold) * 0.5;
    } else {
      // Beyond threshold, rapidly decay to minimum
      const excessDistance = distance - proximityThreshold;
      return Math.max(0.1, 0.5 * Math.exp(-excessDistance * 3));
    }
  };

  // Helper function to get position from event
  // Priority: 1) ball detection, 2) mergedPosition (from Gemini), 3) zone conversion
  const getEventPosition = (e: DeduplicatedEvent): { position: Point2D; source: PositionSource } => {
    // Get ball position at event timestamp
    const ballMatch = ballPositions.get(e.absoluteTimestamp) ?? null;
    const ballPos = ballMatchToPositionMetadata(ballMatch);

    // Get Gemini position if available
    const geminiPos: PositionWithMetadata | null = e.mergedPosition && e.positionSource
      ? { position: e.mergedPosition, source: e.positionSource, confidence: e.mergedPositionConfidence ?? 0.5 }
      : null;

    // Get zone conversion as fallback
    const team = e.team as "home" | "away";
    const zonePos = getPositionFromZone(e.zone as EventZone | undefined, team);

    // Select best position based on priority and confidence
    const best = selectBestPosition(ballPos, geminiPos, zonePos);
    return { position: best.position, source: best.source };
  };

  // Convert to Firestore documents and save
  const BATCH_LIMIT = 450; // Leave buffer for safety (Firestore max is 500)
  const now = new Date().toISOString();

  type DocWrite = { collection: string; id: string; data: unknown };
  const allDocs: DocWrite[] = [];

  // Convert pass events (using enriched data with passDirection)
  for (let i = 0; i < passEvents.length; i++) {
    const e = passEvents[i];
    const { position: eventPosition } = getEventPosition(e);

    // Calculate performer identification confidence
    const playerData = await getPlayerData(e.player);
    const playerConfidence = playerData?.confidence || 0.5;
    const positionProximity = calculatePositionProximity(eventPosition, eventPosition); // Use event position as player position estimate

    const performerConfidenceResult = calculatePerformerIdentificationConfidence(
      e.adjustedConfidence,
      playerConfidence,
      positionProximity
    );

    // Update needsReview based on performer confidence
    const needsReview =
      e.adjustedConfidence < 0.7 ||
      !performerConfidenceResult.reliable;

    stepLogger.debug("Pass event performer confidence", {
      matchId,
      eventIndex: i,
      player: e.player,
      eventConfidence: e.adjustedConfidence,
      playerConfidence,
      positionProximity,
      performerConfidence: performerConfidenceResult.confidence,
      performerQuality: performerConfidenceResult.quality,
      needsReview,
    });

    const eventDoc: PassEventDoc = {
      eventId: `${matchId}_pass_${i}`,
      matchId,
      videoId,
      type: "pass",
      frameNumber: Math.floor(e.absoluteTimestamp * fps),
      timestamp: e.absoluteTimestamp,
      kicker: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: eventPosition,
        confidence: performerConfidenceResult.confidence,
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
      passDirection: e.passDirection,
      confidence: e.adjustedConfidence,
      needsReview,
      source: "auto",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "passEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert carry events (using enriched data with calculated distance)
  for (let i = 0; i < carryEvents.length; i++) {
    const e = carryEvents[i];
    const { position: eventPosition } = getEventPosition(e);

    // Calculate performer identification confidence
    const playerData = await getPlayerData(e.player);
    const playerConfidence = playerData?.confidence || 0.5;
    const positionProximity = calculatePositionProximity(eventPosition, eventPosition);

    const performerConfidenceResult = calculatePerformerIdentificationConfidence(
      e.adjustedConfidence,
      playerConfidence,
      positionProximity
    );

    stepLogger.debug("Carry event performer confidence", {
      matchId,
      eventIndex: i,
      player: e.player,
      performerConfidence: performerConfidenceResult.confidence,
      performerQuality: performerConfidenceResult.quality,
    });

    // For carry events, estimate end position based on zone movement or use same position
    const endPosition = e.details?.endZone
      ? getPositionFromZone(e.details.endZone as EventZone, e.team as "home" | "away").position
      : eventPosition;
    // Use enriched carryDistanceMeters if available, otherwise fall back to Gemini estimate
    const distance = e.carryDistanceMeters ?? (e.details?.distance as number | undefined);
    const eventDoc: CarryEventDoc = {
      eventId: `${matchId}_carry_${i}`,
      matchId,
      videoId,
      type: "carry",
      trackId: "",
      playerId: e.player || null,
      teamId: e.team as TeamId,
      startFrame: Math.floor(e.absoluteTimestamp * fps),
      endFrame: Math.floor(e.absoluteTimestamp * fps) + fps, // Assume 1 second duration
      startTime: e.absoluteTimestamp,
      endTime: e.absoluteTimestamp + 1,
      startPosition: eventPosition,
      endPosition: endPosition,
      carryIndex: 0,
      progressIndex: 0,
      distanceMeters: distance,
      isDribble: e.isDribble,
      dribbleConfidence: e.dribbleConfidence,
      confidence: performerConfidenceResult.confidence,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "carryEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert turnover events
  for (let i = 0; i < turnoverEvents.length; i++) {
    const e = turnoverEvents[i];
    const { position: eventPosition } = getEventPosition(e);

    // Calculate performer identification confidence
    const playerData = await getPlayerData(e.player);
    const playerConfidence = playerData?.confidence || 0.5;
    const positionProximity = calculatePositionProximity(eventPosition, eventPosition);

    const performerConfidenceResult = calculatePerformerIdentificationConfidence(
      e.adjustedConfidence,
      playerConfidence,
      positionProximity
    );

    const needsReview =
      e.adjustedConfidence < 0.7 ||
      !performerConfidenceResult.reliable;

    stepLogger.debug("Turnover event performer confidence", {
      matchId,
      eventIndex: i,
      player: e.player,
      performerConfidence: performerConfidenceResult.confidence,
      performerQuality: performerConfidenceResult.quality,
      needsReview,
    });

    const eventDoc: TurnoverEventDoc = {
      eventId: `${matchId}_turnover_${i}`,
      matchId,
      videoId,
      type: "turnover",
      turnoverType: "lost",
      frameNumber: Math.floor(e.absoluteTimestamp * fps),
      timestamp: e.absoluteTimestamp,
      player: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: eventPosition,
      },
      context: e.details?.turnoverType as
        | "tackle"
        | "interception"
        | "bad_touch"
        | "out_of_bounds"
        | "other"
        | undefined,
      confidence: performerConfidenceResult.confidence,
      needsReview,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "turnoverEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Convert shot events (using enriched data with xG)
  // Phase 2.8: shotResult欠落の警告ログを追加
  let missingShotResultCount = 0;
  let goalCount = 0;

  for (let i = 0; i < shotEvents.length; i++) {
    const e = shotEvents[i];
    const { position: eventPosition } = getEventPosition(e);

    // Calculate performer identification confidence
    const playerData = await getPlayerData(e.player);
    const playerConfidence = playerData?.confidence || 0.5;
    const positionProximity = calculatePositionProximity(eventPosition, eventPosition);

    const performerConfidenceResult = calculatePerformerIdentificationConfidence(
      e.adjustedConfidence,
      playerConfidence,
      positionProximity
    );

    stepLogger.debug("Shot event performer confidence", {
      matchId,
      eventIndex: i,
      player: e.player,
      performerConfidence: performerConfidenceResult.confidence,
      performerQuality: performerConfidenceResult.quality,
    });

    // shotResultが欠落している場合は警告
    if (!e.details?.shotResult) {
      missingShotResultCount++;
      stepLogger.warn("Shot event missing shotResult, defaulting to 'missed'", {
        matchId,
        eventIndex: i,
        timestamp: e.absoluteTimestamp,
        team: e.team,
        player: e.player,
        confidence: e.adjustedConfidence,
        details: e.details,
      });
    }

    const shotResult = (e.details?.shotResult || "missed") as "goal" | "saved" | "blocked" | "missed" | "post";
    if (shotResult === "goal") {
      goalCount++;
    }

    const eventDoc: ShotEventDoc = {
      eventId: `${matchId}_shot_${i}`,
      matchId,
      videoId,
      type: "shot",
      timestamp: e.absoluteTimestamp,
      team: e.team as TeamId,
      player: e.player,
      result: shotResult,
      position: eventPosition,
      shotType: e.details?.shotType as "header" | "volley" | "placed" | "power" | "other" | undefined,
      xG: e.xG,
      xGFactors: e.xGFactors,
      confidence: performerConfidenceResult.confidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "shotEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // ゴール検出のサマリーログ
  stepLogger.info("Shot events processed", {
    matchId,
    totalShots: shotEvents.length,
    goalCount,
    missingShotResultCount,
  });

  // Convert set piece events
  for (let i = 0; i < setPieceEvents.length; i++) {
    const e = setPieceEvents[i];
    const { position: eventPosition } = getEventPosition(e);

    // Calculate performer identification confidence
    const playerData = await getPlayerData(e.player);
    const playerConfidence = playerData?.confidence || 0.5;
    const positionProximity = calculatePositionProximity(eventPosition, eventPosition);

    const performerConfidenceResult = calculatePerformerIdentificationConfidence(
      e.adjustedConfidence,
      playerConfidence,
      positionProximity
    );

    stepLogger.debug("Set piece event performer confidence", {
      matchId,
      eventIndex: i,
      player: e.player,
      performerConfidence: performerConfidenceResult.confidence,
      performerQuality: performerConfidenceResult.quality,
    });

    // Section 3.2.2: Find outcome analysis for this set piece
    const outcomeAnalysis = setPieceOutcomes.find(
      (outcome) => outcome.setPieceEventId === `${e.type}_${e.absoluteTimestamp}`
    );

    const eventDoc: SetPieceEventDoc = {
      eventId: `${matchId}_setpiece_${i}`,
      matchId,
      videoId,
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
      position: eventPosition,
      // Section 3.2.2: Add outcome details
      outcomeDetails: outcomeAnalysis
        ? {
            resultType: outcomeAnalysis.resultType,
            timeToOutcome: outcomeAnalysis.timeToOutcome,
            scoringChance: outcomeAnalysis.scoringChance,
            outcomeEventId: outcomeAnalysis.outcomeEventId,
          }
        : undefined,
      confidence: performerConfidenceResult.confidence,
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

  // Calculate performer confidence statistics
  let lowPerformerConfidenceCount = 0;
  let mediumPerformerConfidenceCount = 0;
  let highPerformerConfidenceCount = 0;

  for (const doc of allDocs) {
    // Type-safe access to confidence property
    const data = doc.data as Record<string, unknown>;
    const confidenceValue = data.confidence;
    const confidence = typeof confidenceValue === "number" ? confidenceValue : 0;

    if (confidence >= 0.8) {
      highPerformerConfidenceCount++;
    } else if (confidence >= 0.6) {
      mediumPerformerConfidenceCount++;
    } else {
      lowPerformerConfidenceCount++;
    }
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
    performerConfidence: {
      high: highPerformerConfidenceCount,
      medium: mediumPerformerConfidenceCount,
      low: lowPerformerConfidenceCount,
      highPercent: ((highPerformerConfidenceCount / allDocs.length) * 100).toFixed(1),
      lowPercent: ((lowPerformerConfidenceCount / allDocs.length) * 100).toFixed(1),
    },
  });

  // Prepare validation summary for result
  const validationResultSummary = {
    valid: validationResult.valid,
    errorCount: validationResult.errors.length,
    warningCount: validationResult.warnings.length,
    warningsByType: validationResult.warnings.reduce(
      (acc, w) => {
        acc[w.type] = (acc[w.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  };

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
    validation: validationResultSummary,
  };
}
