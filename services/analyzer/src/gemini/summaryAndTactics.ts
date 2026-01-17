/**
 * Summary and Tactics Client
 *
 * Call 2: Call 1の結果を使用してサマリー・戦術分析を生成
 * - tactical（戦術分析）
 * - summary（試合サマリー）
 *
 * このAPI呼び出しは動画なしでテキストのみで実行される
 */

import { promises as fs } from "fs";
import path from "path";
import { generateContent, type CostTrackingContext } from "./gemini3Client";
import {
  SummaryAndTacticsResponseSchema,
  type SummaryAndTacticsResponse,
  type EventStatsInput,
} from "./schemas";
import { parseJsonFromGemini } from "../lib/json";
import { withRetry } from "../lib/retry";
import { defaultLogger as logger } from "../lib/logger";
import { ValidationError, isRetryableError } from "../lib/errors";
import type { ComprehensiveAnalysisResponse } from "./schemas";

/**
 * Load summary and tactics prompt with examples and edge cases
 */
async function loadSummaryAndTacticsPrompt(): Promise<string> {
  const promptPath = path.join(__dirname, "prompts", "summary_and_tactics_v1.json");
  const promptContent = await fs.readFile(promptPath, "utf-8");
  const prompt = JSON.parse(promptContent);

  // Build examples section if available
  let examplesSection = "";
  if (prompt.examples && Array.isArray(prompt.examples) && prompt.examples.length > 0) {
    examplesSection = `

---

# 出力例

以下は各シナリオでの期待される出力例です。これらを参考に同様のフォーマットで出力してください。

${prompt.examples
  .map(
    (example: { scenario: string; output: unknown }, index: number) =>
      `## 例${index + 1}: ${example.scenario}

\`\`\`json
${JSON.stringify(example.output, null, 2)}
\`\`\``
  )
  .join("\n\n")}`;
  }

  // Build edge cases section if available
  let edgeCasesSection = "";
  if (prompt.edge_cases && Array.isArray(prompt.edge_cases)) {
    edgeCasesSection = `

---

# エッジケースの対処法

${prompt.edge_cases
  .map(
    (ec: { scenario: string; guidance: string }) =>
      `- **${ec.scenario}**: ${ec.guidance}`
  )
  .join("\n")}`;
  }

  // Build the full prompt text
  return `${prompt.task}

${prompt.instructions}${examplesSection}${edgeCasesSection}

---

出力は必ず以下のJSON形式で返してください:
${JSON.stringify(prompt.output_schema, null, 2)}`;
}

/**
 * Build input context from comprehensive analysis results
 */
function buildInputContext(
  analysisResult: ComprehensiveAnalysisResponse,
  eventStats: EventStatsInput,
  durationSec?: number
): string {
  // Calculate tempo (passes per minute)
  const activePlayDuration = analysisResult.segments
    .filter((s) => s.type === "active_play")
    .reduce((sum, s) => sum + (s.endSec - s.startSec), 0);

  const activePlayMinutes = activePlayDuration / 60;
  const homeTempo =
    activePlayMinutes > 0 ? +(eventStats.home.passes / activePlayMinutes).toFixed(1) : 0;
  const awayTempo =
    activePlayMinutes > 0 ? +(eventStats.away.passes / activePlayMinutes).toFixed(1) : 0;

  return `# 分析データ（Call 1の結果）

## メタデータ
- 動画時間: ${durationSec ? `${durationSec}秒` : "不明"}
- 動画品質: ${analysisResult.metadata.videoQuality}
- アクティブプレイ時間: ${Math.round(activePlayDuration)}秒

## チーム情報
- ホーム: ${analysisResult.teams.home.primaryColor}（攻撃方向: ${analysisResult.teams.home.attackingDirection || "不明"}）
- アウェイ: ${analysisResult.teams.away.primaryColor}（攻撃方向: ${analysisResult.teams.away.attackingDirection || "不明"}）

## イベント統計
### ホーム
- パス: ${eventStats.home.passes}回（成功: ${eventStats.home.passesComplete}回）
- シュート: ${eventStats.home.shots}回（枠内: ${eventStats.home.shotsOnTarget}回）
- ターンオーバー獲得: ${eventStats.home.turnoversWon}回
- ターンオーバー喪失: ${eventStats.home.turnoversLost}回

### アウェイ
- パス: ${eventStats.away.passes}回（成功: ${eventStats.away.passesComplete}回）
- シュート: ${eventStats.away.shots}回（枠内: ${eventStats.away.shotsOnTarget}回）
- ターンオーバー獲得: ${eventStats.away.turnoversWon}回
- ターンオーバー喪失: ${eventStats.away.turnoversLost}回

## 推定テンポ
- ホーム: ${homeTempo} パス/分
- アウェイ: ${awayTempo} パス/分

## セグメント概要
${summarizeSegments(analysisResult.segments)}

## 重要シーン
${summarizeScenes(analysisResult.scenes)}

## 検出イベント
${summarizeEvents(analysisResult.events)}

