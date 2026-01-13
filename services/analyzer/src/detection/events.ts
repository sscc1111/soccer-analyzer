/**
 * Event Detection Module
 *
 * Core algorithms for detecting soccer events from tracking data:
 * - Ball possession assignment
 * - Pass detection (complete/incomplete/intercepted)
 * - Carry detection (dribbling)
 * - Turnover detection (possession change between teams)
 */

import type {
  Point2D,
  TrackFrame,
  BallDetection,
  PossessionSegment,
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  PendingReviewDoc,
  TeamId,
  PassOutcome,
  AttackDirection,
} from "@soccer/shared";

// ============================================================================
// Types
// ============================================================================

export type EventDetectionConfig = {
  /** Maximum distance (normalized 0-1) to assign possession */
  possessionDistanceThreshold: number;
  /** Minimum frames to hold possession before registering */
  minPossessionFrames: number;
  /** Minimum carry distance to create a carry event */
  minCarryDistance: number;
  /** Confidence threshold below which events are flagged for review */
  reviewThreshold: number;
  /** Frame rate for timestamp calculation */
  fps: number;
};

export type TrackData = {
  trackId: string;
  frames: Map<number, TrackFrame>;
  teamId: TeamId;
  playerId: string | null;
};

export type BallData = {
  frames: Map<number, BallDetection>;
};

export type FramePossession = {
  frameNumber: number;
  timestamp: number;
  ballPosition: Point2D | null;
  ballVisible: boolean;
  possessorTrackId: string | null;
  possessorPosition: Point2D | null;
  possessorTeamId: TeamId | null;
  distance: number | null;
  confidence: number;
};

export type DetectedEvents = {
  possessionSegments: PossessionSegment[];
  passEvents: PassEventDoc[];
  carryEvents: CarryEventDoc[];
  turnoverEvents: TurnoverEventDoc[];
};

// ============================================================================
// Configuration
// ============================================================================

