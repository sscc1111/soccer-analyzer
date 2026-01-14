/**
 * Segment and Events Gemini Client
 *
 * Hybrid 4-Call Pipeline - Call 1
 * セグメント分割 + イベント検出の統合Geminiクライアント
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
  parseSegmentAndEventsResponse,
  type SegmentAndEventsResponse,
} from "./schemas/segmentAndEvents";
import { parseJsonFromGemini } from "../lib/json";
import { withRetry } from "../lib/retry";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types
// ============================================================

export interface SegmentAndEventsOptions {
  matchId: string;
  cache: GeminiCacheDoc;
  promptVersion?: string;
  logger: ILogger;
}

export interface SegmentAndEventsResult {
  segments: SegmentAndEventsResponse["segments"];
  events: SegmentAndEventsResponse["events"];
  metadata: SegmentAndEventsResponse["metadata"];
  teams: SegmentAndEventsResponse["teams"];
}

// ============================================================
// Prompt Loading
// ============================================================

interface SegmentAndEventsPrompt {
  version: string;
  task: string;
  instructions: string;
  examples: unknown[];
  edge_cases: { cases: unknown[] };
  output_schema: Record<string, unknown>;
}

let cachedPrompt: SegmentAndEventsPrompt | null = null;

function loadPrompt(version: string): SegmentAndEventsPrompt {
  if (cachedPrompt && cachedPrompt.version === version) {
    return cachedPrompt;
  }

  const promptPath = path.join(
    __dirname,
    "prompts",
    `segment_and_events_${version}.json`
  );

  const content = fs.readFileSync(promptPath, "utf-8");
  cachedPrompt = JSON.parse(content) as SegmentAndEventsPrompt;
  return cachedPrompt;
}

// ============================================================
// Response Schema for Gemini
// ============================================================

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    metadata: {
      type: "object",
      properties: {
        totalDurationSec: { type: "number" },
        videoQuality: { type: "string", enum: ["good", "fair", "poor"] },
        qualityIssues: {
          type: "array",
          items: { type: "string" },
        },
        analyzedFromSec: { type: "number" },
        analyzedToSec: { type: "number" },
      },
      required: ["totalDurationSec", "videoQuality"],
    },
    teams: {
      type: "object",
      properties: {
        home: {
          type: "object",
          properties: {
            primaryColor: { type: "string" },
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
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          type: {
            type: "string",
            enum: ["active_play", "stoppage", "set_piece", "goal_moment", "replay"],
          },
          subtype: {
            type: "string",
            enum: [
              "corner",
              "free_kick",
              "penalty",
              "goal_kick",
              "throw_in",
              "kick_off",
              "foul",
              "injury",
              "substitution",
              "referee_decision",
              "other",
            ],
          },
          description: { type: "string" },
          attackingTeam: { type: "string", enum: ["home", "away"] },
          importance: { type: "integer" },
          confidence: { type: "number" },
          visualEvidence: { type: "string" },
        },
        required: ["startSec", "endSec", "type", "description", "confidence"],
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "number" },
          type: {
            type: "string",
            enum: ["pass", "carry", "turnover", "shot", "setPiece"],
          },
          team: { type: "string", enum: ["home", "away"] },
          player: { type: "string" },
          zone: {
            type: "string",
            enum: ["defensive_third", "middle_third", "attacking_third"],
          },
          details: {
            type: "object",
            properties: {
              passType: {
                type: "string",
                enum: ["short", "medium", "long", "through", "cross"],
              },
              outcome: {
                type: "string",
                enum: ["complete", "incomplete", "intercepted"],
              },
              targetPlayer: { type: "string" },
              distance: { type: "number" },
              endReason: {
                type: "string",
                enum: ["pass", "shot", "dispossessed", "stopped"],
              },
              turnoverType: {
                type: "string",
                enum: ["tackle", "interception", "bad_touch", "out_of_bounds", "other"],
              },
              shotResult: {
                type: "string",
                enum: ["goal", "saved", "blocked", "missed", "post"],
              },
              shotType: {
                type: "string",
                enum: ["power", "placed", "header", "volley", "long_range", "chip"],
              },
              setPieceType: {
                type: "string",
                enum: [
                  "corner",
                  "free_kick",
                  "penalty",
                  "throw_in",
                  "goal_kick",
                  "kick_off",
                ],
              },
            },
          },
          confidence: { type: "number" },
          visualEvidence: { type: "string" },
        },
        required: ["timestamp", "type", "team", "confidence"],
      },
    },
  },
  required: ["metadata", "teams", "segments", "events"],
};

// ============================================================
// Main Function
// ============================================================

/**
 * Analyze video for segments and events in a single API call
 */
export async function analyzeSegmentAndEvents(
  options: SegmentAndEventsOptions
): Promise<SegmentAndEventsResult> {
  const { matchId, cache, logger } = options;
  const promptVersion = options.promptVersion || "v1";

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  // Load prompt
  const prompt = loadPrompt(promptVersion);

  // Build prompt text
  const promptText = [
    prompt.instructions,
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
    temperature: 0.25, // Lower for more consistent results
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
        logger.info("Using context cache for segment and events detection", {
          cacheId: cache.cacheId,
          matchId,
        });
        response = await callGeminiApiWithCache(
          projectId,
          modelId,
          cache.cacheId,
          promptText,
          generationConfig,
          { matchId, step: "segment_and_events" }
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
          step: "segment_and_events",
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
      const result = parseSegmentAndEventsResponse(parsed);

      if (!result.success) {
        logger.warn("Validation errors in segment and events response", {
          errors: result.error.errors.slice(0, 5),
        });
        throw new Error(
          `Validation failed: ${result.error.errors.map((e) => e.message).join(", ")}`
        );
      }

      logger.info("Segment and events analysis complete", {
        matchId,
        segmentCount: result.data.segments.length,
        eventCount: result.data.events.length,
        shotCount: result.data.events.filter((e) => e.type === "shot").length,
      });

      return {
        segments: result.data.segments,
        events: result.data.events,
        metadata: result.data.metadata,
        teams: result.data.teams,
      };
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 600000, // 10 minutes
      onRetry: (attempt, error) => {
        logger.warn("Retrying segment and events analysis", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
