/**
 * Step 07a: Segment Video with Gemini
 *
 * 試合動画を意味のある時間窓に分割（active_play, stoppage, set_piece, goal_moment, replay）
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callGeminiApi, callGeminiApiWithCache, extractTextFromResponse, type Gemini3Request } from "../../gemini/gemini3Client";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { defaultLogger as logger, ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";

// Prompt version: can be set via PROMPT_VERSION env var (default: v1)
const PROMPT_VERSION = process.env.PROMPT_VERSION || "v1";

// Response schema validation
const MetadataSchema = z.object({
  totalDurationSec: z.number().positive(),
  videoQuality: z.enum(["good", "fair", "poor"]),
  qualityNotes: z.string().optional(),
});

const TeamInfoSchema = z.object({
  colors: z.string(),
  attackingDirection: z.enum(["left_to_right", "right_to_left"]),
});

const VideoSegmentSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  type: z.enum(["active_play", "stoppage", "set_piece", "goal_moment", "replay"]),
  // Set piece subtypes + stoppage subtypes (v2 prompt additions)
  subtype: z.enum([
    // Set piece subtypes
    "corner", "free_kick", "penalty", "goal_kick", "throw_in", "kick_off",
    // Stoppage subtypes (v2)
    "foul", "injury", "substitution", "referee_decision", "other"
  ]).optional(),
  description: z.string(),
  attackingTeam: z.enum(["home", "away"]).optional(),
  importance: z.number().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1),
  // v2: visual evidence for confidence calibration
  visualEvidence: z.string().optional(),
});

const SegmentationResponseSchema = z.object({
  metadata: MetadataSchema,
  teams: z.object({
    home: TeamInfoSchema,
    away: TeamInfoSchema,
  }),
  segments: z.array(VideoSegmentSchema),
});

export type VideoSegment = z.infer<typeof VideoSegmentSchema>;
type SegmentationResponse = z.infer<typeof SegmentationResponseSchema>;

export type SegmentVideoOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type SegmentVideoResult = {
  matchId: string;
  segmentCount: number;
  totalDurationSec: number;
  videoQuality: string;
  skipped: boolean;
  error?: string;
  segments: VideoSegmentDoc[]; // Added for pipeline integration
};

// Firestore document schema for segments collection
export type VideoSegmentDoc = VideoSegment & {
  segmentId: string;
  matchId: string;
  version: string;
  createdAt: string;
};

let cachedPrompt: { version: string; task: string; instructions: string; output_schema: Record<string, unknown> } | null = null;

async function loadPrompt(promptVersion: string = PROMPT_VERSION) {
  // Only use cache if same version
  if (cachedPrompt && cachedPrompt.version === promptVersion) return cachedPrompt;

  const promptPath = path.join(__dirname, "prompts", `video_segmentation_${promptVersion}.json`);
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
 * Segment video into meaningful time windows using Gemini
 */
