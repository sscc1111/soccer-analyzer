/**
 * Test helper utilities for analyzer tests
 *
 * Provides factory functions for creating test data with sensible defaults.
 * All functions support partial overrides for customization.
 *
 * @example
 * // Create a simple track doc
 * const track = createTrackDoc({ trackId: "player-1" });
 *
 * // Create a pass event with custom outcome
 * const pass = createPassEvent({ outcome: "incomplete" });
 *
 * // Generate a full match scenario
 * const scenario = createMatchScenario({
 *   playerCount: 10,
 *   frameCount: 300,
 *   passCount: 15,
 * });
 */

import type {
  Point2D,
  BoundingBox,
  TrackFrame,
  TrackDoc,
  BallDetection,
  BallTrackDoc,
  TrackPlayerMapping,
  TrackTeamMeta,
  TeamId,
  PossessionSegment,
  PassEventDoc,
  PassOutcome,
  CarryEventDoc,
  TurnoverEventDoc,
  TurnoverType,
} from "@soccer/shared";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MATCH_ID = "test-match";
const DEFAULT_VERSION = "1.0.0";
const DEFAULT_FPS = 30;
const DEFAULT_CONFIDENCE = 0.9;

// ============================================================================
// Core Type Builders
// ============================================================================

/**
 * Create a Point2D with optional overrides
 */
export function createPoint2D(x: number = 0.5, y: number = 0.5): Point2D {
  return { x, y };
}

/**
 * Create a BoundingBox centered at a point
 */
export function createBoundingBox(
  centerX: number = 0.5,
  centerY: number = 0.5,
  width: number = 0.04,
  height: number = 0.08
): BoundingBox {
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height,
  };
}

/**
 * Create a TrackFrame for a single detection
 */
export function createTrackFrame(
  trackId: string,
  frameNumber: number,
  center: Point2D = { x: 0.5, y: 0.5 },
  confidence: number = DEFAULT_CONFIDENCE,
  fps: number = DEFAULT_FPS
): TrackFrame {
  return {
    trackId,
    frameNumber,
    timestamp: frameNumber / fps,
    bbox: createBoundingBox(center.x, center.y),
    center,
    confidence,
  };
}

// ============================================================================
// Document Builders
// ============================================================================

/**
 * Create a TrackDoc with sensible defaults
 */
export function createTrackDoc(
  overrides: Partial<TrackDoc> & { trackId: string }
): TrackDoc {
  const trackId = overrides.trackId;
  const frames = overrides.frames ?? [
    createTrackFrame(trackId, 0, { x: 0.5, y: 0.5 }),
    createTrackFrame(trackId, 1, { x: 0.51, y: 0.5 }),
    createTrackFrame(trackId, 2, { x: 0.52, y: 0.5 }),
  ];

  const frameNumbers = frames.map((f) => f.frameNumber);
  const startFrame = Math.min(...frameNumbers);
  const endFrame = Math.max(...frameNumbers);

  const { trackId: _, ...rest } = overrides;

  return {
    trackId,
    matchId: DEFAULT_MATCH_ID,
    frames,
    startFrame,
    endFrame,
    startTime: startFrame / DEFAULT_FPS,
    endTime: endFrame / DEFAULT_FPS,
    avgConfidence:
      frames.reduce((sum, f) => sum + f.confidence, 0) / frames.length,
    entityType: "player",
    version: DEFAULT_VERSION,
    createdAt: new Date().toISOString(),
    ...rest,
  };
}

/**
 * Create a BallDetection
 */
export function createBallDetection(
  frameNumber: number,
  position: Point2D = { x: 0.5, y: 0.5 },
  options: {
    visible?: boolean;
    confidence?: number;
    interpolated?: boolean;
    fps?: number;
  } = {}
): BallDetection {
  const {
    visible = true,
    confidence = DEFAULT_CONFIDENCE,
    interpolated,
    fps = DEFAULT_FPS,
  } = options;

  return {
    frameNumber,
    timestamp: frameNumber / fps,
    position,
    confidence,
    visible,
    ...(interpolated !== undefined && { interpolated }),
  };
}

/**
 * Create a BallTrackDoc with sensible defaults
 */
