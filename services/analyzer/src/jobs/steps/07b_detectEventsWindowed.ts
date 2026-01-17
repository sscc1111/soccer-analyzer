/**
 * Step 07b: Windowed Event Detection with Gemini
 *
 * Phase 2.2: Process video segments in overlapping windows for more accurate event detection
 * - Takes video segments from step 07a (or generated in-memory)
 * - Creates overlapping analysis windows (60s with 15s overlap)
 * - Processes windows in parallel (5 concurrent)
 * - Returns raw events with windowId for later deduplication
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type { TeamId } from "@soccer/shared";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";
import { parseJsonFromGemini } from "../../lib/json";

// ============================================================================
// Types
// ============================================================================

/**
 * Video segment type (from scene extraction or classification)
 */
export type SegmentType = "active_play" | "set_piece" | "goal_moment" | "stoppage" | "replay";

/**
 * Video segment definition (input)
 */
export interface VideoSegment {
  segmentId: string;
  startSec: number;
  endSec: number;
  type: SegmentType;
  description?: string;
  team?: "home" | "away" | "unknown";
  importance?: number;
}

/**
 * Analysis window with overlap information
 */
export interface AnalysisWindow {
  windowId: string;
  absoluteStart: number;
  absoluteEnd: number;
  overlap: { before: number; after: number };
  targetFps: number;
  segmentContext: VideoSegment;
}

/**
 * Raw event from window analysis (before deduplication)
 */
export interface RawEvent {
  /** Match ID this event belongs to */
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  windowId: string;
  relativeTimestamp: number; // Relative to window start
  absoluteTimestamp: number; // Relative to video start
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece";
  team: "home" | "away";
  player?: string;
  zone?: "defensive_third" | "middle_third" | "attacking_third";
  /** v4: Position from Gemini output (normalized 0-100 coordinates) */
  position?: { x: number; y: number };
  /** v4: Position confidence from Gemini (0-1) */
  positionConfidence?: number;
  details: {
    passType?: "short" | "medium" | "long" | "through" | "cross";
    outcome?: "complete" | "incomplete" | "intercepted";
    targetPlayer?: string;
    distance?: number;
    endReason?: "pass" | "shot" | "dispossessed" | "stopped";
    /** v4: End zone for carry events */
    endZone?: "defensive_third" | "middle_third" | "attacking_third";
    turnoverType?: "tackle" | "interception" | "bad_touch" | "out_of_bounds" | "other";
    // v3: Added "post" for bar/post hits
    shotResult?: "goal" | "saved" | "blocked" | "missed" | "post";
    // v3: Shot type classification
    shotType?: "power" | "placed" | "header" | "volley" | "long_range" | "chip";
    setPieceType?: "corner" | "free_kick" | "penalty" | "throw_in" | "goal_kick" | "kick_off";
  };
  confidence: number;
  visualEvidence?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const WINDOW_CONFIG = {
  defaultDurationSec: 60,
  // Phase 2.9: 25%オーバーラップに削減（重複検出を減らす）
  overlapSec: 15,
  fpsBySegment: {
    active_play: 3,
    set_piece: 2,
    goal_moment: 5,
    stoppage: 0.5, // Phase 1.4: ストッページを低FPSで処理（ファウル、交代、負傷検出用）
  } as Record<SegmentType, number>,
  parallelism: 5,
  // Phase 1.4: ストッページセグメントも検出対象にする（ファウル、交代、負傷）
  skipStoppages: false,
  // セグメントごとの最大ウィンドウ数 (60s window, 30s step → 200 windows = 6000s ≈ 100min)
  maxWindowsPerSegment: 200,
};

// Prompt version
// Phase 1.1: v3にアップグレード（Few-Shotサンプル追加版）
const PROMPT_VERSION = process.env.PROMPT_VERSION || "v3";

// ============================================================================
// Zod Schemas (v2 format) - With robust field name normalization
// ============================================================================

const EventDetailsSchema = z.object({
  passType: z.enum(["short", "medium", "long", "through", "cross"]).optional(),
  outcome: z.enum(["complete", "incomplete", "intercepted"]).optional(),
  targetPlayer: z.string().optional(),
  distance: z.number().optional(),
  endReason: z.enum(["pass", "shot", "dispossessed", "stopped"]).optional(),
  turnoverType: z.enum(["tackle", "interception", "bad_touch", "out_of_bounds", "other"]).optional(),
  // v3: Added "post" for bar/post hits
  shotResult: z.enum(["goal", "saved", "blocked", "missed", "post"]).optional(),
  // v3: Shot type classification
  shotType: z.enum(["power", "placed", "header", "volley", "long_range", "chip"]).optional(),
  setPieceType: z.enum(["corner", "free_kick", "penalty", "throw_in", "goal_kick", "kick_off"]).optional(),
});

/**
 * Normalize event object from Gemini to handle field name variations
 * Gemini sometimes returns: time/timestamp, eventType/type, teamId/team, score/confidence
 */
function normalizeEventFields(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;

  // Normalize field names
  const normalized: Record<string, unknown> = { ...obj };

  // timestamp variations: time, timestamp, t
  if (!("timestamp" in normalized)) {
    if ("time" in obj) normalized.timestamp = obj.time;
    else if ("t" in obj) normalized.timestamp = obj.t;
  }

  // type variations: eventType, type, event_type
  if (!("type" in normalized)) {
    if ("eventType" in obj) normalized.type = obj.eventType;
    else if ("event_type" in obj) normalized.type = obj.event_type;
  }

  // team variations: teamId, team, teamName
  if (!("team" in normalized)) {
    if ("teamId" in obj) normalized.team = obj.teamId;
    else if ("teamName" in obj) normalized.team = obj.teamName;
  }

  // confidence variations: score, confidence, probability
  if (!("confidence" in normalized)) {
    if ("score" in obj) normalized.confidence = obj.score;
    else if ("probability" in obj) normalized.confidence = obj.probability;
  }

  // details may be at top level (flat) instead of nested
  if (!("details" in normalized) || normalized.details === undefined) {
    const detailFields = ["passType", "outcome", "targetPlayer", "distance", "endReason", "turnoverType", "shotResult", "shotType", "setPieceType"];
    const flatDetails: Record<string, unknown> = {};
    let hasDetails = false;
    for (const field of detailFields) {
      if (field in obj && obj[field] !== undefined) {
        flatDetails[field] = obj[field];
        hasDetails = true;
      }
    }
    if (hasDetails) {
      normalized.details = flatDetails;
    }
  }

  return normalized;
}

// v4: Position schema for event location on pitch
const PositionSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).optional(),
}).optional();

