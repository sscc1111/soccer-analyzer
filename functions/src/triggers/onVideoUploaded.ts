import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { createJob } from "../enqueue/createJob";

export const onVideoUploaded = onDocumentWritten("matches/{matchId}", async (event) => {
  const matchId = event.params.matchId;
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const beforePath = before?.video?.storagePath ?? null;
  const afterPath = after?.video?.storagePath ?? null;

  console.log(`[onVideoUploaded] matchId=${matchId}, beforePath=${beforePath}, afterPath=${afterPath}, status=${after?.analysis?.status}`);

  if (!afterPath) {
    console.log(`[onVideoUploaded] Skip: no video path`);
    return;
  }
  if (beforePath === afterPath) {
    console.log(`[onVideoUploaded] Skip: path unchanged`);
    return;
  }
  if (after?.analysis?.status === "running" || after?.analysis?.status === "queued") {
    console.log(`[onVideoUploaded] Skip: already ${after.analysis.status}`);
    return;
  }

  console.log(`[onVideoUploaded] Creating job for matchId=${matchId}`);
  await createJob(matchId, "analyze_match");
  console.log(`[onVideoUploaded] Job created successfully`);
});
