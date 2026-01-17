import { PROMPT_VERSION } from "@soccer/shared";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../../firebase/admin";
import {
  labelClipWithGemini,
  labelClipBatchWithGemini,
  getLabelBatchSize,
  type BatchLabelClipInput,
} from "../../gemini/labelClip";
import { defaultLogger as logger } from "../../lib/logger";

type ClipDoc = {
  clipId: string;
  t0: number;
  t1: number;
  // Phase 2.1: clipPathを追加（動画クリップ送信対応）
  media?: { clipPath?: string; thumbPath?: string };
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
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Phase 3.4: Batch labeling configuration
const USE_BATCH_LABELING = process.env.USE_BATCH_LABELING === "true";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stepLabelClipsGemini({
  matchId,
  videoId,
  version
}: {
  matchId: string;
  videoId?: string;
  version: string
}) {
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
  let failed = 0;

  // Phase 3.4: Use batch labeling if enabled
  if (USE_BATCH_LABELING) {
    const batchSize = getLabelBatchSize();
    logger.info("Using batch labeling", { matchId, videoId, batchSize, targetCount: targets.length });

    // Limit to MAX_CLIPS_PER_RUN
    const clipsToProcess = targets.slice(0, MAX_CLIPS_PER_RUN);

    // Process clips in batches
    for (let i = 0; i < clipsToProcess.length; i += batchSize) {
      const batchClips = clipsToProcess.slice(i, i + batchSize);
      const batchInputs: BatchLabelClipInput[] = batchClips.map((clip) => ({
        clipId: clip.clipId,
        t0: clip.t0,
        t1: clip.t1,
        clipPath: clip.media?.clipPath,
        thumbPath: clip.media?.thumbPath,
      }));

      const batchResult = await labelClipBatchWithGemini(batchInputs, matchId);

      // Process successful results
      for (const [clipId, { result, rawResponse }] of batchResult.results) {
        const needsReview = (result.confidence ?? 0) < 0.4;

        batch.set(
          matchRef.collection("clips").doc(clipId),
          {
            gemini: {
              model: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
              promptVersion: PROMPT_VERSION,
              label: result.label,
              confidence: result.confidence,
              title: result.title ?? null,
              summary: result.summary ?? null,
              tags: result.tags ?? [],
              coachTips: result.coachTips ?? [],
              needsReview,
              createdAt: now,
              rawResponse,
              rawOriginalResponse: null,
              batchProcessed: true, // Phase 3.4: Mark as batch processed
            },
          },
          { merge: true }
        );
        processed += 1;
      }

      // Fallback to sequential processing for failed clips
      for (const failedClipId of batchResult.failed) {
        const failedClip = batchClips.find((c) => c.clipId === failedClipId);
        if (!failedClip) continue;

        // Retry with sequential processing
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const labeled = await labelClipWithGemini({
              clipId: failedClip.clipId,
              t0: failedClip.t0,
              t1: failedClip.t1,
              clipPath: failedClip.media?.clipPath,
              thumbPath: failedClip.media?.thumbPath,
              matchId,
            });

            const needsReview = (labeled.result.confidence ?? 0) < 0.4;

            batch.set(
              matchRef.collection("clips").doc(failedClip.clipId),
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
                  needsReview,
                  createdAt: now,
                  rawResponse: labeled.rawResponse,
                  rawOriginalResponse: labeled.rawOriginalResponse ?? null,
                  batchProcessed: false, // Sequential fallback
                },
              },
              { merge: true }
            );
            processed += 1;
            lastError = null;
            break;
          } catch (err) {
            lastError = err as Error;
            if (attempt < MAX_RETRIES) {
              await sleep(RETRY_DELAY_MS * attempt);
            }
          }
        }

        if (lastError) {
          failed += 1;
          logger.warn("Failed to label clip after batch and sequential fallback", {
            matchId,
            clipId: failedClipId,
            error: lastError.message,
          });
        }
      }
    }
  } else {
    // Sequential processing (original behavior)
    for (const clip of targets) {
      if (processed >= MAX_CLIPS_PER_RUN) break;

      // Retry logic for resilient labeling
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const labeled = await labelClipWithGemini({
            clipId: clip.clipId,
            t0: clip.t0,
            t1: clip.t1,
            // Phase 2.1: 動画クリップパスを渡す（USE_VIDEO_FOR_LABELING=trueの場合に使用）
            clipPath: clip.media?.clipPath,
            thumbPath: clip.media?.thumbPath,
            matchId,
          });

          // Phase 1.3: 信頼度が0.4未満の場合はneedsReviewフラグを設定
          const needsReview = (labeled.result.confidence ?? 0) < 0.4;

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
                needsReview, // Phase 1.3: 低信頼度クリップにレビューフラグ
                createdAt: now,
                rawResponse: labeled.rawResponse,
                rawOriginalResponse: labeled.rawOriginalResponse ?? null,
              },
            },
            { merge: true }
          );
          processed += 1;
          lastError = null;
          break; // Success, exit retry loop
        } catch (err) {
          lastError = err as Error;
          if (attempt < MAX_RETRIES) {
            console.warn(
              JSON.stringify({
                level: "warn",
                matchId,
                step: "label_clips",
                clipId: clip.clipId,
                attempt,
                message: `Retry ${attempt}/${MAX_RETRIES}: ${lastError?.message ?? String(err)}`,
              })
            );
            await sleep(RETRY_DELAY_MS * attempt); // Exponential backoff
          }
        }
      }

      // Log final failure after all retries exhausted
      if (lastError) {
        failed += 1;
        console.warn(
          JSON.stringify({
            level: "warn",
            matchId,
            step: "label_clips",
            clipId: clip.clipId,
            message: `Failed after ${MAX_RETRIES} attempts: ${lastError.message}`,
          })
        );
      }
    }
  }

  if (processed > 0) await batch.commit();
  if (processed > 0) {
    // Phase 3.4: Adjust cost tracking for batch processing (fewer API calls)
    const batchSize = USE_BATCH_LABELING ? getLabelBatchSize() : 1;
    const apiCalls = Math.ceil(processed / batchSize);
    const costDelta = COST_PER_CLIP > 0 ? processed * COST_PER_CLIP : 0;

    await matchRef.set(
      {
        analysis: {
          cost: {
            estimatedUsd: costDelta ? FieldValue.increment(costDelta) : FieldValue.increment(0),
            geminiCalls: FieldValue.increment(apiCalls),
            perClipUsd: COST_PER_CLIP,
            updatedAt: now,
            batchLabeling: USE_BATCH_LABELING, // Phase 3.4: Track if batch was used
          },
        },
      },
      { merge: true }
    );
  }
  return { matchId, ok: true, labeled: processed, failed };
}
