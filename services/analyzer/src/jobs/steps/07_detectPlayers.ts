/**
 * Step 07: Detect players and create tracks
 *
 * This step:
 * 1. Downloads video from Cloud Storage
 * 2. Extracts frames at configured FPS
 * 3. Runs player detection model on each frame
 * 4. Applies tracking algorithm (ByteTrack/SORT)
 * 5. Saves tracks to Firestore
 *
 * Status: INTEGRATED - Frame extraction and detection pipeline implemented
 */

import { getDb } from "../../firebase/admin";
import type {
  TrackDoc,
  TrackFrame,
  TrackingProcessingStatus,
  ProcessingMode,
} from "@soccer/shared";
import { PROCESSING_CONFIGS } from "@soccer/shared";
import { createStepLogger, type ILogger } from "../../lib/logger";
import { wrapError, DetectionError } from "../../lib/errors";
import { downloadToTmp } from "../../lib/storage";
import { probeVideo, extractFrameBuffer } from "../../lib/ffmpeg";
import type { PlayerDetector, Tracker, Detection } from "../../detection/types";
import {
  PlaceholderPlayerDetector,
  PlaceholderTracker,
} from "../../detection/placeholder";

type StepOptions = {
  matchId: string;
  videoId?: string;
  version: string;
  logger?: ILogger;
  playerDetector?: PlayerDetector;
  tracker?: Tracker;
  /** Override processing mode (default: from match settings or 'standard') */
  processingMode?: ProcessingMode;
  /** Progress callback (0-100) */
  onProgress?: (progress: number) => void;
};

/**
 * Get video storage path and duration, supporting both videoId and legacy match.video
 */
async function getVideoInfo(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId?: string
): Promise<{ storagePath: string | null; durationSec?: number }> {
  if (videoId) {
    const videoDoc = await matchRef.collection("videos").doc(videoId).get();
    if (videoDoc.exists) {
      const data = videoDoc.data();
      return {
        storagePath: data?.storagePath ?? null,
        durationSec: data?.durationSec,
      };
    }
  }
  // Fallback to legacy match.video field
  const matchDoc = await matchRef.get();
  const video = matchDoc.data()?.video;
  return {
    storagePath: video?.storagePath ?? null,
    durationSec: video?.durationSec,
  };
}

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
 * Detect players and create tracks
 */