export const DEFAULT_EVENT_CONFIG: EventDetectionConfig = {
  possessionDistanceThreshold: 0.05, // 5% of screen width/height
  minPossessionFrames: 3, // ~0.1s at 30fps
  minCarryDistance: 0.02, // 2% of screen
  reviewThreshold: 0.6,
  fps: 30,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate Euclidean distance between two points
 * @returns Distance, or Infinity if inputs are invalid
 */
export function distance(a: Point2D | null | undefined, b: Point2D | null | undefined): number {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate unique event ID
 */
export function generateEventId(type: string, frameNumber: number): string {
  return `${type}_${frameNumber}_${Date.now().toString(36)}`;
}

/**
 * Calculate progress based on attack direction
 * @param startPos Starting position
 * @param endPos Ending position
 * @param attackDirection Attack direction setting
 * @returns Progress value (positive = forward, negative = backward)
 */
export function calculateProgress(
  startPos: Point2D,
  endPos: Point2D,
  attackDirection: AttackDirection | null
): number {
  const dx = endPos.x - startPos.x;

  if (attackDirection === "LTR") {
    // Left-to-right: positive X is forward
    return dx;
  } else if (attackDirection === "RTL") {
    // Right-to-left: negative X is forward
    return -dx;
  }

  // No direction set, return 0
  return 0;
}

// ============================================================================
// Possession Detection
// ============================================================================

/**
 * Find the closest player to the ball at a given frame
 */
export function findClosestPlayer(
  ballPos: Point2D,
  tracks: TrackData[],
  frameNumber: number
): { trackId: string; position: Point2D; distance: number; teamId: TeamId } | null {
  let closest: {
    trackId: string;
    position: Point2D;
    distance: number;
    teamId: TeamId;
  } | null = null;

  for (const track of tracks) {
    const frame = track.frames.get(frameNumber);
    if (!frame) continue;

    const dist = distance(ballPos, frame.center);

    if (!closest || dist < closest.distance) {
      closest = {
        trackId: track.trackId,
        position: frame.center,
        distance: dist,
        teamId: track.teamId,
      };
    }
  }

  return closest;
}

/**
 * Determine possession for each frame
 */
export function detectFramePossessions(
  tracks: TrackData[],
  ball: BallData,
  frameNumbers: number[],
  config: EventDetectionConfig
): FramePossession[] {
  const possessions: FramePossession[] = [];

  for (const frameNumber of frameNumbers) {
    const ballFrame = ball.frames.get(frameNumber);
    const timestamp = frameNumber / config.fps;

    if (!ballFrame || !ballFrame.visible) {
      possessions.push({
        frameNumber,
        timestamp,
        ballPosition: ballFrame?.position ?? null,
        ballVisible: false,
        possessorTrackId: null,
        possessorPosition: null,
        possessorTeamId: null,
        distance: null,
        confidence: 0,
      });
      continue;
    }

    const closest = findClosestPlayer(ballFrame.position, tracks, frameNumber);

    if (!closest || closest.distance > config.possessionDistanceThreshold) {
      // Ball visible but no one is close enough
      possessions.push({
        frameNumber,
        timestamp,
        ballPosition: ballFrame.position,
        ballVisible: true,
        possessorTrackId: null,
        possessorPosition: null,
        possessorTeamId: null,
        distance: closest?.distance ?? null,
        confidence: ballFrame.confidence,
      });
      continue;
    }

    // Assign possession to closest player
    // Confidence is based on ball detection confidence and proximity
    const proximityConfidence = config.possessionDistanceThreshold > 0
      ? Math.max(0, 1 - closest.distance / config.possessionDistanceThreshold)
      : closest.distance === 0 ? 1 : 0;
    const overallConfidence = ballFrame.confidence * proximityConfidence;

    possessions.push({
      frameNumber,
      timestamp,
      ballPosition: ballFrame.position,
      ballVisible: true,
      possessorTrackId: closest.trackId,
      possessorPosition: closest.position,
      possessorTeamId: closest.teamId,
      distance: closest.distance,
      confidence: overallConfidence,
    });
  }

  return possessions;
}

// ============================================================================
// Possession Segment Detection
// ============================================================================

/**
 * Build possession segments from frame-by-frame possession data
 */
export function buildPossessionSegments(
  framePossessions: FramePossession[],
  trackPlayerMap: Map<string, string | null>,
  config: EventDetectionConfig
): PossessionSegment[] {
  const segments: PossessionSegment[] = [];

  let currentSegment: {
    trackId: string;
    teamId: TeamId;
    startFrame: number;
    startTime: number;
    startPos: Point2D;
    endPos: Point2D;
    confidenceSum: number;
    frameCount: number;
  } | null = null;

  for (let i = 0; i < framePossessions.length; i++) {
    const fp = framePossessions[i];
    const nextFp = framePossessions[i + 1];

    // Start new segment if possessor changed or no current segment
    // Skip frame if essential data is missing
    if (fp.possessorTrackId && fp.possessorTeamId && fp.possessorPosition) {
      if (!currentSegment || currentSegment.trackId !== fp.possessorTrackId) {
        // Finalize previous segment
        if (currentSegment && currentSegment.frameCount >= config.minPossessionFrames) {
          const prevFp = framePossessions[i - 1];
          segments.push(finalizePossessionSegment(
            currentSegment,
            prevFp?.frameNumber ?? currentSegment.startFrame,
            prevFp?.timestamp ?? currentSegment.startTime,
            trackPlayerMap,
            determineEndReason(currentSegment.teamId, fp.possessorTeamId)
          ));
        }

        // Start new segment with validated data
        currentSegment = {
          trackId: fp.possessorTrackId,
          teamId: fp.possessorTeamId,
          startFrame: fp.frameNumber,
          startTime: fp.timestamp,
          startPos: fp.possessorPosition,
          endPos: fp.possessorPosition,
          confidenceSum: fp.confidence,
          frameCount: 1,
        };
      } else {
        // Continue current segment
        currentSegment.endPos = fp.possessorPosition;
        currentSegment.confidenceSum += fp.confidence;
        currentSegment.frameCount++;
      }
    } else if (currentSegment && !fp.possessorTrackId) {
      // Ball lost visibility or no possessor
      // Finalize segment if it meets minimum duration
      if (currentSegment.frameCount >= config.minPossessionFrames) {
        segments.push(finalizePossessionSegment(
          currentSegment,
          fp.frameNumber,
          fp.timestamp,
          trackPlayerMap,
          fp.ballVisible ? "lost" : "unknown"
        ));
      }
      currentSegment = null;
    }
  }

  // Finalize last segment
  if (currentSegment && currentSegment.frameCount >= config.minPossessionFrames) {
    const lastFp = framePossessions[framePossessions.length - 1];
    segments.push(finalizePossessionSegment(
      currentSegment,
      lastFp.frameNumber,
      lastFp.timestamp,
      trackPlayerMap,
      "unknown"
    ));
  }

  return segments;
}

function finalizePossessionSegment(
  segment: {
    trackId: string;
    teamId: TeamId;
    startFrame: number;
    startTime: number;
    startPos: Point2D;
    endPos: Point2D;
    confidenceSum: number;
    frameCount: number;
  },
  endFrame: number,
  endTime: number,
  trackPlayerMap: Map<string, string | null>,
  endReason: PossessionSegment["endReason"]
): PossessionSegment {
  return {
    trackId: segment.trackId,
    playerId: trackPlayerMap.get(segment.trackId) ?? null,
    teamId: segment.teamId,
    startFrame: segment.startFrame,
    endFrame,
    startTime: segment.startTime,
    endTime,
    confidence: segment.confidenceSum / segment.frameCount,
    endReason,
  };
}

function determineEndReason(
  previousTeam: TeamId | null,
  nextTeam: TeamId | null
): PossessionSegment["endReason"] {
  if (!nextTeam) return "lost";
  if (previousTeam === nextTeam) return "pass";
  return "lost"; // Different team = turnover
}

// ============================================================================
// Pass Event Detection
// ============================================================================

/**
 * Detect pass events from possession segments
 */
export function detectPassEvents(
  segments: PossessionSegment[],
  matchId: string,
  config: EventDetectionConfig,
  possessionsByFrame: Map<number, FramePossession>
): PassEventDoc[] {
  const passes: PassEventDoc[] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];

    // Skip if same player (not a pass)
    if (current.trackId === next.trackId) continue;

    // Get positions at transition using Map for O(1) lookup
    const kickerFp = possessionsByFrame.get(current.endFrame);
    const receiverFp = possessionsByFrame.get(next.startFrame);
    const kickerPos = kickerFp?.possessorPosition;
    const receiverPos = receiverFp?.possessorPosition;

    // Skip event if kicker position is unavailable
    if (!kickerPos) continue;

    // Determine outcome
    const outcome = determinePassOutcome(current.teamId, next.teamId);
    const outcomeConfidence = calculateOutcomeConfidence(current, next);

    // Calculate overall confidence
    const confidence = (current.confidence + next.confidence) / 2 * outcomeConfidence;
    const needsReview = confidence < config.reviewThreshold;

    const pass: PassEventDoc = {
      eventId: generateEventId("pass", current.endFrame),
      matchId,
      type: "pass",
      frameNumber: current.endFrame,
      timestamp: current.endTime,
      kicker: {
        trackId: current.trackId,
        playerId: current.playerId,
        teamId: current.teamId,
        position: kickerPos,
        confidence: current.confidence,
      },
      receiver: outcome === "incomplete" || !receiverPos ? null : {
        trackId: next.trackId,
        playerId: next.playerId,
        teamId: next.teamId,
        position: receiverPos,
        confidence: next.confidence,
      },
      outcome,
      outcomeConfidence,
      confidence,
      needsReview,
      reviewReason: needsReview
        ? (current.confidence < config.reviewThreshold ? "low_kicker_confidence" : "low_receiver_confidence")
        : undefined,
      source: "auto",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
    };

    passes.push(pass);
  }

  return passes;
}

