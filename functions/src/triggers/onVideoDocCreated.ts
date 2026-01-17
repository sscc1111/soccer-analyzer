import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAdminApp } from "../firebase/admin";
import { createVideoJob } from "../enqueue/createJob";
import type { VideoType } from "@soccer/shared";

/**
 * P0修正: VideoTypeの実行時型ガード
 * Firestoreデータの不正を防ぐ
 */
function isValidVideoType(value: unknown): value is VideoType {
  return value === "firstHalf" || value === "secondHalf" || value === "single";
}

/**
 * Trigger when a video document is created or updated in the videos subcollection.
 * Path: matches/{matchId}/videos/{videoId}
 *
 * P0修正: onDocumentCreated → onDocumentWritten に変更
 * 理由: upload-video.tsxでは以下の順序で処理される
 *   1. createVideoDoc(storagePath="")でドキュメント作成
 *   2. uploadVideoToMatchでストレージにアップロード
 *   3. updateVideoDocでstoragePathを更新
 * onDocumentCreatedでは1の時点でstoragePathが空なのでスキップされ、
 * 3の更新時には再発火しない。onDocumentWrittenを使用することで、
 * storagePathが追加されたタイミングで処理を実行できる。
 *
 * This trigger:
 * 1. Updates the parent match's videosUploaded status and videoCount (on create only)
 * 2. Creates an analyze_video job for the new video (when storagePath is set)
 *
 * Note: Merge job creation is handled by onVideoAnalysisCompleted when
 * both halves have analysis.status === "done".
 */
export const onVideoDocCreated = onDocumentWritten(
  "matches/{matchId}/videos/{videoId}",
  async (event) => {
    const matchId = event.params.matchId;
    const videoId = event.params.videoId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    console.log(`[onVideoDocCreated] matchId=${matchId}, videoId=${videoId}`);

    // ドキュメントが削除された場合はスキップ
    if (!after) {
      console.log(`[onVideoDocCreated] Skip: document deleted`);
      return;
    }

    const videoType = after.type;
    const storagePath = after.storagePath as string | undefined;
    const beforeStoragePath = before?.storagePath as string | undefined;

    // P0修正: VideoTypeの実行時検証
    if (!isValidVideoType(videoType)) {
      console.log(`[onVideoDocCreated] Skip: invalid or missing videoType: ${videoType}`);
      return;
    }

    // storagePathがまだ設定されていない場合はスキップ
    if (!storagePath) {
      console.log(`[onVideoDocCreated] Skip: missing storagePath (waiting for upload)`);
      return;
    }

    // storagePathが変更されていない場合はスキップ（idempotency）
    if (beforeStoragePath === storagePath) {
      console.log(`[onVideoDocCreated] Skip: storagePath unchanged`);
      return;
    }

    console.log(`[onVideoDocCreated] Video type: ${videoType}, storagePath: ${storagePath}`);

    const db = getFirestore(getAdminApp());
    const matchRef = db.collection("matches").doc(matchId);

    // 新規作成の場合のみ videosUploaded と videoCount を更新
    // (beforeが存在しない = 新規作成)
    if (!before) {
      // P0修正: update()とドット記法でアトミックに更新（race condition防止）
      // set() + merge では並行書き込み時にデータ損失の可能性がある
      await matchRef.update({
        [`videosUploaded.${videoType}`]: true,
        videoCount: FieldValue.increment(1),
      });
      console.log(`[onVideoDocCreated] Updated match videosUploaded.${videoType}=true, videoCount incremented`);
    } else {
      // 更新の場合でも、videosUploadedがまだ設定されていなければ更新
      // (storagePath追加時に実行される)
      const matchSnap = await matchRef.get();
      const matchData = matchSnap.data();
      const videosUploaded = matchData?.videosUploaded as Record<string, boolean> | undefined;

      if (!videosUploaded?.[videoType]) {
        await matchRef.update({
          [`videosUploaded.${videoType}`]: true,
          videoCount: FieldValue.increment(1),
        });
        console.log(`[onVideoDocCreated] Updated match videosUploaded.${videoType}=true, videoCount incremented (on storagePath update)`);
      }
    }

    // P0修正: idempotency保護 - 既にジョブが存在する場合はスキップ
    // Cloud Functionsのリトライで重複ジョブが作成されるのを防ぐ
    const existingJobsSnap = await db
      .collection("jobs")
      .where("matchId", "==", matchId)
      .where("videoId", "==", videoId)
      .where("type", "==", "analyze_video")
      .where("status", "in", ["queued", "running"])
      .limit(1)
      .get();

    if (!existingJobsSnap.empty) {
      console.log(`[onVideoDocCreated] Skip: job already exists for video ${videoId}`);
      return;
    }

    // Create analysis job for this video
    const videoRef = matchRef.collection("videos").doc(videoId);
    try {
      const jobId = await createVideoJob(matchId, videoId, videoType);
      console.log(`[onVideoDocCreated] Created analyze_video job: ${jobId}`);
    } catch (error) {
      // P1修正: ジョブ作成失敗時にvideo documentのステータスをエラーに更新
      console.error(`[onVideoDocCreated] Failed to create job:`, error);
      await videoRef.set(
        {
          analysis: {
            status: "error",
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        },
        { merge: true }
      );
      throw error;
    }
  }
);
