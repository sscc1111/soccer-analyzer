/**
 * Step 08: Classify teams for tracked players
 *
 * This step:
 * 1. Downloads video and extracts frames for color sampling
 * 2. Extracts uniform colors from player bounding boxes
 * 3. Clusters colors using K-means to identify teams
 * 4. Uses settings.teamColors as hints if available
 * 5. Assigns team labels to tracks
 *
 * Status: INTEGRATED - Color clustering pipeline implemented
 */

import { getDb } from "../../firebase/admin";
import type {
  TrackDoc,
  TrackTeamMeta,
  TeamId,
  TrackingProcessingStatus,
  MatchSettings,
} from "@soccer/shared";
import { createStepLogger, type ILogger } from "../../lib/logger";
import { wrapError, DetectionError } from "../../lib/errors";
import { downloadToTmp } from "../../lib/storage";
import { probeVideo, extractFrameBuffer } from "../../lib/ffmpeg";
import {
  classifyTeamsByColor,
  extractDominantColor,
  DEFAULT_KMEANS_CONFIG,
  type ColorSample,
  type RGB,
} from "../../detection/colorClustering";

type StepOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
  /** Number of frame samples per track for color extraction (default: 1 for performance) */
  samplesPerTrack?: number;
  /** Maximum number of tracks to process for color extraction (default: 100) */
  maxTracksForColor?: number;
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
 * Classify teams based on uniform colors using K-means clustering
 */
