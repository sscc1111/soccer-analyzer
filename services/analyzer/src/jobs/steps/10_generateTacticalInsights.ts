/**
 * Step 10: Generate Tactical Insights (Gemini-first Architecture)
 *
 * Gemini を使用して戦術的な分析を生成
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type { TacticalAnalysisDoc, GameFormat, PassEventDoc, ShotEventDoc, TurnoverEventDoc } from "@soccer/shared";
import { GAME_FORMAT_INFO, FORMATIONS_BY_FORMAT } from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";
import {
  trackFormationChanges,
  analyzeFormationByHalf,
  analyzeFormationByPhase,
  type FormationTimeline,
  type FormationHalfComparison,
  type FormationByPhase,
  type MatchEvent as FormationMatchEvent,
} from "../../lib/formationTracking";
import {
  analyzeTeamTacticalPatterns,
  generateTacticalSummary,
  type TeamTacticalPatterns,
} from "../../lib/tacticalPatterns";

// Phase 2.6: 環境変数対応でプロンプトバージョン管理を統一
const TACTICAL_VERSION = process.env.TACTICAL_PROMPT_VERSION || "v1";

// Phase 2.9: optionalを削除してGeminiに必須項目として返させる
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
  // Phase 2.9: 必須フィールドに変更（0-100スケール）
  pressingIntensity: z.object({
    home: z.number().min(0).max(100),
    away: z.number().min(0).max(100),
  }),
  // Phase 2.9: 必須フィールドに変更
  buildUpStyle: z.object({
    home: z.enum(["short", "long", "mixed"]),
    away: z.enum(["short", "long", "mixed"]),
  }),
});

type TacticalResponse = z.infer<typeof TacticalResponseSchema>;

export type GenerateTacticalInsightsOptions = {
  matchId: string;
  videoId?: string;
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
  const promptPath = path.join(__dirname, "prompts", "tactical_analysis_" + TACTICAL_VERSION + ".json");
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
}

export async function stepGenerateTacticalInsights(
  options: GenerateTacticalInsightsOptions
): Promise<GenerateTacticalInsightsResult> {
  const { matchId, videoId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "generate_tactical_insights" }) : log;

  stepLogger.info("Starting tactical analysis", { matchId, videoId, version });

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
  const cache = await getValidCacheOrFallback(matchId, options.videoId, "generate_tactical_insights");

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

  // Convert events to FormationMatchEvent format for formation tracking
  const allEvents: FormationMatchEvent[] = [
    ...passEventsSnap.docs.map((d) => {
      const data = d.data();
      return {
        timestamp: data.timestamp ?? 0,
        type: "pass",
        metadata: { team: data.team },
      };
    }),
    ...shotEventsSnap.docs.map((d) => {
      const data = d.data();
      return {
        timestamp: data.timestamp ?? 0,
        type: "shot",
        metadata: { team: data.team },
      };
    }),
    ...turnoverEventsSnap.docs.map((d) => {
      const data = d.data();
      return {
        timestamp: data.timestamp ?? 0,
        type: data.turnoverType === "won" ? "tackle" : "turnover",
        metadata: { team: data.team },
      };
    }),
  ];

  // Track formation changes over time (5-minute intervals)
  let formationTimeline: FormationTimeline | null = null;
  let formationByHalf: FormationHalfComparison | null = null;
  let formationByPhase: FormationByPhase | null = null;

  if (allEvents.length > 0) {
    // Overall formation tracking
    formationTimeline = trackFormationChanges(allEvents, undefined, 300);
    stepLogger.info("Formation tracking complete", {
      matchId,
      statesCount: formationTimeline.states.length,
      changesCount: formationTimeline.changes.length,
      dominantFormation: formationTimeline.dominantFormation,
      variability: formationTimeline.formationVariability.toFixed(2),
    });

    // Half-by-half formation analysis
    formationByHalf = analyzeFormationByHalf(allEvents, 45, undefined, 300);
    stepLogger.info("Half-by-half formation analysis complete", {
      matchId,
      firstHalfDominant: formationByHalf.comparison.firstHalfDominant,
      secondHalfDominant: formationByHalf.comparison.secondHalfDominant,
      formationChanged: formationByHalf.comparison.formationChanged,
      variabilityChange: formationByHalf.comparison.variabilityChange.toFixed(2),
      firstHalfChanges: formationByHalf.firstHalf.changes.length,
      secondHalfChanges: formationByHalf.secondHalf.changes.length,
    });

    // Phase-by-phase formation analysis (attacking/defending/transition)
    formationByPhase = analyzeFormationByPhase(allEvents, undefined, 300);
    stepLogger.info("Phase-by-phase formation analysis complete", {
      matchId,
      attackingDominant: formationByPhase.comparison.attackingDominant,
      defendingDominant: formationByPhase.comparison.defendingDominant,
      transitionDominant: formationByPhase.comparison.transitionDominant,
      hasPhaseVariation: formationByPhase.comparison.hasPhaseVariation,
      phaseAdaptability: formationByPhase.comparison.phaseAdaptability.toFixed(2),
      attackingStates: formationByPhase.attacking.states.length,
      defendingStates: formationByPhase.defending.states.length,
      transitionStates: formationByPhase.transition.states.length,
    });
  }

  // Phase 6.2: Position-based tactical pattern detection
  let homeTacticalPatterns: TeamTacticalPatterns | null = null;
  let awayTacticalPatterns: TeamTacticalPatterns | null = null;

  // Convert Firestore documents to typed event arrays
  const passEventDocs = passEventsSnap.docs.map((d) => d.data() as PassEventDoc);
  const shotEventDocs = shotEventsSnap.docs.map((d) => d.data() as ShotEventDoc);
  const turnoverEventDocs = turnoverEventsSnap.docs.map((d) => d.data() as TurnoverEventDoc);

  if (passEventDocs.length > 0 || shotEventDocs.length > 0 || turnoverEventDocs.length > 0) {
    // Analyze home team tactical patterns
    homeTacticalPatterns = analyzeTeamTacticalPatterns(
      "home",
      passEventDocs,
      shotEventDocs,
      turnoverEventDocs
    );

    // Analyze away team tactical patterns
    awayTacticalPatterns = analyzeTeamTacticalPatterns(
      "away",
      passEventDocs,
      shotEventDocs,
      turnoverEventDocs
    );

    stepLogger.info("Tactical pattern analysis complete", {
      matchId,
      home: {
        dominantPattern: homeTacticalPatterns.attack.dominantPattern,
        buildUpSpeed: homeTacticalPatterns.attack.buildUpSpeed,
        pressHeight: homeTacticalPatterns.defense.pressHeight,
        pressIntensity: homeTacticalPatterns.defense.pressIntensity,
        counterAttacks: homeTacticalPatterns.attack.counterAttacks.length,
      },
      away: {
        dominantPattern: awayTacticalPatterns.attack.dominantPattern,
        buildUpSpeed: awayTacticalPatterns.attack.buildUpSpeed,
        pressHeight: awayTacticalPatterns.defense.pressHeight,
        pressIntensity: awayTacticalPatterns.defense.pressIntensity,
        counterAttacks: awayTacticalPatterns.attack.counterAttacks.length,
      },
    });

    // Generate tactical summaries
    const homeSummary = generateTacticalSummary(homeTacticalPatterns, "ホーム");
    const awaySummary = generateTacticalSummary(awayTacticalPatterns, "アウェイ");

    stepLogger.info("Tactical summaries generated", {
      matchId,
      homeSummary,
      awaySummary,
    });
  }

  const prompt = await loadPrompt();
  const result = await generateTacticalWithGemini(
    cache,
    prompt,
    gameFormat,
    eventStats,
    formationByHalf,
    formationByPhase,
    matchId,
    stepLogger
  );

  // Save tactical analysis with formation timeline and half-by-half analysis
  const tacticalDoc: TacticalAnalysisDoc = {
    matchId,
    videoId,
    version,
    formation: result.formation,
    tempo: result.tempo,
    attackPatterns: result.attackPatterns,
    defensivePatterns: result.defensivePatterns,
    keyInsights: result.keyInsights,
    pressingIntensity: result.pressingIntensity,
    buildUpStyle: result.buildUpStyle,
    createdAt: new Date().toISOString(),
    // Add formation timeline from event-based tracking
    ...(formationTimeline && {
      formationTimeline: {
        states: formationTimeline.states,
        changes: formationTimeline.changes,
        dominantFormation: formationTimeline.dominantFormation,
        formationVariability: formationTimeline.formationVariability,
      },
    }),
    // Add half-by-half formation analysis
    ...(formationByHalf && {
      formationByHalf: {
        firstHalf: formationByHalf.firstHalf,
        secondHalf: formationByHalf.secondHalf,
        comparison: formationByHalf.comparison,
      },
    }),
    // Add phase-based formation analysis (attacking/defending/transition)
    ...(formationByPhase && {
      formationByPhase: {
        attacking: formationByPhase.attacking,
        defending: formationByPhase.defending,
        transition: formationByPhase.transition,
        setPiece: formationByPhase.setPiece,
        comparison: formationByPhase.comparison,
      },
    }),
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
  formationByHalf: FormationHalfComparison | null,
  formationByPhase: FormationByPhase | null,
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

  // Build formation by half context
  let formationByHalfContext = "";
  if (formationByHalf) {
    const { firstHalf, secondHalf, comparison } = formationByHalf;

    formationByHalfContext = [
      "\n## ハーフごとのフォーメーション分析",
      "### 前半",
      `- 支配的フォーメーション: ${comparison.firstHalfDominant}`,
      `- フォーメーション変更: ${firstHalf.changes.length}回`,
      `- 変動性スコア: ${firstHalf.formationVariability.toFixed(2)} (0=安定, 1=頻繁に変更)`,
      "",
      "### 後半",
      `- 支配的フォーメーション: ${comparison.secondHalfDominant}`,
      `- フォーメーション変更: ${secondHalf.changes.length}回`,
      `- 変動性スコア: ${secondHalf.formationVariability.toFixed(2)}`,
      "",
      "### ハーフタイムの変化",
      `- フォーメーション変更: ${comparison.formationChanged ? 'あり' : 'なし'}`,
      comparison.formationChanged
        ? `  → ${comparison.firstHalfDominant} から ${comparison.secondHalfDominant} に変更`
        : `  → ${comparison.firstHalfDominant} を継続`,
      `- 戦術的柔軟性の変化: ${comparison.variabilityChange > 0 ? '増加' : comparison.variabilityChange < 0 ? '減少' : '変化なし'} (${comparison.variabilityChange >= 0 ? '+' : ''}${comparison.variabilityChange.toFixed(2)})`,
      "",
      "注: この情報を戦術分析の keyInsights に含めてください。特にハーフタイムでの戦術変更があった場合は重要な洞察として記述してください。",
    ].join("\n");
  }

  // Build formation by phase context (attacking/defending/transition)
  let formationByPhaseContext = "";
  if (formationByPhase) {
    const { attacking, defending, transition, comparison } = formationByPhase;

    formationByPhaseContext = [
      "\n## フェーズ別フォーメーション分析（攻守の配置）",
      "### 攻撃時のフォーメーション",
      `- 支配的フォーメーション: ${comparison.attackingDominant}`,
      `- 攻撃時の状態数: ${attacking.states.length}`,
      `- フォーメーション変更: ${attacking.changes.length}回`,
      `- 変動性スコア: ${attacking.formationVariability.toFixed(2)} (0=安定, 1=柔軟に変化)`,
      "",
      "### 守備時のフォーメーション",
      `- 支配的フォーメーション: ${comparison.defendingDominant}`,
      `- 守備時の状態数: ${defending.states.length}`,
      `- フォーメーション変更: ${defending.changes.length}回`,
      `- 変動性スコア: ${defending.formationVariability.toFixed(2)}`,
      "",
      "### トランジション時のフォーメーション",
      `- 支配的フォーメーション: ${comparison.transitionDominant}`,
      `- トランジション時の状態数: ${transition.states.length}`,
      `- フォーメーション変更: ${transition.changes.length}回`,
      `- 変動性スコア: ${transition.formationVariability.toFixed(2)}`,
      "",
      "### 攻守の切り替え分析",
      `- 攻守でフォーメーションが変化: ${comparison.hasPhaseVariation ? 'あり' : 'なし'}`,
      comparison.hasPhaseVariation
        ? `  → 攻撃時 ${comparison.attackingDominant} / 守備時 ${comparison.defendingDominant}`
        : `  → 攻守ともに ${comparison.attackingDominant} を維持`,
      `- フェーズ適応力スコア: ${comparison.phaseAdaptability.toFixed(2)} (0=固定的, 1=高い柔軟性)`,
      "",
      "### 戦術的特徴の解釈",
      comparison.hasPhaseVariation
        ? "- このチームは攻撃時と守備時で明確にフォーメーションを変化させる柔軟な戦術を採用しています"
        : "- このチームは攻守ともに一貫したフォーメーションを維持する安定した戦術を採用しています",
      comparison.phaseAdaptability > 0.6
        ? "- 高いフェーズ適応力を示しており、試合状況に応じて柔軟に配置を変更しています"
        : comparison.phaseAdaptability > 0.3
        ? "- 中程度のフェーズ適応力を示しており、基本的な戦術を維持しつつ部分的に調整しています"
        : "- 低いフェーズ適応力を示しており、一貫した配置を維持する堅実な戦術です",
      "",
      "注: この攻守別の配置分析を keyInsights に反映してください。特に攻守でフォーメーションが変化する場合は、その戦術的意図（例: 攻撃時のワイド展開、守備時のコンパクト化）を具体的に記述してください。",
    ].join("\n");
  }

  const promptText = [
    prompt.instructions,
    formatContext,
    eventStatsContext,
    formationByHalfContext,
    formationByPhaseContext,
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

  // Calculate dynamic maxOutputTokens based on video duration
  const videoDurationSec = cache.videoDurationSec || 600; // Default 10 minutes
  const baseTokens = 12288;
  const tokensPerMinute = 800;
  const maxOutputTokens = Math.min(
    32768,
    baseTokens + Math.ceil((videoDurationSec / 60) * tokensPerMinute)
  );

  const generationConfig = {
    // Phase 2.4: 分析タスクは高めのTemperatureで創造的な洞察
    temperature: 0.4,
    topP: 0.95,
    topK: 40,
    maxOutputTokens,
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
      const validated = TacticalResponseSchema.parse(parsed);

      // Phase 2.9: フォーメーション検証（gameFormat に合った形式か確認）
      const validateFormation = (formation: string, validOptions: string[]): string => {
        // 完全一致
        if (validOptions.includes(formation)) {
          return formation;
        }
        // 部分一致を試みる（例: "4-3-3" が "eleven" 以外で使われた場合）
        const normalized = formation.trim();
        const match = validOptions.find(v => v === normalized);
        if (match) return match;

        // マッチしない場合は警告ログを出し、最初の有効なフォーメーションを返す
        log.warn("Formation not valid for game format, using default", {
          matchId,
          formation,
          gameFormat,
          validOptions,
          usingDefault: validOptions[0],
        });
        return validOptions[0] || formation;
      };

      // Phase 2.9: テンポ計算のフォールバック（0の場合はイベント統計から推定）
      const calculateTempoFallback = (team: "home" | "away"): number => {
        const passes = eventStats[team].passes;
        // 動画長が不明なので、パス数に基づく簡易推定（1分あたり10パスを基準）
        // 8人制は少し高めのテンポ（11人制より狭いピッチ）
        const baseTempo = gameFormat === "eight" ? 12 : gameFormat === "five" ? 18 : 10;
        if (passes === 0) return baseTempo;

        // パス数が多ければテンポ高め、少なければ低め（10〜20の範囲）
        const normalizedPasses = Math.min(passes, 100);
        return Math.max(5, Math.min(25, baseTempo + (normalizedPasses - 50) / 10));
      };

      return {
        ...validated,
        formation: {
          home: validateFormation(validated.formation.home, validFormations),
          away: validateFormation(validated.formation.away, validFormations),
        },
        tempo: {
          home: validated.tempo.home > 0 ? validated.tempo.home : calculateTempoFallback("home"),
          away: validated.tempo.away > 0 ? validated.tempo.away : calculateTempoFallback("away"),
        },
        // pressingIntensity と buildUpStyle は必須になったので、0チェックのみ
        pressingIntensity: {
          home: validated.pressingIntensity.home > 0 ? validated.pressingIntensity.home : 50,
          away: validated.pressingIntensity.away > 0 ? validated.pressingIntensity.away : 50,
        },
      };
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
