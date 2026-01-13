import { PROMPT_VERSION } from "@soccer/shared";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../../firebase/admin";
import { labelClipWithGemini } from "../../gemini/labelClip";

type ClipDoc = {
  clipId: string;
  t0: number;
  t1: number;
  media?: { thumbPath?: string };
  gemini?: { promptVersion?: string };
};

const MAX_CLIPS_PER_RUN = (() => {
  const value = Number(process.env.MAX_GEMINI_CLIPS ?? 30);
  return Number.isFinite(value) ? value : 30;
})();
const COST_PER_CLIP = (() => {
  const value = Number(process.env.GEMINI_COST_PER_CLIP_USD ?? 0);
  return Number.isFinite(value) ? value : 0;
})();

export async function stepLabelClipsGemini({ matchId, version }: { matchId: string; version: string }) {
  if (!process.env.GCP_PROJECT_ID) {
    throw new Error("GCP_PROJECT_ID not set");
  }
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const clipsSnap = await matchRef.collection("clips").where("version", "==", version).get();
  const clips = clipsSnap.docs.map((doc) => doc.data() as ClipDoc);

  const targets = clips.filter((clip) => clip.gemini?.promptVersion !== PROMPT_VERSION);
  const batch = db.batch();
  const now = new Date().toISOString();

  let processed = 0;
  for (const clip of targets) {
    if (processed >= MAX_CLIPS_PER_RUN) break;
    try {
      const labeled = await labelClipWithGemini({
        clipId: clip.clipId,
        t0: clip.t0,
        t1: clip.t1,
        thumbPath: clip.media?.thumbPath,
        matchId,
      });

      batch.set(
        matchRef.collection("clips").doc(clip.clipId),
        {
          gemini: {
            model: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
            promptVersion: PROMPT_VERSION,
            label: labeled.result.label,
            confidence: labeled.result.confidence,
            title: labeled.result.title ?? null,
            summary: labeled.result.summary ?? null,
            tags: labeled.result.tags ?? [],
            coachTips: labeled.result.coachTips ?? [],
            createdAt: now,
            rawResponse: labeled.rawResponse,
            rawOriginalResponse: labeled.rawOriginalResponse ?? null,
          },
        },
        { merge: true }
      );
      processed += 1;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          matchId,
          step: "label_clips",
          clipId: clip.clipId,
          message: (err as Error)?.message ?? String(err),
        })
      );
    }
  }

  if (processed > 0) await batch.commit();
  if (processed > 0) {
    const costDelta = COST_PER_CLIP > 0 ? processed * COST_PER_CLIP : 0;
    await matchRef.set(
      {
        analysis: {
          cost: {
            estimatedUsd: costDelta ? FieldValue.increment(costDelta) : FieldValue.increment(0),
            geminiCalls: FieldValue.increment(processed),
            perClipUsd: COST_PER_CLIP,
            updatedAt: now,
          },
        },
      },
      { merge: true }
    );
  }
  return { matchId, ok: true, labeled: processed };
}