const EventSchema = z.preprocess(
  normalizeEventFields,
  z.object({
    timestamp: z.number().min(0),
    type: z.enum(["pass", "carry", "turnover", "shot", "setPiece"]),
    team: z.enum(["home", "away"]),
    player: z.string().optional(),
    zone: z.enum(["defensive_third", "middle_third", "attacking_third"]).optional(),
    // v4: Position on pitch (0-100 coordinate system)
    position: PositionSchema,
    details: EventDetailsSchema.optional(),
    // Phase 2.10: 閾値を0.7に上げてイベント過検出を防止
    confidence: z.number().min(0.7).max(1),
    visualEvidence: z.string().optional(),
  })
);

const MetadataSchema = z.object({
  videoQuality: z.enum(["good", "fair", "poor"]).optional(),
  qualityIssues: z.array(z.string()).optional(),
  analyzedDurationSec: z.number().optional(),
}).optional();

// Support both { metadata, events } object format and direct array format
// Gemini sometimes returns just the events array without the wrapper
const EventsResponseSchema = z.union([
  z.object({
    metadata: MetadataSchema,
    events: z.array(EventSchema),
  }),
  z.array(EventSchema), // Direct array fallback
]);

// ============================================================================
// Gemini responseSchema - Force consistent output format
// ============================================================================

