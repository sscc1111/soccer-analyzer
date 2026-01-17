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
 * Note: This interface must be compatible with the RawEvent in deduplication.ts
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
  // Phase 3: Position estimation (v4)
  position?: { x: number; y: number };  // Normalized 0-100 coordinates
  positionConfidence?: number;  // 0-1 confidence in position estimate
  details: {
    passType?: "short" | "medium" | "long" | "through" | "cross";
    outcome?: "complete" | "incomplete" | "intercepted";
    targetPlayer?: string;
    distance?: number;
    endReason?: "pass" | "shot" | "dispossessed" | "stopped";
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
};

// Prompt version
// Phase 3: v4にアップグレード（位置推定機能追加版）
const PROMPT_VERSION = process.env.PROMPT_VERSION || "v4";

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

// Phase 3: Position schema for v4
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
    // Phase 3: Position estimation (v4)
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
          // Phase 3: Position estimation (v4)
          position: {
            type: "object",
            properties: {
              x: { type: "number", minimum: 0, maximum: 100, description: "0=home goal line, 100=away goal line" },
              y: { type: "number", minimum: 0, maximum: 100, description: "0=top touchline, 100=bottom touchline" },
              confidence: { type: "number", minimum: 0, maximum: 1, description: "Position estimate confidence" },
            },
          },
          details: {
            type: "object",
            properties: {
              passType: { type: "string", enum: ["short", "medium", "long", "through", "cross"] },
              outcome: { type: "string", enum: ["complete", "incomplete", "intercepted"] },
              targetPlayer: { type: "string" },
              distance: { type: "number" },
              endReason: { type: "string", enum: ["pass", "shot", "dispossessed", "stopped"] },
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

async function loadPrompt(promptVersion: string = PROMPT_VERSION) {
  if (cachedPrompt && cachedPrompt.version === promptVersion) return cachedPrompt;

  const promptPath = path.join(__dirname, "prompts", `event_detection_${promptVersion}.json`);
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
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

      // Safety check: prevent infinite loops
      if (windowIndex >= 100) {
        logger.warn("Too many windows generated for segment", {
          segmentId: segment.segmentId,
          duration: segmentDuration,
        });
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
  const generationConfig = {
    // Phase 2.4: 0.35→0.25に調整（攻撃的シュート検出を維持しつつ安定性向上）
    temperature: 0.25,
    topP: 0.95,
    topK: 40,
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
        // Phase 3: Normalize position to 0-100 scale
        let position: { x: number; y: number } | undefined;
        let positionConfidence: number | undefined;

        if (event.position) {
          const pos = event.position;
          // Validate and normalize position values
          if (typeof pos.x === "number" && typeof pos.y === "number" &&
              !Number.isNaN(pos.x) && !Number.isNaN(pos.y) &&
              pos.x >= 0 && pos.x <= 100 && pos.y >= 0 && pos.y <= 100) {
            position = { x: pos.x, y: pos.y };
            positionConfidence = pos.confidence ?? event.confidence;
          }
        }

        return {
          matchId,
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

    const batchPromises = batch.map((window) => processWindow(window, cache, prompt, matchId, log));
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
  const { matchId, version, segments } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "detect_events_windowed" }) : log;

  stepLogger.info("Starting windowed event detection", {
    matchId,
    version,
    segmentCount: segments.length,
    promptVersion: PROMPT_VERSION,
  });

  // Generate windows from segments
  const windows = generateWindows(segments);

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
  const cache = await getValidCacheOrFallback(matchId, "detect_events_windowed");

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
  const rawEvents = await processWindowsInBatches(windows, cache, prompt, matchId, stepLogger);

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
