/**
 * Step 11: Generate Match Summary with Gemini
 *
 * タクティカル分析結果とイベントデータを基に、
 * 試合のナラティブサマリーを生成
 *
 * 処理フロー:
 * 1. タクティカル分析結果の取得
 * 2. イベント統計の集計
 * 3. Gemini によるサマリー生成
 * 4. MatchSummaryDoc の保存
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type { MatchSummaryDoc, TacticalAnalysisDoc, KeyMoment, PlayerHighlight } from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";

// Phase 2.6: 環境変数対応でプロンプトバージョン管理を統一
const SUMMARY_VERSION = process.env.SUMMARY_PROMPT_VERSION || "v1";

const KeyMomentSchema = z.object({
  timestamp: z.number(),
  description: z.string(),
  importance: z.number(),
  type: z.enum(["goal", "chance", "save", "foul", "substitution", "tactical_change", "other"]).optional(),
});

const PlayerHighlightSchema = z.object({
  player: z.string(),
  jerseyNumber: z.number().optional(),
  team: z.enum(["home", "away"]),
  achievement: z.string(),
  metric: z.object({
    name: z.string(),
    value: z.union([z.number(), z.string()]),
  }).optional(),
});

const SummaryResponseSchema = z.object({
  headline: z.string(),
  narrative: z.object({
    firstHalf: z.string(),
    secondHalf: z.string(),
    overall: z.string().optional(),
  }),
  keyMoments: z.array(KeyMomentSchema),
  playerHighlights: z.array(PlayerHighlightSchema),
  score: z.object({
    home: z.number(),
    away: z.number(),
  }).optional(),
  mvp: PlayerHighlightSchema.optional(),
});

type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export type GenerateMatchSummaryOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type GenerateMatchSummaryResult = {
  matchId: string;
  generated: boolean;
  skipped: boolean;
  error?: string;
};

let cachedPrompt: { task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", "match_summary_" + SUMMARY_VERSION + ".json");
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
}

export async function stepGenerateMatchSummary(
  options: GenerateMatchSummaryOptions
): Promise<GenerateMatchSummaryResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "generate_match_summary" }) : log;

  stepLogger.info("Starting match summary generation", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing summary
  const existingDoc = await matchRef.collection("summary").doc("current").get();
  if (existingDoc.exists && existingDoc.data()?.version === version) {
    stepLogger.info("Match summary already exists for this version", { matchId, version });
    return { matchId, generated: false, skipped: true };
  }

  // Get cache info (with fallback to direct file URI)
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, "generate_match_summary");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot generate match summary", { matchId });
    return {
      matchId,
      generated: false,
      skipped: true,
      error: "No video file URI available",
    };
  }

  stepLogger.info("Using video for match summary", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
  });

  // Get tactical analysis for context
  const tacticalSnap = await matchRef.collection("tactical").doc("current").get();
  const tacticalAnalysis = tacticalSnap.exists
    ? (tacticalSnap.data() as TacticalAnalysisDoc)
    : null;

  // Get event statistics (use correct collection names with version filter)
  const [shotEventsSnap, passesSnap, turnoversSnap, clipsSnap] = await Promise.all([
    matchRef.collection("shotEvents").where("version", "==", version).get(),
    matchRef.collection("passEvents").where("version", "==", version).get(),
    matchRef.collection("turnoverEvents").where("version", "==", version).get(),
    matchRef.collection("clips").where("version", "==", version).get(),
  ]);

  const eventStats = {
    totalShots: shotEventsSnap.size,
    totalPasses: passesSnap.size,
    totalTurnovers: turnoversSnap.size,
  };

  // Build clips array for timestamp matching
  const clips = clipsSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      clipId: doc.id,
      t0: data.t0 as number,
      t1: data.t1 as number,
    };
  });

  const prompt = await loadPrompt();
  const result = await generateSummaryWithGemini(cache, prompt, tacticalAnalysis, eventStats, matchId, stepLogger);

  // Match keyMoments to clips by timestamp
  const TIMESTAMP_TOLERANCE = 5; // seconds
  const findClipByTimestamp = (timestamp: number): string | null => {
    if (timestamp <= 0 || clips.length === 0) return null;
    // Find clip whose t0-t1 range contains the timestamp (with tolerance)
    const matchingClip = clips.find(
      (c) => timestamp >= c.t0 - TIMESTAMP_TOLERANCE && timestamp <= c.t1 + TIMESTAMP_TOLERANCE
    );
    return matchingClip?.clipId ?? null;
  };

  // Enhance keyMoments with clipId for video navigation
  const enhancedKeyMoments: KeyMoment[] = result.keyMoments.map((moment) => ({
    ...moment,
    type: moment.type as KeyMoment["type"],
    clipId: findClipByTimestamp(moment.timestamp),
  }));

  stepLogger.info("Matched keyMoments to clips", {
    matchId,
    totalMoments: enhancedKeyMoments.length,
    matchedMoments: enhancedKeyMoments.filter((m) => m.clipId).length,
  });

  // Save match summary
  const summaryDoc: MatchSummaryDoc = {
    matchId,
    version,
    headline: result.headline,
    narrative: result.narrative,
    keyMoments: enhancedKeyMoments,
    playerHighlights: result.playerHighlights as PlayerHighlight[],
    score: result.score,
    mvp: result.mvp ? {
      player: result.mvp.player,
      jerseyNumber: result.mvp.jerseyNumber,
      team: result.mvp.team,
      achievement: result.mvp.achievement,
      metric: result.mvp.metric,
    } : undefined,
    createdAt: new Date().toISOString(),
  };

  await matchRef.collection("summary").doc("current").set(summaryDoc);
  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Match summary generation complete", {
    matchId,
    headline: result.headline,
    keyMomentsCount: result.keyMoments.length,
    playerHighlightsCount: result.playerHighlights.length,
  });

  return { matchId, generated: true, skipped: false };
}

async function generateSummaryWithGemini(
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  tacticalAnalysis: TacticalAnalysisDoc | null,
  eventStats: { totalShots: number; totalPasses: number; totalTurnovers: number },
  matchId: string,
  log: ILogger
): Promise<SummaryResponse> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  const contextInfo = [
    "## 戦術分析データ（参考）",
    tacticalAnalysis ? JSON.stringify({
      formation: tacticalAnalysis.formation,
      tempo: tacticalAnalysis.tempo,
      attackPatterns: tacticalAnalysis.attackPatterns,
      defensivePatterns: tacticalAnalysis.defensivePatterns,
      keyInsights: tacticalAnalysis.keyInsights,
    }, null, 2) : "戦術分析データなし",
    "",
    "## イベント統計",
    "- シュート数: " + eventStats.totalShots,
    "- パス数: " + eventStats.totalPasses,
    "- ターンオーバー数: " + eventStats.totalTurnovers,
  ].join("\n");

  const promptText = [
    prompt.instructions,
    "",
    contextInfo,
    "",
    "## 出力形式 (JSON)",
    JSON.stringify(prompt.output_schema, null, 2),
    "",
    "Task: " + prompt.task,
    "",
    "Return JSON only.",
  ].join("\n");

  // Phase 3: Use context caching for cost reduction
  const useCache = cache.cacheId && cache.version !== "fallback";
  const generationConfig = {
    // Phase 2.4: サマリー生成は創造的な表現のため高めのTemperatureを維持
    temperature: 0.4,
    topP: 0.95,
    topK: 40,
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
          { matchId, step: "generate_match_summary" }
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
        response = await callGeminiApi(projectId, modelId, request, { matchId, step: "generate_match_summary" });
      }

      const text = extractTextFromResponse(response);

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = JSON.parse(text);
      return SummaryResponseSchema.parse(parsed);
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 300000, // 5 minutes
      onRetry: (attempt, error) => {
        log.warn("Retrying match summary generation", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