/**
 * JSON Schema to force Gemini to return consistent output format.
 * This is passed to generationConfig.responseSchema to enforce structure.
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    metadata: {
      type: "object",
      properties: {
        videoQuality: { type: "string", enum: ["good", "fair", "poor"] },
        qualityIssues: { type: "array", items: { type: "string" } },
        analyzedDurationSec: { type: "number" },
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "number", description: "Event time in seconds relative to window start" },
          type: { type: "string", enum: ["pass", "carry", "turnover", "shot", "setPiece"] },
          team: { type: "string", enum: ["home", "away"] },
          player: { type: "string" },
          zone: { type: "string", enum: ["defensive_third", "middle_third", "attacking_third"] },
          // v4: Position on pitch (0-100 coordinate system)
          position: {
            type: "object",
            properties: {
              x: { type: "number", minimum: 0, maximum: 100, description: "X position (0=home goal, 100=away goal)" },
              y: { type: "number", minimum: 0, maximum: 100, description: "Y position (0=top touchline, 100=bottom touchline)" },
              confidence: { type: "number", minimum: 0, maximum: 1, description: "Position confidence (0.3-1.0)" },
            },
            required: ["x", "y"],
          },
          details: {
            type: "object",
            properties: {
              passType: { type: "string", enum: ["short", "medium", "long", "through", "cross"] },
              outcome: { type: "string", enum: ["complete", "incomplete", "intercepted"] },
              targetPlayer: { type: "string" },
              distance: { type: "number" },
              endReason: { type: "string", enum: ["pass", "shot", "dispossessed", "stopped"] },
              endZone: { type: "string", enum: ["defensive_third", "middle_third", "attacking_third"] },
              turnoverType: { type: "string", enum: ["tackle", "interception", "bad_touch", "out_of_bounds", "other"] },
              shotResult: { type: "string", enum: ["goal", "saved", "blocked", "missed", "post"] },
              shotType: { type: "string", enum: ["power", "placed", "header", "volley", "long_range", "chip"] },
              setPieceType: { type: "string", enum: ["corner", "free_kick", "penalty", "throw_in", "goal_kick", "kick_off"] },
            },
          },
          confidence: { type: "number", minimum: 0.7, maximum: 1.0 },
          visualEvidence: { type: "string" },
        },
        required: ["timestamp", "type", "team", "confidence"],
      },
    },
  },
  required: ["events"],
};

type GeminiEvent = z.infer<typeof EventSchema>;
type EventsResponse = z.infer<typeof EventsResponseSchema>;

// ============================================================================
// Prompt Loading
// ============================================================================

let cachedPrompt: { version: string; task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

type PromptData = { version: string; task: string; instructions: string; output_schema: Record<string, unknown> };

async function loadPrompt(promptVersion: string = PROMPT_VERSION): Promise<PromptData> {
  // Check cache with null safety
  if (cachedPrompt && cachedPrompt.version === promptVersion) {
    return cachedPrompt;
  }

  const promptPath = path.join(__dirname, "prompts", `event_detection_${promptVersion}.json`);

  try {
    const data = await readFile(promptPath, "utf-8");
    const parsed = JSON.parse(data);

    // Validate prompt structure
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Prompt file is not a valid object");
    }
    if (!parsed.task || typeof parsed.task !== "string") {
      throw new Error("Prompt file missing or invalid 'task' field");
    }
    if (!parsed.instructions || typeof parsed.instructions !== "string") {
      throw new Error("Prompt file missing or invalid 'instructions' field");
    }
    if (!parsed.output_schema || typeof parsed.output_schema !== "object") {
      throw new Error("Prompt file missing or invalid 'output_schema' field");
    }

    // Assign validated data to cache and return
    const validatedPrompt: PromptData = {
      version: promptVersion,
      task: parsed.task,
      instructions: parsed.instructions,
      output_schema: parsed.output_schema,
    };
    cachedPrompt = validatedPrompt;
    return validatedPrompt;
  } catch (error) {
    // Clear cache on error to ensure fresh load on retry
    cachedPrompt = null;
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load event detection prompt version "${promptVersion}" from ${promptPath}: ${errorMessage}`
    );
  }
}

// ============================================================================
// Segment Consolidation (Phase 2.10)
// ============================================================================

/**
 * Minimum segment duration after consolidation (seconds)
 * Segments shorter than this will be merged with adjacent segments of the same type
 */
const MIN_SEGMENT_DURATION_SEC = 10;

/**
 * Consolidate adjacent segments of the same type to reduce API calls.
 * This prevents over-segmentation where Gemini creates many tiny segments.
 *
 * Example: [active_play(3s), active_play(5s), active_play(7s)] → [active_play(15s)]
 */
