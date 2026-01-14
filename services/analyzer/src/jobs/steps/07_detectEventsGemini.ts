/**
 * Step 07: Detect Events with Gemini (Gemini-first Architecture)
 *
 * Gemini を使用して試合動画からイベント（パス、キャリー、ターンオーバー等）を検出
 * 既存のルールベース検出を置き換え
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import type {
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  ShotEventDoc,
  SetPieceEventDoc,
  TeamId,
  Point2D,
} from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";
import { parseJsonFromGemini } from "../../lib/json";

// Prompt version: can be set via PROMPT_VERSION env var (default: v1)
const PROMPT_VERSION = process.env.PROMPT_VERSION || "v1";

// Response schema validation - supports both v1 and v2 formats
const EventDetailsSchema = z.object({
  passType: z.enum(["short", "medium", "long", "through", "cross"]).optional(),
  outcome: z.enum(["complete", "incomplete", "intercepted"]).optional(),
  targetPlayer: z.string().optional(),
  distance: z.number().optional(),
  endReason: z.enum(["pass", "shot", "dispossessed", "stopped"]).optional(), // v2
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

const EventSchema = z.preprocess(
  normalizeEventFields,
  z.object({
    timestamp: z.number().min(0),
    type: z.enum(["pass", "carry", "turnover", "shot", "setPiece"]),
    team: z.enum(["home", "away"]),
    player: z.string().optional(),
    zone: z.enum(["defensive_third", "middle_third", "attacking_third"]).optional(), // v2
    details: EventDetailsSchema.optional(),
    // v3: Allow 0.3 minimum for shots (aggressive detection)
    confidence: z.number().min(0.3).max(1),
    visualEvidence: z.string().optional(), // v2
  })
);

// v2 metadata schema
const MetadataSchema = z.object({
  videoQuality: z.enum(["good", "fair", "poor"]).optional(),
  qualityIssues: z.array(z.string()).optional(),
  analyzedDurationSec: z.number().optional(),
}).optional();

// Support both { metadata, events } object format and direct array format
const EventsResponseSchema = z.union([
  z.object({
    metadata: MetadataSchema, // v2 optional
    events: z.array(EventSchema),
  }),
  z.array(EventSchema), // Direct array fallback
]);

// Gemini responseSchema to force consistent output format
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
          timestamp: { type: "number", description: "Event time in seconds" },
          type: { type: "string", enum: ["pass", "carry", "turnover", "shot", "setPiece"] },
          team: { type: "string", enum: ["home", "away"] },
          player: { type: "string" },
          zone: { type: "string", enum: ["defensive_third", "middle_third", "attacking_third"] },
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
          confidence: { type: "number", minimum: 0.3, maximum: 1.0 },
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

export type DetectEventsGeminiOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type DetectEventsGeminiResult = {
  matchId: string;
  passCount: number;
  carryCount: number;
  turnoverCount: number;
  shotCount: number;
  setPieceCount: number;
  skipped: boolean;
  error?: string;
};

let cachedPrompt: { version: string; task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

async function loadPrompt(promptVersion: string = PROMPT_VERSION) {
  // Only use cache if same version
  if (cachedPrompt && cachedPrompt.version === promptVersion) return cachedPrompt;

  const promptPath = path.resolve(process.cwd(), "src/gemini/prompts", `event_detection_${promptVersion}.json`);
  const data = await readFile(promptPath, "utf-8");
  cachedPrompt = JSON.parse(data);
  return cachedPrompt!;
}

/**
 * Get current prompt version being used
 */
export function getPromptVersion(): string {
  return PROMPT_VERSION;
}

/**
 * Detect events from match video using Gemini
 */
