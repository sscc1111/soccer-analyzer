/**
 * Step 04c: Label Clips (Hybrid Pipeline Call 3)
 *
 * ハイブリッドパイプライン - Call 3
 * Call 2のシーン結果からクリップを生成・ラベリング
 *
 * 処理フロー:
 * 1. importantScenes から suggestedClip を取得
 * 2. 既存クリップと比較して新規クリップを特定
 * 3. クリップドキュメントを作成
 * 4. labelClipBatchWithGemini() でバッチラベリング
 * 5. clips コレクションに保存
 */

import { PROMPT_VERSION, type ImportantSceneDoc } from "@soccer/shared";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../../firebase/admin";
import {
  labelClipBatchWithGemini,
  getLabelBatchSize,
  type BatchLabelClipInput,
} from "../../gemini/labelClip";
import { defaultLogger as logger, ILogger } from "../../lib/logger";

// ============================================================
// Types
// ============================================================

export interface LabelClipsHybridOptions {
  matchId: string;
  version: string;
  logger?: ILogger;
}

export interface LabelClipsHybridResult {
  matchId: string;
  clipsCreated: number;
  clipsLabeled: number;
  clipsFailed: number;
  skipped: boolean;
  error?: string;
}

interface ClipDoc {
  clipId: string;
  matchId: string;
  version: string;
  t0: number;
  t1: number;
  reason: "scene_based" | "motionPeak" | "audioPeak" | "manual";
  sceneId?: string;
  media?: {
    clipPath?: string;
    thumbPath?: string;
  };
  gemini?: {
    model?: string;
    promptVersion?: string;
    label?: string;
    confidence?: number;
    title?: string;
    summary?: string;
    tags?: string[];
    coachTips?: string[];
    needsReview?: boolean;
    createdAt?: string;
    rawResponse?: string;
    batchProcessed?: boolean;
  };
  createdAt: string;
}

// ============================================================
// Constants
// ============================================================

const MAX_CLIPS_PER_RUN = Number(process.env.MAX_GEMINI_CLIPS ?? 50);
const COST_PER_CLIP = Number(process.env.GEMINI_COST_PER_CLIP_USD ?? 0);

// ============================================================
// Helper Functions
// ============================================================

/**
 * Generate clip ranges from scenes with suggestedClip
 */
function generateClipsFromScenes(
  scenes: ImportantSceneDoc[],
  existingClips: ClipDoc[]
): Array<{ t0: number; t1: number; sceneId: string }> {
  const plans: Array<{ t0: number; t1: number; sceneId: string }> = [];

  for (const scene of scenes) {
    // Get clip range from suggestedClip or calculate from scene times
    const suggestedClip = (scene as Record<string, unknown>).suggestedClip as
      | { t0: number; t1: number }
      | undefined;

    const t0 = suggestedClip?.t0 ?? Math.max(0, scene.startSec - 3);
    const t1 = suggestedClip?.t1 ?? (scene.endSec ?? scene.startSec) + 5;

    // Check for overlap with existing clips (within 2 seconds)
    const overlapping = existingClips.find(
      (c) => Math.abs(c.t0 - t0) < 2 || Math.abs(c.t1 - t1) < 2
    );

    if (!overlapping) {
      plans.push({ t0, t1, sceneId: scene.sceneId });
    }
  }

  return plans;
}

// ============================================================
// Main Step
// ============================================================

