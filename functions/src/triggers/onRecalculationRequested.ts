import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { createJob } from "../enqueue/createJob";

/**
 * Trigger stats recalculation when needsRecalculation flag is set
 * This happens after user corrects pending reviews
 */
export const onRecalculationRequested = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  // Check if needsRecalculation flag was just set
  const wasRequested = Boolean(before?.analysis?.needsRecalculation);
  const isRequested = Boolean(after?.analysis?.needsRecalculation);

  if (!isRequested || wasRequested) return; // No new request

  // Don't queue if already processing
  if (after?.analysis?.status === "running" || after?.analysis?.status === "queued") {
    return;
  }

  // Don't queue if video is not uploaded yet
  if (!after?.video?.storagePath) {
    return;
  }

  // Clear the flag and queue the job
  await event.data?.after?.ref.update({
    "analysis.needsRecalculation": false,
  });

  // Queue stats recalculation job
  await createJob(event.params.matchId, "recompute_stats");
});
