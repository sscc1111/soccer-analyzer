/**
 * Step 10: Generate Tactical Insights (Gemini-first Architecture)
 *
 * Gemini を使用して戦術的な分析を生成
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type { TacticalAnalysisDoc, GameFormat } from "@soccer/shared";
import { GAME_FORMAT_INFO, FORMATIONS_BY_FORMAT } from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";

// Phase 2.6: 環境変数対応でプロンプトバージョン管理を統一
const TACTICAL_VERSION = process.env.TACTICAL_PROMPT_VERSION || "v1";

const TacticalResponseSchema = z.object({
  formation: z.object({
    home: z.string(),
    away: z.string(),
  }),
  tempo: z.object({
    home: z.number(),
    away: z.number(),
  }),
  attackPatterns: z.array(z.string()),
  defensivePatterns: z.array(z.string()),
  keyInsights: z.array(z.string()),
  pressingIntensity: z.object({
    home: z.number(),
    away: z.number(),
  }).optional(),
  buildUpStyle: z.object({
    home: z.enum(["short", "long", "mixed"]),
    away: z.enum(["short", "long", "mixed"]),
  }).optional(),
});

type TacticalResponse = z.infer<typeof TacticalResponseSchema>;

export type GenerateTacticalInsightsOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type GenerateTacticalInsightsResult = {
  matchId: string;
  generated: boolean;
  skipped: boolean;
  error?: string;
};

let cachedPrompt: { task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", "tactical_analysis_" + TACTICAL_VERSION + ".json");
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
}

export async function stepGenerateTacticalInsights(
  options: GenerateTacticalInsightsOptions
): Promise<GenerateTacticalInsightsResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "generate_tactical_insights" }) : log;

  stepLogger.info("Starting tactical analysis", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing analysis
  const existingDoc = await matchRef.collection("tactical").doc("current").get();
  if (existingDoc.exists && existingDoc.data()?.version === version) {
    stepLogger.info("Tactical analysis already exists for this version", { matchId, version });
    return { matchId, generated: false, skipped: true };
  }

  // Get game format from match settings
  const matchSnap = await matchRef.get();
  const matchData = matchSnap.data();
  const gameFormat: GameFormat = matchData?.settings?.gameFormat || "eleven";
  const validFormations = FORMATIONS_BY_FORMAT[gameFormat];

  // Get cache info (with fallback to direct file URI)
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, "generate_tactical_insights");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot generate tactical insights", { matchId });
    return {
      matchId,
      generated: false,
      skipped: true,
      error: "No video file URI available",
    };
  }

  stepLogger.info("Using video for tactical analysis", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
    gameFormat,
    validFormations,
  });

  // Phase 2.5: イベントデータを取得して戦術分析の精度を向上
  const [passEventsSnap, shotEventsSnap, turnoverEventsSnap] = await Promise.all([
    matchRef.collection("passEvents").where("version", "==", version).get(),
    matchRef.collection("shotEvents").where("version", "==", version).get(),
    matchRef.collection("turnoverEvents").where("version", "==", version).get(),
  ]);

  // チーム別のイベント統計を集計
  const eventStats = {
    home: {
      passes: passEventsSnap.docs.filter((d) => d.data().team === "home").length,
      passesComplete: passEventsSnap.docs.filter((d) => d.data().team === "home" && d.data().outcome === "complete").length,
      shots: shotEventsSnap.docs.filter((d) => d.data().team === "home").length,
      shotsOnTarget: shotEventsSnap.docs.filter((d) => d.data().team === "home" && ["goal", "saved"].includes(d.data().result)).length,
      // turnoverType: "won" | "lost" を使用（typeはイベントタイプで "turnover" 固定）
      turnoversWon: turnoverEventsSnap.docs.filter((d) => d.data().team === "home" && d.data().turnoverType === "won").length,
      turnoversLost: turnoverEventsSnap.docs.filter((d) => d.data().team === "home" && d.data().turnoverType === "lost").length,
    },
    away: {
      passes: passEventsSnap.docs.filter((d) => d.data().team === "away").length,
      passesComplete: passEventsSnap.docs.filter((d) => d.data().team === "away" && d.data().outcome === "complete").length,
      shots: shotEventsSnap.docs.filter((d) => d.data().team === "away").length,
      shotsOnTarget: shotEventsSnap.docs.filter((d) => d.data().team === "away" && ["goal", "saved"].includes(d.data().result)).length,
      turnoversWon: turnoverEventsSnap.docs.filter((d) => d.data().team === "away" && d.data().turnoverType === "won").length,
      turnoversLost: turnoverEventsSnap.docs.filter((d) => d.data().team === "away" && d.data().turnoverType === "lost").length,
    },
    total: {
      passes: passEventsSnap.size,
      shots: shotEventsSnap.size,
      turnovers: turnoverEventsSnap.size,
    },
  };

  stepLogger.info("Event statistics for tactical analysis", { matchId, eventStats: eventStats.total });

  const prompt = await loadPrompt();
  const result = await generateTacticalWithGemini(cache, prompt, gameFormat, eventStats, matchId, stepLogger);

  // Save tactical analysis
  const tacticalDoc: TacticalAnalysisDoc = {
    matchId,
    version,
    formation: result.formation,
    tempo: result.tempo,
    attackPatterns: result.attackPatterns,
    defensivePatterns: result.defensivePatterns,
    keyInsights: result.keyInsights,
    pressingIntensity: result.pressingIntensity,
    buildUpStyle: result.buildUpStyle,
    createdAt: new Date().toISOString(),
  };

  await matchRef.collection("tactical").doc("current").set(tacticalDoc);
  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Tactical analysis complete", {
    matchId,
    homeFormation: result.formation.home,
    awayFormation: result.formation.away,
    insightsCount: result.keyInsights.length,
  });

  return { matchId, generated: true, skipped: false };
}

// Phase 2.5: イベント統計の型定義
type EventStats = {
  home: { passes: number; passesComplete: number; shots: number; shotsOnTarget: number; turnoversWon: number; turnoversLost: number };
  away: { passes: number; passesComplete: number; shots: number; shotsOnTarget: number; turnoversWon: number; turnoversLost: number };
  total: { passes: number; shots: number; turnovers: number };
};

async function generateTacticalWithGemini(
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  gameFormat: GameFormat,
  eventStats: EventStats,
  matchId: string,
  log: ILogger
): Promise<TacticalResponse> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  // Get format-specific information
  const formatInfo = GAME_FORMAT_INFO[gameFormat];
  const validFormations = FORMATIONS_BY_FORMAT[gameFormat];

  // Build format context for the prompt
  const formatContext = [
    `\n## 試合フォーマット: ${formatInfo.labelJa}`,
    `- 各チームの選手数: ${formatInfo.players / 2}人（GK含む）`,
    `- フィールドプレイヤー: ${formatInfo.outfieldPlayers}人`,
    `- 有効なフォーメーション例: ${validFormations.join(", ")}`,
    `- 重要: ${formatInfo.labelJa}に適したフォーメーションを使用してください（11人制のフォーメーションは使用しないでください）`,
  ].join("\n");

  // Phase 2.5: イベント統計コンテキストを追加
  const homePassRate = eventStats.home.passes > 0
    ? Math.round((eventStats.home.passesComplete / eventStats.home.passes) * 100)
    : 0;
  const awayPassRate = eventStats.away.passes > 0
    ? Math.round((eventStats.away.passesComplete / eventStats.away.passes) * 100)
    : 0;

  const eventStatsContext = [
    "\n## 検出されたイベント統計（参考データ）",
    "### ホームチーム",
    `- パス: ${eventStats.home.passes}本 (成功率: ${homePassRate}%)`,
    `- シュート: ${eventStats.home.shots}本 (枠内: ${eventStats.home.shotsOnTarget}本)`,
    `- ターンオーバー: 獲得${eventStats.home.turnoversWon}回 / 喪失${eventStats.home.turnoversLost}回`,
    "### アウェイチーム",
    `- パス: ${eventStats.away.passes}本 (成功率: ${awayPassRate}%)`,
    `- シュート: ${eventStats.away.shots}本 (枠内: ${eventStats.away.shotsOnTarget}本)`,
    `- ターンオーバー: 獲得${eventStats.away.turnoversWon}回 / 喪失${eventStats.away.turnoversLost}回`,
    "",
    "注: これらの統計は動画分析で検出されたイベントに基づいています。戦術分析の参考にしてください。",
  ].join("\n");

  const promptText = [
    prompt.instructions,
    formatContext,
    eventStatsContext,
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
    // Phase 2.4: 分析タスクは高めのTemperatureで創造的な洞察
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
          { matchId, step: "generate_tactical_insights" }
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
        response = await callGeminiApi(projectId, modelId, request, { matchId, step: "generate_tactical_insights" });
      }

      const text = extractTextFromResponse(response);

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = JSON.parse(text);
      return TacticalResponseSchema.parse(parsed);
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 300000,
      onRetry: (attempt, error) => {
        log.warn("Retrying tactical analysis", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
