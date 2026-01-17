import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "../firebase/admin";
import { createMergeJob } from "../enqueue/createJob";
import type { VideoType } from "@soccer/shared";

/**
 * P0修正: VideoTypeの実行時型ガード
 */
function isValidVideoType(value: unknown): value is VideoType {
  return value === "firstHalf" || value === "secondHalf" || value === "single";
}

/**
 * Trigger when a video document's analysis status changes to "done".
 * Path: matches/{matchId}/videos/{videoId}
 *
 * When both first and second half videos are analyzed, creates a merge job.
 */
export const onVideoAnalysisCompleted = onDocumentWritten(
  "matches/{matchId}/videos/{videoId}",
  async (event) => {
    const matchId = event.params.matchId;
    const videoId = event.params.videoId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    const beforeStatus = before?.analysis?.status ?? null;
    const afterStatus = after?.analysis?.status ?? null;

    // Only proceed if status changed to "done"
    if (afterStatus !== "done" || beforeStatus === "done") {
      return;
    }

    const videoType = after?.type;
    console.log(
      `[onVideoAnalysisCompleted] matchId=${matchId}, videoId=${videoId}, type=${videoType}, status: ${beforeStatus} -> ${afterStatus}`
    );

    // P0修正: VideoTypeの実行時検証
    if (!isValidVideoType(videoType)) {
      console.log(`[onVideoAnalysisCompleted] Skip: invalid or missing videoType: ${videoType}`);
      return;
    }

    // Only check for merge if this is a half video
    if (videoType !== "firstHalf" && videoType !== "secondHalf") {
      console.log(`[onVideoAnalysisCompleted] Skip merge check: video type is ${videoType}`);

      // For single videos, update match analysis status
      if (videoType === "single") {
        await updateMatchAnalysisStatus(matchId, "done");
      }
      return;
    }

    // Check if both halves are now done
    const db = getFirestore(getAdminApp());
    const matchRef = db.collection("matches").doc(matchId);
    const videosSnap = await matchRef.collection("videos").get();

    let firstHalfDone = false;
    let secondHalfDone = false;

    for (const doc of videosSnap.docs) {
      const data = doc.data();
      const type = data.type;
      const status = data.analysis?.status;

      // P0修正: 型ガードを使用して安全にVideoTypeを検証
      if (!isValidVideoType(type)) {
        console.warn(`[onVideoAnalysisCompleted] Skipping invalid video type: ${type}`);
        continue;
      }

      if (type === "firstHalf" && status === "done") {
        firstHalfDone = true;
      }
      if (type === "secondHalf" && status === "done") {
        secondHalfDone = true;
      }
    }

    console.log(
      `[onVideoAnalysisCompleted] firstHalfDone=${firstHalfDone}, secondHalfDone=${secondHalfDone}`
    );

    if (firstHalfDone && secondHalfDone) {
      // P1修正: マッチステータスも確認（完了済みジョブのチェック漏れ防止）
      const matchSnap = await matchRef.get();
      const matchData = matchSnap.data();
      if (matchData?.analysis?.status === "done") {
        console.log(`[onVideoAnalysisCompleted] Match already merged (status=done), skipping`);
        return;
      }

      // Check if a merge job already exists (queued or running)
      const jobsSnap = await db
        .collection("jobs")
        .where("matchId", "==", matchId)
        .where("type", "==", "merge_half_analysis")
        .where("status", "in", ["queued", "running"])
        .limit(1)
        .get();

      if (!jobsSnap.empty) {
        console.log(`[onVideoAnalysisCompleted] Merge job already exists, skipping`);
        return;
      }

      console.log(`[onVideoAnalysisCompleted] Both halves done, creating merge job`);
      try {
        const mergeJobId = await createMergeJob(matchId);
        console.log(`[onVideoAnalysisCompleted] Created merge_half_analysis job: ${mergeJobId}`);
      } catch (error) {
        // P0修正: マージジョブ作成失敗をマッチステータスに反映
        console.error(`[onVideoAnalysisCompleted] Failed to create merge job:`, error);
        await db
          .collection("matches")
          .doc(matchId)
          .set(
            {
              analysis: {
                status: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
                lastRunAt: new Date().toISOString(),
              },
            },
            { merge: true }
          );
        throw error; // エラーを再スローしてCloud Functionsに失敗を通知
      }
    } else {
      // Update match to partial status if only one half is done
      await updateMatchAnalysisStatus(matchId, "partial");
    }
  }
);

/**
 * Update the parent match's analysis status
 */
async function updateMatchAnalysisStatus(
  matchId: string,
  status: "partial" | "done"
) {
  const db = getFirestore(getAdminApp());
  await db
    .collection("matches")
    .doc(matchId)
    .set(
      {
        analysis: {
          status,
          lastRunAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
  console.log(`[onVideoAnalysisCompleted] Updated match analysis status to ${status}`);
}
