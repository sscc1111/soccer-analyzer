/**
 * Scenes and Players Gemini Client
 *
 * Hybrid 4-Call Pipeline - Call 2
 * シーン抽出 + 選手識別の統合Geminiクライアント
 * Call 1の結果をコンテキストとして受け取る
 */

import type { ILogger } from "../lib/logger";
import type { GeminiCacheDoc } from "./cacheManager";
import {
  callGeminiApi,
  callGeminiApiWithCache,
  extractTextFromResponse,
  type Gemini3Request,
} from "./gemini3Client";
import {
  parseScenesAndPlayersResponse,
  type ScenesAndPlayersResponse,
} from "./schemas/scenesAndPlayers";
import type { SegmentAndEventsResponse } from "./schemas/segmentAndEvents";
import { parseJsonFromGemini } from "../lib/json";
import { withRetry } from "../lib/retry";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types
// ============================================================

export interface ScenesAndPlayersOptions {
  matchId: string;
  cache: GeminiCacheDoc;
  call1Result: SegmentAndEventsResponse; // Call 1の結果
  promptVersion?: string;
  logger: ILogger;
}

export interface ScenesAndPlayersResult {
  scenes: ScenesAndPlayersResponse["scenes"];
  players: ScenesAndPlayersResponse["players"];
}

// ============================================================
// Prompt Loading
// ============================================================

interface ScenesAndPlayersPrompt {
  version: string;
  task: string;
  instructions: string;
  examples: unknown[];
  edge_cases: { cases: unknown[] };
  output_schema: Record<string, unknown>;
}

let cachedPrompt: ScenesAndPlayersPrompt | null = null;

function loadPrompt(version: string): ScenesAndPlayersPrompt {
  if (cachedPrompt && cachedPrompt.version === version) {
    return cachedPrompt;
  }

  const promptPath = path.join(
    __dirname,
    "prompts",
    `scenes_and_players_${version}.json`
  );

  const content = fs.readFileSync(promptPath, "utf-8");
  cachedPrompt = JSON.parse(content) as ScenesAndPlayersPrompt;
  return cachedPrompt;
}

// ============================================================
// Context Builder
// ============================================================

/**
 * Call 1の結果からコンテキストテキストを生成
 */
function buildContextFromCall1(result: SegmentAndEventsResponse): string {
  const segments = result.segments;
  const events = result.events;

  // イベント統計
  const eventCounts = {
    pass: events.filter((e) => e.type === "pass").length,
    shot: events.filter((e) => e.type === "shot").length,
    turnover: events.filter((e) => e.type === "turnover").length,
    carry: events.filter((e) => e.type === "carry").length,
    setPiece: events.filter((e) => e.type === "setPiece").length,
  };

  // シュート詳細（特に重要）
  const shots = events
    .filter((e) => e.type === "shot")
    .map(
      (e) =>
        `  - ${e.timestamp}秒: ${e.team} ${e.player || "?"} - ${e.details?.shotResult || "unknown"}`
    )
    .join("\n");

  // 高重要度セグメント
  const importantSegments = segments
    .filter((s) => s.importance && s.importance >= 4)
    .map(
      (s) =>
        `  - ${s.startSec}-${s.endSec}秒: ${s.type} (importance: ${s.importance}) - ${s.description}`
    )
    .join("\n");

  return `## 動画メタデータ
- 総時間: ${result.metadata.totalDurationSec}秒
- 品質: ${result.metadata.videoQuality}

## チーム情報
- ホーム: ${result.teams.home.primaryColor}
- アウェイ: ${result.teams.away.primaryColor}

## セグメント統計
- 総セグメント数: ${segments.length}
- アクティブプレイ: ${segments.filter((s) => s.type === "active_play").length}
- ストップ: ${segments.filter((s) => s.type === "stoppage").length}
- セットピース: ${segments.filter((s) => s.type === "set_piece").length}
- ゴールモーメント: ${segments.filter((s) => s.type === "goal_moment").length}

## 検出済みイベント統計
- パス: ${eventCounts.pass}回
- シュート: ${eventCounts.shot}回
- ターンオーバー: ${eventCounts.turnover}回
- キャリー: ${eventCounts.carry}回
- セットピース: ${eventCounts.setPiece}回

## 検出されたシュート詳細
${shots || "（シュートなし）"}

## 高重要度セグメント (importance >= 4)
${importantSegments || "（なし）"}`;
}