function determinePassOutcome(kickerTeam: TeamId, receiverTeam: TeamId): PassOutcome {
  if (kickerTeam === receiverTeam && kickerTeam !== "unknown") {
    return "complete";
  }
  if (receiverTeam === "unknown") {
    return "incomplete";
  }
  return "intercepted";
}

function calculateOutcomeConfidence(
  current: PossessionSegment,
  next: PossessionSegment
): number {
  // Higher confidence if teams are clearly different or same
  if (current.teamId === next.teamId && current.teamId !== "unknown") {
    return Math.min(current.confidence, next.confidence);
  }
  if (current.teamId !== next.teamId && current.teamId !== "unknown" && next.teamId !== "unknown") {
    return Math.min(current.confidence, next.confidence);
  }
  // Lower confidence if team is unknown
  return Math.min(current.confidence, next.confidence) * 0.5;
}

// ============================================================================
// Carry Event Detection
// ============================================================================

/**
 * Detect carry events from possession segments
 */
export function detectCarryEvents(
  segments: PossessionSegment[],
  matchId: string,
  config: EventDetectionConfig,
  possessionsByFrame: Map<number, FramePossession>,
  attackDirection: AttackDirection | null
): CarryEventDoc[] {
  const carries: CarryEventDoc[] = [];

  for (const segment of segments) {
    // Get all positions during this segment using Map for O(1) lookup
    const segmentPossessions: FramePossession[] = [];
    for (let frame = segment.startFrame; frame <= segment.endFrame; frame++) {
      const fp = possessionsByFrame.get(frame);
      if (fp && fp.possessorTrackId === segment.trackId && fp.possessorPosition) {
        segmentPossessions.push(fp);
      }
    }

    if (segmentPossessions.length < 2) continue;

    // Calculate carry metrics
    const metrics = calculateCarryMetrics(segmentPossessions, attackDirection);

    // Skip if carry metrics are invalid or distance is too small
    if (!metrics || metrics.carryIndex < config.minCarryDistance) continue;

    const carry: CarryEventDoc = {
      eventId: generateEventId("carry", segment.startFrame),
      matchId,
      type: "carry",
      trackId: segment.trackId,
      playerId: segment.playerId,
      teamId: segment.teamId,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      startTime: segment.startTime,
      endTime: segment.endTime,
      startPosition: metrics.startPos,
      endPosition: metrics.endPos,
      carryIndex: metrics.carryIndex,
      progressIndex: metrics.progressIndex,
      confidence: segment.confidence,
      version: "1.0.0",
      createdAt: new Date().toISOString(),
    };

    carries.push(carry);
  }

  return carries;
}

