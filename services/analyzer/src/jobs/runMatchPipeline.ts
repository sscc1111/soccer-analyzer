import { PIPELINE_VERSION, type AnalysisStep, type AnalysisProgress } from "@soccer/shared";
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
import { stepDetectEventsWindowed, type RawEvent, type DetectEventsWindowedResult } from "./steps/07b_detectEventsWindowed";
import { stepDeduplicateEvents } from "./steps/07c_deduplicateEvents";
import { stepVerifyEvents } from "./steps/07d_verifyEvents";
import { stepSupplementClipsForUncoveredEvents } from "./steps/07e_supplementClipsForUncoveredEvents";
import { stepDetectAssists } from "./steps/07e_detectAssists";
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
 *
 * Tier 1: Gemini-first architecture - all analysis via Gemini API
 * Tier 2: Gemini + YOLO/ByteTrack for detailed tracking
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
 * When enabled, uses 07a_segmentVideo -> 07b_detectEventsWindowed -> 07c_deduplicateEvents
 * Instead of single-pass 07_detectEventsGemini
 */
function isMultipassDetectionEnabled(): boolean {
  return process.env.USE_MULTIPASS_DETECTION === "true";
}

/**
 * Check if consolidated analysis is enabled
 * When enabled, uses 2-call architecture:
 * - Call 1: Comprehensive analysis (segments, events, scenes, players, clipLabels)
 * - Call 2: Summary and tactics (uses Call 1 results, no video)
 * This reduces API calls from 20+ to 2, achieving 90%+ cost reduction
 */
function isConsolidatedAnalysisEnabled(): boolean {
  return process.env.USE_CONSOLIDATED_ANALYSIS === "true";
}

/**
 * Check if hybrid 4-call pipeline is enabled
 * When enabled, uses 4-call architecture:
 * - Call 1: Segments + Events detection (video)
 * - Call 2: Scenes + Players identification (video, uses Call 1 context)
 * - Call 3: Clip labeling (video, batch)
 * - Call 4: Summary + Tactics (text-only)
 * This balances quality and cost: 4-5 API calls vs 20+ (legacy) or 2 (consolidated)
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
      tracker: new PlaceholderTracker(), // TODO: Replace with ByteTrack from ML service
    };
  }
  return {
    playerDetector: new PlaceholderPlayerDetector(),
    ballDetector: new PlaceholderBallDetector(),
    tracker: new PlaceholderTracker(),
  };
}

type JobType = "analyze_match" | "recompute_stats" | "relabel_and_stats";

type PipelineOptions = {
  matchId: string;
  jobId?: string;
  type?: JobType;
};

/** Step weights for progress calculation (Tier 1 sums to ~100, Tier 2 sums to ~100) */
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
  comprehensive_analysis: 55, // Call 1: segments, events, scenes, players, clipLabels
  summary_and_tactics: 20, // Call 2: tactical + summary (text-only, no video)
  // Hybrid 4-call pipeline steps
  segment_and_events: 25, // Hybrid Call 1: segments + events detection
  scenes_and_players: 20, // Hybrid Call 2: scenes + player identification
  label_clips_hybrid: 15, // Hybrid Call 3: clip labeling (batch)
  // Final steps (both tiers)
  compute_stats: 5,
  generate_tactical_insights: 8,
  generate_match_summary: 7,
  done: 0,
};

