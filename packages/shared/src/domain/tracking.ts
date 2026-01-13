/**
 * Phase 1.1: Player detection and tracking types
 *
 * トラッキングデータの型定義
 * Firestore: matches/{matchId}/tracks/{trackId}
 */

/**
 * Bounding box for detected objects
 */
export type BoundingBox = {
  /** X coordinate (0-1 normalized) */
  x: number;
  /** Y coordinate (0-1 normalized) */
  y: number;
  /** Width (0-1 normalized) */
  w: number;
  /** Height (0-1 normalized) */
  h: number;
};

/**
 * 2D point in normalized coordinates (0-1)
 */
export type Point2D = {
  x: number;
  y: number;
};

/**
 * Single frame data for a track
 */
export type TrackFrame = {
  /** Unique track ID (persistent across frames) */
  trackId: string;
  /** Frame number in the video */
  frameNumber: number;
  /** Timestamp in seconds */
  timestamp: number;
  /** Bounding box of the detection */
  bbox: BoundingBox;
  /** Center point of the bounding box */
  center: Point2D;
  /** Detection confidence (0-1) */
  confidence: number;
};

/**
 * Track document stored in Firestore
 * Contains all frame data for a single tracked entity
 */
export type TrackDoc = {
  trackId: string;
  matchId: string;
  /** Frame data for this track */
  frames: TrackFrame[];
  /** First frame where this track appears */
  startFrame: number;
  /** Last frame where this track appears */
  endFrame: number;
  /** Start timestamp in seconds */
  startTime: number;
  /** End timestamp in seconds */
  endTime: number;
  /** Average detection confidence across all frames */
  avgConfidence: number;
  /** Entity type classification */
  entityType: "player" | "referee" | "goalkeeper" | "other" | "unknown";
  /** Processing version */
  version: string;
  createdAt: string;
};

/**
 * Phase 1.2: Team classification types
 */

/** Team identifier */
export type TeamId = "home" | "away" | "unknown";

/**
 * Team classification metadata for a track
 */
export type TrackTeamMeta = {
  trackId: string;
  /** Assigned team */
  teamId: TeamId;
  /** Classification confidence (0-1) */
  teamConfidence: number;
  /** Primary color detected from uniform (hex) */
  dominantColor?: string;
  /** Classification method used */
  classificationMethod: "color_clustering" | "user_hint" | "manual";
};

/**
 * Phase 1.3: Ball detection types
 */

/**
 * Single ball detection in a frame
 */
export type BallDetection = {
  /** Frame number in the video */
  frameNumber: number;
  /** Timestamp in seconds */
  timestamp: number;
  /** Ball position (normalized 0-1) */
  position: Point2D;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Whether ball is visible in this frame */
  visible: boolean;
  /** If not visible, reason for interpolation */
  interpolated?: boolean;
};

/**
 * Ball track document
 * Firestore: matches/{matchId}/ballTrack
 */
export type BallTrackDoc = {
  matchId: string;
  /** All ball detections */
  detections: BallDetection[];
  /** Processing version */
  version: string;
  /** Detection model used */
  modelId: string;
  /** Average confidence for visible detections */
  avgConfidence: number;
  /** Percentage of frames with visible ball */
  visibilityRate: number;
  createdAt: string;
};

/**
 * Phase 1.4: Jersey number OCR and track-to-player mapping
 */

/**
 * OCR result for jersey number
 */
export type JerseyOcrResult = {
  /** Detected jersey number */
  jerseyNumber: number | null;
  /** OCR confidence (0-1) */
  confidence: number;
  /** Frame number where OCR was performed */
  frameNumber: number;
  /** Source of the OCR */
  source: "ocr" | "manual";
};

/**
 * Mapping from track to player
 * Firestore: matches/{matchId}/trackMappings/{trackId}
 */
export type TrackPlayerMapping = {
  trackId: string;
  /** Player ID from roster (if matched) */
  playerId: string | null;
  /** Detected jersey number */
  jerseyNumber: number | null;
  /** OCR confidence (0-1) */
  ocrConfidence: number;
  /** How the mapping was established */
  source: "ocr" | "manual" | "roster_match";
  /** All OCR attempts for this track */
  ocrHistory?: JerseyOcrResult[];
  /** Whether this mapping needs user review */
  needsReview: boolean;
  /** Review reason if needsReview is true */
  reviewReason?: "low_confidence" | "multiple_candidates" | "no_match";
};

/**
 * Processing status for tracking pipeline
 */
export type TrackingProcessingStatus = {
  matchId: string;
  stage:
    | "pending"
    | "extracting_frames"
    | "detecting_players"
    | "tracking"
    | "classifying_teams"
    | "detecting_ball"
    | "ocr_jerseys"
    | "detecting_events"
    | "computing_stats"
    | "done"
    | "error";
  progress: number;
  currentStep?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

/**
 * Phase 1.5: Homography estimation types
 * Used for camera coordinate to field coordinate transformation (tactical view)
 */

/**
 * Keypoint for homography calculation
 */
export type HomographyKeypoint = {
  /** Screen coordinates (normalized 0-1) */
  screen: Point2D;
  /** Field coordinates in meters */
  field: Point2D;
  /** Label for the keypoint (e.g., 'corner_tl', 'penalty_area_top') */
  label: string;
  /** Detection confidence (0-1) */
  confidence: number;
};

/**
 * Homography data for camera-to-field coordinate transformation
 * Firestore: matches/{matchId}/homography/{frameNumber}
 */
export type HomographyData = {
  matchId: string;
  /** Frame number this homography applies to */
  frameNumber: number;
  /** 3x3 transformation matrix (row-major) */
  matrix: number[][];
  /** Detected keypoints used for homography calculation */
  keypoints: HomographyKeypoint[];
  /** Overall confidence of the homography (0-1) */
  confidence: number;
  /** Field dimensions in meters (for reference) */
  fieldSize?: { length: number; width: number };
  /** Whether camera was moving (requires frequent updates) */
  cameraMoving?: boolean;
  /** Processing version */
  version: string;
  createdAt: string;
};

/**
 * Phase 2.5: Predicted position for off-screen players
 * Used for tracking players when they leave the camera frame
 */

/**
 * Velocity vector
 */
export type Velocity2D = {
  /** Velocity in x direction (units per second) */
  vx: number;
  /** Velocity in y direction (units per second) */
  vy: number;
};

/**
 * Predicted position for a player who left the camera frame
 * Uses Kalman filter for prediction
 */
export type PredictedPosition = {
  trackId: string;
  /** Frame number of this prediction */
  frameNumber: number;
  /** Predicted screen position (normalized 0-1, may be outside 0-1 range) */
  position: Point2D;
  /** Predicted velocity */
  velocity: Velocity2D;
  /** Flag indicating this is a prediction, not an observation */
  isPredicted: true;
  /** Confidence (decays over time since last observation) */
  confidence: number;
  /** Last frame where this player was actually observed */
  lastObservedFrame: number;
  /** Time since last observation in seconds */
  timeSinceObservation: number;
  /** Field position after homography transformation (if available) */
  fieldPosition?: Point2D;
};

/**
 * Configuration for position prediction (Kalman filter parameters)
 */
export type PredictionConfig = {
  /** Process noise (higher = more responsive to changes) */
  processNoise: number;
  /** Measurement noise (higher = smoother predictions) */
  measurementNoise: number;
  /** Confidence decay rate per second */
  confidenceDecayRate: number;
  /** Maximum prediction time in seconds */
  maxPredictionTime: number;
};
