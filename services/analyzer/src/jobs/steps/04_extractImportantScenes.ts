/**
 * Step 04: Extract Important Scenes (Gemini-first Architecture)
 *
 * Gemini を使用して試合動画から重要シーンを抽出
 * Context Cache を活用して効率的に分析
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ImportantSceneDoc, SceneType, SceneTeam } from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";

// Prompt version for cache invalidation
const SCENE_EXTRACTION_VERSION = "v1";
const MAX_SCENES = 60; // gemini-2.5-flashはmaxOutputTokens 65536対応

// Response schema validation
const SceneSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  type: z.enum(["shot", "chance", "setPiece", "dribble", "defense", "turnover", "goal", "save", "other"]),
  importance: z.number().min(0).max(1),
  description: z.string(),
  team: z.enum(["home", "away", "unknown"]).optional().default("unknown"),
  confidence: z.number().min(0).max(1).optional(),
});

const ScenesResponseSchema = z.object({
  scenes: z.array(SceneSchema).max(MAX_SCENES),
});

type SceneResponse = z.infer<typeof ScenesResponseSchema>;

export type ExtractImportantScenesOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type ExtractImportantScenesResult = {
  matchId: string;
  sceneCount: number;
  skipped: boolean;
  error?: string;
};

// Cached prompt
let cachedPrompt: {
  task: string;
  extraction_criteria: string[];
  output_schema: Record<string, unknown>;
  constraints: { max_scenes: number; min_scene_duration_sec: number; max_scene_duration_sec: number };
} | null = null;

/**
 * Load scene extraction prompt
 */
async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.join(__dirname, "prompts", "scene_extraction_" + SCENE_EXTRACTION_VERSION + ".json");
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
}

/**
 * Extract important scenes from match video using Gemini
 */
export async function stepExtractImportantScenes(
  options: ExtractImportantScenesOptions
): Promise<ExtractImportantScenesResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "extract_important_scenes" }) : log;

  stepLogger.info("Starting scene extraction", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing extraction with same version
  const existingScenesSnap = await matchRef
    .collection("importantScenes")
    .where("version", "==", version)
    .limit(1)
    .get();

  if (!existingScenesSnap.empty) {
    stepLogger.info("Scenes already extracted for this version", { matchId, version });
    return {
      matchId,
      sceneCount: existingScenesSnap.size,
      skipped: true,
    };
  }

  // Get cache info (with fallback to direct file URI)
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, "extract_important_scenes");

  if (!cache) {
    stepLogger.warn("No valid cache or file URI found, skipping scene extraction", { matchId });
    return {
      matchId,
      sceneCount: 0,
      skipped: true,
      error: "No video file URI available",
    };
  }

  stepLogger.info("Using video for scene extraction", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
  });

  // Load prompt
  const prompt = await loadPrompt();

  // Call Gemini with cached video
  const scenes = await extractScenesWithGemini(cache, prompt, matchId, stepLogger);

  if (scenes.length === 0) {
    stepLogger.warn("No scenes extracted", { matchId });
    return {
      matchId,
      sceneCount: 0,
      skipped: false,
      error: "No scenes found in video",
    };
  }

  // Save scenes to Firestore
  const batch = db.batch();
  const scenesCollection = matchRef.collection("importantScenes");

  for (const scene of scenes) {
    const sceneDoc: ImportantSceneDoc = {
      sceneId: matchId + "_" + scene.startSec.toFixed(1),
      matchId,
      startSec: scene.startSec,
      endSec: scene.endSec,
      type: scene.type as SceneType,
      importance: scene.importance,
      description: scene.description,
      team: (scene.team || "unknown") as SceneTeam,
      confidence: scene.confidence,
      version,
      createdAt: new Date().toISOString(),
    };

    const docRef = scenesCollection.doc(sceneDoc.sceneId);
    batch.set(docRef, sceneDoc);
  }

  await batch.commit();

  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Scene extraction complete", {
    matchId,
    sceneCount: scenes.length,
    topScenes: scenes.slice(0, 5).map((s) => ({ type: s.type, importance: s.importance })),
  });

  return {
    matchId,
    sceneCount: scenes.length,
    skipped: false,
  };
}

