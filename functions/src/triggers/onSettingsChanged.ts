import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { createJob } from "../enqueue/createJob";

export const onSettingsChanged = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  if (!after?.video?.storagePath) return;

  // If settings changed, enqueue lightweight recompute (or relabel) based on flag
  const changed = JSON.stringify(before.settings ?? null) !== JSON.stringify(after.settings ?? null);
  if (!changed) return;
  if (after?.analysis?.status === "running" || after?.analysis?.status === "queued") return;
  const wantsRelabel = Boolean(after?.settings?.relabelOnChange);
  await createJob(event.params.matchId, wantsRelabel ? "relabel_and_stats" : "recompute_stats");
});
