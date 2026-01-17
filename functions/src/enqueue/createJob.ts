import { getFirestore } from "firebase-admin/firestore";
import type { JobType, VideoType } from "@soccer/shared";
import { getAdminApp } from "../firebase/admin";

/**
 * Create a job for match-level analysis
 */
export async function createJob(matchId: string, type: JobType) {
  const db = getFirestore(getAdminApp());
  const ref = db.collection("jobs").doc();
  const now = new Date().toISOString();
  await ref.set({
    matchId,
    type,
    status: "queued",
    step: "queued",
    progress: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .collection("matches")
    .doc(matchId)
    .set(
      {
        analysis: {
          status: "queued",
          lastRunAt: now,
        },
      },
      { merge: true }
    );
  return ref.id;
}

/**
 * Create a job for video-level analysis (subcollection videos)
 * @param matchId - Parent match ID
 * @param videoId - Video document ID in the subcollection
 * @param videoType - Type of video (firstHalf, secondHalf, single)
 *
 * P1修正: 競合状態防止のため、ジョブ作成前にvideoDocの存在とstoragePathを再確認
 */
export async function createVideoJob(
  matchId: string,
  videoId: string,
  videoType: VideoType
) {
  const db = getFirestore(getAdminApp());

  // P1修正: ジョブ作成前にvideoDocが存在し、storagePathが設定されていることを確認
  // クライアントがアップロード失敗でvideoDocを削除した場合の競合状態を防ぐ
  const videoRef = db
    .collection("matches")
    .doc(matchId)
    .collection("videos")
    .doc(videoId);
  const videoSnap = await videoRef.get();

  if (!videoSnap.exists) {
    console.log(`[createVideoJob] Skip: videoDoc ${videoId} does not exist (may have been deleted)`);
    throw new Error(`Video document ${videoId} does not exist`);
  }

  const videoData = videoSnap.data();
  const storagePath = videoData?.storagePath as string | undefined;

  if (!storagePath) {
    console.log(`[createVideoJob] Skip: videoDoc ${videoId} has no storagePath`);
    throw new Error(`Video document ${videoId} has no storagePath`);
  }

  const ref = db.collection("jobs").doc();
  const now = new Date().toISOString();

  // Create job document with video-specific fields
  await ref.set({
    matchId,
    videoId,
    videoType,
    type: "analyze_video" as JobType,
    status: "queued",
    step: "queued",
    progress: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  });

  // Update video document status
  await db
    .collection("matches")
    .doc(matchId)
    .collection("videos")
    .doc(videoId)
    .set(
      {
        analysis: {
          status: "queued",
          lastRunAt: now,
        },
      },
      { merge: true }
    );

  // Update parent match analysis status if not already running
  const matchSnap = await db.collection("matches").doc(matchId).get();
  const matchData = matchSnap.data();
  if (matchData?.analysis?.status !== "running" && matchData?.analysis?.status !== "queued") {
    await db
      .collection("matches")
      .doc(matchId)
      .set(
        {
          analysis: {
            status: "queued",
            lastRunAt: now,
          },
        },
        { merge: true }
      );
  }

  return ref.id;
}

/**
 * Create a merge job for combining first and second half results
 */
export async function createMergeJob(matchId: string) {
  const db = getFirestore(getAdminApp());
  const ref = db.collection("jobs").doc();
  const now = new Date().toISOString();

  await ref.set({
    matchId,
    type: "merge_half_analysis" as JobType,
    status: "queued",
    step: "queued",
    progress: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  });

  // Update parent match status
  await db
    .collection("matches")
    .doc(matchId)
    .set(
      {
        analysis: {
          status: "queued",
          lastRunAt: now,
        },
      },
      { merge: true }
    );

  return ref.id;
}
