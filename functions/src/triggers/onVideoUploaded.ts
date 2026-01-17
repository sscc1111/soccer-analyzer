import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "../firebase/admin";

/**
 * Legacy trigger for backward compatibility.
 * Handles uploads using the deprecated match.video field.
 *
 * When a legacy client uploads to match.video:
 * 1. Creates a corresponding document in the videos subcollection
 * 2. The onVideoDocCreated trigger will handle the rest
 *
 * For clients already using the videos subcollection, this trigger
 * will be skipped (no match.video change detected).
 */
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

  const db = getFirestore(getAdminApp());
  const videosRef = db.collection("matches").doc(matchId).collection("videos");

  // Check if videos subcollection already has a "single" video
  const existingSingleSnap = await videosRef.where("type", "==", "single").limit(1).get();

  if (!existingSingleSnap.empty) {
    console.log(`[onVideoUploaded] Skip: videos subcollection already has single video`);
    return;
  }

  // Check video configuration to decide behavior
  const videoConfiguration = after?.settings?.videoConfiguration;

  if (videoConfiguration === "split") {
    // If configured for split but using legacy upload, this is an error state
    console.log(`[onVideoUploaded] Warning: videoConfiguration=split but using legacy video field`);
    // Still process as single for backward compatibility
  }

  // Migrate legacy upload to videos subcollection
  console.log(`[onVideoUploaded] Migrating legacy video to subcollection`);

  const videoDoc = {
    videoId: "single", // Use "single" as the ID for legacy uploads
    matchId,
    type: "single" as const,
    storagePath: afterPath,
    durationSec: after?.video?.durationSec ?? undefined,
    width: after?.video?.width ?? undefined,
    height: after?.video?.height ?? undefined,
    fps: after?.video?.fps ?? undefined,
    uploadedAt: after?.video?.uploadedAt ?? new Date().toISOString(),
    analysis: {
      status: "idle" as const,
    },
  };

  // Create video document in subcollection
  // This will trigger onVideoDocCreated which handles job creation
  await videosRef.doc("single").set(videoDoc);

  console.log(`[onVideoUploaded] Migrated to videos/single subcollection document`);

  // Note: We no longer call createJob here directly.
  // The onVideoDocCreated trigger will handle job creation.
  // This prevents duplicate jobs when migrating.
});