export async function runMatchPipeline({ matchId, jobId, type }: PipelineOptions) {
  const db = getDb();
  const jobRef = jobId ? db.collection("jobs").doc(jobId) : null;
  const matchRef = db.collection("matches").doc(matchId);
  const now = () => new Date().toISOString();

  const jobType: JobType =
    type === "recompute_stats" || type === "relabel_and_stats" || type === "analyze_match"
      ? type
      : "analyze_match";
  const matchSnap = await matchRef.get();
  const match = matchSnap.data() as { analysis?: { activeVersion?: string } } | undefined;
  const activeVersion = match?.analysis?.activeVersion ?? PIPELINE_VERSION;
  const runVersion =
    jobType === "recompute_stats" || jobType === "relabel_and_stats" ? activeVersion : PIPELINE_VERSION;

  // Create pipeline logger with context
  const logger = createPipelineLogger({ matchId, jobId, version: runVersion });

  const updateJob = async (data: Record<string, unknown>) => {
    if (!jobRef) return;
    await jobRef.set({ ...data, updatedAt: now() }, { merge: true });
  };

  const updateMatchAnalysis = async (data: Record<string, unknown>) => {
    await matchRef.set({ analysis: { ...data, lastRunAt: now() } }, { merge: true });
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
   * Update detailed progress in match analysis
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
    await updateMatchAnalysis({ status: "running", progress });
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
        // Update progress to show retry status (don't change status to error)
        await updateMatchAnalysis({
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
    await updateMatchAnalysis(
      jobType === "analyze_match"
        ? { status: "running", errorMessage: FieldValue.delete() }
        : { status: "running", activeVersion: runVersion, errorMessage: FieldValue.delete() }
    );
    logger.info(`pipeline start (${jobType})`, { version: runVersion });

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

    if (jobType === "analyze_match") {
      // ===== Common Steps (both Tier 1 and Tier 2) =====
      await startStep("extract_meta");
      await runWithRetry("extract_meta", () => stepExtractMeta({ matchId, version: runVersion }));
      completeStep("extract_meta");

      await startStep("detect_shots");
      await runWithRetry("detect_shots", () => stepDetectShots({ matchId, version: runVersion }));
      completeStep("detect_shots");

      // ===== Tier 1: Gemini-first Pipeline =====
      if (isGeminiFirst) {
        // Check pipeline mode
        const useHybridPipeline = isHybridPipelineEnabled();
        const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();
        logger.info("Tier 1 pipeline mode", { matchId, useHybridPipeline, useConsolidatedAnalysis });

        // Upload video to Gemini with Context Caching
        await startStep("upload_video_to_gemini");
        await runWithRetry("upload_video_to_gemini", () =>
          stepUploadVideoToGemini({ matchId, version: runVersion })
        );
        completeStep("upload_video_to_gemini");

        // Extract clips for app display (FFmpeg)
        await startStep("extract_clips");
        await runWithRetry("extract_clips", () => stepExtractClips({ matchId, version: runVersion }));
        completeStep("extract_clips");

        if (useHybridPipeline) {
          // ===== Hybrid 4-Call Pipeline =====
          // Call 1: Segments + Events detection (video)
          await startStep("segment_and_events");
          await runWithRetry("segment_and_events", () =>
            stepSegmentAndEvents({ matchId, version: runVersion, logger })
          );
          completeStep("segment_and_events");

          // Call 2: Scenes + Players identification (video, uses Call 1 context)
          await startStep("scenes_and_players");
          await runWithRetry("scenes_and_players", () =>
            stepScenesAndPlayers({ matchId, version: runVersion, logger })
          );
          completeStep("scenes_and_players");

          // Call 3: Clip labeling (video, batch)
          await startStep("label_clips_hybrid");
          await runWithRetry("label_clips_hybrid", () =>
            stepLabelClipsHybrid({ matchId, version: runVersion, logger })
          );
          completeStep("label_clips_hybrid");

          // Call 4: Summary + Tactics (text-only, no video)
          await startStep("summary_and_tactics");
          await runWithRetry("summary_and_tactics", () =>
            stepSummaryAndTacticsHybrid({ matchId, version: runVersion, logger })
          );
          completeStep("summary_and_tactics");

          logger.info("Tier 1 (Hybrid 4-call) pipeline completed", { matchId });
        } else if (useConsolidatedAnalysis) {
          // ===== Consolidated Analysis (2-call architecture) =====
          // Call 1: Comprehensive analysis (segments, events, scenes, players, clipLabels)
          await startStep("comprehensive_analysis");
          await runWithRetry("comprehensive_analysis", () =>
            stepComprehensiveAnalysis({ matchId, version: runVersion, logger })
          );
          completeStep("comprehensive_analysis");

          // Call 2: Summary and tactics (uses Call 1 results, no video)
          await startStep("summary_and_tactics");
          await runWithRetry("summary_and_tactics", () =>
            stepSummaryAndTactics({ matchId, version: runVersion, logger })
          );
          completeStep("summary_and_tactics");

          logger.info("Tier 1 (Consolidated 2-call) pipeline completed", { matchId });
        } else {
          // ===== Legacy Multipass Pipeline =====
          // Phase B: Extract important scenes with Gemini
          await startStep("extract_important_scenes");
          await runWithRetry("extract_important_scenes", () =>
            stepExtractImportantScenes({ matchId, version: runVersion })
          );
          completeStep("extract_important_scenes");

          // Label clips with Gemini (existing - will use cached context)
          await startStep("label_clips");
          await runWithRetry("label_clips", () => stepLabelClipsGemini({ matchId, version: runVersion }));
          completeStep("label_clips");

          await startStep("build_events");
          await runWithRetry("build_events", () => stepBuildEvents({ matchId, version: runVersion }));
          completeStep("build_events");

          // Phase C: Detect events with Gemini
          await startStep("detect_events_gemini");
          if (isMultipassDetectionEnabled()) {
            // Multipass detection: segment -> windowed detection -> deduplication
            logger.info("Using multipass event detection", { matchId });

            // Step 1: Segment video into active/stoppage/set_piece periods
            const segmentResult = (await runWithRetry("segment_video", () =>
              stepSegmentVideo({ matchId, version: runVersion, logger })
            )) as SegmentVideoResult;

            // Step 2: Detect events in overlapping windows
            const windowedResult = (await runWithRetry("detect_events_windowed", () =>
              stepDetectEventsWindowed({
                matchId,
                version: runVersion,
                segments: segmentResult?.segments as VideoSegmentDoc[] ?? [],
                logger,
              })
            )) as DetectEventsWindowedResult;

            // Step 3: Deduplicate and save events
            await runWithRetry("deduplicate_events", () =>
              stepDeduplicateEvents({
                matchId,
                version: runVersion,
                rawEvents: windowedResult?.rawEvents ?? [],
                logger,
              })
            );

            // Step 4: Verify low-confidence events (Phase 4)
            await runWithRetry("verify_events", () =>
              stepVerifyEvents({
                matchId,
                version: runVersion,
                logger,
              })
            );

            // Step 5: Detect assists from goals and passes (Phase 6)
            await runWithRetry("detect_assists", () =>
              stepDetectAssists({
                matchId,
                version: runVersion,
                logger,
              })
            );

            // Step 6: Supplement clips for uncovered events (Phase 2.2a)
            await runWithRetry("supplement_clips", () =>
              stepSupplementClipsForUncoveredEvents({
                matchId,
                version: runVersion,
                logger,
              })
            );

            logger.info("Multipass event detection complete", { matchId });
          } else {
            // Single-pass detection (default)
            await runWithRetry("detect_events_gemini", () =>
              stepDetectEventsGemini({ matchId, version: runVersion })
            );
          }
          completeStep("detect_events_gemini");

          // Phase D: Identify players with Gemini
          await startStep("identify_players_gemini");
          await runWithRetry("identify_players_gemini", () =>
            stepIdentifyPlayersGemini({ matchId, version: runVersion })
          );
          completeStep("identify_players_gemini");

          // Phase E: Generate tactical insights
          await startStep("generate_tactical_insights");
          await runWithRetry("generate_tactical_insights", () =>
            stepGenerateTacticalInsights({ matchId, version: runVersion })
          );
          completeStep("generate_tactical_insights");

          // Phase E: Generate match summary
          await startStep("generate_match_summary");
          await runWithRetry("generate_match_summary", () =>
            stepGenerateMatchSummary({ matchId, version: runVersion })
          );
          completeStep("generate_match_summary");

          logger.info("Tier 1 (Gemini-first multipass) pipeline completed", { matchId });
        }
      } else {
        // ===== Tier 2: Gemini + YOLO Pipeline =====
        await startStep("extract_clips");
        await runWithRetry("extract_clips", () => stepExtractClips({ matchId, version: runVersion }));
        completeStep("extract_clips");

        await startStep("label_clips");
        await runWithRetry("label_clips", () => stepLabelClipsGemini({ matchId, version: runVersion }));
        completeStep("label_clips");

        await startStep("build_events");
        await runWithRetry("build_events", () => stepBuildEvents({ matchId, version: runVersion }));
        completeStep("build_events");

        // Phase 1: Detection & Tracking (YOLO/ByteTrack)
        await startStep("detect_players");
        await runWithRetry("detect_players", () =>
          stepDetectPlayers({
            matchId,
            version: runVersion,
            logger,
            playerDetector: detectors.playerDetector,
            tracker: detectors.tracker,
          })
        );
        completeStep("detect_players");

        await startStep("classify_teams");
        await runWithRetry("classify_teams", () =>
          stepClassifyTeams({ matchId, version: runVersion, logger })
        );
        completeStep("classify_teams");

        await startStep("detect_ball");
        await runWithRetry("detect_ball", () =>
          stepDetectBall({
            matchId,
            version: runVersion,
            logger,
            ballDetector: detectors.ballDetector,
          })
        );
        completeStep("detect_ball");

        // Phase 2: Event Detection (Rule-based)
        await startStep("detect_events");
        await runWithRetry("detect_events", () =>
          stepDetectEvents({ matchId, version: runVersion, logger })
        );
        completeStep("detect_events");

        logger.info("Tier 2 (Gemini + YOLO) pipeline completed", { matchId });
      }
    } else if (jobType === "relabel_and_stats") {
      // Check which analysis mode data exists
      const [comprehensiveDoc, segmentsSnap] = await Promise.all([
        matchRef.collection("comprehensiveAnalysis").doc("current").get(),
        matchRef.collection("segments").where("version", "==", runVersion).limit(1).get(),
      ]);
      const hasComprehensiveData =
        comprehensiveDoc.exists && comprehensiveDoc.data()?.version === runVersion;
      const hasHybridData = !segmentsSnap.empty;
      const useHybridPipeline = isHybridPipelineEnabled();
      const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();

      if (hasHybridData || useHybridPipeline) {
        // Use hybrid pipeline path - re-run summary_and_tactics_hybrid
        logger.info("Using hybrid pipeline path for relabel_and_stats", {
          matchId,
          hasHybridData,
          version: runVersion,
        });
        await startStep("summary_and_tactics");
        await runWithRetry("summary_and_tactics", () =>
          stepSummaryAndTacticsHybrid({ matchId, version: runVersion, logger })
        );
        completeStep("summary_and_tactics");
      } else if (hasComprehensiveData || useConsolidatedAnalysis) {
        // Use consolidated analysis path - re-run summary_and_tactics
        logger.info("Using consolidated analysis path for relabel_and_stats", {
          matchId,
          hasComprehensiveData,
          version: runVersion,
        });
        await startStep("summary_and_tactics");
        await runWithRetry("summary_and_tactics", () =>
          stepSummaryAndTactics({ matchId, version: runVersion, logger })
        );
        completeStep("summary_and_tactics");
      } else {
        // Legacy path
        await startStep("label_clips");
        await runWithRetry("label_clips", () => stepLabelClipsGemini({ matchId, version: runVersion }));
        completeStep("label_clips");

        await startStep("build_events");
        await runWithRetry("build_events", () => stepBuildEvents({ matchId, version: runVersion }));
        completeStep("build_events");
      }
    }

    // Skip compute_stats in consolidated/hybrid analysis mode
    // Both modes calculate event stats directly and pass to summary step
    const useHybridPipeline = isHybridPipelineEnabled();
    const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();
    if (!useConsolidatedAnalysis && !useHybridPipeline) {
      await startStep("compute_stats");
      await runWithRetry("compute_stats", () => stepComputeStats({ matchId, version: runVersion }));
      completeStep("compute_stats");
    } else {
      logger.info("Skipping compute_stats (consolidated/hybrid analysis mode)", { matchId });
    }

    await updateJob({ status: "done", step: "done", progress: 1 });
    await updateMatchAnalysis({ status: "done", activeVersion: runVersion, progress: FieldValue.delete() });
    logger.info("pipeline complete", { version: runVersion });
    return { matchId, version: runVersion };
  } catch (error: unknown) {
    const wrapped = wrapError(error, { matchId, jobId, step: "pipeline_error" });
    const message = wrapped.message;
    await updateJob({ status: "error", error: message });
    await updateMatchAnalysis({ status: "error", errorMessage: message, progress: FieldValue.delete() });
    logger.error("pipeline failed", wrapped);
    throw wrapped;
  }
}