export function consolidateSegments(segments: VideoSegment[]): VideoSegment[] {
  if (segments.length <= 1) return segments;

  // Sort by start time
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);
  const consolidated: VideoSegment[] = [];

  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    // Check if segments can be merged:
    // 1. Same type
    // 2. Current segment is short (< MIN_SEGMENT_DURATION_SEC) OR
    // 3. Gap between segments is small (< 2 seconds)
    const currentDuration = current.endSec - current.startSec;
    const gap = next.startSec - current.endSec;
    const sameType = current.type === next.type;

    if (sameType && (currentDuration < MIN_SEGMENT_DURATION_SEC || gap < 2)) {
      // Merge: extend current segment to include next
      current = {
        ...current,
        endSec: next.endSec,
        // Keep the higher importance
        importance: Math.max(current.importance || 1, next.importance || 1),
        // Combine descriptions if both exist
        description: current.description && next.description
          ? `${current.description}; ${next.description}`
          : current.description || next.description,
      };
    } else {
      // Cannot merge: push current and start new
      consolidated.push(current);
      current = { ...next };
    }
  }

  // Don't forget the last segment
  consolidated.push(current);

  return consolidated;
}

// ============================================================================
// Window Generation
// ============================================================================

/**
 * Generate overlapping analysis windows from segments
 */
export function generateWindows(segments: VideoSegment[]): AnalysisWindow[] {
  const windows: AnalysisWindow[] = [];

  for (const segment of segments) {
    // Skip stoppage segments if configured
    if (WINDOW_CONFIG.skipStoppages && segment.type === "stoppage") {
      continue;
    }

    const segmentDuration = segment.endSec - segment.startSec;
    const targetFps = WINDOW_CONFIG.fpsBySegment[segment.type] || 3;

    // If segment is shorter than window size, create single window
    if (segmentDuration <= WINDOW_CONFIG.defaultDurationSec) {
      windows.push({
        windowId: `${segment.segmentId}_w0`,
        absoluteStart: segment.startSec,
        absoluteEnd: segment.endSec,
        overlap: { before: 0, after: 0 },
        targetFps,
        segmentContext: segment,
      });
      continue;
    }

    // Generate overlapping windows
    const step = WINDOW_CONFIG.defaultDurationSec - WINDOW_CONFIG.overlapSec;

    // P0修正: step値のバリデーション（無限ループ防止）
    if (step <= 0) {
      logger.error("Invalid window configuration: step must be positive", {
        segmentId: segment.segmentId,
        defaultDurationSec: WINDOW_CONFIG.defaultDurationSec,
        overlapSec: WINDOW_CONFIG.overlapSec,
        calculatedStep: step,
      });
      throw new Error(
        `Invalid window config: defaultDurationSec (${WINDOW_CONFIG.defaultDurationSec}) ` +
        `must be greater than overlapSec (${WINDOW_CONFIG.overlapSec})`
      );
    }

    let windowIndex = 0;
    let currentStart = segment.startSec;

    while (currentStart < segment.endSec) {
      const currentEnd = Math.min(
        currentStart + WINDOW_CONFIG.defaultDurationSec,
        segment.endSec
      );

      // Calculate overlap with adjacent windows
      const overlapBefore = windowIndex === 0 ? 0 : WINDOW_CONFIG.overlapSec;
      const overlapAfter = currentEnd < segment.endSec ? WINDOW_CONFIG.overlapSec : 0;

      windows.push({
        windowId: `${segment.segmentId}_w${windowIndex}`,
        absoluteStart: currentStart,
        absoluteEnd: currentEnd,
        overlap: { before: overlapBefore, after: overlapAfter },
        targetFps,
        segmentContext: segment,
      });

      windowIndex++;

      // Safety check: prevent infinite loops using configured max
      if (windowIndex >= WINDOW_CONFIG.maxWindowsPerSegment) {
        logger.error("Window generation limit exceeded - segment may be too long or configuration is invalid", {
          segmentId: segment.segmentId,
          duration: segmentDuration,
          windowIndex,
          maxWindows: WINDOW_CONFIG.maxWindowsPerSegment,
          currentStart,
          segmentEnd: segment.endSec,
        });

        // 末尾までカバーするため、最後のウィンドウを強制追加
        if (currentStart < segment.endSec) {
          windows.push({
            windowId: `${segment.segmentId}_w${windowIndex}_final`,
            absoluteStart: currentStart,
            absoluteEnd: segment.endSec,
            overlap: { before: WINDOW_CONFIG.overlapSec, after: 0 },
            targetFps,
            segmentContext: segment,
          });
        }
        break;
      }

      currentStart += step;
    }
  }

  return windows;
}

