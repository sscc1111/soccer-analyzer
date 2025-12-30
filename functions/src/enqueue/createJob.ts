import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "../firebase/admin";

export type JobType = "analyze_match" | "recompute_stats" | "relabel_and_stats";

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
    error: null,
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