function calculateCarryMetrics(
  possessions: FramePossession[],
  attackDirection: AttackDirection | null
): {
  carryIndex: number;
  progressIndex: number;
  startPos: Point2D;
  endPos: Point2D;
} | null {
  // Validate that we have valid positions
  const firstPos = possessions[0]?.possessorPosition;
  const lastPos = possessions[possessions.length - 1]?.possessorPosition;

  if (!firstPos || !lastPos) return null;

  let carryIndex = 0;

  // Sum up all movement
  for (let i = 1; i < possessions.length; i++) {
    const prev = possessions[i - 1];
    const curr = possessions[i];

    if (prev.possessorPosition && curr.possessorPosition) {
      carryIndex += distance(prev.possessorPosition, curr.possessorPosition);
    }
  }

  // Calculate progress (net forward movement)
  const progressIndex = calculateProgress(firstPos, lastPos, attackDirection);

  return { carryIndex, progressIndex, startPos: firstPos, endPos: lastPos };
}

// ============================================================================
// Turnover Event Detection
// ============================================================================

/**
 * Detect turnover events from possession segments
 */
export function detectTurnoverEvents(
  segments: PossessionSegment[],
  matchId: string,
  config: EventDetectionConfig,
  possessionsByFrame: Map<number, FramePossession>
): TurnoverEventDoc[] {
  const turnovers: TurnoverEventDoc[] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];

    // Only create turnover if teams are different and both known
    if (
      current.teamId === next.teamId ||
      current.teamId === "unknown" ||
      next.teamId === "unknown"
    ) {
      continue;
    }

    // Get positions using Map for O(1) lookup
    const loserFp = possessionsByFrame.get(current.endFrame);
    const winnerFp = possessionsByFrame.get(next.startFrame);
    const loserPos = loserFp?.possessorPosition;
    const winnerPos = winnerFp?.possessorPosition;

    // Skip if positions are unavailable
    if (!loserPos || !winnerPos) continue;

    const confidence = Math.min(current.confidence, next.confidence);
    const needsReview = confidence < config.reviewThreshold;

    // Create "lost" event for the player who lost the ball
    const lostEvent: TurnoverEventDoc = {
      eventId: generateEventId("turnover_lost", current.endFrame),
      matchId,
      type: "turnover",
      turnoverType: "lost",
      frameNumber: current.endFrame,
      timestamp: current.endTime,
      player: {
        trackId: current.trackId,
        playerId: current.playerId,
        teamId: current.teamId,
        position: loserPos,
      },
      otherPlayer: {
        trackId: next.trackId,
        playerId: next.playerId,
        teamId: next.teamId,
        position: winnerPos,
      },
      context: "other",
      confidence,
      needsReview,
      version: "1.0.0",
      createdAt: new Date().toISOString(),
    };

    // Create "won" event for the player who won the ball
    const wonEvent: TurnoverEventDoc = {
      eventId: generateEventId("turnover_won", next.startFrame),
      matchId,
      type: "turnover",
      turnoverType: "won",
      frameNumber: next.startFrame,
      timestamp: next.startTime,
      player: {
        trackId: next.trackId,
        playerId: next.playerId,
        teamId: next.teamId,
        position: winnerPos,
      },
      otherPlayer: {
        trackId: current.trackId,
        playerId: current.playerId,
        teamId: current.teamId,
        position: loserPos,
      },
      context: "other",
      confidence,
      needsReview,
      version: "1.0.0",
      createdAt: new Date().toISOString(),
    };

    turnovers.push(lostEvent, wonEvent);
  }

  return turnovers;
}

