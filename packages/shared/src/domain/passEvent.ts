/**
 * Phase 2: Event detection types
 *
 * パス、キャリー、ターンオーバー等のイベント型定義
 * Firestore: matches/{matchId}/passEvents/{eventId}
 */

import type { Point2D, TeamId } from "./tracking";

/**
 * Phase 2.1: Ball possession types
 */

/**
 * Continuous ball possession segment
 */
export type PossessionSegment = {
  /** Track ID of the possessing player */
  trackId: string;
  /** Player ID if mapped */
  playerId: string | null;
  /** Team of the possessing player */
  teamId: TeamId;
  /** Frame where possession started */
  startFrame: number;
  /** Frame where possession ended */
  endFrame: number;
  /** Start timestamp in seconds */
  startTime: number;
  /** End timestamp in seconds */
  endTime: number;
  /** Possession confidence (0-1) */
  confidence: number;
  /** How possession ended */
  endReason: "pass" | "lost" | "shot" | "out_of_bounds" | "whistle" | "unknown";
};

/**
 * Phase 2.2: Pass event types
 */

/** Pass outcome */
export type PassOutcome = "complete" | "incomplete" | "intercepted";

/**
 * Pass event document
 * Firestore: matches/{matchId}/passEvents/{eventId}
 */
export type PassEventDoc = {
  eventId: string;
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  type: "pass";

  /** Frame number when pass was initiated */
  frameNumber: number;
  /** Timestamp when pass was initiated */
  timestamp: number;

  /** Kicker information */
  kicker: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    position: Point2D;
    /** Confidence in kicker identification (0-1) */
    confidence: number;
  };

  /** Receiver information (null if incomplete/intercepted) */
  receiver: {
    trackId: string | null;
    playerId: string | null;
    teamId: TeamId | null;
    position: Point2D | null;
    /** Confidence in receiver identification (0-1) */
    confidence: number;
  } | null;

  /** Pass outcome */
  outcome: PassOutcome;
  /** Confidence in outcome determination (0-1) */
  outcomeConfidence: number;

  /** Pass characteristics */
  passType?: "short" | "medium" | "long" | "through" | "cross";
  /** Pass direction relative to attack */
  passDirection?: "forward" | "backward" | "lateral";

  /** Overall event confidence (0-1) */
  confidence: number;

  /** Whether this event needs user review */
  needsReview: boolean;
  /** Review reason if needsReview is true */
  reviewReason?: "low_kicker_confidence" | "low_receiver_confidence" | "ambiguous_outcome";

  /** Source of the event */
  source: "auto" | "manual" | "corrected";

  /** Processing version */
  version: string;
  createdAt: string;
  updatedAt?: string;
  /** Whether this event was merged from first and second half */
  mergedFromHalves?: boolean;
};

/**
 * Phase 2.3: Carry (dribble) event types
 */

/**
 * Carry event document
 * Firestore: matches/{matchId}/carryEvents/{eventId}
 */
export type CarryEventDoc = {
  eventId: string;
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  type: "carry";

  /** Track ID of the carrying player */
  trackId: string;
  /** Player ID if mapped */
  playerId: string | null;
  /** Team of the carrying player */
  teamId: TeamId;

  /** Frame where carry started */
  startFrame: number;
  /** Frame where carry ended */
  endFrame: number;
  /** Start timestamp in seconds */
  startTime: number;
  /** End timestamp in seconds */
  endTime: number;

  /** Start position */
  startPosition: Point2D;
  /** End position */
  endPosition: Point2D;

  /**
   * Carry index - relative movement magnitude
   * Normalized value (screen distance traveled)
   */
  carryIndex: number;

  /**
   * Progress index - movement toward attack direction
   * Positive = forward, Negative = backward
   * Only meaningful when attackDirection is set
   */
  progressIndex: number;

  /**
   * Carry distance in meters (only available with calibration)
   */
  distanceMeters?: number;

  /**
   * Phase 2.2.2: Whether this carry is classified as a dribble
   * true = dribble (active running with ball against defenders)
   * false = simple carry (low intensity movement with ball)
   */
  isDribble?: boolean;

  /**
   * Phase 2.2.2: Confidence in dribble classification (0-1)
   * Higher confidence indicates stronger evidence of dribbling behavior
   */
  dribbleConfidence?: number;

  /** Overall event confidence (0-1) */
  confidence: number;

  /** Processing version */
  version: string;
  createdAt: string;
  /** Whether this event was merged from first and second half */
  mergedFromHalves?: boolean;
};

/**
 * Phase 2.4: Turnover event types
 */

/** Turnover type */
export type TurnoverType = "lost" | "won";

/**
 * Turnover event document
 * Firestore: matches/{matchId}/turnoverEvents/{eventId}
 */
