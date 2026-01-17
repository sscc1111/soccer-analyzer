import { runMatchPipeline } from "./jobs/runMatchPipeline";
import { runVideoPipeline } from "./jobs/runVideoPipeline";
import { mergeHalfResults } from "./lib/halfMerger";

export async function handler(req: any, res: any) {
  try {
    const { matchId, videoId, jobId, type } = req.body ?? {};
    if (!matchId) return res.status(400).json({ error: "matchId required" });

    let result;

    // Dispatch to correct pipeline based on job type
    if (type === "analyze_video") {
      if (!videoId) return res.status(400).json({ error: "videoId required for analyze_video" });
      result = await runVideoPipeline({ matchId, videoId, jobId, type });
    } else if (type === "merge_half_analysis") {
      result = await mergeHalfResults({ matchId });
    } else {
      // Legacy job types: analyze_match, recompute_stats, relabel_and_stats
      result = await runMatchPipeline({ matchId, jobId, type });
    }

    return res.json({ ok: true, result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
}