export function createBallTrackDoc(
  overrides: Partial<BallTrackDoc> = {}
): BallTrackDoc {
  const detections = overrides.detections ?? [
    createBallDetection(0, { x: 0.5, y: 0.5 }),
    createBallDetection(1, { x: 0.52, y: 0.5 }),
    createBallDetection(2, { x: 0.54, y: 0.5 }),
  ];

  const visibleDetections = detections.filter((d) => d.visible);
  const avgConfidence =
    visibleDetections.length > 0
      ? visibleDetections.reduce((sum, d) => sum + d.confidence, 0) /
        visibleDetections.length
      : 0;
  const visibilityRate = visibleDetections.length / detections.length;

  return {
    matchId: DEFAULT_MATCH_ID,
    detections,
    version: DEFAULT_VERSION,
    modelId: "test-ball-detector",
    avgConfidence,
    visibilityRate,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a TrackPlayerMapping
 */
export function createTrackPlayerMapping(
  trackId: string,
  playerId: string | null = null,
  overrides: Partial<TrackPlayerMapping> = {}
): TrackPlayerMapping {
  return {
    trackId,
    playerId,
    jerseyNumber: playerId ? parseInt(playerId.replace(/\D/g, "")) || null : null,
    ocrConfidence: DEFAULT_CONFIDENCE,
    source: "ocr",
    needsReview: false,
    ...overrides,
  };
}

/**
 * Create a TrackTeamMeta
 */
export function createTrackTeamMeta(
  trackId: string,
  teamId: TeamId = "home",
  overrides: Partial<TrackTeamMeta> = {}
): TrackTeamMeta {
  return {
    trackId,
    teamId,
    teamConfidence: DEFAULT_CONFIDENCE,
    dominantColor: teamId === "home" ? "#FF0000" : "#0000FF",
    classificationMethod: "color_clustering",
    ...overrides,
  };
}

// ============================================================================
// Event Builders
// ============================================================================

/**
 * Create a PossessionSegment
 */
export function createPossessionSegment(
  overrides: Partial<PossessionSegment> = {}
): PossessionSegment {
  const startFrame = overrides.startFrame ?? 100;
  const endFrame = overrides.endFrame ?? 150;

  return {
    trackId: "track-1",
    playerId: null,
    teamId: "home",
    startFrame,
    endFrame,
    startTime: startFrame / DEFAULT_FPS,
    endTime: endFrame / DEFAULT_FPS,
    confidence: DEFAULT_CONFIDENCE,
    endReason: "pass",
    ...overrides,
  };
}

/**
 * Create a PassEventDoc with sensible defaults
 */
export function createPassEvent(
  overrides: Partial<PassEventDoc> = {}
): PassEventDoc {
  const frameNumber = overrides.frameNumber ?? 100;

  return {
    eventId: `pass-${Date.now()}`,
    matchId: DEFAULT_MATCH_ID,
    type: "pass",
    frameNumber,
    timestamp: frameNumber / DEFAULT_FPS,
    kicker: {
      trackId: "track-1",
      playerId: null,
      teamId: "home",
      position: { x: 0.5, y: 0.5 },
      confidence: DEFAULT_CONFIDENCE,
    },
    receiver: {
      trackId: "track-2",
      playerId: null,
      teamId: "home",
      position: { x: 0.6, y: 0.6 },
      confidence: 0.85,
    },
    outcome: "complete",
    outcomeConfidence: 0.95,
    confidence: DEFAULT_CONFIDENCE,
    needsReview: false,
    source: "auto",
    version: DEFAULT_VERSION,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create an incomplete pass event
 */
export function createIncompletePass(
  overrides: Partial<PassEventDoc> = {}
): PassEventDoc {
  return createPassEvent({
    outcome: "incomplete",
    outcomeConfidence: 0.8,
    receiver: null,
    ...overrides,
  });
}

/**
 * Create an intercepted pass event
 */
export function createInterceptedPass(
  overrides: Partial<PassEventDoc> = {}
): PassEventDoc {
  return createPassEvent({
    outcome: "intercepted",
    outcomeConfidence: 0.75,
    receiver: {
      trackId: "track-opponent",
      playerId: null,
      teamId: "away",
      position: { x: 0.55, y: 0.55 },
      confidence: 0.7,
    },
    ...overrides,
  });
}

/**
 * Create a CarryEventDoc with sensible defaults
 */
export function createCarryEvent(
  overrides: Partial<CarryEventDoc> = {}
): CarryEventDoc {
  const startFrame = overrides.startFrame ?? 100;
  const endFrame = overrides.endFrame ?? 130;
  const startPosition = overrides.startPosition ?? { x: 0.3, y: 0.5 };
  const endPosition = overrides.endPosition ?? { x: 0.5, y: 0.5 };

  const dx = endPosition.x - startPosition.x;
  const dy = endPosition.y - startPosition.y;
  const carryIndex = Math.sqrt(dx * dx + dy * dy);

  return {
    eventId: `carry-${Date.now()}`,
    matchId: DEFAULT_MATCH_ID,
    type: "carry",
    trackId: "track-1",
    playerId: null,
    teamId: "home",
    startFrame,
    endFrame,
    startTime: startFrame / DEFAULT_FPS,
    endTime: endFrame / DEFAULT_FPS,
    startPosition,
    endPosition,
    carryIndex,
    progressIndex: dx, // Assuming LTR attack direction
    confidence: DEFAULT_CONFIDENCE,
    version: DEFAULT_VERSION,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a TurnoverEventDoc with sensible defaults
 */
export function createTurnoverEvent(
  overrides: Partial<TurnoverEventDoc> = {}
): TurnoverEventDoc {
  const frameNumber = overrides.frameNumber ?? 150;

  return {
    eventId: `turnover-${Date.now()}`,
    matchId: DEFAULT_MATCH_ID,
    type: "turnover",
    turnoverType: "lost",
    frameNumber,
    timestamp: frameNumber / DEFAULT_FPS,
    player: {
      trackId: "track-1",
      playerId: null,
      teamId: "home",
      position: { x: 0.5, y: 0.5 },
    },
    otherPlayer: {
      trackId: "track-opponent",
      playerId: null,
      teamId: "away",
      position: { x: 0.52, y: 0.5 },
    },
    context: "tackle",
    confidence: DEFAULT_CONFIDENCE,
    needsReview: false,
    version: DEFAULT_VERSION,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Detection Data Builders (for events.ts module)
// ============================================================================

/**
 * Internal TrackData type used by detection module
 */
export type TestTrackData = {
  trackId: string;
  frames: Map<number, TrackFrame>;
  teamId: TeamId;
  playerId: string | null;
};

/**
 * Internal BallData type used by detection module
 */
export type TestBallData = {
  frames: Map<number, BallDetection>;
};

/**
 * Create TrackData for detection tests
 */
export function createTrackData(
  trackId: string,
  frames: TrackFrame[],
  teamId: TeamId,
  playerId: string | null = null
): TestTrackData {
  return {
    trackId,
    frames: new Map(frames.map((f) => [f.frameNumber, f])),
    teamId,
    playerId,
  };
}

/**
 * Create BallData for detection tests
 */
export function createBallData(detections: BallDetection[]): TestBallData {
  return {
    frames: new Map(detections.map((d) => [d.frameNumber, d])),
  };
}

// ============================================================================
// Scenario Generators
// ============================================================================

export type MatchScenarioOptions = {
  /** Number of players per team (default: 5) */
  playersPerTeam?: number;
  /** Total frame count (default: 300, ~10 seconds at 30fps) */
  frameCount?: number;
  /** Number of pass events to generate (default: 10) */
  passCount?: number;
  /** Number of carry events to generate (default: 5) */
  carryCount?: number;
  /** Number of turnover events to generate (default: 2) */
  turnoverCount?: number;
  /** Ratio of incomplete passes (default: 0.2) */
  incompletePassRatio?: number;
  /** Seed for deterministic random generation */
  seed?: number;
};

export type MatchScenario = {
  matchId: string;
  tracks: TrackDoc[];
  teamMetas: TrackTeamMeta[];
  mappings: TrackPlayerMapping[];
  ballTrack: BallTrackDoc;
  passEvents: PassEventDoc[];
  carryEvents: CarryEventDoc[];
  turnoverEvents: TurnoverEventDoc[];
  possessionSegments: PossessionSegment[];
};

/**
 * Simple seeded random number generator for deterministic tests
 */
function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Generate a complete match scenario with realistic test data
 *
 * Creates a coherent set of tracking data and events that can be used
 * for full pipeline testing.
 *
 * @example
 * const scenario = createMatchScenario({
 *   playersPerTeam: 5,
 *   frameCount: 300,
 *   passCount: 15,
 * });
 *
 * // Use in tests
 * const result = await stepDetectEvents({
 *   matchId: scenario.matchId,
 *   tracks: scenario.tracks,
 *   ballTrack: scenario.ballTrack,
 * });
 */
export function createMatchScenario(
  options: MatchScenarioOptions = {}
): MatchScenario {
  const {
    playersPerTeam = 5,
    frameCount = 300,
    passCount = 10,
    carryCount = 5,
    turnoverCount = 2,
    incompletePassRatio = 0.2,
    seed = 12345,
  } = options;

  const random = seededRandom(seed);
  const matchId = DEFAULT_MATCH_ID;
  const totalPlayers = playersPerTeam * 2;

  // Generate player tracks
  const tracks: TrackDoc[] = [];
  const teamMetas: TrackTeamMeta[] = [];
  const mappings: TrackPlayerMapping[] = [];

  for (let i = 0; i < totalPlayers; i++) {
    const trackId = `track-${i + 1}`;
    const teamId: TeamId = i < playersPerTeam ? "home" : "away";
    const playerId = `player-${i + 1}`;

    // Generate frames with slight movement
    const baseX = 0.2 + (i % playersPerTeam) * 0.15;
    const baseY = teamId === "home" ? 0.3 + random() * 0.4 : 0.3 + random() * 0.4;

    const frames: TrackFrame[] = [];
    for (let frame = 0; frame < frameCount; frame++) {
      // Add small random movement
      const x = baseX + (random() - 0.5) * 0.1;
      const y = baseY + (random() - 0.5) * 0.1;
      frames.push(
        createTrackFrame(trackId, frame, { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) })
      );
    }

    tracks.push(createTrackDoc({ trackId, matchId, frames, entityType: "player" }));
    teamMetas.push(createTrackTeamMeta(trackId, teamId));
    mappings.push(createTrackPlayerMapping(trackId, playerId));
  }

  // Generate ball track following possession changes
  const ballDetections: BallDetection[] = [];
  let currentPossessor = 0;

  for (let frame = 0; frame < frameCount; frame++) {
    // Occasionally change possession
    if (random() < 0.02) {
      currentPossessor = Math.floor(random() * totalPlayers);
    }

    // Ball follows the possessor with slight offset
    const possessorTrack = tracks[currentPossessor];
    const possessorFrame = possessorTrack.frames.find((f) => f.frameNumber === frame);

    if (possessorFrame) {
      const ballX = possessorFrame.center.x + (random() - 0.5) * 0.02;
      const ballY = possessorFrame.center.y + 0.02; // Slightly in front
      ballDetections.push(
        createBallDetection(frame, { x: ballX, y: ballY }, { visible: random() > 0.05 })
      );
    }
  }

  const ballTrack = createBallTrackDoc({ matchId, detections: ballDetections });

  // Generate pass events
  const passEvents: PassEventDoc[] = [];
  const frameStep = Math.floor(frameCount / (passCount + 1));

  for (let i = 0; i < passCount; i++) {
    const frameNumber = (i + 1) * frameStep;
    const kickerIdx = Math.floor(random() * playersPerTeam);
    const isIncomplete = random() < incompletePassRatio;

    const kicker = tracks[kickerIdx];
    const kickerFrame = kicker.frames.find((f) => f.frameNumber === frameNumber);
    const receiverIdx = (kickerIdx + 1 + Math.floor(random() * (playersPerTeam - 1))) % playersPerTeam;
    const receiver = tracks[receiverIdx];
    const receiverFrame = receiver.frames.find((f) => f.frameNumber === frameNumber + 10);

    if (kickerFrame && receiverFrame) {
      const outcome: PassOutcome = isIncomplete ? "incomplete" : "complete";

      passEvents.push(
        createPassEvent({
          eventId: `pass-${i + 1}`,
          matchId,
          frameNumber,
          kicker: {
            trackId: kicker.trackId,
            playerId: mappings[kickerIdx].playerId,
            teamId: "home",
            position: kickerFrame.center,
            confidence: 0.85 + random() * 0.1,
          },
          receiver: isIncomplete
            ? null
            : {
                trackId: receiver.trackId,
                playerId: mappings[receiverIdx].playerId,
                teamId: "home",
                position: receiverFrame.center,
                confidence: 0.8 + random() * 0.15,
              },
          outcome,
          outcomeConfidence: 0.75 + random() * 0.2,
        })
      );
    }
  }

  // Generate carry events
  const carryEvents: CarryEventDoc[] = [];
  const carryFrameStep = Math.floor(frameCount / (carryCount + 1));

  for (let i = 0; i < carryCount; i++) {
    const startFrame = (i + 1) * carryFrameStep;
    const endFrame = startFrame + 20 + Math.floor(random() * 30);
    const playerIdx = Math.floor(random() * playersPerTeam);
    const player = tracks[playerIdx];

    const startFrameData = player.frames.find((f) => f.frameNumber === startFrame);
    const endFrameData = player.frames.find(
      (f) => f.frameNumber === Math.min(endFrame, frameCount - 1)
    );

    if (startFrameData && endFrameData) {
      carryEvents.push(
        createCarryEvent({
          eventId: `carry-${i + 1}`,
          matchId,
          trackId: player.trackId,
          playerId: mappings[playerIdx].playerId,
          teamId: "home",
          startFrame,
          endFrame: Math.min(endFrame, frameCount - 1),
          startPosition: startFrameData.center,
          endPosition: endFrameData.center,
        })
      );
    }
  }

  // Generate turnover events
  const turnoverEvents: TurnoverEventDoc[] = [];
  const turnoverFrameStep = Math.floor(frameCount / (turnoverCount + 1));

  for (let i = 0; i < turnoverCount; i++) {
    const frameNumber = (i + 1) * turnoverFrameStep;
    const loserIdx = Math.floor(random() * playersPerTeam);
    const winnerIdx = playersPerTeam + Math.floor(random() * playersPerTeam);

    const loser = tracks[loserIdx];
    const winner = tracks[winnerIdx];
    const loserFrame = loser.frames.find((f) => f.frameNumber === frameNumber);
    const winnerFrame = winner.frames.find((f) => f.frameNumber === frameNumber);

    if (loserFrame && winnerFrame) {
      turnoverEvents.push(
        createTurnoverEvent({
          eventId: `turnover-${i + 1}`,
          matchId,
          frameNumber,
          turnoverType: "lost",
          player: {
            trackId: loser.trackId,
            playerId: mappings[loserIdx].playerId,
            teamId: "home",
            position: loserFrame.center,
          },
          otherPlayer: {
            trackId: winner.trackId,
            playerId: mappings[winnerIdx].playerId,
            teamId: "away",
            position: winnerFrame.center,
          },
        })
      );
    }
  }

  // Generate possession segments based on events
  const possessionSegments: PossessionSegment[] = [];
  let lastFrame = 0;
  let lastTeam: TeamId = "home";
  let lastTrackId = tracks[0].trackId;

  for (const turnover of turnoverEvents) {
    possessionSegments.push(
      createPossessionSegment({
        trackId: lastTrackId,
        teamId: lastTeam,
        startFrame: lastFrame,
        endFrame: turnover.frameNumber,
        endReason: "lost",
      })
    );

    lastFrame = turnover.frameNumber;
    lastTeam = lastTeam === "home" ? "away" : "home";
    lastTrackId = turnover.otherPlayer?.trackId ?? tracks[playersPerTeam].trackId;
  }

  // Add final possession segment
  possessionSegments.push(
    createPossessionSegment({
      trackId: lastTrackId,
      teamId: lastTeam,
      startFrame: lastFrame,
      endFrame: frameCount - 1,
      endReason: "unknown",
    })
  );

  return {
    matchId,
    tracks,
    teamMetas,
    mappings,
    ballTrack,
    passEvents,
    carryEvents,
    turnoverEvents,
    possessionSegments,
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  DEFAULT_MATCH_ID,
  DEFAULT_VERSION,
  DEFAULT_FPS,
  DEFAULT_CONFIDENCE,
};
