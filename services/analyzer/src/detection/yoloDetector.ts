/**
 * YOLO-based Player Detector
 *
 * Implements PlayerDetector interface using real ML inference service.
 * This replaces PlaceholderPlayerDetector with actual YOLO model calls.
 */

import type { PlayerDetector, Detection } from "./types";
import { getMLClient, bufferToBase64DataUrl, type MLClient } from "./mlClient";
import { defaultLogger, type ILogger } from "../lib/logger";
import { DetectionError } from "../lib/errors";

/**
 * Configuration for YOLO player detector
 */
export type YoloPlayerDetectorConfig = {
  /** Confidence threshold for detections (0-1) */
  confidenceThreshold: number;
  /** NMS IoU threshold (0-1) */
  nmsThreshold: number;
  /** ML client instance (optional, will use singleton if not provided) */
  mlClient?: MLClient;
  /** Logger instance */
  logger?: ILogger;
};

/**
 * Default YOLO player detector configuration
 */
export const DEFAULT_YOLO_PLAYER_CONFIG: YoloPlayerDetectorConfig = {
  confidenceThreshold: 0.5,
  nmsThreshold: 0.45,
  logger: defaultLogger,
};

/**
 * YOLO Player Detector Implementation
 *
 * Uses ML inference service to detect players in frames using YOLO model.
 */
export class YoloPlayerDetector implements PlayerDetector {
  readonly modelId = "yolo-player-v1";

  private config: YoloPlayerDetectorConfig;
  private mlClient: MLClient;
  private logger: ILogger;

  constructor(config?: Partial<YoloPlayerDetectorConfig>) {
    this.config = { ...DEFAULT_YOLO_PLAYER_CONFIG, ...config };
    this.mlClient = this.config.mlClient || getMLClient();
    this.logger = this.config.logger || defaultLogger;
  }

  /**
   * Detect players in a single frame
   */
  async detectPlayers(
    frameBuffer: Buffer,
    width: number,
    height: number
  ): Promise<Detection[]> {
    try {
      this.logger.debug("Detecting players", { width, height, bufferSize: frameBuffer.length });

      // Convert frame buffer to base64 for transmission
      const frameData = bufferToBase64DataUrl(frameBuffer, width, height);

      // Call ML inference service
      const response = await this.mlClient.detectPlayers({
        frameData,
        width,
        height,
        confidenceThreshold: this.config.confidenceThreshold,
        nmsThreshold: this.config.nmsThreshold,
      });

      this.logger.debug("Player detection completed", {
        detectionCount: response.detections.length,
        inferenceTimeMs: response.inferenceTimeMs,
        modelId: response.modelId,
      });

      // Validate detections
      const validDetections = this.validateDetections(response.detections);

      return validDetections;
    } catch (error) {
      this.logger.error("Player detection failed", error, { width, height });
      throw new DetectionError("detection", "Player detection failed", { width, height }, error as Error);
    }
  }

  /**
   * Validate and normalize detections
   */
  private validateDetections(detections: Detection[]): Detection[] {
    return detections
      .filter((det) => {
        // Filter out invalid detections
        if (det.confidence < 0 || det.confidence > 1) {
          this.logger.warn("Invalid confidence value", { confidence: det.confidence });
          return false;
        }

        if (det.bbox.x < 0 || det.bbox.y < 0 || det.bbox.w <= 0 || det.bbox.h <= 0) {
          this.logger.warn("Invalid bbox", { bbox: det.bbox });
          return false;
        }

        if (det.bbox.x > 1 || det.bbox.y > 1 || det.bbox.x + det.bbox.w > 1 || det.bbox.y + det.bbox.h > 1) {
          this.logger.warn("Bbox outside normalized range", { bbox: det.bbox });
          return false;
        }

        return true;
      })
      .map((det) => ({
        ...det,
        // Ensure label is set for players
        label: det.label || "player",
      }));
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
  getConfig(): YoloPlayerDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update detector configuration
   */
  updateConfig(config: Partial<YoloPlayerDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info("Player detector config updated", { config: this.config });
  }
}

/**
 * Factory function to create YOLO player detector
 */
export function createYoloPlayerDetector(config?: Partial<YoloPlayerDetectorConfig>): PlayerDetector {
  return new YoloPlayerDetector(config);
}