export async function stepDetectPlayers({
  matchId,
  videoId,
  version,
  logger,
  playerDetector = new PlaceholderPlayerDetector(),
  tracker = new PlaceholderTracker(),
  processingMode,
  onProgress,
}: StepOptions) {
  const stepLog = logger ? createStepLogger(logger, "detect_players") : null;
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  try {
    await updateTrackingStatus(matchId, {
      stage: "detecting_players",
      progress: 0,
    });

    // 1. Get video info (supports videoId or legacy match.video)
    const videoInfo = await getVideoInfo(matchRef, videoId);
    const storagePath = videoInfo.storagePath;
    const durationSec = videoInfo.durationSec ?? 0;

    // Get match settings for processing mode
    const matchSnap = await matchRef.get();
    const matchData = matchSnap.data() as {
      settings?: { processingMode?: ProcessingMode };
    } | undefined;

    if (!storagePath) {
      throw new DetectionError("detection", "video.storagePath missing", {
        matchId,
        step: "detect_players",
      });
    }

    // Get FPS from processing mode
    const mode =
      processingMode ??
      matchData?.settings?.processingMode ??
      "standard";
    const fps = PROCESSING_CONFIGS[mode].fps;

    stepLog?.info("Starting player detection", {
      modelId: playerDetector.modelId,
      trackerId: tracker.trackerId,
      processingMode: mode,
      fps,
      durationSec,
    });

    await updateTrackingStatus(matchId, { progress: 5 });
    onProgress?.(5);

    // 2. Download video
    const localPath = await downloadToTmp(storagePath);
    stepLog?.info("Video downloaded", { localPath });

    await updateTrackingStatus(matchId, { progress: 10 });
    onProgress?.(10);

    // 3. Probe video for dimensions
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

    stepLog?.info("Video probed", {
      width,
      height,
      durationSec: actualDuration,
      fps: probe.fps,
    });

    // 4. Calculate timestamps for frame extraction
    const totalFrames = Math.floor(actualDuration * fps);
    const timestamps: number[] = [];
    for (let i = 0; i < totalFrames; i++) {
      timestamps.push(i / fps);
    }

    stepLog?.info("Frame extraction starting", {
      totalFrames,
      fps,
    });

    // 5. Process frames and run detection
    // Store all frame detections for tracking
    const frameDetections: Array<{
      frameNumber: number;
      timestamp: number;
      detections: Detection[];
    }> = [];

    // Process frames in batches for memory efficiency
    const BATCH_SIZE = 30; // Process 30 frames at a time

    for (let batchStart = 0; batchStart < timestamps.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, timestamps.length);
      const batchTimestamps = timestamps.slice(batchStart, batchEnd);

      // Process batch
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

          // Run player detection
          const detections = await playerDetector.detectPlayers(
            buffer,
            width,
            height
          );

          frameDetections.push({
            frameNumber,
            timestamp,
            detections,
          });
        } catch (err) {
          // Log but continue on frame extraction errors
          stepLog?.info("Frame extraction failed, skipping", {
            frameNumber,
            timestamp,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Update progress (10-80 range for detection phase)
      const progress = 10 + Math.floor(70 * (batchEnd / timestamps.length));
      await updateTrackingStatus(matchId, { progress });
      onProgress?.(progress);

      stepLog?.info("Batch processed", {
        batchStart,
        batchEnd,
        totalFrames: timestamps.length,
        progress,
      });
    }

    stepLog?.info("Detection complete", {
      processedFrames: frameDetections.length,
      totalDetections: frameDetections.reduce(
        (sum, f) => sum + f.detections.length,
        0
      ),
    });

    await updateTrackingStatus(matchId, { progress: 80 });
    onProgress?.(80);

    // 6. Apply tracking algorithm
    tracker.reset();
    const trackFramesMap = new Map<string, TrackFrame[]>();

    for (const frame of frameDetections) {
      const assignments = tracker.update(
        frame.frameNumber,
        frame.timestamp,
        frame.detections
      );

      // Build track frames from assignments
      for (const [detIdx, trackId] of assignments.entries()) {
        const det = frame.detections[detIdx];

        const trackFrame: TrackFrame = {
          trackId,
          frameNumber: frame.frameNumber,
          timestamp: frame.timestamp,
          bbox: det.bbox,
          center: det.center,
          confidence: det.confidence,
        };

        const existing = trackFramesMap.get(trackId) ?? [];
        existing.push(trackFrame);
        trackFramesMap.set(trackId, existing);
      }
    }

    stepLog?.info("Tracking complete", {
      trackCount: trackFramesMap.size,
    });

    await updateTrackingStatus(matchId, { progress: 90 });
    onProgress?.(90);

    // 7. Build TrackDoc for each track
    const tracks: TrackDoc[] = [];
    const now = new Date().toISOString();

    for (const [trackId, frames] of trackFramesMap.entries()) {
      // Sort frames by frame number
      frames.sort((a, b) => a.frameNumber - b.frameNumber);

      const startFrame = frames[0].frameNumber;
      const endFrame = frames[frames.length - 1].frameNumber;
      const avgConfidence =
        frames.reduce((sum, f) => sum + f.confidence, 0) / frames.length;

      const trackDoc: TrackDoc = {
        trackId,
        matchId,
        frames,
        startFrame,
        endFrame,
        startTime: frames[0].timestamp,
        endTime: frames[frames.length - 1].timestamp,
        avgConfidence,
        entityType: "unknown", // Will be classified in step 08
        version,
        createdAt: now,
      };

      tracks.push(trackDoc);
    }

    // 8. Save tracks if any were created
    if (tracks.length > 0) {
      await saveTracks(matchId, tracks);
    }

    await updateTrackingStatus(matchId, {
      stage: "detecting_players",
      progress: 100,
    });
    onProgress?.(100);

    stepLog?.complete("Player detection completed", {
      trackCount: tracks.length,
      totalFrames: frameDetections.length,
      processingMode: mode,
    });

    return {
      matchId,
      version,
      trackCount: tracks.length,
      frameCount: frameDetections.length,
      processingMode: mode,
    };
  } catch (error) {
    const wrapped = wrapError(error, { matchId, step: "detect_players" });
    stepLog?.error("Player detection failed", wrapped);
    throw wrapped;
  }
}

/**
 * Helper to save tracks in batches
 */
async function saveTracks(matchId: string, tracks: TrackDoc[]) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const tracksRef = matchRef.collection("tracks");

  // Firestore batch limit is 500, so chunk if needed
  const BATCH_SIZE = 400;
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = tracks.slice(i, i + BATCH_SIZE);

    for (const track of chunk) {
      batch.set(tracksRef.doc(track.trackId), track);
    }

    await batch.commit();
  }
}
