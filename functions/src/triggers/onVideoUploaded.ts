import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { createJob } from "../enqueue/createJob";

export const onVideoUploaded = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const beforePath = before?.video?.storagePath ?? null;
  const afterPath = after?.video?.storagePath ?? null;
  if (!afterPath) return;
  if (beforePath === afterPath) return;
  if (after?.analysis?.status === "running" || after?.analysis?.status === "queued") return;

  // naive: enqueue when video exists and status not running
  await createJob(event.params.matchId, "analyze_match");
});
