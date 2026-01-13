import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "../firebase/admin";

const DEFAULT_TIMEOUT_SECONDS = 540;

export const onJobCreated = onDocumentCreated(
  { document: "jobs/{jobId}", timeoutSeconds: DEFAULT_TIMEOUT_SECONDS },
  async (event) => {
    const jobId = event.params.jobId;
    const job = event.data?.data();

    console.log(`[onJobCreated] jobId=${jobId}, matchId=${job?.matchId}, type=${job?.type}`);

    if (!job) {
      console.error(`[onJobCreated] No job data for jobId=${jobId}`);
      return;
    }

    const db = getFirestore(getAdminApp());
    const now = new Date().toISOString();

    const matchId = job.matchId as string | undefined;
    const type = job.type as string | undefined;
    if (!matchId || !type) {
      console.error(`[onJobCreated] Missing matchId/type for jobId=${jobId}`);
      await event.data?.ref.set(
        { status: "error", error: "missing matchId/type", updatedAt: now },
        { merge: true }
      );
      return;
    }

    const analyzerUrl = process.env.ANALYZER_URL;
    console.log(`[onJobCreated] ANALYZER_URL=${analyzerUrl}, hasToken=${!!process.env.ANALYZER_TOKEN}`);

    if (!analyzerUrl) {
      console.error(`[onJobCreated] ANALYZER_URL not set`);
      await event.data?.ref.set(
        { status: "error", error: "ANALYZER_URL not set", updatedAt: now },
        { merge: true }
      );
      await db
        .collection("matches")
        .doc(matchId)
        .set({ analysis: { status: "error", lastRunAt: now } }, { merge: true });
      return;
    }

    await event.data?.ref.set({ status: "running", step: "invoke_analyzer", updatedAt: now }, { merge: true });

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = process.env.ANALYZER_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;

      console.log(`[onJobCreated] Calling analyzer: ${analyzerUrl}`);
      const res = await fetch(analyzerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ matchId, jobId, type }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[onJobCreated] Analyzer error ${res.status}: ${text}`);
        throw new Error(`analyzer error ${res.status}: ${text}`);
      }

      console.log(`[onJobCreated] Analyzer call successful for jobId=${jobId}`);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`[onJobCreated] Error:`, message);
      await event.data?.ref.set(
        { status: "error", error: message, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      await db
        .collection("matches")
        .doc(matchId)
        .set({ analysis: { status: "error", lastRunAt: new Date().toISOString() } }, { merge: true });
    }
  }
);
