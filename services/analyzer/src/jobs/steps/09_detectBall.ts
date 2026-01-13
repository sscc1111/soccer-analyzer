/**
 * Step 09: Detect ball position in video
 *
 * This step:
 * 1. Downloads video and extracts frames
 * 2. Runs ball detection model on video frames
 * 3. Applies temporal smoothing (Kalman filter)
 * 4. Interpolates missing detections
 * 5. Saves ball track to Firestore
 *
 * Status: INTEGRATED - Ball detection pipeline with Kalman smoothing
 */

import { getDb } from "../../firebase/admin";
import type {
  BallDetection,
  BallTrackDoc,
  TrackingProcessingStatus,
  MatchSettings,
  ProcessingMode,
} from "@soccer/shared";
import { PROCESSING_CONFIGS } from "@soccer/shared";
import { createStepLogger, type ILogger } from "../../lib/logger";
import { wrapError, DetectionError } from "../../lib/errors";
import { downloadToTmp } from "../../lib/storage";
import { probeVideo, extractFrameBuffer } from "../../lib/ffmpeg";
import type { BallDetector, Detection } from "../../detection/types";
import { PlaceholderBallDetector } from "../../detection/placeholder";
import { KalmanFilter2D } from "../../detection/kalman";

type StepOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
  ballDetector?: BallDetector;
  /** Override processing mode (default: from match settings or 'standard') */
  processingMode?: ProcessingMode;
  /** Progress callback (0-100) */
  onProgress?: (progress: number) => void;
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
 * Get confidence threshold based on camera zoom hint
 */
function getConfidenceThreshold(zoomHint?: "near" | "mid" | "far"): number {
  switch (zoomHint) {
    case "near":
      return 0.6; // Higher threshold for clearer ball
    case "far":
      return 0.3; // Lower threshold for smaller ball
    case "mid":
    default:
      return 0.4;
  }
}

/**
 * Detect ball in video frames with Kalman filtering and interpolation
 */