export async function stepClassifyTeams({
  matchId,
  version,
  logger,
  samplesPerTrack = 1,  // Reduced from 5 for faster processing (1 frame per track is sufficient)
  maxTracksForColor = Infinity,  // Process all tracks (no limit)
  onProgress,
}: StepOptions) {
  const stepLog = logger ? createStepLogger(logger, "classify_teams") : null;
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  try {
    await updateTrackingStatus(matchId, {
      stage: "classifying_teams",
      progress: 0,
    });

    // 1. Get match settings and video info
    const matchSnap = await matchRef.get();
    const matchData = matchSnap.data() as {
      settings?: MatchSettings;
      video?: { storagePath?: string; durationSec?: number };
    } | undefined;

    const teamColors = matchData?.settings?.teamColors;
    const storagePath = matchData?.video?.storagePath;

    if (!storagePath) {
      throw new DetectionError("classification", "video.storagePath missing", {
        matchId,
        step: "classify_teams",
      });
    }

    // 2. Get existing tracks from Step 07
    const tracksSnap = await matchRef.collection("tracks").get();
    const tracks = tracksSnap.docs.map((doc) => doc.data() as TrackDoc);

    if (tracks.length === 0) {
      stepLog?.info("No tracks to classify", { matchId });
      await updateTrackingStatus(matchId, {
        stage: "classifying_teams",
        progress: 100,
      });
      return { matchId, version, classifiedCount: 0 };
    }

    // Limit tracks for color extraction to avoid timeout
    const tracksForColorExtraction = tracks.slice(0, maxTracksForColor);

    stepLog?.info("Starting team classification", {
      trackCount: tracks.length,
      tracksForColorExtraction: tracksForColorExtraction.length,
      teamColorsHint: teamColors
        ? { home: teamColors.home, away: teamColors.away }
        : undefined,
      samplesPerTrack,
      maxTracksForColor,
    });

    await updateTrackingStatus(matchId, { progress: 5 });
    onProgress?.(5);

    // 3. Download video and probe for dimensions
    const localPath = await downloadToTmp(storagePath);
    const probe = await probeVideo(localPath);
    const { width, height } = probe;

    if (width === 0 || height === 0) {
      throw new DetectionError("classification", "Invalid video dimensions", {
        matchId,
        width,
        height,
      });
    }

    stepLog?.info("Video ready for color extraction", {
      width,
      height,
      totalTracks: tracks.length,
      processingTracks: tracksForColorExtraction.length,
    });

    await updateTrackingStatus(matchId, { progress: 10 });
    onProgress?.(10);

    // 4. Extract color samples from tracks (limited for performance)
    const colorSamples: ColorSample[] = [];
    const trackColors = new Map<string, RGB[]>();
    const PARALLEL_BATCH_SIZE = 5; // Process 5 tracks in parallel

    // Process tracks in parallel batches
    for (let batchStart = 0; batchStart < tracksForColorExtraction.length; batchStart += PARALLEL_BATCH_SIZE) {
      const batch = tracksForColorExtraction.slice(batchStart, batchStart + PARALLEL_BATCH_SIZE);

      stepLog?.info("Processing track batch", {
        batchStart,
        batchSize: batch.length,
        totalTracks: tracksForColorExtraction.length,
      });

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (track) => {
          // Sample only 1 frame (middle of track) for speed
          const sampleCount = Math.min(samplesPerTrack, track.frames.length);
          const middleIdx = Math.floor(track.frames.length / 2);
          const sampleIndices = sampleCount > 0 ? [middleIdx] : [];

          const trackSamples: RGB[] = [];

          for (const idx of sampleIndices) {
            const frame = track.frames[idx];
            if (!frame) continue;

            try {
              const { buffer } = await extractFrameBuffer(
                localPath,
                frame.timestamp,
                width,
                height
              );

              const pixelBbox = {
                x: Math.floor(frame.bbox.x * width),
                y: Math.floor(frame.bbox.y * height),
                w: Math.floor(frame.bbox.w * width),
                h: Math.floor(frame.bbox.h * height),
              };

              const color = extractDominantColor(buffer, width, height, pixelBbox);

              // Skip neutral/gray colors
              if (
                Math.abs(color.r - color.g) > 10 ||
                Math.abs(color.g - color.b) > 10 ||
                Math.abs(color.r - color.b) > 10
              ) {
                trackSamples.push(color);
              }
            } catch (err) {
              // Silently skip frame extraction errors for performance
            }
          }

          return { track, trackSamples };
        })
      );

      // Aggregate batch results
      for (const { track, trackSamples } of batchResults) {
        if (trackSamples.length > 0) {
          const avgColor: RGB = {
            r: Math.round(
              trackSamples.reduce((sum, c) => sum + c.r, 0) / trackSamples.length
            ),
            g: Math.round(
              trackSamples.reduce((sum, c) => sum + c.g, 0) / trackSamples.length
            ),
            b: Math.round(
              trackSamples.reduce((sum, c) => sum + c.b, 0) / trackSamples.length
            ),
          };

          colorSamples.push({
            trackId: track.trackId,
            color: avgColor,
            position: track.frames[0].center,
          });

          trackColors.set(track.trackId, trackSamples);
        }
      }

      // Update progress (10-70 range for color extraction)
      const progress = 10 + Math.floor(60 * ((batchStart + batch.length) / tracksForColorExtraction.length));
      await updateTrackingStatus(matchId, { progress });
      onProgress?.(progress);
    }

    stepLog?.info("Color extraction complete", {
      samplesExtracted: colorSamples.length,
      tracksWithSamples: colorSamples.length,
      tracksWithoutSamples: tracksForColorExtraction.length - colorSamples.length,
      skippedTracks: tracks.length - tracksForColorExtraction.length,
    });

    await updateTrackingStatus(matchId, { progress: 75 });
    onProgress?.(75);

    // 5. Run K-means clustering for team classification
    // Only pass team color hints if both home and away are valid strings
    const validTeamColors =
      teamColors?.home && teamColors?.away
        ? { home: teamColors.home, away: teamColors.away }
        : null;

    const classification = classifyTeamsByColor(
      colorSamples,
      validTeamColors,
      { ...DEFAULT_KMEANS_CONFIG, k: 2 }
    );

    stepLog?.info("Classification complete", {
      confidence: classification.confidence,
      detectedColors: classification.detectedColors,
      clusterSizes: classification.clusters.map((c) => c.members.length),
    });

    await updateTrackingStatus(matchId, { progress: 85 });
    onProgress?.(85);

    // 6. Build TrackTeamMeta for all tracks
    const teamMetas: TrackTeamMeta[] = [];

    for (const track of tracks) {
      const assignment = classification.assignments.get(track.trackId);
      const trackSamples = trackColors.get(track.trackId);

      // Determine dominant color hex if we have samples
      let dominantColor: string | undefined;
      if (trackSamples && trackSamples.length > 0) {
        const avgColor = {
          r: Math.round(
            trackSamples.reduce((sum, c) => sum + c.r, 0) / trackSamples.length
          ),
          g: Math.round(
            trackSamples.reduce((sum, c) => sum + c.g, 0) / trackSamples.length
          ),
          b: Math.round(
            trackSamples.reduce((sum, c) => sum + c.b, 0) / trackSamples.length
          ),
        };
        dominantColor = `#${avgColor.r.toString(16).padStart(2, "0")}${avgColor.g.toString(16).padStart(2, "0")}${avgColor.b.toString(16).padStart(2, "0")}`;
      }

      // Convert referee to unknown for TeamId type
      let teamId: TeamId;
      if (assignment === "home" || assignment === "away") {
        teamId = assignment;
      } else {
        teamId = "unknown";
      }

      teamMetas.push({
        trackId: track.trackId,
        teamId,
        teamConfidence: assignment ? classification.confidence : 0,
        dominantColor,
        classificationMethod: "color_clustering",
      });
    }

    // 7. Save team metadata
    await saveTeamMetas(matchId, teamMetas);

    await updateTrackingStatus(matchId, {
      stage: "classifying_teams",
      progress: 100,
    });
    onProgress?.(100);

    const homeCount = teamMetas.filter((m) => m.teamId === "home").length;
    const awayCount = teamMetas.filter((m) => m.teamId === "away").length;
    const unknownCount = teamMetas.filter((m) => m.teamId === "unknown").length;

    stepLog?.complete("Team classification completed", {
      classifiedCount: teamMetas.length,
      homeCount,
      awayCount,
      unknownCount,
      confidence: classification.confidence,
      detectedColors: classification.detectedColors,
    });

    return {
      matchId,
      version,
      classifiedCount: teamMetas.length,
      homeCount,
      awayCount,
      unknownCount,
      confidence: classification.confidence,
      detectedColors: classification.detectedColors,
    };
  } catch (error) {
    const wrapped = wrapError(error, { matchId, step: "classify_teams" });
    stepLog?.error("Team classification failed", wrapped);
    throw wrapped;
  }
}

/**
 * Save team metadata in batches
 */
async function saveTeamMetas(matchId: string, metas: TrackTeamMeta[]) {
  if (metas.length === 0) return;

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const metaRef = matchRef.collection("trackTeamMetas");

  const BATCH_SIZE = 400;
  for (let i = 0; i < metas.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = metas.slice(i, i + BATCH_SIZE);

    for (const meta of chunk) {
      batch.set(metaRef.doc(meta.trackId), meta);
    }

    await batch.commit();
  }
}
