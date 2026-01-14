import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROMPT_VERSION } from "@soccer/shared";
import { z } from "zod";
import { downloadToTmp } from "../lib/storage";
import { withRetry } from "../lib/retry";
import { extractJson } from "../lib/json";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request, type Gemini3Part } from "./gemini3Client";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "./cacheManager";
import { defaultLogger as logger } from "../lib/logger";

const LabelSchema = z.object({
  label: z.enum(["shot", "chance", "setPiece", "dribble", "defense", "other"]),
  confidence: z.number().min(0).max(1),
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  coachTips: z.array(z.string()).optional().nullable(),
});

type LabelResult = z.infer<typeof LabelSchema>;

type LabelClipInput = {
  clipId: string;
  t0: number;
  t1: number;
  // Phase 2.1: 動画クリップパスを追加（GCSパス、例: matches/{matchId}/clips/{version}/clip_1.mp4）
  clipPath?: string;
  thumbPath?: string;
  matchId?: string;
};

export async function labelClipWithGemini(clip: LabelClipInput) {
  // Validate GCP_PROJECT_ID is set
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  const prompt = await loadPrompt();

  // Phase 3: Try to use context cache for the full video if matchId is provided
  let cache: GeminiCacheDoc | null = null;
  if (clip.matchId) {
    cache = await getValidCacheOrFallback(clip.matchId, "label_clips");
  }

  const useCache = cache?.cacheId && cache.version !== "fallback";

  // Phase 3: If cache is available, use cached full video with timestamp hints
  if (useCache && cache) {
    logger.debug("Using context cache for clip labeling", {
      clipId: clip.clipId,
      cacheId: cache.cacheId,
      t0: clip.t0,
      t1: clip.t1,
    });

    const promptText = [
      `Task: ${prompt.task}`,
      `Return JSON only. Output schema: ${JSON.stringify(prompt.output_schema)}`,
      "",
      "## Clip to Analyze",
      `- Clip ID: ${clip.clipId}`,
      `- Start time: ${clip.t0.toFixed(2)} seconds`,
      `- End time: ${clip.t1.toFixed(2)} seconds`,
      "",
      "IMPORTANT: Focus ONLY on the video segment from ${clip.t0.toFixed(2)}s to ${clip.t1.toFixed(2)}s.",
      "Analyze what happens in this specific time range and classify it.",
    ].join("\n");

    const response = await callGeminiWithCacheRetry(projectId, modelId, cache.cacheId, promptText, clip.matchId);
    const parsed = parseLabel(response);

    if (parsed.ok) {
      // Update cache usage
      await getCacheManager().updateCacheUsage(clip.matchId!);
      return { result: parsed.data, rawResponse: response };
    }

    // Repair attempt if JSON parsing failed
    const repairPrompt = [
      "Fix the following to valid JSON with the required schema.",
      JSON.stringify(prompt.output_schema),
      "Input:",
      response,
    ].join("\n");
    const repair = await callGeminiWithCacheRetry(projectId, modelId, cache.cacheId, repairPrompt, clip.matchId);
    const repaired = parseLabel(repair);
    if (!repaired.ok) throw new Error("Gemini response invalid JSON");
    await getCacheManager().updateCacheUsage(clip.matchId!);
    return { result: repaired.data, rawResponse: repair, rawOriginalResponse: response };
  }

  // Fallback: Use individual clip file or thumbnail (no cache available)
  // Phase 2.1: 動画クリップ送信対応
  // USE_VIDEO_FOR_LABELING=true の場合、clipPathがあれば動画を送信
  const useVideoForLabeling = process.env.USE_VIDEO_FOR_LABELING === "true";
  const storageBucket = process.env.STORAGE_BUCKET;

  const parts: Gemini3Part[] = [
    {
      text: [
        `Task: ${prompt.task}`,
        `Return JSON only. Output schema: ${JSON.stringify(prompt.output_schema)}`,
        `Clip info: id=${clip.clipId}, t0=${clip.t0.toFixed(2)}s, t1=${clip.t1.toFixed(2)}s.`,
      ].join("\n"),
    },
  ];

  // Phase 2.1: 動画クリップ優先、サムネイルをフォールバックとして使用
  if (useVideoForLabeling && clip.clipPath && storageBucket) {
    // GCS URIを構築
    const clipUri = clip.clipPath.startsWith("gs://")
      ? clip.clipPath
      : `gs://${storageBucket}/${clip.clipPath}`;

    parts.push({
      fileData: {
        fileUri: clipUri,
        mimeType: "video/mp4",
      },
    });

    logger.debug("Using video clip for labeling (no cache)", { clipId: clip.clipId, clipUri });
  } else if (clip.thumbPath) {
    // フォールバック: サムネイル画像を使用
    const localThumb = await downloadToTmp(clip.thumbPath, path.basename(clip.thumbPath));
    const imageBytes = await readFile(localThumb);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBytes.toString("base64"),
      },
    });
  }

  const response = await callGeminiWithRetry(projectId, modelId, parts, clip.matchId);
  const parsed = parseLabel(response);
  if (parsed.ok) return { result: parsed.data, rawResponse: response };

  // Repair attempt if JSON parsing failed
  const repairParts: Gemini3Part[] = [
    {
      text: [
        "Fix the following to valid JSON with the required schema.",
        JSON.stringify(prompt.output_schema),
        "Input:",
        response,
      ].join("\n"),
    },
  ];
  const repair = await callGeminiWithRetry(projectId, modelId, repairParts, clip.matchId);
  const repaired = parseLabel(repair);
  if (!repaired.ok) throw new Error("Gemini response invalid JSON");
  return { result: repaired.data, rawResponse: repair, rawOriginalResponse: response };
}

