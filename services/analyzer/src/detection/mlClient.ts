/**
 * ML Inference Service HTTP Client
 *
 * Communicates with the Python FastAPI ML service for:
 * - Player detection (YOLO)
 * - Ball detection (YOLO)
 * - Video tracking
 */

import { defaultLogger, type ILogger } from "../lib/logger";
import { ExternalServiceError, TimeoutError } from "../lib/errors";
import type { Detection } from "./types";

/**
 * ML service configuration
 */
export type MLClientConfig = {
  /** Base URL for ML inference service */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Initial retry delay in milliseconds */
  retryDelayMs: number;
  /** Logger instance */
  logger?: ILogger;
};

/**
 * Default ML client configuration
 */
export const DEFAULT_ML_CLIENT_CONFIG: MLClientConfig = {
  baseUrl: process.env.ML_INFERENCE_URL || "http://localhost:8080",
  timeoutMs: 30000, // 30 seconds
  maxRetries: 3,
  retryDelayMs: 1000,
  logger: defaultLogger,
};

/**
 * Player detection request
 */
export type DetectPlayersRequest = {
  /** Base64-encoded frame image (RGB) */
  frameData: string;
  /** Frame width in pixels */
  width: number;
  /** Frame height in pixels */
  height: number;
  /** Confidence threshold (0-1) */
  confidenceThreshold?: number;
  /** NMS IoU threshold (0-1) */
  nmsThreshold?: number;
};

/**
 * Player detection response
 */
export type DetectPlayersResponse = {
  /** Array of player detections */
  detections: Detection[];
  /** Inference time in milliseconds */
  inferenceTimeMs: number;
  /** Model identifier */
  modelId: string;
};

/**
 * Ball detection request
 */
export type DetectBallRequest = {
  /** Base64-encoded frame image (RGB) */
  frameData: string;
  /** Frame width in pixels */
  width: number;
  /** Frame height in pixels */
  height: number;
  /** Confidence threshold (0-1) */
  confidenceThreshold?: number;
};

/**
 * Ball detection response
 */
export type DetectBallResponse = {
  /** Ball detection or null if not detected */
  detection: Detection | null;
  /** Inference time in milliseconds */
  inferenceTimeMs: number;
  /** Model identifier */
  modelId: string;
};

/**
 * Video tracking request
 */
export type TrackVideoRequest = {
  /** Path to video file (accessible to ML service) */
  videoPath: string;
  /** Detection configuration */
  config?: {
    confidenceThreshold?: number;
    nmsThreshold?: number;
    trackPlayers?: boolean;
    trackBall?: boolean;
  };
};

/**
 * Video tracking response
 */
export type TrackVideoResponse = {
  /** Path to output tracking data (JSON) */
  trackingDataPath: string;
  /** Total frames processed */
  totalFrames: number;
  /** Processing time in seconds */
  processingTimeSeconds: number;
  /** Model identifiers used */
  models: {
    player?: string;
    ball?: string;
  };
};

/**
 * ML Inference Service Client
 */
export class MLClient {
  private config: MLClientConfig;
  private logger: ILogger;

  constructor(config?: Partial<MLClientConfig>) {
    this.config = { ...DEFAULT_ML_CLIENT_CONFIG, ...config };
    this.logger = this.config.logger || defaultLogger;
  }

  /**
   * Detect players in a single frame
   */
  async detectPlayers(request: DetectPlayersRequest): Promise<DetectPlayersResponse> {
    return this.post<DetectPlayersResponse>("/detect/players", request);
  }

  /**
   * Detect ball in a single frame
   */
  async detectBall(request: DetectBallRequest): Promise<DetectBallResponse> {
    return this.post<DetectBallResponse>("/detect/ball", request);
  }

  /**
   * Track entire video (batch processing)
   */
  async trackVideo(request: TrackVideoRequest): Promise<TrackVideoResponse> {
    // Video tracking may take longer, use extended timeout
    const extendedTimeout = this.config.timeoutMs * 10;
    return this.post<TrackVideoResponse>("/track/video", request, extendedTimeout);
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ status: string; version: string }> {
    return this.get<{ status: string; version: string }>("/health");
  }

  /**
   * Generic POST request with retry logic
   */
  private async post<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number = this.config.timeoutMs
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(`Retrying ML request (attempt ${attempt + 1})`, {
            url,
            delayMs: delay,
          });
          await sleep(delay);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          this.logger.debug("ML service request", { url, endpoint });

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new ExternalServiceError(
              "ml-inference",
              `HTTP ${response.status}: ${errorText}`,
              { url, status: response.status },
              response.status >= 500 // Retry on server errors
            );
          }

          const data = (await response.json()) as T;
          this.logger.debug("ML service response received", { url, endpoint });
          return data;
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error as Error;

        // Check if timeout
        if ((error as Error).name === "AbortError") {
          lastError = new TimeoutError(endpoint, timeoutMs, { url });
        }

        // Wrap external errors
        if (!(error instanceof ExternalServiceError || error instanceof TimeoutError)) {
          lastError = new ExternalServiceError(
            "ml-inference",
            (error as Error).message,
            { url, endpoint },
            true,
            error as Error
          );
        }

        // Don't retry if not retryable
        const analyzerError = lastError as ExternalServiceError | TimeoutError;
        if (!analyzerError.isRetryable && attempt < this.config.maxRetries) {
          this.logger.error("ML request failed (non-retryable)", lastError, { url, attempt });
          throw lastError;
        }

        if (attempt === this.config.maxRetries) {
          this.logger.error("ML request failed (max retries exceeded)", lastError, {
            url,
            attempts: attempt + 1,
          });
          throw lastError;
        }
      }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError || new Error("Unknown error in ML request");
  }

  /**
   * Generic GET request
   */
  private async get<T>(endpoint: string): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new ExternalServiceError(
            "ml-inference",
            `HTTP ${response.status}: ${errorText}`,
            { url, status: response.status },
            false
          );
        }

        return (await response.json()) as T;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new TimeoutError(endpoint, this.config.timeoutMs, { url });
      }
      throw error;
    }
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert frame buffer to base64 data URL
 */
export function bufferToBase64DataUrl(buffer: Buffer, width: number, height: number): string {
  // Assuming buffer is raw RGB data
  // In production, you may want to convert to PNG/JPEG for better compression
  const base64 = buffer.toString("base64");
  return `data:image/raw;base64,${base64}`;
}

/**
 * Create a singleton ML client instance
 */
let mlClientInstance: MLClient | null = null;

export function getMLClient(config?: Partial<MLClientConfig>): MLClient {
  if (!mlClientInstance) {
    mlClientInstance = new MLClient(config);
  }
  return mlClientInstance;
}

/**
 * Reset ML client instance (useful for testing)
 */
export function resetMLClient(): void {
  mlClientInstance = null;
}
