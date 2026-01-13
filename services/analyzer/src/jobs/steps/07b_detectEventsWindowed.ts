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
import { callGeminiApi, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type { TeamId } from "@soccer/shared";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";

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
  windowId: string;
  relativeTimestamp: number; // Relative to window start
  absoluteTimestamp: number; // Relative to video start
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece";
  team: "home" | "away";
  player?: string;
  zone?: "defensive_third" | "middle_third" | "attacking_third";
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
    setPieceType?: "corner" | "free_kick" | "penalty" | "throw_in";
  };
  confidence: number;
  visualEvidence?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const WINDOW_CONFIG = {
  defaultDurationSec: 60,
  overlapSec: 15,
  fpsBySegment: {
    active_play: 3,
    set_piece: 2,
    goal_moment: 5,
    stoppage: 1, // Or skip entirely
  } as Record<SegmentType, number>,
  parallelism: 5,
  skipStoppages: true, // Skip stoppage segments entirely
};

// Prompt version
const PROMPT_VERSION = process.env.PROMPT_VERSION || "v2";

// ============================================================================
// Zod Schemas (v2 format)
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
  setPieceType: z.enum(["corner", "free_kick", "penalty", "throw_in"]).optional(),
});

const EventSchema = z.object({
  timestamp: z.number().min(0),
  type: z.enum(["pass", "carry", "turnover", "shot", "setPiece"]),
  team: z.enum(["home", "away"]),
  player: z.string().optional(),
  zone: z.enum(["defensive_third", "middle_third", "attacking_third"]).optional(),
  details: EventDetailsSchema.optional(),
  // v3: Allow 0.3 minimum for shots (aggressive detection)
  confidence: z.number().min(0.3).max(1),
  visualEvidence: z.string().optional(),
});

const MetadataSchema = z.object({
  videoQuality: z.enum(["good", "fair", "poor"]).optional(),
  qualityIssues: z.array(z.string()).optional(),
  analyzedDurationSec: z.number().optional(),
}).optional();

const EventsResponseSchema = z.object({
  metadata: MetadataSchema,
  events: z.array(EventSchema),
});

type GeminiEvent = z.infer<typeof EventSchema>;
type EventsResponse = z.infer<typeof EventsResponseSchema>;

// ============================================================================
// Prompt Loading
// ============================================================================

let cachedPrompt: { version: string; task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

async function loadPrompt(promptVersion: string = PROMPT_VERSION) {
  if (cachedPrompt && cachedPrompt.version === promptVersion) return cachedPrompt;

  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", `event_detection_${promptVersion}.json`);
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

  return withRetry(
    async () => {
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
        generationConfig: {
          // v3: Increased from 0.2 to 0.35 for more aggressive shot detection
          temperature: 0.35,
          responseMimeType: "application/json",
        },
      };

      const response = await callGeminiApi(projectId, modelId, request, { matchId, step: "detect_events_windowed" });

      // Check for safety filter blocks
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked request: ${response.promptFeedback.blockReason}`);
      }

      const text = extractTextFromResponse(response);

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = JSON.parse(text);
      const validated = EventsResponseSchema.parse(parsed);

      // Convert to RawEvent format with absolute timestamps
      const rawEvents: RawEvent[] = validated.events.map((event) => ({
        windowId: window.windowId,
        relativeTimestamp: event.timestamp,
        absoluteTimestamp: window.absoluteStart + event.timestamp,
        type: event.type,
        team: event.team,
        player: event.player,
        zone: event.zone,
        details: event.details || {},
        confidence: event.confidence,
        visualEvidence: event.visualEvidence,
      }));

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
  const cache = await getValidCacheOrFallback(matchId);

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
