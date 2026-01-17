/**
 * Video Pipeline for Half-Based Video Processing
 *
 * This pipeline processes individual video documents from the videos subcollection.
 * - Supports firstHalf, secondHalf, and single video types
 * - Runs the same analysis steps as match pipeline
 * - Stores results per-video (in video-specific subcollections)
 * - Updates video document status instead of match document
 *
 * Usage:
 *   await runVideoPipeline({ matchId, videoId, jobId, type: "analyze_video" });
 */

import { PIPELINE_VERSION, type AnalysisStep, type AnalysisProgress, type VideoType, type JobType } from "@soccer/shared";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../firebase/admin";
import { createPipelineLogger } from "../lib/logger";
import { wrapError } from "../lib/errors";
import { stepExtractMeta } from "./steps/01_extractMeta";
import { stepDetectShots } from "./steps/02_detectShots";
import { stepUploadVideoToGemini } from "./steps/03_uploadVideoToGemini";
import { stepExtractClips } from "./steps/03_extractClips";
import { stepExtractImportantScenes } from "./steps/04_extractImportantScenes";
import { stepLabelClipsGemini } from "./steps/04_labelClipsGemini";
import { stepBuildEvents } from "./steps/05_buildEvents";
import { stepComputeStats } from "./steps/06_computeStats";
import { stepDetectEventsGemini } from "./steps/07_detectEventsGemini";
import { stepSegmentVideo, type VideoSegmentDoc, type SegmentVideoResult } from "./steps/07a_segmentVideo";
import { stepDetectEventsWindowed, type DetectEventsWindowedResult } from "./steps/07b_detectEventsWindowed";
import { stepDeduplicateEvents } from "./steps/07c_deduplicateEvents";
import { stepVerifyEvents } from "./steps/07d_verifyEvents";
import { stepSupplementClipsForUncoveredEvents } from "./steps/07e_supplementClipsForUncoveredEvents";
import { stepDetectPlayers } from "./steps/07_detectPlayers";
import { stepIdentifyPlayersGemini } from "./steps/08_identifyPlayersGemini";
import { stepClassifyTeams } from "./steps/08_classifyTeams";
import { stepDetectBall } from "./steps/09_detectBall";
import { stepDetectEvents } from "./steps/10_detectEvents";
import { stepGenerateTacticalInsights } from "./steps/10_generateTacticalInsights";
import { stepGenerateMatchSummary } from "./steps/11_generateMatchSummary";
// New consolidated analysis steps (Call 1 + Call 2 architecture)
import { stepComprehensiveAnalysis } from "./steps/04_comprehensiveAnalysis";
import { stepSummaryAndTactics } from "./steps/05_summaryAndTactics";
// Hybrid 4-call pipeline steps
import { stepSegmentAndEvents } from "./steps/04a_segmentAndEvents";
import { stepScenesAndPlayers } from "./steps/04b_scenesAndPlayers";
import { stepLabelClipsHybrid } from "./steps/04c_labelClipsHybrid";
import { stepSummaryAndTacticsHybrid } from "./steps/04d_summaryAndTacticsHybrid";
import {
  createYoloPlayerDetector,
  createYoloBallDetector,
  PlaceholderPlayerDetector,
  PlaceholderBallDetector,
  PlaceholderTracker,
} from "../detection";

/**
 * Get analyzer tier (1 = Gemini-only, 2 = Gemini + YOLO)
 */
type AnalyzerTier = 1 | 2;

function getAnalyzerTier(): AnalyzerTier {
  const tier = process.env.ANALYZER_TIER;
  if (tier === "2") return 2;
  return 1; // Default to Tier 1 (Gemini-only)
}

/**
 * Check if Gemini-first mode is enabled
 */
function isGeminiFirstEnabled(): boolean {
  return getAnalyzerTier() === 1;
}

/**
 * Check if ML inference service is configured
 */
function isMLServiceEnabled(): boolean {
  return !!process.env.ML_INFERENCE_URL;
}

/**
 * Check if multipass detection is enabled
 */
function isMultipassDetectionEnabled(): boolean {
  return process.env.USE_MULTIPASS_DETECTION === "true";
}

/**
 * Check if consolidated analysis is enabled
 */
function isConsolidatedAnalysisEnabled(): boolean {
  return process.env.USE_CONSOLIDATED_ANALYSIS === "true";
}

/**
 * Check if hybrid 4-call pipeline is enabled
 */
function isHybridPipelineEnabled(): boolean {
  return process.env.USE_HYBRID_PIPELINE === "true";
}

/**
 * Create appropriate detectors based on environment configuration
 */