// ============================================================
// Response Schema for Gemini
// ============================================================

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          type: {
            type: "string",
            enum: [
              "goal",
              "shot",
              "save",
              "chance",
              "turnover",
              "foul",
              "card",
              "setPiece",
              "dribble",
              "defense",
              "other",
            ],
          },
          team: { type: "string", enum: ["home", "away"] },
          description: { type: "string" },
          importance: { type: "number" },
          confidence: { type: "number" },
          suggestedClip: {
            type: "object",
            properties: {
              t0: { type: "number" },
              t1: { type: "number" },
            },
            required: ["t0", "t1"],
          },
        },
        required: ["startSec", "type", "description", "importance"],
      },
    },
    players: {
      type: "object",
      properties: {
        teams: {
          type: "object",
          properties: {
            home: {
              type: "object",
              properties: {
                primaryColor: { type: "string" },
                secondaryColor: { type: "string" },
                goalkeeperColor: { type: "string" },
                attackingDirection: {
                  type: "string",
                  enum: ["left_to_right", "right_to_left"],
                },
              },
              required: ["primaryColor"],
            },
            away: {
              type: "object",
              properties: {
                primaryColor: { type: "string" },
                secondaryColor: { type: "string" },
                goalkeeperColor: { type: "string" },
                attackingDirection: {
                  type: "string",
                  enum: ["left_to_right", "right_to_left"],
                },
              },
              required: ["primaryColor"],
            },
          },
          required: ["home", "away"],
        },
        identified: {
          type: "array",
          items: {
            type: "object",
            properties: {
              team: { type: "string", enum: ["home", "away"] },
              jerseyNumber: { type: "integer" },
              role: { type: "string", enum: ["player", "goalkeeper"] },
              confidence: { type: "number" },
            },
            required: ["team", "role", "confidence"],
          },
        },
        referees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: ["main_referee", "linesman", "fourth_official"],
              },
              uniformColor: { type: "string" },
            },
            required: ["role"],
          },
        },
      },
      required: ["teams", "identified"],
    },
  },
  required: ["scenes", "players"],
};

// ============================================================
// Main Function
// ============================================================

/**
 * Analyze video for scenes and players in a single API call
 * Uses context from Call 1 (segments and events)
 */
export async function analyzeScenesAndPlayers(
  options: ScenesAndPlayersOptions
): Promise<ScenesAndPlayersResult> {
  const { matchId, cache, call1Result, logger } = options;
  const promptVersion = options.promptVersion || "v1";

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  // Load prompt
  const prompt = loadPrompt(promptVersion);

  // Build context from Call 1 results
  const contextText = buildContextFromCall1(call1Result);

  // Replace placeholder in instructions
  const instructionsWithContext = prompt.instructions.replace(
    "{{CONTEXT_PLACEHOLDER}}",
    contextText
  );

  // Build prompt text
  const promptText = [
    instructionsWithContext,
    "",
    "## Examples",
    JSON.stringify(prompt.examples, null, 2),
    "",
    "## Edge Cases",
    JSON.stringify(prompt.edge_cases.cases, null, 2),
    "",
    "## Output Schema (JSON)",
    JSON.stringify(prompt.output_schema, null, 2),
    "",
    "Task: " + prompt.task,
    "",
    "Return JSON only.",
  ].join("\n");

  // Generation config
  const generationConfig = {
    temperature: 0.2,
    topP: 0.95,
    topK: 40,
    responseMimeType: "application/json",
    responseSchema: GEMINI_RESPONSE_SCHEMA,
  };

  // Check if cache is available
  const useCache = cache.cacheId && cache.version !== "fallback";

  return withRetry(
    async () => {
      let response;

      if (useCache) {
        logger.info("Using context cache for scenes and players detection", {
          cacheId: cache.cacheId,
          matchId,
        });
        response = await callGeminiApiWithCache(
          projectId,
          modelId,
          cache.cacheId,
          promptText,
          generationConfig,
          { matchId, step: "scenes_and_players" }
        );
      } else {
        logger.info("Using direct file URI (no cache available)", { matchId });
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
        response = await callGeminiApi(projectId, modelId, request, {
          matchId,
          step: "scenes_and_players",
        });
      }

      // Check for safety filter blocks
      if (response.promptFeedback?.blockReason) {
        throw new Error(
          `Gemini blocked request: ${response.promptFeedback.blockReason}`
        );
      }

      const text = extractTextFromResponse(response);
      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      // Parse and validate
      const parsed = parseJsonFromGemini(text);
      const result = parseScenesAndPlayersResponse(parsed);

      if (!result.success) {
        logger.warn("Validation errors in scenes and players response", {
          errors: result.error.errors.slice(0, 5),
        });
        throw new Error(
          `Validation failed: ${result.error.errors.map((e) => e.message).join(", ")}`
        );
      }

      logger.info("Scenes and players analysis complete", {
        matchId,
        sceneCount: result.data.scenes.length,
        goalScenes: result.data.scenes.filter((s) => s.type === "goal").length,
        shotScenes: result.data.scenes.filter((s) => s.type === "shot").length,
        playerCount: result.data.players.identified.length,
      });

      return {
        scenes: result.data.scenes,
        players: result.data.players,
      };
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 300000, // 5 minutes
      onRetry: (attempt, error) => {
        logger.warn("Retrying scenes and players analysis", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