## 識別された選手
${summarizePlayers(analysisResult.players)}`;
}

function summarizeSegments(
  segments: ComprehensiveAnalysisResponse["segments"]
): string {
  const typeCounts: Record<string, number> = {};
  for (const seg of segments) {
    typeCounts[seg.type] = (typeCounts[seg.type] || 0) + 1;
  }
  return Object.entries(typeCounts)
    .map(([type, count]) => `- ${type}: ${count}回`)
    .join("\n");
}

function summarizeScenes(scenes: ComprehensiveAnalysisResponse["scenes"]): string {
  return scenes
    .filter((s) => s.importance >= 0.6)
    .map((s) => `- [${s.startSec}秒] ${s.type}: ${s.description} (重要度: ${s.importance})`)
    .slice(0, 10)
    .join("\n");
}

function summarizeEvents(events: ComprehensiveAnalysisResponse["events"]): string {
  const goals = events.filter(
    (e) => e.type === "shot" && e.details?.shotResult === "goal"
  );
  const shots = events.filter((e) => e.type === "shot");
  const setPieces = events.filter((e) => e.type === "setPiece");

  return `- ゴール: ${goals.length}回
- シュート: ${shots.length}回
- セットピース: ${setPieces.length}回
${goals.map((g) => `  - [${g.timestamp}秒] ${g.team}チームのゴール`).join("\n")}`;
}

function summarizePlayers(
  players: ComprehensiveAnalysisResponse["players"]
): string {
  const homePlayerNumbers = players.players
    .filter((p) => p.team === "home" && p.jerseyNumber)
    .map((p) => `#${p.jerseyNumber}`)
    .slice(0, 5);

  const awayPlayerNumbers = players.players
    .filter((p) => p.team === "away" && p.jerseyNumber)
    .map((p) => `#${p.jerseyNumber}`)
    .slice(0, 5);

  return `- ホーム: ${homePlayerNumbers.join(", ") || "不明"}
- アウェイ: ${awayPlayerNumbers.join(", ") || "不明"}`;
}

export type SummaryAndTacticsOptions = {
  projectId: string;
  modelId: string;
  analysisResult: ComprehensiveAnalysisResponse;
  eventStats: EventStatsInput;
  durationSec?: number;
  matchId: string;
  costContext?: CostTrackingContext;
};

export type SummaryAndTacticsResult = {
  response: SummaryAndTacticsResponse;
  rawResponse: string;
};

/**
 * Call Gemini API for summary and tactical analysis
 *
 * This is Call 2 of the 2-call architecture.
 * It takes the comprehensive analysis results and generates tactical insights and match summary.
 * No video is required for this call - only text context.
 */
export async function callSummaryAndTactics(
  options: SummaryAndTacticsOptions
): Promise<SummaryAndTacticsResult> {
  const {
    projectId,
    modelId,
    analysisResult,
    eventStats,
    durationSec,
    matchId,
    costContext,
  } = options;

  const stepLogger = logger.child({ matchId, step: "summary_and_tactics" });

  // Load prompt (now returns full string with examples and edge cases)
  const promptTemplate = await loadSummaryAndTacticsPrompt();

  // Build input context from analysis results
  const inputContext = buildInputContext(analysisResult, eventStats, durationSec);

  // Build full prompt by prepending input context
  const prompt = `${inputContext}

---

${promptTemplate}`;

  stepLogger.info("Starting summary and tactics analysis", {
    eventCount: analysisResult.events.length,
    sceneCount: analysisResult.scenes.length,
  });

  // Call Gemini API with retry (no video, text only)
  const rawResponse = await withRetry(
    async () => {
      return generateContent({
        projectId,
        modelId,
        prompt,
        // No fileUri - this is text-only Call 2
        temperature: 0.3,
        maxOutputTokens: 16384, // 長い試合サマリー用に増加
        responseFormat: "json",
        costContext,
      });
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 15000,
      timeoutMs: 120000, // 2 minutes is enough for text-only
      isRetryable: isRetryableError,
      logger: stepLogger,
      operationName: "summary_and_tactics",
    }
  );

  stepLogger.info("Received Gemini response", {
    responseLength: rawResponse.length,
  });

  // Parse and validate response
  try {
    const parsed = parseJsonFromGemini<Record<string, unknown>>(rawResponse);

    // Validate against schema
    const validated = SummaryAndTacticsResponseSchema.parse(parsed);

    stepLogger.info("Summary and tactics analysis completed", {
      headline: validated.summary.headline,
      keyMomentCount: validated.summary.keyMoments.length,
      playerHighlightCount: validated.summary.playerHighlights.length,
      hasScore: !!validated.summary.score,
      hasMvp: !!validated.summary.mvp,
    });

    return {
      response: validated,
      rawResponse,
    };
  } catch (parseError) {
    stepLogger.error("Failed to parse summary and tactics response", parseError, {
      responsePreview: rawResponse.substring(0, 1000),
    });

    throw new ValidationError(
      `Failed to parse summary and tactics response: ${
        parseError instanceof Error ? parseError.message : String(parseError)
      }`,
      { rawResponse: rawResponse.substring(0, 2000) }
    );
  }
}
