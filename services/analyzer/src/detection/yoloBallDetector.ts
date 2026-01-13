/**
 * YOLO-based Ball Detector
 *
 * Implements BallDetector interface using real ML inference service.
 * This replaces PlaceholderBallDetector with actual YOLO model calls.
 */

import type { BallDetector, Detection } from "./types";
import { getMLClient, bufferToBase64DataUrl, type MLClient } from "./mlClient";
import { defaultLogger, type ILogger } from "../lib/logger";
import { DetectionError } from "../lib/errors";

/**
 * Configuration for YOLO ball detector
 */
export type YoloBallDetectorConfig = {
  /** Confidence threshold for ball detection (0-1) */
  confidenceThreshold: number;
  /** ML client instance (optional, will use singleton if not provided) */
  mlClient?: MLClient;
  /** Logger instance */
  logger?: ILogger;
};

/**
 * Default YOLO ball detector configuration
 */
export const DEFAULT_YOLO_BALL_CONFIG: YoloBallDetectorConfig = {
  confidenceThreshold: 0.4, // Lower threshold for ball (harder to detect)
  logger: defaultLogger,
};

/**
 * YOLO Ball Detector Implementation
 *
 * Uses ML inference service to detect ball in frames using YOLO model.
 */
export class YoloBallDetector implements BallDetector {
  readonly modelId = "yolo-ball-v1";

  private config: YoloBallDetectorConfig;
  private mlClient: MLClient;
  private logger: ILogger;

  constructor(config?: Partial<YoloBallDetectorConfig>) {
    this.config = { ...DEFAULT_YOLO_BALL_CONFIG, ...config };
    this.mlClient = this.config.mlClient || getMLClient();
    this.logger = this.config.logger || defaultLogger;
  }

  /**
   * Detect ball in a single frame
   */
  async detectBall(
    frameBuffer: Buffer,
    width: number,
    height: number
  ): Promise<Detection | null> {
    try {
      this.logger.debug("Detecting ball", { width, height, bufferSize: frameBuffer.length });

      // Convert frame buffer to base64 for transmission
      const frameData = bufferToBase64DataUrl(frameBuffer, width, height);

      // Call ML inference service
      const response = await this.mlClient.detectBall({
        frameData,
        width,
        height,
        confidenceThreshold: this.config.confidenceThreshold,
      });

      this.logger.debug("Ball detection completed", {
        detected: response.detection !== null,
        inferenceTimeMs: response.inferenceTimeMs,
        modelId: response.modelId,
        confidence: response.detection?.confidence,
      });

      // Validate detection if present
      if (response.detection) {
        const validDetection = this.validateDetection(response.detection);
        return validDetection;
      }

      return null;
    } catch (error) {
      this.logger.error("Ball detection failed", error, { width, height });
      throw new DetectionError("detection", "Ball detection failed", { width, height }, error as Error);
    }
  }

  /**
   * Validate and normalize ball detection
   */
  private validateDetection(detection: Detection): Detection | null {
    // Validate confidence
    if (detection.confidence < 0 || detection.confidence > 1) {
      this.logger.warn("Invalid confidence value for ball", { confidence: detection.confidence });
      return null;
    }

    // Validate bbox
    if (detection.bbox.x < 0 || detection.bbox.y < 0 || detection.bbox.w <= 0 || detection.bbox.h <= 0) {
      this.logger.warn("Invalid bbox for ball", { bbox: detection.bbox });
      return null;
    }

    if (detection.bbox.x > 1 || detection.bbox.y > 1 || detection.bbox.x + detection.bbox.w > 1 || detection.bbox.y + detection.bbox.h > 1) {
      this.logger.warn("Ball bbox outside normalized range", { bbox: detection.bbox });
      return null;
    }

    // Validate ball size - ball should be relatively small
    const bboxArea = detection.bbox.w * detection.bbox.h;
    if (bboxArea > 0.1) {
      // Ball bbox should not exceed 10% of frame area
      this.logger.warn("Ball bbox too large", { bbox: detection.bbox, area: bboxArea });
      return null;
    }

    return {
      ...detection,
      // Ensure label is set for ball
      label: detection.label || "ball",
    };
  }

  /**
   * Check if ML service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.mlClient.healthCheck();
      return true;
    } catch (error) {
      this.logger.warn("ML service health check failed", { error });
      return false;
    }
  }

  /**
   * Get detector configuration
   */
  getConfig(): YoloBallDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update detector configuration
   */
  updateConfig(config: Partial<YoloBallDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info("Ball detector config updated", { config: this.config });
  }
}

/**
 * Factory function to create YOLO ball detector
 */
export function createYoloBallDetector(config?: Partial<YoloBallDetectorConfig>): BallDetector {
  return new YoloBallDetector(config);
}