export async function stepLabelClipsHybrid(
  options: LabelClipsHybridOptions
): Promise<LabelClipsHybridResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child
    ? log.child({ step: "label_clips_hybrid" })
    : log;

  stepLogger.info("Starting hybrid clip labeling", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Get existing clips
  const existingClipsSnap = await matchRef
    .collection("clips")
    .where("version", "==", version)
    .get();
  const existingClips = existingClipsSnap.docs.map((doc) => doc.data() as ClipDoc);

  // Check if clips are already labeled
  const labeledClips = existingClips.filter(
    (c) => c.gemini?.promptVersion === PROMPT_VERSION
  );

  if (labeledClips.length > 0 && labeledClips.length === existingClips.length) {
    stepLogger.info("All clips already labeled for this version", {
      matchId,
      version,
      clipCount: labeledClips.length,
    });

    return {
      matchId,
      clipsCreated: 0,
      clipsLabeled: labeledClips.length,
      clipsFailed: 0,
      skipped: true,
    };
  }

  // Get scenes from Call 2
  const scenesSnap = await matchRef
    .collection("importantScenes")
    .where("version", "==", version)
    .orderBy("importance", "desc")
    .get();

  const scenes = scenesSnap.docs.map((doc) => doc.data() as ImportantSceneDoc);

  if (scenes.length === 0) {
    stepLogger.warn("No scenes found, cannot generate clips", { matchId, version });
    return {
      matchId,
      clipsCreated: 0,
      clipsLabeled: 0,
      clipsFailed: 0,
      skipped: true,
      error: "No scenes found",
    };
  }

  // Generate clip plans from scenes
  const clipPlans = generateClipsFromScenes(scenes, existingClips);

  stepLogger.info("Clip generation plan", {
    matchId,
    sceneCount: scenes.length,
    existingClipCount: existingClips.length,
    newClipsPlanned: clipPlans.length,
  });

  // Create new clip documents
  const now = new Date().toISOString();
  const batch = db.batch();
  const newClips: ClipDoc[] = [];

  for (let i = 0; i < clipPlans.length && newClips.length < MAX_CLIPS_PER_RUN; i++) {
    const plan = clipPlans[i];
    const clipId = `${matchId}_clip_${Math.floor(plan.t0 * 10)}`;

    const clipDoc: ClipDoc = {
      clipId,
      matchId,
      version,
      t0: plan.t0,
      t1: plan.t1,
      reason: "scene_based",
      sceneId: plan.sceneId,
      createdAt: now,
    };

    batch.set(matchRef.collection("clips").doc(clipId), clipDoc);
    newClips.push(clipDoc);
  }

  // Commit new clips
  if (newClips.length > 0) {
    await batch.commit();
    stepLogger.info("Created new clip documents", {
      matchId,
      clipsCreated: newClips.length,
    });
  }

  // Collect all clips to label
  const allClips = [...existingClips, ...newClips];
  const clipsToLabel = allClips.filter(
    (c) => c.gemini?.promptVersion !== PROMPT_VERSION
  );

  if (clipsToLabel.length === 0) {
    stepLogger.info("No clips need labeling", { matchId });
    return {
      matchId,
      clipsCreated: newClips.length,
      clipsLabeled: 0,
      clipsFailed: 0,
      skipped: false,
    };
  }

  // Label clips in batches
  const batchSize = getLabelBatchSize();
  stepLogger.info("Starting batch labeling", {
    matchId,
    clipsToLabel: clipsToLabel.length,
    batchSize,
  });

  let labeled = 0;
  let failed = 0;
  const labelBatch = db.batch();

  for (let i = 0; i < clipsToLabel.length; i += batchSize) {
    const batchClips = clipsToLabel.slice(i, i + batchSize);
    const batchInputs: BatchLabelClipInput[] = batchClips.map((clip) => ({
      clipId: clip.clipId,
      t0: clip.t0,
      t1: clip.t1,
      clipPath: clip.media?.clipPath,
      thumbPath: clip.media?.thumbPath,
    }));

    try {
      const batchResult = await labelClipBatchWithGemini(batchInputs, matchId);

      // Process successful results
      for (const [clipId, { result, rawResponse }] of batchResult.results) {
        const needsReview = (result.confidence ?? 0) < 0.4;

        labelBatch.set(
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
              batchProcessed: true,
            },
          },
          { merge: true }
        );
        labeled += 1;
      }

      // Track failed clips
      failed += batchResult.failed.length;

      if (batchResult.failed.length > 0) {
        stepLogger.warn("Some clips failed to label in batch", {
          matchId,
          failedClipIds: batchResult.failed,
        });
      }
    } catch (err) {
      const error = err as Error;
      stepLogger.error("Batch labeling failed", {
        matchId,
        error: error.message,
        batchIndex: Math.floor(i / batchSize),
      });
      failed += batchClips.length;
    }
  }

  // Commit label updates
  if (labeled > 0) {
    await labelBatch.commit();
  }

  // Update cost tracking
  if (labeled > 0 && COST_PER_CLIP > 0) {
    const apiCalls = Math.ceil(labeled / batchSize);
    const costDelta = labeled * COST_PER_CLIP;

    await matchRef.set(
      {
        analysis: {
          cost: {
            estimatedUsd: FieldValue.increment(costDelta),
            geminiCalls: FieldValue.increment(apiCalls),
            perClipUsd: COST_PER_CLIP,
            updatedAt: now,
            batchLabeling: true,
          },
        },
      },
      { merge: true }
    );
  }

  stepLogger.info("Hybrid clip labeling complete", {
    matchId,
    clipsCreated: newClips.length,
    clipsLabeled: labeled,
    clipsFailed: failed,
  });

  return {
    matchId,
    clipsCreated: newClips.length,
    clipsLabeled: labeled,
    clipsFailed: failed,
    skipped: false,
  };
}
