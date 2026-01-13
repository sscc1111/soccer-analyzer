import { runMatchPipeline } from "./jobs/runMatchPipeline";

export async function handler(req: any, res: any) {
  try {
    const { matchId, jobId, type } = req.body ?? {};
    if (!matchId) return res.status(400).json({ error: "matchId required" });

    // Run pipeline synchronously and wait for completion
    const result = await runMatchPipeline({ matchId, jobId, type });
    return res.json({ ok: true, result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
}