function createDetectors() {
  if (isMLServiceEnabled()) {
    return {
      playerDetector: createYoloPlayerDetector(),
      ballDetector: createYoloBallDetector(),
      tracker: new PlaceholderTracker(),
    };
  }
  return {
    playerDetector: new PlaceholderPlayerDetector(),
    ballDetector: new PlaceholderBallDetector(),
    tracker: new PlaceholderTracker(),
  };
}

type VideoPipelineOptions = {
  matchId: string;
  videoId: string;
  jobId?: string;
  type?: JobType;
};

/** Step weights for progress calculation */
const STEP_WEIGHTS: Record<AnalysisStep, number> = {
  // Common steps (both tiers)
  extract_meta: 5,
  detect_shots: 5,
  upload_video_to_gemini: 5,
  extract_clips: 5,
  // Gemini-first steps (Tier 1 only - legacy multipass)
  extract_important_scenes: 12,
  label_clips: 10,
  build_events: 8,
  detect_events_gemini: 18,
  identify_players_gemini: 12,
  // Tier 2 (YOLO) steps
  detect_players: 20,
  classify_teams: 12,
  detect_ball: 18,
  detect_events: 15,
  // Consolidated analysis steps (2-call architecture)
  comprehensive_analysis: 55,
  summary_and_tactics: 20,
  // Hybrid 4-call pipeline steps
  segment_and_events: 25,
  scenes_and_players: 20,
  label_clips_hybrid: 15,
  // Final steps (both tiers)
  compute_stats: 5,
  generate_tactical_insights: 8,
  generate_match_summary: 7,
  done: 0,
};

/**
 * Run video analysis pipeline for a specific video document
 *
 * This processes videos from matches/{matchId}/videos/{videoId}
 * and stores results in video-specific subcollections.
 */