export async function stepSegmentVideo(
  options: SegmentVideoOptions
): Promise<SegmentVideoResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "segment_video" }) : log;

  stepLogger.info("Starting video segmentation", { matchId, version, promptVersion: PROMPT_VERSION });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing segments (idempotency)
  const existingSegments = await matchRef
    .collection("segments")
    .where("version", "==", version)
    .limit(1)
    .get();

  if (!existingSegments.empty) {
    stepLogger.info("Segments already exist for this version, skipping", { matchId, version });

    // Get full segment count and metadata
    const allSegments = await matchRef.collection("segments").where("version", "==", version).get();
    const matchDoc = await matchRef.get();
    const matchData = matchDoc.data();

    // Map existing segments to VideoSegmentDoc format
    const existingDocs = allSegments.docs.map((doc) => doc.data() as VideoSegmentDoc);

    return {
      matchId,
      segmentCount: allSegments.size,
      totalDurationSec: matchData?.segmentationMetadata?.totalDurationSec || 0,
      videoQuality: matchData?.segmentationMetadata?.videoQuality || "unknown",
      skipped: true,
      segments: existingDocs,
    };
  }

  // Get cache info (with fallback to direct file URI)
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, "segment_video");

  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot segment video", { matchId });
    return {
      matchId,
      segmentCount: 0,
      totalDurationSec: 0,
      videoQuality: "unknown",
      skipped: true,
      error: "No video file URI available",
      segments: [],
    };
  }

  stepLogger.info("Using video for segmentation", {
    matchId,
    fileUri: cache.storageUri || cache.fileUri,
    hasCaching: cache.version !== "fallback",
  });

  const prompt = await loadPrompt();
  const segmentationResult = await segmentVideoWithGemini(cache, prompt, matchId, stepLogger);

  // Save segments to Firestore
  const BATCH_LIMIT = 450; // Leave buffer for safety (Firestore max: 500)
  const now = new Date().toISOString();

  // Prepare segment documents
  const segmentDocs: VideoSegmentDoc[] = segmentationResult.segments.map((segment, index) => ({
    segmentId: `${matchId}_segment_${index}`,
    matchId,
    version,
    createdAt: now,
    ...segment,
  }));

  // Commit in batches
  const totalBatches = Math.ceil(segmentDocs.length / BATCH_LIMIT);
  stepLogger.info("Writing segments to Firestore", {
    totalSegments: segmentDocs.length,
    totalBatches,
    batchLimit: BATCH_LIMIT,
  });

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, segmentDocs.length);

    for (let i = startIdx; i < endIdx; i++) {
      const doc = segmentDocs[i];
      batch.set(matchRef.collection("segments").doc(doc.segmentId), doc);
    }

    await batch.commit();
    stepLogger.debug("Batch committed", { batchIdx: batchIdx + 1, totalBatches, segmentsInBatch: endIdx - startIdx });
  }

  // Save metadata to match document
  await matchRef.update({
    segmentationMetadata: {
      totalDurationSec: segmentationResult.metadata.totalDurationSec,
      videoQuality: segmentationResult.metadata.videoQuality,
      qualityNotes: segmentationResult.metadata.qualityNotes,
      version,
      createdAt: now,
    },
    teamInfo: {
      home: {
        colors: segmentationResult.teams.home.colors,
        attackingDirection: segmentationResult.teams.home.attackingDirection,
      },
      away: {
        colors: segmentationResult.teams.away.colors,
        attackingDirection: segmentationResult.teams.away.attackingDirection,
      },
    },
  });

  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Video segmentation complete", {
    matchId,
    segmentCount: segmentDocs.length,
    totalDuration: segmentationResult.metadata.totalDurationSec,
    videoQuality: segmentationResult.metadata.videoQuality,
  });

  return {
    matchId,
    segmentCount: segmentDocs.length,
    totalDurationSec: segmentationResult.metadata.totalDurationSec,
    videoQuality: segmentationResult.metadata.videoQuality,
    skipped: false,
    segments: segmentDocs,
  };
}

async function segmentVideoWithGemini(
  cache: GeminiCacheDoc,
  prompt: { task: string; instructions: string; output_schema: Record<string, unknown> },
  matchId: string,
  log: ILogger
): Promise<SegmentationResponse> {
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
    temperature: 0.1, // Lower temperature for consistent segmentation
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
          { matchId, step: "segment_video" }
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
        response = await callGeminiApi(projectId, modelId, request, { matchId, step: "segment_video" });
      }

      // Check for safety filter blocks
      if (response.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked request: ${response.promptFeedback.blockReason}`);
      }

      const text = extractTextFromResponse(response);

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = JSON.parse(text);
      const validated = SegmentationResponseSchema.parse(parsed);

      // Validate segments are in chronological order
      for (let i = 1; i < validated.segments.length; i++) {
        const prev = validated.segments[i - 1];
        const curr = validated.segments[i];
        if (curr.startSec < prev.endSec) {
          log.warn("Segments overlap or out of order", {
            prevIndex: i - 1,
            prevEnd: prev.endSec,
            currIndex: i,
            currStart: curr.startSec,
          });
        }
      }

      return validated;
    },
    {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 600000, // 10 minutes for full video segmentation
      onRetry: (attempt, error) => {
        log.warn("Retrying video segmentation", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}
