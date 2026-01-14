/**
 * Comprehensive Analysis Client
 *
 * Call 1: 1回のGemini API呼び出しで以下を全て取得
 * - segments（セグメント）
 * - events（イベント）
 * - scenes（重要シーン）
 * - players（選手識別）
 * - clipLabels（クリップラベル）
 */

import { promises as fs } from "fs";
import path from "path";
import { generateContent, type CostTrackingContext } from "./gemini3Client";
import {
  ComprehensiveAnalysisResponseSchema,
  normalizeComprehensiveResponse,
  type ComprehensiveAnalysisResponse,
} from "./schemas";
import { parseJsonFromGemini } from "../lib/json";
import { withRetry } from "../lib/retry";
import { defaultLogger as logger } from "../lib/logger";
import { ValidationError, isRetryableError } from "../lib/errors";

/**
 * Load comprehensive analysis prompt
 */
async function loadComprehensiveAnalysisPrompt(): Promise<string> {
  const promptPath = path.join(__dirname, "prompts", "comprehensive_analysis_v1.json");
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
  if (prompt.edge_cases && prompt.edge_cases.cases) {
    edgeCasesSection = `

---

# エッジケースの対処法

${prompt.edge_cases.cases
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

export type ComprehensiveAnalysisOptions = {
  projectId: string;
  modelId: string;
  fileUri: string;
  mimeType?: string;
  durationSec?: number;
  matchId: string;
  costContext?: CostTrackingContext;
};

export type ComprehensiveAnalysisResult = {
  response: ComprehensiveAnalysisResponse;
  rawResponse: string;
  tokenCount?: number;
};

/**
 * Call Gemini API for comprehensive video analysis
 *
 * This is Call 1 of the 2-call architecture.
 * It analyzes the video and returns segments, events, scenes, players, and clip labels.
 */
export async function callComprehensiveAnalysis(
  options: ComprehensiveAnalysisOptions
): Promise<ComprehensiveAnalysisResult> {
  const {
    projectId,
    modelId,
    fileUri,
    mimeType = "video/mp4",
    durationSec,
    matchId,
    costContext,
  } = options;

  const stepLogger = logger.child({ matchId, step: "comprehensive_analysis" });

  // Load prompt
  const prompt = await loadComprehensiveAnalysisPrompt();

  stepLogger.info("Starting comprehensive analysis", {
    fileUri,
    durationSec,
    modelId,
  });

  // Calculate appropriate max output tokens based on video duration
  // Longer videos need more tokens for segments and events
  const baseTokens = 16384;
  const tokensPerMinute = 1000;
  const maxOutputTokens = durationSec
    ? Math.min(32768, baseTokens + Math.ceil((durationSec / 60) * tokensPerMinute))
    : 24576;

  // Call Gemini API with retry
  const rawResponse = await withRetry(
    async () => {
      return generateContent({
        projectId,
        modelId,
        prompt,
        fileUri,
        mimeType,
        temperature: 0.2, // Lower temperature for more consistent output
        maxOutputTokens,
        responseFormat: "json",
        costContext,
      });
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 600000, // 10 minutes for long videos
      isRetryable: isRetryableError,
      logger: stepLogger,
      operationName: "comprehensive_analysis",
    }
  );

  stepLogger.info("Received Gemini response", {
    responseLength: rawResponse.length,
  });

  // Parse and validate response
  try {
    const parsed = parseJsonFromGemini<Record<string, unknown>>(rawResponse);

    // Normalize event fields (handle time vs timestamp, etc.)
    const normalized = normalizeComprehensiveResponse(parsed);

    // Validate against schema
    const validated = ComprehensiveAnalysisResponseSchema.parse(normalized);

    stepLogger.info("Comprehensive analysis completed", {
      segmentCount: validated.segments.length,
      eventCount: validated.events.length,
      sceneCount: validated.scenes.length,
      playerCount: validated.players.players.length,
      clipLabelCount: validated.clipLabels?.length ?? 0,
    });

    return {
      response: validated,
      rawResponse,
    };
  } catch (parseError) {
    stepLogger.error("Failed to parse comprehensive analysis response", parseError, {
      responsePreview: rawResponse.substring(0, 1000),
    });

    throw new ValidationError(
      `Failed to parse comprehensive analysis response: ${
        parseError instanceof Error ? parseError.message : String(parseError)
      }`,
      { rawResponse: rawResponse.substring(0, 2000) }
    );
  }
}

/**
 * Extract events by type from comprehensive analysis response
 */
export function extractEventsByType(
  response: ComprehensiveAnalysisResponse,
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece"
) {
  return response.events.filter((event) => event.type === type);
}

/**
 * Get goal events from the analysis
 */
export function getGoalEvents(response: ComprehensiveAnalysisResponse) {
  return response.events.filter(
    (event) => event.type === "shot" && event.details?.shotResult === "goal"
  );
}

/**
 * Calculate event statistics from comprehensive analysis
 */
export function calculateEventStatsFromAnalysis(response: ComprehensiveAnalysisResponse) {
  const stats = {
    home: {
      passes: 0,
      passesComplete: 0,
      shots: 0,
      shotsOnTarget: 0,
      turnoversWon: 0,
      turnoversLost: 0,
    },
    away: {
      passes: 0,
      passesComplete: 0,
      shots: 0,
      shotsOnTarget: 0,
      turnoversWon: 0,
      turnoversLost: 0,
    },
    total: {
      passes: 0,
      shots: 0,
      turnovers: 0,
    },
  };

  for (const event of response.events) {
    const team = event.team;
    const oppositeTeam = team === "home" ? "away" : "home";

    switch (event.type) {
      case "pass":
        stats[team].passes++;
        stats.total.passes++;
        if (event.details?.outcome === "complete") {
          stats[team].passesComplete++;
        }
        break;

      case "shot":
        stats[team].shots++;
        stats.total.shots++;
        if (
          event.details?.shotResult === "goal" ||
          event.details?.shotResult === "saved"
        ) {
          stats[team].shotsOnTarget++;
        }
        break;

      case "turnover":
        stats[oppositeTeam].turnoversWon++;
        stats[team].turnoversLost++;
        stats.total.turnovers++;
        break;
    }
  }

  return stats;
}