// ============================================================================
// Main Detection Pipeline
// ============================================================================

/**
 * Run the complete event detection pipeline
 */
export function detectAllEvents(
  tracks: TrackData[],
  ball: BallData,
  matchId: string,
  trackPlayerMap: Map<string, string | null>,
  attackDirection: AttackDirection | null,
  config: Partial<EventDetectionConfig> = {}
): DetectedEvents {
  const cfg: EventDetectionConfig = { ...DEFAULT_EVENT_CONFIG, ...config };

  // Get all frame numbers
  const allFrames = new Set<number>();
  for (const [frame] of ball.frames) {
    allFrames.add(frame);
  }
  const frameNumbers = Array.from(allFrames).sort((a, b) => a - b);

  if (frameNumbers.length === 0) {
    return {
      possessionSegments: [],
      passEvents: [],
      carryEvents: [],
      turnoverEvents: [],
    };
  }

  // Step 1: Detect frame-by-frame possession
  const framePossessions = detectFramePossessions(tracks, ball, frameNumbers, cfg);

  // Create Map for O(1) frame lookup (performance optimization)
  const possessionsByFrame = new Map<number, FramePossession>(
    framePossessions.map((fp) => [fp.frameNumber, fp])
  );

  // Step 2: Build possession segments
  const possessionSegments = buildPossessionSegments(
    framePossessions,
    trackPlayerMap,
    cfg
  );

  // Step 3: Detect pass events
  const passEvents = detectPassEvents(
    possessionSegments,
    matchId,
    cfg,
    possessionsByFrame
  );

  // Step 4: Detect carry events
  const carryEvents = detectCarryEvents(
    possessionSegments,
    matchId,
    cfg,
    possessionsByFrame,
    attackDirection
  );

  // Step 5: Detect turnover events
  const turnoverEvents = detectTurnoverEvents(
    possessionSegments,
    matchId,
    cfg,
    possessionsByFrame
  );

  return {
    possessionSegments,
    passEvents,
    carryEvents,
    turnoverEvents,
  };
}

