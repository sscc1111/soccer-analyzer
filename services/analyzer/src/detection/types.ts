/**
 * Detection module types
 *
 * Abstraction layer for ML-based detection models.
 * Allows swapping between placeholder and real implementations.
 */

import type { BoundingBox, Point2D } from "@soccer/shared";

/**
 * Single detection from a frame
 */
export type Detection = {
  /** Bounding box (normalized 0-1) */
  bbox: BoundingBox;
  /** Center point (normalized 0-1) */
  center: Point2D;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Detected class label */
  label: string;
  /** Class-specific confidence if available */
  classConfidence?: number;
};

/**
 * Frame with detections
 */
export type FrameDetections = {
  /** Frame number (0-indexed) */
  frameNumber: number;
  /** Timestamp in seconds */
  timestamp: number;
  /** All detections in this frame */
  detections: Detection[];
};

/**
 * Player detection interface
 */
export interface PlayerDetector {
  /**
   * Detect players in a single frame
   * @param frameBuffer - RGB buffer of the frame
   * @param width - Frame width in pixels
   * @param height - Frame height in pixels
   * @returns Array of player detections
   */
  detectPlayers(
    frameBuffer: Buffer,
    width: number,
    height: number
  ): Promise<Detection[]>;

  /**
   * Model identifier
   */
  readonly modelId: string;
}

/**
 * Ball detection interface
 */
export interface BallDetector {
  /**
   * Detect ball in a single frame
   * @param frameBuffer - RGB buffer of the frame
   * @param width - Frame width in pixels
   * @param height - Frame height in pixels
   * @returns Ball detection or null if not detected
   */
  detectBall(
    frameBuffer: Buffer,
    width: number,
    height: number
  ): Promise<Detection | null>;

  /**
   * Model identifier
   */
  readonly modelId: string;
}

/**
 * Color extractor for team classification
 */
export interface ColorExtractor {
  /**
   * Extract dominant color from a region
   * @param frameBuffer - RGB buffer of the frame
   * @param width - Frame width in pixels
   * @param height - Frame height in pixels
   * @param bbox - Bounding box to extract color from (normalized 0-1)
   * @returns Dominant color as hex string
   */
  extractDominantColor(
    frameBuffer: Buffer,
    width: number,
    height: number,
    bbox: BoundingBox
  ): Promise<string>;

  /**
   * Extract color histogram from a region
   * @param frameBuffer - RGB buffer of the frame
   * @param width - Frame width in pixels
   * @param height - Frame height in pixels
   * @param bbox - Bounding box to extract from (normalized 0-1)
   * @returns Color histogram (HSV bins)
   */
  extractColorHistogram(
    frameBuffer: Buffer,
    width: number,
    height: number,
    bbox: BoundingBox
  ): Promise<number[]>;
}

/**
 * Tracking algorithm interface
 */
export interface Tracker {
  /**
   * Update tracker with new detections
   * @param frameNumber - Current frame number
   * @param timestamp - Current timestamp
   * @param detections - Detections from this frame
   * @returns Track assignments (detection index -> track ID)
   */
  update(
    frameNumber: number,
    timestamp: number,
    detections: Detection[]
  ): Map<number, string>;

  /**
   * Get all active track IDs
   */
  getActiveTrackIds(): string[];

  /**
   * Reset tracker state
   */
  reset(): void;

  /**
   * Tracker algorithm identifier
   */
  readonly trackerId: string;
}

/**
 * Detection configuration
 */
export type DetectionConfig = {
  /** Confidence threshold for detections (0-1) */
  confidenceThreshold: number;
  /** Non-maximum suppression IoU threshold (0-1) */
  nmsThreshold: number;
  /** Maximum detections per frame */
  maxDetections: number;
};

/**
 * Default detection configuration
 */
export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  confidenceThreshold: 0.5,
  nmsThreshold: 0.45,
  maxDetections: 50,
};