export type TurnoverEventDoc = {
  eventId: string;
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  type: "turnover";
  turnoverType: TurnoverType;

  /** Frame number when turnover occurred */
  frameNumber: number;
  /** Timestamp when turnover occurred */
  timestamp: number;

  /** Player who lost/won the ball */
  player: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    position: Point2D;
  };

  /** Other player involved (if applicable) */
  otherPlayer?: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    position: Point2D;
  };

  /** Context of the turnover */
  context?: "tackle" | "interception" | "bad_touch" | "out_of_bounds" | "other";

  /** Overall event confidence (0-1) */
  confidence: number;

  /** Whether this event needs user review */
  needsReview: boolean;

  /** Processing version */
  version: string;
  createdAt: string;
  /** Whether this event was merged from first and second half */
  mergedFromHalves?: boolean;
};

/**
 * Phase 2.4: Shot event types
 */

/** Shot result */
export type ShotResult = "goal" | "saved" | "blocked" | "missed" | "post";

/**
 * Shot event document
 * Firestore: matches/{matchId}/shotEvents/{eventId}
 */
export type ShotEventDoc = {
  eventId: string;
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  type: "shot";

  /** Frame number when shot was taken */
  frameNumber?: number;
  /** Timestamp when shot was taken */
  timestamp: number;

  /** Team that took the shot */
  team: TeamId;
  /** Player who took the shot (jersey number or identifier) */
  player?: string;
  /** Track ID if available */
  trackId?: string;
  /** Player ID if mapped */
  playerId?: string;

  /** Shot result */
  result: ShotResult;
  /** Shot position on the field */
  position?: Point2D;
  /** Target position (where the ball was aimed) */
  targetPosition?: Point2D;

  /** Shot characteristics */
  shotType?: "header" | "volley" | "placed" | "power" | "other";
  /** Body part used */
  bodyPart?: "right_foot" | "left_foot" | "head" | "other";

  /** Expected Goals (xG) - probability of scoring (0-1) */
  xG?: number;
  /** xG calculation factors */
  xGFactors?: {
    distanceFromGoal: number;
    angleToGoal: number;
    inPenaltyArea: boolean;
    inGoalArea: boolean;
    shotType?: string;
  };

  /** Confidence in the detection (0-1) */
  confidence: number;
  /** Source of the event */
  source: "gemini" | "manual" | "auto";

  /** Processing version */
  version: string;
  createdAt: string;
  updatedAt?: string;
  /** Whether this event was merged from first and second half */
  mergedFromHalves?: boolean;
};

/**
 * Phase 2.5: Set piece event types
 */

/** Set piece type */
export type SetPieceType = "corner" | "free_kick" | "penalty" | "throw_in" | "goal_kick";

/** Set piece outcome */
export type SetPieceOutcome = "goal" | "chance" | "cleared" | "foul" | "other";

/**
 * Set piece event document
 * Firestore: matches/{matchId}/setPieceEvents/{eventId}
 */
export type SetPieceEventDoc = {
  eventId: string;
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  type: "setPiece";

  /** Frame number when set piece started */
  frameNumber?: number;
  /** Timestamp when set piece started */
  timestamp: number;

  /** Team taking the set piece */
  team: TeamId;
  /** Player taking the set piece */
  player?: string;
  /** Track ID if available */
  trackId?: string;

  /** Set piece type */
  setPieceType: SetPieceType;
  /** Position where set piece was taken */
  position?: Point2D;

  /** Outcome of the set piece */
  outcome?: SetPieceOutcome;
  /** Description of what happened */
  description?: string;

  /** Detailed outcome analysis (Section 3.2.2) */
  outcomeDetails?: {
    /** What happened after the set piece */
    resultType: "shot" | "goal" | "cleared" | "turnover" | "continued_play" | "unknown";
    /** Time elapsed from set piece to outcome (seconds) */
    timeToOutcome: number;
    /** Whether it created a scoring opportunity */
    scoringChance: boolean;
    /** Event ID of the outcome event (if any) */
    outcomeEventId?: string;
  };

  /** Confidence in the detection (0-1) */
  confidence: number;
  /** Source of the event */
  source: "gemini" | "manual" | "auto";

  /** Processing version */
  version: string;
  createdAt: string;
  updatedAt?: string;
  /** Whether this event was merged from first and second half */
  mergedFromHalves?: boolean;
};

/**
 * Union type for all tracked events
 */
export type TrackedEvent =
  | PassEventDoc
  | CarryEventDoc
  | TurnoverEventDoc
  | ShotEventDoc
  | SetPieceEventDoc;

/**
 * Pending review document
 * Firestore: matches/{matchId}/pendingReviews/{eventId}
 */
export type PendingReviewDoc = {
  eventId: string;
  /** Match ID this review belongs to */
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  eventType: "pass" | "carry" | "turnover";
  reason: "low_confidence" | "ambiguous_player" | "multiple_candidates";
  /** Alternative candidates if applicable */
  candidates?: Array<{
    trackId: string;
    playerId: string | null;
    confidence: number;
  }>;
  /** Whether user has resolved this review */
  resolved: boolean;
  /** Resolution details */
  resolution?: {
    selectedTrackId?: string;
    correctedOutcome?: PassOutcome;
    resolvedBy: "user" | "auto";
    resolvedAt: string;
  };
  createdAt: string;
};