// ============================================================================
// Helper: Convert raw tracking data to detection format
// ============================================================================

/**
 * Convert TrackDoc array to TrackData format for event detection
 */
export function convertTracksForDetection(
  tracks: Array<{
    trackId: string;
    frames: Array<TrackFrame>;
  }>,
  teamMetas: Map<string, TeamId>,
  playerMappings: Map<string, string | null>
): TrackData[] {
  return tracks.map((track) => ({
    trackId: track.trackId,
    frames: new Map(track.frames.map((f) => [f.frameNumber, f])),
    teamId: teamMetas.get(track.trackId) ?? "unknown",
    playerId: playerMappings.get(track.trackId) ?? null,
  }));
}

/**
 * Convert BallTrackDoc to BallData format for event detection
 */
export function convertBallForDetection(
  ballDetections: BallDetection[]
): BallData {
  return {
    frames: new Map(ballDetections.map((d) => [d.frameNumber, d])),
  };
}

// ============================================================================
// Pending Review Extraction
// ============================================================================

/**
 * Extract events that need user review and create PendingReviewDoc entries
 */
export function extractPendingReviews(
  events: DetectedEvents,
  reviewThreshold: number = DEFAULT_EVENT_CONFIG.reviewThreshold
): PendingReviewDoc[] {
  const pendingReviews: PendingReviewDoc[] = [];
  const now = new Date().toISOString();

  // Process pass events
  for (const pass of events.passEvents) {
    if (!pass.needsReview) continue;

    const reason = determineReviewReason(pass, reviewThreshold);

    pendingReviews.push({
      eventId: pass.eventId,
      eventType: "pass",
      reason,
      candidates: buildPassCandidates(pass),
      resolved: false,
      createdAt: now,
    });
  }

  // Process carry events
  for (const carry of events.carryEvents) {
    if (carry.confidence >= reviewThreshold) continue;

    pendingReviews.push({
      eventId: carry.eventId,
      eventType: "carry",
      reason: "low_confidence",
      resolved: false,
      createdAt: now,
    });
  }

  // Process turnover events - only add "lost" type to avoid duplicates
  for (const turnover of events.turnoverEvents) {
    if (!turnover.needsReview) continue;
    if (turnover.turnoverType === "won") continue; // Skip "won" to avoid duplicates

    pendingReviews.push({
      eventId: turnover.eventId,
      eventType: "turnover",
      reason: "low_confidence",
      resolved: false,
      createdAt: now,
    });
  }

  return pendingReviews;
}

/**
 * Determine the reason for review based on event data
 */
function determineReviewReason(
  pass: PassEventDoc,
  threshold: number
): PendingReviewDoc["reason"] {
  // Check kicker confidence
  if (pass.kicker.confidence < threshold) {
    return "low_confidence";
  }

  // Check receiver confidence
  if (pass.receiver && pass.receiver.confidence < threshold) {
    return "low_confidence";
  }

  // Check outcome confidence
  if (pass.outcomeConfidence < threshold) {
    return "ambiguous_player";
  }

  // Default to low confidence
  return "low_confidence";
}

/**
 * Build candidate list for pass event review
 */
function buildPassCandidates(pass: PassEventDoc): PendingReviewDoc["candidates"] {
  const candidates: PendingReviewDoc["candidates"] = [];

  // Add kicker as a candidate
  candidates?.push({
    trackId: pass.kicker.trackId,
    playerId: pass.kicker.playerId,
    confidence: pass.kicker.confidence,
  } as NonNullable<PendingReviewDoc["candidates"]>[number]);

  // Add receiver as a candidate if present
  if (pass.receiver) {
    candidates?.push({
      trackId: pass.receiver.trackId,
      playerId: pass.receiver.playerId,
      confidence: pass.receiver.confidence,
    } as NonNullable<PendingReviewDoc["candidates"]>[number]);
  }

  return candidates && candidates.length > 0 ? candidates : undefined;
}