export async function stepDetectBall({
  matchId,
  version,
  logger,
  ballDetector = new PlaceholderBallDetector(),
  processingMode,
  onProgress,
}: StepOptions) {
  const stepLog = logger ? createStepLogger(logger, "detect_ball") : null;
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  try {
    await updateTrackingStatus(matchId, {
      stage: "detecting_ball",
      progress: 0,
    });

    // 1. Get match settings and video info
    const matchSnap = await matchRef.get();
    const matchData = matchSnap.data() as {
      settings?: MatchSettings;
      video?: { storagePath?: string; durationSec?: number };
    } | undefined;

    const cameraZoomHint = matchData?.settings?.camera?.zoomHint;
    const storagePath = matchData?.video?.storagePath;
    const durationSec = matchData?.video?.durationSec ?? 0;

    if (!storagePath) {
      throw new DetectionError("detection", "video.storagePath missing", {
        matchId,
        step: "detect_ball",
      });
    }

    // Get FPS from processing mode
    const mode =
      processingMode ??
      matchData?.settings?.processingMode ??
      "standard";
    const fps = PROCESSING_CONFIGS[mode].fps;
    // Convert null to undefined for type compatibility
    const confidenceThreshold = getConfidenceThreshold(cameraZoomHint ?? undefined);

    stepLog?.info("Starting ball detection", {
      modelId: ballDetector.modelId,
      cameraZoomHint,
      processingMode: mode,
      fps,
      confidenceThreshold,
    });

    await updateTrackingStatus(matchId, { progress: 5 });
    onProgress?.(5);

    // 2. Download video and probe for dimensions
    const localPath = await downloadToTmp(storagePath);
    const probe = await probeVideo(localPath);
    const { width, height } = probe;
    const actualDuration = durationSec > 0 ? durationSec : probe.durationSec;

    if (width === 0 || height === 0) {
      throw new DetectionError("detection", "Invalid video dimensions", {
        matchId,
        width,
        height,
      });
    }

    stepLog?.info("Video ready for ball detection", {
      width,
      height,
      durationSec: actualDuration,
    });

    await updateTrackingStatus(matchId, { progress: 10 });
    onProgress?.(10);

    // 3. Calculate timestamps for frame extraction
    const totalFrames = Math.floor(actualDuration * fps);
    const timestamps: number[] = [];
    for (let i = 0; i < totalFrames; i++) {
      timestamps.push(i / fps);
    }

    stepLog?.info("Frame extraction starting", {
      totalFrames,
      fps,
    });

    // 4. Process frames and run ball detection
    const rawDetections: Array<{
      frameNumber: number;
      timestamp: number;
      detection: Detection | null;
    }> = [];

    // Process frames in batches for memory efficiency
    const BATCH_SIZE = 30;

    for (let batchStart = 0; batchStart < timestamps.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, timestamps.length);
      const batchTimestamps = timestamps.slice(batchStart, batchEnd);

      for (let i = 0; i < batchTimestamps.length; i++) {
        const timestamp = batchTimestamps[i];
        const frameNumber = batchStart + i;

        try {
          // Extract frame buffer
          const { buffer } = await extractFrameBuffer(
            localPath,
            timestamp,
            width,
            height
          );

          // Run ball detection
          const detection = await ballDetector.detectBall(buffer, width, height);

          rawDetections.push({
            frameNumber,
            timestamp,
            detection:
              detection && detection.confidence >= confidenceThreshold
                ? detection
                : null,
          });
        } catch (err) {
          // Log but continue on frame extraction errors
          stepLog?.info("Frame extraction failed, marking as not visible", {
            frameNumber,
            timestamp,
            error: err instanceof Error ? err.message : String(err),
          });
          rawDetections.push({
            frameNumber,
            timestamp,
            detection: null,
          });
        }
      }

      // Update progress (10-70 range for detection phase)
      const progress = 10 + Math.floor(60 * (batchEnd / timestamps.length));
      await updateTrackingStatus(matchId, { progress });
      onProgress?.(progress);

      stepLog?.info("Batch processed", {
        batchStart,
        batchEnd,
        totalFrames: timestamps.length,
        progress,
      });
    }

    const visibleCount = rawDetections.filter((d) => d.detection !== null).length;
    stepLog?.info("Raw detection complete", {
      totalFrames: rawDetections.length,
      visibleFrames: visibleCount,
      rawVisibilityRate: visibleCount / Math.max(1, rawDetections.length),
    });

    await updateTrackingStatus(matchId, { progress: 75 });
    onProgress?.(75);

    // 5. Apply Kalman filtering for temporal smoothing
    const smoothedDetections: BallDetection[] = [];
    let kalmanFilter: KalmanFilter2D | null = null;
    let lastVisibleFrame = -1;
    let lastVisibleTimestamp = 0;
    const dt = 1 / fps; // Time delta between frames

    for (const raw of rawDetections) {
      if (raw.detection) {
        if (!kalmanFilter) {
          // Initialize filter with first detection
          kalmanFilter = new KalmanFilter2D(raw.detection.center);
        } else {
          // Predict forward then update with observation
          kalmanFilter.predict(dt);
          kalmanFilter.update(
            raw.detection.center,
            raw.frameNumber,
            raw.timestamp
          );
        }

        lastVisibleFrame = raw.frameNumber;
        lastVisibleTimestamp = raw.timestamp;

        smoothedDetections.push({
          frameNumber: raw.frameNumber,
          timestamp: raw.timestamp,
          position: kalmanFilter.getPosition(),
          confidence: raw.detection.confidence,
          visible: true,
        });
      } else {
        // No detection - try to predict if we have a filter
        const timeSinceLastVisible =
          lastVisibleFrame >= 0
            ? (raw.frameNumber - lastVisibleFrame) / fps
            : Infinity;

        if (kalmanFilter && timeSinceLastVisible < 1.0) {
          // Predict forward
          kalmanFilter.predict(dt);
          const predictedPosition = kalmanFilter.getPosition();

          smoothedDetections.push({
            frameNumber: raw.frameNumber,
            timestamp: raw.timestamp,
            position: predictedPosition,
            confidence: Math.max(0.1, 0.9 - timeSinceLastVisible), // Decay confidence
            visible: false,
            interpolated: true,
          });
        } else {
          // Too long since last observation, mark as not visible
          smoothedDetections.push({
            frameNumber: raw.frameNumber,
            timestamp: raw.timestamp,
            position: { x: 0.5, y: 0.5 }, // Center as placeholder
            confidence: 0,
            visible: false,
          });
        }
      }
    }

    stepLog?.info("Kalman smoothing complete", {
      smoothedCount: smoothedDetections.length,
      interpolatedCount: smoothedDetections.filter((d) => d.interpolated).length,
    });

    await updateTrackingStatus(matchId, { progress: 90 });
    onProgress?.(90);

    // 6. Calculate statistics
    const visibleDetections = smoothedDetections.filter((d) => d.visible);
    const avgConfidence =
      visibleDetections.length > 0
        ? visibleDetections.reduce((sum, d) => sum + d.confidence, 0) /
          visibleDetections.length
        : 0;
    const visibilityRate =
      smoothedDetections.length > 0
        ? visibleDetections.length / smoothedDetections.length
        : 0;

    // 7. Create and save ball track
    const ballTrack: BallTrackDoc = {
      matchId,
      detections: smoothedDetections,
      version,
      modelId: ballDetector.modelId,
      avgConfidence,
      visibilityRate,
      createdAt: new Date().toISOString(),
    };

    await matchRef.collection("ballTrack").doc("current").set(ballTrack);

    await updateTrackingStatus(matchId, {
      stage: "detecting_ball",
      progress: 100,
    });
    onProgress?.(100);

    stepLog?.complete("Ball detection completed", {
      detectionCount: smoothedDetections.length,
      visibleCount: visibleDetections.length,
      interpolatedCount: smoothedDetections.filter((d) => d.interpolated).length,
      visibilityRate,
      avgConfidence,
      processingMode: mode,
    });

    return {
      matchId,
      version,
      detectionCount: smoothedDetections.length,
      visibleCount: visibleDetections.length,
      visibilityRate,
      avgConfidence,
    };
  } catch (error) {
    const wrapped = wrapError(error, { matchId, step: "detect_ball" });
    stepLog?.error("Ball detection failed", wrapped);
    throw wrapped;
  }
}