async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", `${PROMPT_VERSION}.json`);
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data) as { task: string; output_schema: Record<string, unknown> };
  return cachedPrompt;
}

let cachedPrompt: { task: string; output_schema: Record<string, unknown> } | null = null;

/**
 * Call Gemini API with retry logic using REST API (supports global endpoint)
 */
async function callGeminiWithRetry(projectId: string, modelId: string, parts: Gemini3Part[], matchId?: string): Promise<string> {
  return withRetry(
    async () => {
      const request: Gemini3Request = {
        contents: [{ role: "user", parts }],
        generationConfig: {
          // Phase 2.4: 分類タスクは低Temperatureで一貫性向上
          temperature: 0.1,
          topP: 0.95,
          topK: 40,
          responseMimeType: "application/json",
        },
      };

      const costContext = matchId ? { matchId, step: "label_clips" } : undefined;
      const response = await callGeminiApi(projectId, modelId, request, costContext);
      const text = extractTextFromResponse(response);
      if (!text) throw new Error("Gemini response empty");
      return text;
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 120000, // 2 minutes timeout
      onRetry: (attempt, error, delayMs) => {
        logger.warn("Retrying clip labeling", {
          model: modelId,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}

/**
 * Phase 3: Call Gemini API with context cache and retry logic
 * Uses the cached full video for ~84% cost savings
 */
async function callGeminiWithCacheRetry(
  projectId: string,
  modelId: string,
  cacheId: string,
  promptText: string,
  matchId?: string
): Promise<string> {
  return withRetry(
    async () => {
      const generationConfig = {
        // Phase 2.4: 分類タスクは低Temperatureで一貫性向上
        temperature: 0.1,
        topP: 0.95,
        topK: 40,
        responseMimeType: "application/json",
      };

      const costContext = matchId ? { matchId, step: "label_clips" } : undefined;
      const response = await callGeminiApiWithCache(
        projectId,
        modelId,
        cacheId,
        promptText,
        generationConfig,
        costContext
      );
      const text = extractTextFromResponse(response);
      if (!text) throw new Error("Gemini response empty");
      return text;
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 120000, // 2 minutes timeout
      onRetry: (attempt, error, delayMs) => {
        logger.warn("Retrying clip labeling with cache", {
          model: modelId,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}

function parseLabel(text: string): { ok: true; data: LabelResult } | { ok: false; error: string } {
  try {
    const extracted = extractJson(text);
    const json = JSON.parse(extracted);
    const parsed = LabelSchema.parse(json);
    return { ok: true, data: parsed };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ============================================================================
// Phase 3.4: Batch Labeling Support
// ============================================================================

/**
 * Schema for batch labeling response
 * Each item in the array corresponds to a clip in the batch
 */
const BatchLabelSchema = z.array(
  z.object({
    clipId: z.string(),
    label: z.enum(["shot", "chance", "setPiece", "dribble", "defense", "other"]),
    confidence: z.number().min(0).max(1),
    title: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    tags: z.array(z.string()).optional().nullable(),
    coachTips: z.array(z.string()).optional().nullable(),
  })
);

type BatchLabelResult = z.infer<typeof BatchLabelSchema>;

export type BatchLabelClipInput = LabelClipInput & {
  clipId: string;
};

export interface BatchLabelingResult {
  results: Map<string, { result: LabelResult; rawResponse: string }>;
  failed: string[];
  batchSize: number;
}

/**
 * Get the batch size for labeling from environment variable
 * Default is 5 clips per batch (balances API efficiency and error handling)
 */
export function getLabelBatchSize(): number {
  const envSize = process.env.LABEL_BATCH_SIZE;
  const size = envSize ? parseInt(envSize, 10) : 5;
  return Math.max(1, Math.min(size, 15)); // Clamp between 1-15
}

/**
 * Phase 3.4: Label multiple clips in a single Gemini API call
 *
 * Benefits:
 * - Reduces API call overhead by ~80% (5 clips in 1 request vs 5 requests)
 * - Saves ~33% on token costs due to shared prompt overhead
 * - 5x faster execution due to reduced network round trips
 *
 * @param clips - Array of clips to label (recommended: 5-10 clips)
 * @param matchId - Match ID for cost tracking
 * @returns Map of clipId to label results, plus list of failed clipIds
 */
export async function labelClipBatchWithGemini(
  clips: BatchLabelClipInput[],
  matchId: string
): Promise<BatchLabelingResult> {
  if (clips.length === 0) {
    return { results: new Map(), failed: [], batchSize: 0 };
  }

  // If batch size is 1, use regular function
  if (clips.length === 1) {
    try {
      const result = await labelClipWithGemini({ ...clips[0], matchId });
      const results = new Map<string, { result: LabelResult; rawResponse: string }>();
      results.set(clips[0].clipId, { result: result.result, rawResponse: result.rawResponse });
      return { results, failed: [], batchSize: 1 };
    } catch (error) {
      logger.warn("Single clip labeling failed in batch context", {
        clipId: clips[0].clipId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { results: new Map(), failed: [clips[0].clipId], batchSize: 1 };
    }
  }

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  const prompt = await loadPrompt();

  // Phase 3: Try to use context cache for the full video
  const cache = await getValidCacheOrFallback(matchId, "label_clips_batch");
  const useCache = cache?.cacheId && cache.version !== "fallback";

  // Phase 3: If cache is available, use cached full video with batch timestamp hints
  if (useCache && cache) {
    logger.info("Starting batch clip labeling with context cache", {
      matchId,
      batchSize: clips.length,
      cacheId: cache.cacheId,
    });

    // Build batch prompt for cached video with timestamp ranges
    const clipsInfo = clips.map((clip) => ({
      clipId: clip.clipId,
      startSec: clip.t0.toFixed(2),
      endSec: clip.t1.toFixed(2),
    }));

    const promptText = [
      `Task: ${prompt.task}`,
      "",
      `You will analyze ${clips.length} clips from the video. For each clip, provide analysis in JSON format.`,
      "",
      "Return a JSON array with one object per clip. Each object must include:",
      `- clipId: (string) the clip identifier`,
      `- label: ${JSON.stringify(prompt.output_schema.label)}`,
      `- confidence: (number 0-1) your confidence in the label`,
      `- title: (string, optional) brief title for the clip`,
      `- summary: (string, optional) description of what happens`,
      `- tags: (array of strings, optional) relevant tags`,
      `- coachTips: (array of strings, optional) coaching tips`,
      "",
      "## Clips to Analyze (by timestamp range)",
      ...clipsInfo.map((c) => `- ${c.clipId}: from ${c.startSec}s to ${c.endSec}s`),
      "",
      "IMPORTANT: For each clip, focus ONLY on the video segment within its specified time range.",
      "",
      "Return JSON array only. No explanation or markdown.",
    ].join("\n");

    try {
      const response = await callGeminiWithCacheRetry(projectId, modelId, cache.cacheId, promptText, matchId);
      const parsed = parseBatchLabels(response, clips);

      if (parsed.ok) {
        const results = new Map<string, { result: LabelResult; rawResponse: string }>();
        const failed: string[] = [];

        for (const clip of clips) {
          const labelResult = parsed.data.find((r) => r.clipId === clip.clipId);
          if (labelResult) {
            const { clipId, ...rest } = labelResult;
            results.set(clip.clipId, { result: rest as LabelResult, rawResponse: response });
          } else {
            failed.push(clip.clipId);
          }
        }

        // Update cache usage
        await getCacheManager().updateCacheUsage(matchId);

        logger.info("Batch clip labeling with cache completed", {
          matchId,
          successful: results.size,
          failed: failed.length,
        });

        return { results, failed, batchSize: clips.length };
      }

      logger.warn("Batch label parsing failed with cache, marking all clips as failed", {
        matchId,
        error: parsed.error,
      });
      return {
        results: new Map(),
        failed: clips.map((c) => c.clipId),
        batchSize: clips.length,
      };
    } catch (error) {
      logger.error("Batch clip labeling with cache failed", {
        matchId,
        batchSize: clips.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        results: new Map(),
        failed: clips.map((c) => c.clipId),
        batchSize: clips.length,
      };
    }
  }

  // Fallback: Use individual clip files or thumbnails (no cache available)
  const useVideoForLabeling = process.env.USE_VIDEO_FOR_LABELING === "true";
  const storageBucket = process.env.STORAGE_BUCKET;

  // Build batch prompt with all clips
  const parts: Gemini3Part[] = [];

  // Add task instruction first
  parts.push({
    text: [
      `Task: ${prompt.task}`,
      "",
      `You will analyze ${clips.length} clips. For each clip, provide analysis in JSON format.`,
      "",
      "Return a JSON array with one object per clip. Each object must include:",
      `- clipId: (string) the clip identifier`,
      `- label: ${JSON.stringify(prompt.output_schema.label)}`,
      `- confidence: (number 0-1) your confidence in the label`,
      `- title: (string, optional) brief title for the clip`,
      `- summary: (string, optional) description of what happens`,
      `- tags: (array of strings, optional) relevant tags`,
      `- coachTips: (array of strings, optional) coaching tips`,
      "",
      "Clips to analyze:",
    ].join("\n"),
  });

  // Add each clip's info and media
  for (const clip of clips) {
    // Add clip identifier text
    parts.push({
      text: `\n--- Clip: ${clip.clipId} (t0=${clip.t0.toFixed(2)}s, t1=${clip.t1.toFixed(2)}s) ---`,
    });

    // Add video or thumbnail
    if (useVideoForLabeling && clip.clipPath && storageBucket) {
      const clipUri = clip.clipPath.startsWith("gs://")
        ? clip.clipPath
        : `gs://${storageBucket}/${clip.clipPath}`;

      parts.push({
        fileData: {
          fileUri: clipUri,
          mimeType: "video/mp4",
        },
      });
    } else if (clip.thumbPath) {
      try {
        const localThumb = await downloadToTmp(clip.thumbPath, path.basename(clip.thumbPath));
        const imageBytes = await readFile(localThumb);
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBytes.toString("base64"),
          },
        });
      } catch (error) {
        logger.warn("Failed to load thumbnail for batch", {
          clipId: clip.clipId,
          thumbPath: clip.thumbPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Add final instruction
  parts.push({
    text: "\n\nReturn JSON array only. No explanation or markdown.",
  });

  logger.info("Starting batch clip labeling (no cache)", {
    matchId,
    batchSize: clips.length,
    clipIds: clips.map((c) => c.clipId),
  });

  try {
    const response = await callGeminiWithRetry(projectId, modelId, parts, matchId);
    const parsed = parseBatchLabels(response, clips);

    if (parsed.ok) {
      const results = new Map<string, { result: LabelResult; rawResponse: string }>();
      const failed: string[] = [];

      for (const clip of clips) {
        const labelResult = parsed.data.find((r) => r.clipId === clip.clipId);
        if (labelResult) {
          const { clipId, ...rest } = labelResult;
          results.set(clip.clipId, { result: rest as LabelResult, rawResponse: response });
        } else {
          failed.push(clip.clipId);
        }
      }

      logger.info("Batch clip labeling completed", {
        matchId,
        successful: results.size,
        failed: failed.length,
      });

      return { results, failed, batchSize: clips.length };
    }

    // If batch parsing failed, return all clips as failed
    logger.warn("Batch label parsing failed, marking all clips as failed", {
      matchId,
      error: parsed.error,
    });
    return {
      results: new Map(),
      failed: clips.map((c) => c.clipId),
      batchSize: clips.length,
    };
  } catch (error) {
    logger.error("Batch clip labeling failed", {
      matchId,
      batchSize: clips.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      results: new Map(),
      failed: clips.map((c) => c.clipId),
      batchSize: clips.length,
    };
  }
}

/**
 * Parse batch labeling response
 * Handles array format: [{ clipId, label, confidence, ... }, ...]
 */
function parseBatchLabels(
  text: string,
  clips: BatchLabelClipInput[]
): { ok: true; data: BatchLabelResult } | { ok: false; error: string } {
  try {
    const extracted = extractJson(text);
    const json = JSON.parse(extracted);

    // Handle both array and object formats
    let array: unknown[];
    if (Array.isArray(json)) {
      array = json;
    } else if (json.results && Array.isArray(json.results)) {
      array = json.results;
    } else {
      // Try to map object keys to clipIds
      const entries = Object.entries(json);
      if (entries.length === clips.length) {
        array = entries.map(([key, value]) => ({
          clipId: key,
          ...(value as object),
        }));
      } else {
        return { ok: false, error: "Response is not an array or results object" };
      }
    }

    // Ensure all items have clipId
    const withClipIds = array.map((item, idx) => {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (!obj.clipId && clips[idx]) {
          return { ...obj, clipId: clips[idx].clipId };
        }
        return obj;
      }
      return item;
    });

    const parsed = BatchLabelSchema.parse(withClipIds);
    return { ok: true, data: parsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
