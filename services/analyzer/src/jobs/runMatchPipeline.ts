import { PIPELINE_VERSION } from "@soccer/shared";
import { getDb } from "../firebase/admin";
import { stepExtractMeta } from "./steps/01_extractMeta";
import { stepDetectShots } from "./steps/02_detectShots";
import { stepExtractClips } from "./steps/03_extractClips";
import { stepLabelClipsGemini } from "./steps/04_labelClipsGemini";
import { stepBuildEvents } from "./steps/05_buildEvents";
import { stepComputeStats } from "./steps/06_computeStats";

type JobType = "analyze_match" | "recompute_stats" | "relabel_and_stats";

type PipelineOptions = {
  matchId: string;
  jobId?: string;
  type?: JobType;
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

  const updateJob = async (data: Record<string, unknown>) => {
    if (!jobRef) return;
    await jobRef.set({ ...data, updatedAt: now() }, { merge: true });
  };

  const updateMatchAnalysis = async (data: Record<string, unknown>) => {
    await matchRef.set({ analysis: { ...data, lastRunAt: now() } }, { merge: true });
  };

  const log = (step: string, message: string, extra?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        level: "info",
        matchId,
        jobId,
        step,
        message,
        ...extra,
      })
    );
  };

  const runWithRetry = async (step: string, fn: () => Promise<unknown>, retries = 1) => {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= retries) throw err;
        log(step, "retrying step after error", { attempt: attempt + 1 });
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  };

  try {
    await updateJob({ status: "running", step: "start", progress: 0 });
    await updateMatchAnalysis(
      jobType === "analyze_match" ? { status: "running" } : { status: "running", activeVersion: runVersion }
    );
    log("start", `pipeline start (${jobType})`, { version: runVersion });

    if (jobType === "analyze_match") {
      await updateJob({ step: "extract_meta", progress: 0.1 });
      await runWithRetry("extract_meta", () => stepExtractMeta({ matchId, version: runVersion }));

      await updateJob({ step: "detect_shots", progress: 0.25 });
      await runWithRetry("detect_shots", () => stepDetectShots({ matchId, version: runVersion }));

      await updateJob({ step: "extract_clips", progress: 0.4 });
      await runWithRetry("extract_clips", () => stepExtractClips({ matchId, version: runVersion }));

      await updateJob({ step: "label_clips", progress: 0.6 });
      await runWithRetry("label_clips", () => stepLabelClipsGemini({ matchId, version: runVersion }));

      await updateJob({ step: "build_events", progress: 0.8 });
      await runWithRetry("build_events", () => stepBuildEvents({ matchId, version: runVersion }));
    } else if (jobType === "relabel_and_stats") {
      await updateJob({ step: "label_clips", progress: 0.6 });
      await runWithRetry("label_clips", () => stepLabelClipsGemini({ matchId, version: runVersion }));

      await updateJob({ step: "build_events", progress: 0.8 });
      await runWithRetry("build_events", () => stepBuildEvents({ matchId, version: runVersion }));
    }

    await updateJob({ step: "compute_stats", progress: 0.95 });
    await runWithRetry("compute_stats", () => stepComputeStats({ matchId, version: runVersion }));

    await updateJob({ status: "done", step: "done", progress: 1 });
    await updateMatchAnalysis({ status: "done", activeVersion: runVersion });
    log("done", "pipeline complete", { version: runVersion });
    return { matchId, version: runVersion };
  } catch (error: any) {
    const message = error?.message ?? String(error);
    await updateJob({ status: "error", error: message });
    await updateMatchAnalysis({ status: "error" });
    console.error(
      JSON.stringify({
        level: "error",
        matchId,
        jobId,
        step: "pipeline_error",
        message,
      })
    );
    throw error;
  }
}