export async function stepDetectEventsGemini(
  options: DetectEventsGeminiOptions
): Promise<DetectEventsGeminiResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "detect_events_gemini" }) : log;

  stepLogger.info("Starting Gemini event detection", { matchId, version, promptVersion: PROMPT_VERSION });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing events (idempotency)
  const existingPassEvents = await matchRef
    .collection("passEvents")
    .where("version", "==", version)
    .limit(1)
    .get();

  if (!existingPassEvents.empty) {
    stepLogger.info("Events already detected for this version, skipping", { matchId, version });
    // Get counts from existing data
    const [passSnap, carrySnap, turnoverSnap, shotSnap, setPieceSnap] = await Promise.all([
      matchRef.collection("passEvents").where("version", "==", version).get(),
      matchRef.collection("carryEvents").where("version", "==", version).get(),
      matchRef.collection("turnoverEvents").where("version", "==", version).get(),
      matchRef.collection("shotEvents").where("version", "==", version).get(),
      matchRef.collection("setPieceEvents").where("version", "==", version).get(),
    ]);
    return {
      matchId,
      passCount: passSnap.size,
      carryCount: carrySnap.size,
      turnoverCount: turnoverSnap.size,
      shotCount: shotSnap.size,
      setPieceCount: setPieceSnap.size,
      skipped: true,
    };
  }

  // Get cache info (with fallback to direct file URI)
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, "detect_events_gemini");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot detect events", { matchId });
    return {
      matchId,
      passCount: 0,
      carryCount: 0,
      turnoverCount: 0,
      shotCount: 0,
      setPieceCount: 0,
      skipped: true,
      error: "No video file URI available",
    };
  }

  stepLogger.info("Using video for event detection", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
  });

  const prompt = await loadPrompt();
  const events = await detectEventsWithGemini(cache, prompt, matchId, stepLogger);

  // Categorize events
  const passEvents = events.filter((e) => e.type === "pass");
  const carryEvents = events.filter((e) => e.type === "carry");
  const turnoverEvents = events.filter((e) => e.type === "turnover");
  const shotEvents = events.filter((e) => e.type === "shot");
  const setPieceEvents = events.filter((e) => e.type === "setPiece");

  // Save events to Firestore with batch limit handling (max 500 operations per batch)
  const BATCH_LIMIT = 450; // Leave buffer for safety
  const now = new Date().toISOString();

  // Collect all documents to write
  type DocWrite = { collection: string; id: string; data: unknown };
  const allDocs: DocWrite[] = [];

  // Prepare pass events
  for (let i = 0; i < passEvents.length; i++) {
    const e = passEvents[i];
    const eventDoc: PassEventDoc = {
      eventId: matchId + "_pass_" + i,
      matchId,
      type: "pass",
      frameNumber: Math.floor(e.timestamp * 30), // Assume 30fps
      timestamp: e.timestamp,
      kicker: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: { x: 0, y: 0 } as Point2D,
        confidence: e.confidence,
      },
      receiver: e.details?.targetPlayer ? {
        trackId: null,
        playerId: e.details.targetPlayer,
        teamId: e.team as TeamId,
        position: null,
        confidence: e.confidence,
      } : null,
      outcome: (e.details?.outcome || "complete") as "complete" | "incomplete" | "intercepted",
      outcomeConfidence: e.confidence,
      passType: e.details?.passType,
      confidence: e.confidence,
      needsReview: e.confidence < 0.7,
      source: "auto",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "passEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare carry events
  for (let i = 0; i < carryEvents.length; i++) {
    const e = carryEvents[i];
    const eventDoc: CarryEventDoc = {
      eventId: matchId + "_carry_" + i,
      matchId,
      type: "carry",
      trackId: "",
      playerId: e.player || null,
      teamId: e.team as TeamId,
      startFrame: Math.floor(e.timestamp * 30),
      endFrame: Math.floor(e.timestamp * 30) + 30,
      startTime: e.timestamp,
      endTime: e.timestamp + 1,
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 0, y: 0 },
      carryIndex: 0,
      progressIndex: 0,
      distanceMeters: e.details?.distance,
      confidence: e.confidence,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "carryEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare turnover events
  for (let i = 0; i < turnoverEvents.length; i++) {
    const e = turnoverEvents[i];
    const eventDoc: TurnoverEventDoc = {
      eventId: matchId + "_turnover_" + i,
      matchId,
      type: "turnover",
      turnoverType: "lost",
      frameNumber: Math.floor(e.timestamp * 30),
      timestamp: e.timestamp,
      player: {
        trackId: "",
        playerId: e.player || null,
        teamId: e.team as TeamId,
        position: { x: 0, y: 0 },
      },
      context: e.details?.turnoverType as "tackle" | "interception" | "bad_touch" | "out_of_bounds" | "other" | undefined,
      confidence: e.confidence,
      needsReview: e.confidence < 0.7,
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "turnoverEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare shot events
  for (let i = 0; i < shotEvents.length; i++) {
    const e = shotEvents[i];
    const eventDoc: ShotEventDoc = {
      eventId: matchId + "_shot_" + i,
      matchId,
      type: "shot",
      timestamp: e.timestamp,
      team: e.team as TeamId,
      player: e.player,
      result: (e.details?.shotResult || "missed") as "goal" | "saved" | "blocked" | "missed" | "post",
      confidence: e.confidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "shotEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Prepare set piece events
  for (let i = 0; i < setPieceEvents.length; i++) {
    const e = setPieceEvents[i];
    const eventDoc: SetPieceEventDoc = {
      eventId: matchId + "_setpiece_" + i,
      matchId,
      type: "setPiece",
      timestamp: e.timestamp,
      team: e.team as TeamId,
      player: e.player,
      setPieceType: (e.details?.setPieceType || "free_kick") as "corner" | "free_kick" | "penalty" | "throw_in" | "goal_kick",
      confidence: e.confidence,
      source: "gemini",
      version,
      createdAt: now,
    };
    allDocs.push({ collection: "setPieceEvents", id: eventDoc.eventId, data: eventDoc });
  }

  // Commit in batches to respect Firestore 500 operation limit
  const totalBatches = Math.ceil(allDocs.length / BATCH_LIMIT);
  stepLogger.info("Writing events to Firestore", {
    totalDocs: allDocs.length,
    totalBatches,
    batchLimit: BATCH_LIMIT,
  });

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, allDocs.length);

    for (let i = startIdx; i < endIdx; i++) {
      const doc = allDocs[i];
      batch.set(matchRef.collection(doc.collection).doc(doc.id), doc.data);
    }

    await batch.commit();
    stepLogger.debug("Batch committed", { batchIdx: batchIdx + 1, totalBatches, docsInBatch: endIdx - startIdx });
  }
  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Event detection complete", {
    matchId,
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
    setPieceCount: setPieceEvents.length,
  });

  return {
    matchId,
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
    setPieceCount: setPieceEvents.length,
    skipped: false,
  };
}

async function detectEventsWithGemini(
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  matchId: string,
  log: ILogger
): Promise<GeminiEvent[]> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  const promptText = [
    prompt.instructions,
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
        log.info("Using context cache for event detection", { cacheId: cache.cacheId });
        response = await callGeminiApiWithCache(
          projectId,
          modelId,
          cache.cacheId,
          promptText,
          generationConfig,
          { matchId, step: "detect_events_gemini" }
        );
      } else {
        // Fallback to direct file URI when cache not available
        log.info("Using direct file URI (no cache available)");
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
        response = await callGeminiApi(projectId, modelId, request, { matchId, step: "detect_events_gemini" });
      }

      // Check for safety filter blocks
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked request: ${response.promptFeedback.blockReason}`);
      }

      const text = extractTextFromResponse(response);

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = parseJsonFromGemini(text);
      const validated = EventsResponseSchema.parse(parsed);
      // Handle both object format { metadata, events } and direct array format
      return Array.isArray(validated) ? validated : validated.events;
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 600000, // 10 minutes for full event detection
      onRetry: (attempt, error) => {
        log.warn("Retrying event detection", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