export async function runVideoPipeline({ matchId, videoId, jobId, type }: VideoPipelineOptions) {
  const db = getDb();
  const jobRef = jobId ? db.collection("jobs").doc(jobId) : null;
  const matchRef = db.collection("matches").doc(matchId);
  const videoRef = matchRef.collection("videos").doc(videoId);
  const now = () => new Date().toISOString();

  const jobType: JobType =
    type === "recompute_stats" || type === "relabel_and_stats" || type === "analyze_video"
      ? type
      : "analyze_video";

  // Get video document
  const videoSnap = await videoRef.get();
  if (!videoSnap.exists) throw new Error(`video not found: ${matchId}/videos/${videoId}`);

  const videoDoc = videoSnap.data() as {
    videoId: string;
    matchId: string;
    type: VideoType;
    storagePath: string;
    durationSec?: number;
    analysis?: { activeVersion?: string };
  };

  const videoType = videoDoc.type;
  const storagePath = videoDoc.storagePath;

  if (!storagePath) throw new Error(`video.storagePath missing for ${videoId}`);

  const activeVersion = videoDoc.analysis?.activeVersion ?? PIPELINE_VERSION;
  const runVersion =
    jobType === "recompute_stats" || jobType === "relabel_and_stats" ? activeVersion : PIPELINE_VERSION;

  // Create pipeline logger with context
  const logger = createPipelineLogger({ matchId, jobId, version: runVersion });

  const updateJob = async (data: Record<string, unknown>) => {
    if (!jobRef) return;
    await jobRef.set({ ...data, updatedAt: now() }, { merge: true });
  };

  const updateVideoAnalysis = async (data: Record<string, unknown>) => {
    await videoRef.set({ analysis: { ...data, lastRunAt: now() } }, { merge: true });
  };

  // Track progress state
  let pipelineStartTime = Date.now();
  let currentStepStartTime = Date.now();
  const completedSteps: AnalysisStep[] = [];

  /**
   * Calculate cumulative progress based on completed steps
   */
  const calculateOverallProgress = (currentStep: AnalysisStep, stepProgress: number): number => {
    const completedWeight = completedSteps.reduce((sum, s) => sum + STEP_WEIGHTS[s], 0);
    const currentWeight = STEP_WEIGHTS[currentStep] * (stepProgress / 100);
    return Math.min(100, completedWeight + currentWeight);
  };

  /**
   * Estimate remaining time based on elapsed time and progress
   */
  const estimateRemainingSeconds = (overallProgress: number): number => {
    if (overallProgress <= 0) return -1;
    const elapsedMs = Date.now() - pipelineStartTime;
    const estimatedTotalMs = (elapsedMs / overallProgress) * 100;
    const remainingMs = estimatedTotalMs - elapsedMs;
    return Math.max(0, Math.round(remainingMs / 1000));
  };

  /**
   * Update detailed progress in video analysis
   */
  const updateProgress = async (
    step: AnalysisStep,
    stepProgress: number,
    stepDetails?: Record<string, unknown>
  ) => {
    const overallProgress = calculateOverallProgress(step, stepProgress);
    const progress: AnalysisProgress = {
      currentStep: step,
      overallProgress: Math.round(overallProgress),
      stepProgress: Math.round(stepProgress),
      estimatedSecondsRemaining: estimateRemainingSeconds(overallProgress),
      stepStartedAt: new Date(currentStepStartTime).toISOString(),
      ...(stepDetails ? { stepDetails } : {}),
    };
    await updateVideoAnalysis({ status: "running", progress });
  };

  /**
   * Mark step as starting
   */
  const startStep = async (step: AnalysisStep) => {
    currentStepStartTime = Date.now();
    await updateProgress(step, 0);
    await updateJob({ step, progress: calculateOverallProgress(step, 0) / 100 });
  };

  /**
   * Mark step as complete
   */
  const completeStep = (step: AnalysisStep) => {
    completedSteps.push(step);
  };

  const runWithRetry = async (step: string, fn: () => Promise<unknown>, retries = 2) => {
    const stepLogger = logger.child({ step });
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= retries) throw err;
        const errorMessage = err instanceof Error ? err.message : String(err);
        stepLogger.warn("retrying step after error", { attempt: attempt + 1, error: errorMessage });
        await updateVideoAnalysis({
          status: "running",
          progress: {
            stepDetails: { retrying: true, attempt: attempt + 1, maxRetries: retries, step },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  };

  try {
    pipelineStartTime = Date.now();
    await updateJob({ status: "running", step: "start", progress: 0 });
    // Clear any previous error status when starting a new analysis
    await updateVideoAnalysis(
      jobType === "analyze_video"
        ? { status: "running", errorMessage: FieldValue.delete() }
        : { status: "running", activeVersion: runVersion, errorMessage: FieldValue.delete() }
    );
    logger.info(`video pipeline start (${jobType})`, { version: runVersion, videoType, videoId });

    // Create detectors based on environment configuration
    const detectors = createDetectors();
    logger.info("detectors initialized", {
      mlServiceEnabled: isMLServiceEnabled(),
      playerDetector: detectors.playerDetector.modelId,
      ballDetector: detectors.ballDetector.modelId,
    });

    // Determine pipeline tier
    const analyzerTier = getAnalyzerTier();
    const isGeminiFirst = isGeminiFirstEnabled();
    logger.info("analyzer tier configured", { tier: analyzerTier, isGeminiFirst });

    if (jobType === "analyze_video") {
      // ===== Common Steps (both Tier 1 and Tier 2) =====
      // TODO: Adapt steps to work with video subcollection
      // Step functions need to be updated to accept videoId and storagePath parameters
      // For now, this is a template implementation

      await startStep("extract_meta");
      await runWithRetry("extract_meta", () =>
        stepExtractMeta({ matchId, videoId, version: runVersion } as any)
      );
      completeStep("extract_meta");

      await startStep("detect_shots");
      await runWithRetry("detect_shots", () => stepDetectShots({ matchId, videoId, version: runVersion } as any));
      completeStep("detect_shots");

      // ===== Tier 1: Gemini-first Pipeline =====
      if (isGeminiFirst) {
        // Check pipeline mode
        const useHybridPipeline = isHybridPipelineEnabled();
        const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();
        logger.info("Tier 1 pipeline mode", { matchId, videoId, useHybridPipeline, useConsolidatedAnalysis });

        // Upload video to Gemini with Context Caching
        await startStep("upload_video_to_gemini");
        await runWithRetry("upload_video_to_gemini", () =>
          stepUploadVideoToGemini({ matchId, videoId, version: runVersion } as any)
        );
        completeStep("upload_video_to_gemini");

        // Extract clips for app display (FFmpeg)
        await startStep("extract_clips");
        await runWithRetry("extract_clips", () => stepExtractClips({ matchId, videoId, version: runVersion } as any));
        completeStep("extract_clips");

        if (useHybridPipeline) {
          // ===== Hybrid 4-Call Pipeline =====
          await startStep("segment_and_events");
          await runWithRetry("segment_and_events", () =>
            stepSegmentAndEvents({ matchId, videoId, version: runVersion, logger } as any)
          );
          completeStep("segment_and_events");

          await startStep("scenes_and_players");
          await runWithRetry("scenes_and_players", () =>
            stepScenesAndPlayers({ matchId, videoId, version: runVersion, logger } as any)
          );
          completeStep("scenes_and_players");

          await startStep("label_clips_hybrid");
          await runWithRetry("label_clips_hybrid", () =>
            stepLabelClipsHybrid({ matchId, videoId, version: runVersion, logger } as any)
          );
          completeStep("label_clips_hybrid");

          await startStep("summary_and_tactics");
          await runWithRetry("summary_and_tactics", () =>
            stepSummaryAndTacticsHybrid({ matchId, videoId, version: runVersion, logger } as any)
          );
          completeStep("summary_and_tactics");

          logger.info("Tier 1 (Hybrid 4-call) pipeline completed", { matchId, videoId });
        } else if (useConsolidatedAnalysis) {
          // ===== Consolidated Analysis (2-call architecture) =====
          await startStep("comprehensive_analysis");
          await runWithRetry("comprehensive_analysis", () =>
            stepComprehensiveAnalysis({ matchId, videoId, version: runVersion, logger } as any)
          );
          completeStep("comprehensive_analysis");

          await startStep("summary_and_tactics");
          await runWithRetry("summary_and_tactics", () =>
            stepSummaryAndTactics({ matchId, videoId, version: runVersion, logger } as any)
          );
          completeStep("summary_and_tactics");

          logger.info("Tier 1 (Consolidated 2-call) pipeline completed", { matchId, videoId });
        } else {
          // ===== Legacy Multipass Pipeline =====
          await startStep("extract_important_scenes");
          await runWithRetry("extract_important_scenes", () =>
            stepExtractImportantScenes({ matchId, videoId, version: runVersion } as any)
          );
          completeStep("extract_important_scenes");

          await startStep("label_clips");
          await runWithRetry("label_clips", () =>
            stepLabelClipsGemini({ matchId, videoId, version: runVersion } as any)
          );
          completeStep("label_clips");

          await startStep("build_events");
          await runWithRetry("build_events", () => stepBuildEvents({ matchId, videoId, version: runVersion } as any));
          completeStep("build_events");

          await startStep("detect_events_gemini");
          if (isMultipassDetectionEnabled()) {
            // Multipass detection
            logger.info("Using multipass event detection", { matchId, videoId });

            const segmentResult = (await runWithRetry("segment_video", () =>
              stepSegmentVideo({ matchId, videoId, version: runVersion, logger })
            )) as SegmentVideoResult;

            const windowedResult = (await runWithRetry("detect_events_windowed", () =>
              stepDetectEventsWindowed({
                matchId,
                videoId,
                version: runVersion,
                segments: (segmentResult?.segments as VideoSegmentDoc[]) ?? [],
                logger,
              } as any)
            )) as DetectEventsWindowedResult;

            await runWithRetry("deduplicate_events", () =>
              stepDeduplicateEvents({
                matchId,
                videoId,
                version: runVersion,
                rawEvents: windowedResult?.rawEvents ?? [],
                logger,
              } as any)
            );

            await runWithRetry("verify_events", () =>
              stepVerifyEvents({
                matchId,
                videoId,
                version: runVersion,
                logger,
              } as any)
            );

            await runWithRetry("supplement_clips", () =>
              stepSupplementClipsForUncoveredEvents({
                matchId,
                videoId,
                version: runVersion,
                logger,
              } as any)
            );

            logger.info("Multipass event detection complete", { matchId, videoId });
          } else {
            // Single-pass detection
            await runWithRetry("detect_events_gemini", () =>
              stepDetectEventsGemini({ matchId, videoId, version: runVersion })
            );
          }
          completeStep("detect_events_gemini");

          await startStep("identify_players_gemini");
          await runWithRetry("identify_players_gemini", () =>
            stepIdentifyPlayersGemini({ matchId, videoId, version: runVersion } as any)
          );
          completeStep("identify_players_gemini");

          await startStep("generate_tactical_insights");
          await runWithRetry("generate_tactical_insights", () =>
            stepGenerateTacticalInsights({ matchId, videoId, version: runVersion } as any)
          );
          completeStep("generate_tactical_insights");

          await startStep("generate_match_summary");
          await runWithRetry("generate_match_summary", () =>
            stepGenerateMatchSummary({ matchId, videoId, version: runVersion } as any)
          );
          completeStep("generate_match_summary");

          logger.info("Tier 1 (Gemini-first multipass) pipeline completed", { matchId, videoId });
        }
      } else {
        // ===== Tier 2: Gemini + YOLO Pipeline =====
        await startStep("extract_clips");
        await runWithRetry("extract_clips", () => stepExtractClips({ matchId, videoId, version: runVersion } as any));
        completeStep("extract_clips");

        await startStep("label_clips");
        await runWithRetry("label_clips", () =>
          stepLabelClipsGemini({ matchId, videoId, version: runVersion } as any)
        );
        completeStep("label_clips");

        await startStep("build_events");
        await runWithRetry("build_events", () => stepBuildEvents({ matchId, videoId, version: runVersion } as any));
        completeStep("build_events");

        await startStep("detect_players");
        await runWithRetry("detect_players", () =>
          stepDetectPlayers({
            matchId,
            videoId,
            version: runVersion,
            logger,
            playerDetector: detectors.playerDetector,
            tracker: detectors.tracker,
          } as any)
        );
        completeStep("detect_players");

        await startStep("classify_teams");
        await runWithRetry("classify_teams", () =>
          stepClassifyTeams({ matchId, videoId, version: runVersion, logger } as any)
        );
        completeStep("classify_teams");

        await startStep("detect_ball");
        await runWithRetry("detect_ball", () =>
          stepDetectBall({
            matchId,
            videoId,
            version: runVersion,
            logger,
            ballDetector: detectors.ballDetector,
          } as any)
        );
        completeStep("detect_ball");

        await startStep("detect_events");
        await runWithRetry("detect_events", () =>
          stepDetectEvents({ matchId, videoId, version: runVersion, logger } as any)
        );
        completeStep("detect_events");

        logger.info("Tier 2 (Gemini + YOLO) pipeline completed", { matchId, videoId });
      }
    } else if (jobType === "relabel_and_stats") {
      // Check which analysis mode data exists
      const [comprehensiveDoc, segmentsSnap] = await Promise.all([
        matchRef.collection("comprehensiveAnalysis").doc(`${videoId}_current`).get(),
        matchRef
          .collection("segments")
          .where("version", "==", runVersion)
          .limit(1)
          .get(),
      ]);
      const hasComprehensiveData =
        comprehensiveDoc.exists && comprehensiveDoc.data()?.version === runVersion;
      const hasHybridData = !segmentsSnap.empty;
      const useHybridPipeline = isHybridPipelineEnabled();
      const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();

      if (hasHybridData || useHybridPipeline) {
        logger.info("Using hybrid pipeline path for relabel_and_stats", {
          matchId,
          videoId,
          hasHybridData,
          version: runVersion,
        });
        await startStep("summary_and_tactics");
        await runWithRetry("summary_and_tactics", () =>
          stepSummaryAndTacticsHybrid({ matchId, videoId, version: runVersion, logger } as any)
        );
        completeStep("summary_and_tactics");
      } else if (hasComprehensiveData || useConsolidatedAnalysis) {
        logger.info("Using consolidated analysis path for relabel_and_stats", {
          matchId,
          videoId,
          hasComprehensiveData,
          version: runVersion,
        });
        await startStep("summary_and_tactics");
        await runWithRetry("summary_and_tactics", () =>
          stepSummaryAndTactics({ matchId, videoId, version: runVersion, logger } as any)
        );
        completeStep("summary_and_tactics");
      } else {
        // Legacy path
        await startStep("label_clips");
        await runWithRetry("label_clips", () =>
          stepLabelClipsGemini({ matchId, videoId, version: runVersion } as any)
        );
        completeStep("label_clips");

        await startStep("build_events");
        await runWithRetry("build_events", () => stepBuildEvents({ matchId, videoId, version: runVersion } as any));
        completeStep("build_events");
      }
    }

    // Skip compute_stats in consolidated/hybrid analysis mode
    const useHybridPipeline = isHybridPipelineEnabled();
    const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();
    if (!useConsolidatedAnalysis && !useHybridPipeline) {
      await startStep("compute_stats");
      await runWithRetry("compute_stats", () => stepComputeStats({ matchId, videoId, version: runVersion } as any));
      completeStep("compute_stats");
    } else {
      logger.info("Skipping compute_stats (consolidated/hybrid analysis mode)", { matchId, videoId });
    }

    await updateJob({ status: "done", step: "done", progress: 1 });
    await updateVideoAnalysis({ status: "done", activeVersion: runVersion, progress: FieldValue.delete() });
    logger.info("video pipeline complete", { version: runVersion, videoId, videoType });

    return { matchId, videoId, version: runVersion };
  } catch (error: unknown) {
    const wrapped = wrapError(error, { matchId, videoId, jobId, step: "video_pipeline_error" });
    const message = wrapped.message;
    await updateJob({ status: "error", error: message });
    await updateVideoAnalysis({ status: "error", errorMessage: message, progress: FieldValue.delete() });
    logger.error("video pipeline failed", wrapped);
    throw wrapped;
  }
}