// ============================================================================
// Event Detection
// ============================================================================

/**
 * Process a single analysis window and detect events
 */
async function processWindow(
  window: AnalysisWindow,
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  matchId: string,
  videoId: string | undefined,
  log: ILogger
): Promise<RawEvent[]> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  // Build window-specific prompt context
  const windowContext = [
    `## Window Context`,
    `- Segment Type: ${window.segmentContext.type}`,
    `- Time Range: ${window.absoluteStart.toFixed(1)}s - ${window.absoluteEnd.toFixed(1)}s`,
    `- Duration: ${(window.absoluteEnd - window.absoluteStart).toFixed(1)}s`,
    window.segmentContext.description ? `- Description: ${window.segmentContext.description}` : "",
    window.segmentContext.team ? `- Involved Team: ${window.segmentContext.team}` : "",
    `- Target FPS: ${window.targetFps}`,
    "",
    `Note: Analyze ONLY the time range specified above. Report timestamps relative to window start (0.0s).`,
  ].filter(Boolean).join("\n");

  const promptText = [
    windowContext,
    "",
    prompt.instructions,
    "",
    "## Output Format (JSON)",
    JSON.stringify(prompt.output_schema, null, 2),
    "",
    "Task: " + prompt.task,
    "",
    "Return JSON only.",
  ].join("\n");

  // Phase 3: Use context caching for cost reduction
  const useCache = cache.cacheId && cache.version !== "fallback";

  // Calculate dynamic maxOutputTokens based on video duration
  const videoDurationSec = cache.videoDurationSec || 600;
  const baseTokens = 12288;
  const tokensPerMinute = 800;
  const maxOutputTokens = Math.min(
    32768,
    baseTokens + Math.ceil((videoDurationSec / 60) * tokensPerMinute)
  );

  const generationConfig = {
    // Phase 2.4: 0.35→0.25に調整（攻撃的シュート検出を維持しつつ安定性向上）
    temperature: 0.25,
    topP: 0.95,
    topK: 40,
    maxOutputTokens,
    responseMimeType: "application/json",
    responseSchema: GEMINI_RESPONSE_SCHEMA,
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
          { matchId, step: "detect_events_windowed" }
        );
      } else {
        // Fallback to direct file URI when cache not available
        const fileUri = cache.storageUri || cache.fileUri;
        if (!fileUri) {
          throw new Error(
            `No valid file URI found for fallback. matchId: ${matchId}, cacheVersion: ${cache.version}`
          );
        }
        const request: Gemini3Request = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  fileData: {
                    fileUri,
                    mimeType: "video/mp4",
                  },
                },
                { text: promptText },
              ],
            },
          ],
          generationConfig,
        };
        response = await callGeminiApi(projectId, modelId, request, { matchId, step: "detect_events_windowed" });
      }

      // Check for safety filter blocks
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked request: ${response.promptFeedback.blockReason}`);
      }

      const text = extractTextFromResponse(response);

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = parseJsonFromGemini(text) as Record<string, unknown> | unknown[];

      // Handle empty array case before Zod validation
      // Gemini may return [] when no events are detected (e.g., stoppage segments)
      if (Array.isArray(parsed) && parsed.length === 0) {
        log.info("No events detected in window (empty response)", {
          windowId: window.windowId,
          segmentType: window.segmentContext?.type,
        });
        return [];
      }

      // Handle { events: [] } case
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).events) && ((parsed as Record<string, unknown>).events as unknown[]).length === 0) {
        log.info("No events detected in window (empty events array)", {
          windowId: window.windowId,
          segmentType: window.segmentContext?.type,
          metadata: (parsed as Record<string, unknown>).metadata,
        });
        return [];
      }

      const validated = EventsResponseSchema.parse(parsed);

      // Handle both object format { metadata, events } and direct array format
      const events = Array.isArray(validated) ? validated : validated.events;

      // Convert to RawEvent format with absolute timestamps
      const rawEvents: RawEvent[] = events.map((event) => {
        // v4: Convert Gemini position (0-100) to normalized (0-1) coordinates
        let position: { x: number; y: number } | undefined;
        let positionConfidence: number | undefined;

        if (event.position && typeof event.position.x === "number" && typeof event.position.y === "number") {
          const rawX = event.position.x;
          const rawY = event.position.y;

          // NaN/Infinity チェック
          if (!isFinite(rawX) || !isFinite(rawY)) {
            log.warn("Invalid position value (NaN or Infinity)", {
              windowId: window.windowId,
              eventType: event.type,
              rawPosition: { x: rawX, y: rawY },
            });
            // 無効な位置データはスキップ
            position = undefined;
            positionConfidence = undefined;
          } else if (rawX < 0 || rawY < 0) {
            // 負の値は無効
            log.warn("Gemini returned negative position value", {
              windowId: window.windowId,
              eventType: event.type,
              rawPosition: { x: rawX, y: rawY },
            });
            position = undefined;
            positionConfidence = undefined;
          } else {
            let normalizedX: number;
            let normalizedY: number;

            // 位置スケール判定: より堅牢なロジック
            // 両方の値が1以下 → 0-1スケール（既に正規化済み）
            // 両方の値が1より大きく100以下 → 0-100スケール
            // 混在ケース → より大きい値のスケールに合わせる
            const bothNormalized = rawX <= 1 && rawY <= 1;
            const bothScaled = rawX > 1 && rawY > 1 && rawX <= 100 && rawY <= 100;
            const maxValue = Math.max(rawX, rawY);

            if (bothNormalized) {
              // 既に0-1正規化済み
              normalizedX = rawX;
              normalizedY = rawY;
              log.debug("Position already normalized (0-1 scale)", {
                windowId: window.windowId,
                eventType: event.type,
                position: { x: rawX, y: rawY },
              });
            } else if (bothScaled) {
              // 両方が0-100スケール
              normalizedX = rawX / 100;
              normalizedY = rawY / 100;
            } else if (maxValue <= 100) {
              // 混在ケース: より大きい値に基づいて判断
              if (maxValue > 1) {
                // 0-100スケールと判断
                normalizedX = rawX / 100;
                normalizedY = rawY / 100;
                log.debug("Mixed scale detected, treating as 0-100", {
                  windowId: window.windowId,
                  eventType: event.type,
                  rawPosition: { x: rawX, y: rawY },
                });
              } else {
                // 0-1スケールと判断
                normalizedX = rawX;
                normalizedY = rawY;
              }
            } else {
              // 範囲外の値 - 警告を出してクランプ
              log.warn("Gemini returned out-of-bounds position", {
                windowId: window.windowId,
                eventType: event.type,
                rawPosition: { x: rawX, y: rawY },
              });
              // 100を超える場合は0-100スケールと仮定して正規化後にクランプ
              normalizedX = Math.max(0, Math.min(1, rawX / 100));
              normalizedY = Math.max(0, Math.min(1, rawY / 100));
            }

            position = {
              x: Math.max(0, Math.min(1, normalizedX)),
              y: Math.max(0, Math.min(1, normalizedY)),
            };
            positionConfidence = event.position.confidence ?? event.confidence;
          }
        }

        return {
          matchId,
          videoId,
          windowId: window.windowId,
          relativeTimestamp: event.timestamp,
          absoluteTimestamp: window.absoluteStart + event.timestamp,
          type: event.type,
          team: event.team,
          player: event.player,
          zone: event.zone,
          position,
          positionConfidence,
          details: event.details || {},
          confidence: event.confidence,
          visualEvidence: event.visualEvidence,
        };
      });

      return rawEvents;
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 180000, // 3 minutes per window
      onRetry: (attempt, error) => {
        log.warn("Retrying window event detection", {
          windowId: window.windowId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}

/**
 * Process windows in parallel batches
 */
async function processWindowsInBatches(
  windows: AnalysisWindow[],
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  matchId: string,
  videoId: string | undefined,
  log: ILogger
): Promise<RawEvent[]> {
  const allEvents: RawEvent[] = [];
  const batchSize = WINDOW_CONFIG.parallelism;

  for (let i = 0; i < windows.length; i += batchSize) {
    const batch = windows.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(windows.length / batchSize);

    log.info(`Processing window batch ${batchNum}/${totalBatches}`, {
      windowIds: batch.map((w) => w.windowId),
    });

    const batchPromises = batch.map((window) => processWindow(window, cache, prompt, matchId, videoId, log));
    const batchResults = await Promise.all(batchPromises);

    for (const events of batchResults) {
      allEvents.push(...events);
    }

    log.info(`Batch ${batchNum}/${totalBatches} complete`, {
      eventsInBatch: batchResults.reduce((sum, events) => sum + events.length, 0),
      totalEventsSoFar: allEvents.length,
    });
  }

  return allEvents;
}

// ============================================================================
// Main Step Function
// ============================================================================

export type DetectEventsWindowedOptions = {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  version: string;
  segments: VideoSegment[];
  logger?: ILogger;
};

export type DetectEventsWindowedResult = {
  matchId: string;
  windowCount: number;
  rawEventCount: number;
  eventsByType: Record<string, number>;
  rawEvents: RawEvent[];
};

/**
 * Step 07b: Detect events using windowed analysis
 *
 * This step processes video segments in overlapping windows for more accurate
 * event detection. Returns raw events (before deduplication) for downstream processing.
 */
export async function stepDetectEventsWindowed(
  options: DetectEventsWindowedOptions
): Promise<DetectEventsWindowedResult> {
  const { matchId, videoId, version, segments } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "detect_events_windowed" }) : log;

  stepLogger.info("Starting windowed event detection", {
    matchId,
    version,
    segmentCount: segments.length,
    promptVersion: PROMPT_VERSION,
  });

  // Phase 2.10: Consolidate short adjacent segments to reduce API calls
  const consolidatedSegments = consolidateSegments(segments);

  if (consolidatedSegments.length !== segments.length) {
    stepLogger.info("Segments consolidated to reduce API calls", {
      matchId,
      originalCount: segments.length,
      consolidatedCount: consolidatedSegments.length,
      reduction: `${((1 - consolidatedSegments.length / segments.length) * 100).toFixed(1)}%`,
    });
  }

  // Generate windows from consolidated segments
  const windows = generateWindows(consolidatedSegments);

  if (windows.length === 0) {
    stepLogger.warn("No analysis windows generated", { matchId, segmentCount: segments.length });
    return {
      matchId,
      windowCount: 0,
      rawEventCount: 0,
      eventsByType: {},
      rawEvents: [],
    };
  }

  stepLogger.info("Generated analysis windows", {
    matchId,
    windowCount: windows.length,
    segmentTypes: segments.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });

  // Get cache info (with fallback to direct file URI)
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, options.videoId, "detect_events_windowed");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot detect events", { matchId });
    return {
      matchId,
      windowCount: windows.length,
      rawEventCount: 0,
      eventsByType: {},
      rawEvents: [],
    };
  }

  stepLogger.info("Using video for windowed event detection", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
  });

  // Load prompt
  const prompt = await loadPrompt();

  // Process windows in parallel batches
  const rawEvents = await processWindowsInBatches(windows, cache, prompt, matchId, videoId, stepLogger);

  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  // Compute event statistics
  const eventsByType = rawEvents.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  stepLogger.info("Windowed event detection complete", {
    matchId,
    windowCount: windows.length,
    rawEventCount: rawEvents.length,
    eventsByType,
    averageEventsPerWindow: (rawEvents.length / windows.length).toFixed(2),
  });

  return {
    matchId,
    windowCount: windows.length,
    rawEventCount: rawEvents.length,
    eventsByType,
    rawEvents,
  };
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Get FPS for a segment type
 */
export function getFpsForSegmentType(segmentType: SegmentType): number {
  return WINDOW_CONFIG.fpsBySegment[segmentType] || 3;
}

/**
 * Get window configuration (for testing/debugging)
 */
export function getWindowConfig() {
  return { ...WINDOW_CONFIG };
}