/**
 * Call Gemini API to extract scenes from cached video
 */
async function extractScenesWithGemini(
  cache: GeminiCacheDoc,
  prompt: {
    task: string;
    extraction_criteria: string[];
    output_schema: Record<string, unknown>;
    constraints: { max_scenes: number; min_scene_duration_sec: number; max_scene_duration_sec: number };
  },
  matchId: string,
  log: ILogger
): Promise<SceneResponse["scenes"]> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  const promptText = [
    `タスク: ${prompt.task}`,
    "",
    "## 抽出基準",
    ...prompt.extraction_criteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## 制約",
    `- 最大シーン数: ${prompt.constraints.max_scenes}`,
    `- 最小シーン長: ${prompt.constraints.min_scene_duration_sec}秒`,
    `- 最大シーン長: ${prompt.constraints.max_scene_duration_sec}秒`,
    "",
    "## 出力形式 (JSON)",
    JSON.stringify(prompt.output_schema, null, 2),
    "",
    "注意事項:",
    "- シーンは時系列順に出力してください",
    "- importanceは0.0-1.0で、1.0が最も重要",
    "- confidenceは検出確信度（0.0-1.0）",
    "- 重複するシーンは避けてください",
    "",
    "Return JSON only.",
  ].join("\n");

  // Phase 3: Use context caching for cost reduction
  const useCache = cache.cacheId && cache.version !== "fallback";

  log.info("calling Gemini for scene extraction", {
    cacheId: cache.cacheId,
    fileUri: cache.storageUri || cache.fileUri,
    model: modelId,
    useCache,
  });

  // 60シーン × 約200トークン/シーン = 最大約12000トークン + マージン
  // gemini-2.5-flashはmaxOutputTokens 65536対応
  const generationConfig = {
    temperature: 0.3,
    maxOutputTokens: 32768,
    responseMimeType: "application/json",
  };

  return withRetry(
    async () => {
      let response;

      if (useCache) {
        // Use cached content for ~84% cost savings
        response = await callGeminiApiWithCache(
          projectId,
          modelId,
          cache.cacheId,
          promptText,
          generationConfig,
          { matchId, step: "extract_important_scenes" }
        );
      } else {
        // Fallback to direct file URI when cache not available
        const request: Gemini3Request = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  fileData: {
                    fileUri: cache.storageUri || cache.fileUri || "",
                    mimeType: "video/mp4",
                  },
                },
                { text: promptText },
              ],
            },
          ],
          generationConfig,
        };
        response = await callGeminiApi(projectId, modelId, request, { matchId, step: "extract_important_scenes" });
      }

      const text = extractTextFromResponse(response);

      // Parse and validate response
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        log.error("Failed to parse Gemini JSON response", parseError, {
          responsePreview: text.substring(0, 200),
        });
        throw new Error(`Invalid JSON from Gemini: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }

      const validated = ScenesResponseSchema.parse(parsed);

      // Sort by importance descending
      validated.scenes.sort((a, b) => b.importance - a.importance);

      // Limit to MAX_SCENES
      return validated.scenes.slice(0, MAX_SCENES);
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 300000, // 5 minutes for video analysis
      onRetry: (attempt, error) => {
        log.warn("Retrying scene extraction", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}

/**
 * Get scenes for a match (for use by subsequent steps)
 */
export async function getMatchScenes(matchId: string): Promise<ImportantSceneDoc[]> {
  const db = getDb();
  const scenesSnap = await db
    .collection("matches")
    .doc(matchId)
    .collection("importantScenes")
    .orderBy("importance", "desc")
    .get();

  return scenesSnap.docs.map((doc) => doc.data() as ImportantSceneDoc);
}
