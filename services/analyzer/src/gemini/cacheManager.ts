/**
 * Gemini Context Cache Manager
 *
 * Vertex AI Context Caching を使用して動画分析のコストを 90% 削減
 *
 * Context Caching の仕組み:
 * - 大きなコンテンツ（動画など）を一度キャッシュとして保存
 * - その後の複数のリクエストでキャッシュを再利用
 * - キャッシュされたトークンは大幅に割引される
 *
 * 制約:
 * - 最小キャッシュサイズ: 32,768 トークン
 * - TTL: 最小1時間、最大7日
 * - 対応モデル: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash 等
 */

import { VertexAI } from "@google-cloud/vertexai";
import { Firestore, FieldValue } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import type { GeminiCacheDoc as SharedGeminiCacheDoc } from "@soccer/shared";
import { defaultLogger as logger } from "../lib/logger";
import { getDb } from "../firebase/admin";
import { withRetry } from "../lib/retry";
import { ExternalServiceError, RateLimitError } from "../lib/errors";

// Extended cache document with runtime tracking fields
export type GeminiCacheDoc = SharedGeminiCacheDoc & {
  displayName?: string;
  usageCount?: number;
  lastUsedAt?: string;
};

// Phase 3.1: Cache hit/miss tracking types
export type CacheAccessType = "hit" | "miss_expired" | "miss_not_found" | "fallback";

export interface CacheAccessRecord {
  matchId: string;
  stepName: string;
  accessType: CacheAccessType;
  timestamp: string;
  cacheId?: string;
  remainingTtlSeconds?: number;
  fallbackReason?: string;
}

export interface CacheHitStats {
  matchId: string;
  totalAccesses: number;
  hits: number;
  misses: number;
  fallbacks: number;
  hitRate: number;
  accessesByStep: Record<string, { hits: number; misses: number; fallbacks: number }>;
}

export type CreateCacheOptions = {
  matchId: string;
  videoId?: string;
  fileUri: string;
  mimeType: string;
  displayName?: string;
  ttlSeconds?: number;
  systemInstruction?: string;
  videoDurationSec?: number;
};

export type CacheManagerConfig = {
  defaultTtlSeconds: number;
  minTokensForCache: number;
  autoRefreshThresholdMinutes: number;
};

const DEFAULT_CONFIG: CacheManagerConfig = {
  defaultTtlSeconds: 7200, // 2 hours (as per plan)
  minTokensForCache: 32768, // Minimum tokens for caching
  autoRefreshThresholdMinutes: 10, // Refresh if expiring within 10 minutes
};

// Vertex AI API types
export type VertexAICachedContent = {
  name: string; // Resource name: projects/{project}/locations/{location}/cachedContents/{id}
  model: string;
  displayName?: string;
  contents: Array<{
    role: string;
    parts: Array<{
      fileData?: {
        fileUri: string;
        mimeType: string;
      };
      text?: string;
    }>;
  }>;
  ttl?: string; // Format: "{seconds}s"
  expireTime?: string; // ISO 8601 timestamp
  createTime: string;
  updateTime: string;
};

type CreateCachedContentRequest = {
  model: string;
  displayName?: string;
  contents: Array<{
    role: string;
    parts: Array<{
      fileData?: {
        fileUri: string;
        mimeType: string;
      };
      text?: string;
    }>;
  }>;
  ttl: string; // Format: "{seconds}s"
  systemInstruction?: {
    parts: Array<{
      text: string;
    }>;
  };
};

type CreateCachedContentResponse = VertexAICachedContent;

/**
 * Get authenticated access token for Vertex AI API
 */
async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    throw new ExternalServiceError(
      "google-auth",
      "Failed to get access token",
      {},
      true
    );
  }

  return tokenResponse.token;
}

/**
 * Make authenticated request to Vertex AI API with retry
 *
 * @param timeoutMs - Custom timeout in milliseconds (default: 60000)
 *                    Use longer timeout for cache creation (e.g., 300000 = 5 min)
 */
async function vertexAIRequest<T>(
  url: string,
  method: string,
  body?: unknown,
  timeoutMs: number = 60000
): Promise<T> {
  return withRetry(
    async () => {
      const token = await getAccessToken();

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: { error?: { message?: string; code?: number; status?: string } } = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Ignore JSON parse errors
        }

        // Log the actual API error response for debugging
        logger.error("Vertex AI API error response", {
          statusCode: response.status,
          errorText: errorText.substring(0, 1000), // Limit to prevent huge logs
          errorMessage: errorData.error?.message,
          errorCode: errorData.error?.code,
          errorStatus: errorData.error?.status,
        });

        // Handle rate limiting
        if (response.status === 429) {
          throw new RateLimitError("vertex-ai", {
            statusCode: response.status,
            details: errorData,
          });
        }

        // Handle other API errors
        const errorMessage = errorData.error?.message || errorText || "Unknown API error";
        throw new ExternalServiceError(
          "vertex-ai",
          errorMessage,
          {
            statusCode: response.status,
            details: errorData,
          },
          response.status >= 500 // Retry on 5xx errors
        );
      }

      const data = await response.json();
      return data as T;
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      timeoutMs,
      operationName: `${method} ${url}`,
      logger,
    }
  );
}

/**
 * Calculate timeout for cache creation based on video duration
 *
 * Cache creation time depends on video length. We use:
 * - Base: 2 minutes (minimum for any video)
 * - Per minute of video: 1.5 minutes processing time
 * - Max: 30 minutes (to prevent infinite waits)
 *
 * Examples:
 * - 1 min video → 2 + 1.5 = 3.5 min timeout
 * - 5 min video → 2 + 7.5 = 9.5 min timeout
 * - 20 min video → 2 + 30 = 32 min → capped at 30 min
 */
function calculateCacheCreationTimeout(videoDurationSec?: number): number {
  const BASE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  const PER_MINUTE_TIMEOUT_MS = 1.5 * 60 * 1000; // 1.5 minutes per video minute
  const MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max

  if (!videoDurationSec || videoDurationSec <= 0) {
    // Default to 10 minutes if duration unknown
    return 10 * 60 * 1000;
  }

  const videoDurationMin = videoDurationSec / 60;
  const calculatedTimeout = BASE_TIMEOUT_MS + videoDurationMin * PER_MINUTE_TIMEOUT_MS;

  return Math.min(calculatedTimeout, MAX_TIMEOUT_MS);
}

/**
 * Create actual context cache using Vertex AI API
 */
async function createActualCache(
  projectId: string,
  location: string,
  modelId: string,
  fileUri: string,
  mimeType: string,
  ttlSeconds: number,
  displayName: string,
  systemInstruction?: string,
  videoDurationSec?: number
): Promise<{ name: string; expireTime: string }> {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/cachedContents`;

  const requestBody: CreateCachedContentRequest = {
    model: `projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`,
    displayName,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri,
              mimeType,
            },
          },
        ],
      },
    ],
    ttl: `${ttlSeconds}s`,
  };

  // Add system instruction if provided
  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  // Calculate timeout based on video duration
  const timeoutMs = calculateCacheCreationTimeout(videoDurationSec);

  logger.info("Creating Vertex AI context cache", {
    projectId,
    location,
    modelId,
    fileUri,
    ttlSeconds,
    displayName,
    videoDurationSec,
    timeoutMs,
  });

  const response = await vertexAIRequest<CreateCachedContentResponse>(
    url,
    "POST",
    requestBody,
    timeoutMs
  );

  logger.info("Vertex AI context cache created successfully", {
    name: response.name,
    expireTime: response.expireTime,
    createTime: response.createTime,
  });

  return {
    name: response.name,
    expireTime: response.expireTime || "",
  };
}

/**
 * Get cache details from Vertex AI API
 */
async function getCacheFromApi(
  resourceName: string
): Promise<VertexAICachedContent | null> {
  const url = `https://aiplatform.googleapis.com/v1/${resourceName}`;

  try {
    const response = await vertexAIRequest<VertexAICachedContent>(url, "GET");
    return response;
  } catch (error) {
    // If cache not found (404), return null
    if (error instanceof ExternalServiceError &&
        error.context.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete cache using Vertex AI API
 */
async function deleteActualCache(resourceName: string): Promise<void> {
  const url = `https://aiplatform.googleapis.com/v1/${resourceName}`;

  logger.info("Deleting Vertex AI context cache", { resourceName });

  await vertexAIRequest<void>(url, "DELETE");

  logger.info("Vertex AI context cache deleted successfully", { resourceName });
}

/**
 * Update cache TTL using Vertex AI API
 */
async function updateCacheTtl(
  resourceName: string,
  ttlSeconds: number
): Promise<VertexAICachedContent> {
  const url = `https://aiplatform.googleapis.com/v1/${resourceName}?updateMask=ttl`;

  logger.info("Updating Vertex AI context cache TTL", {
    resourceName,
    ttlSeconds,
  });

  const response = await vertexAIRequest<VertexAICachedContent>(url, "PATCH", {
    ttl: `${ttlSeconds}s`,
  });

  logger.info("Vertex AI context cache TTL updated successfully", {
    resourceName,
    expireTime: response.expireTime,
  });

  return response;
}

// Cache Manager singleton
let cacheManagerInstance: GeminiCacheManager | null = null;

/**
 * Get or create the GeminiCacheManager singleton
 */
export function getCacheManager(): GeminiCacheManager {
  if (cacheManagerInstance) return cacheManagerInstance;

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const location = process.env.GEMINI_LOCATION || "global";
  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  cacheManagerInstance = new GeminiCacheManager(projectId, location, modelId);
  return cacheManagerInstance;
}

/**
 * GeminiCacheManager - Manages Context Caching for video analysis
 *
 * Note: Vertex AI Context Caching API requires specific endpoint calls.
 * This implementation uses the Firestore-based tracking approach.
 */
export class GeminiCacheManager {
  private projectId: string;
  private location: string;
  private modelId: string;
  private vertexAI: VertexAI;
  private db: Firestore;
  private config: CacheManagerConfig;

  constructor(
    projectId: string,
    location: string,
    modelId: string,
    config: Partial<CacheManagerConfig> = {}
  ) {
    this.projectId = projectId;
    this.location = location;
    this.modelId = modelId;
    this.vertexAI = new VertexAI({ project: projectId, location });
    this.db = getDb();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create or retrieve a context cache for a match video
   *
   * If a valid cache exists for this match, it will be returned.
   * Otherwise, a new cache will be created.
   */
  async getOrCreateCache(options: CreateCacheOptions & { videoId?: string }): Promise<GeminiCacheDoc> {
    const { matchId, videoId, fileUri, mimeType, displayName, ttlSeconds, systemInstruction, videoDurationSec } =
      options;

    // Check for existing valid cache
    const existingCache = await this.getValidCache(matchId, videoId);
    if (existingCache) {
      logger.info("Using existing Gemini cache", {
        matchId,
        videoId,
        cacheId: existingCache.cacheId,
        expiresAt: existingCache.expiresAt,
      });

      // Update usage tracking
      await this.updateCacheUsage(matchId, videoId);
      return existingCache;
    }

    // Create new cache
    const newCache = await this.createCache({
      matchId,
      videoId,
      fileUri,
      mimeType,
      displayName,
      ttlSeconds: ttlSeconds || this.config.defaultTtlSeconds,
      systemInstruction,
      videoDurationSec,
    });

    return newCache;
  }

  /**
   * Create a new context cache using actual Vertex AI API
   *
   * This method:
   * 1. Calls Vertex AI cachedContents.create API to create real context cache
   * 2. Stores the resource name and metadata in Firestore
   * 3. Returns cache document for use in subsequent Gemini API calls
   *
   * The returned cacheId (resource name) should be used with the cachedContent
   * parameter in generateContent calls for 90% cost reduction.
   */
  async createCache(options: CreateCacheOptions): Promise<GeminiCacheDoc> {
    const {
      matchId,
      videoId,
      fileUri,
      mimeType,
      ttlSeconds = this.config.defaultTtlSeconds,
      systemInstruction,
      videoDurationSec,
    } = options;

    const displayName = options.displayName || `match_${matchId}_video${videoId ? `_${videoId}` : ''}`;
    const now = new Date();

    logger.info("Creating Vertex AI context cache via API", {
      matchId,
      videoId,
      fileUri,
      mimeType,
      ttlSeconds,
      displayName,
      videoDurationSec,
    });

    // Call actual Vertex AI API to create cache
    const { name: cacheId, expireTime } = await createActualCache(
      this.projectId,
      this.location,
      this.modelId,
      fileUri,
      mimeType,
      ttlSeconds,
      displayName,
      systemInstruction,
      videoDurationSec
    );

    const cacheDoc: GeminiCacheDoc = {
      matchId,
      videoId,
      cacheId, // This is now the actual resource name from Vertex AI
      storageUri: fileUri,
      fileUri,
      model: this.modelId,
      displayName,
      ttlSeconds,
      expiresAt: expireTime || new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      createdAt: now.toISOString(),
      version: "1.0.0",
      usageCount: 0,
    };

    // Store cache metadata in Firestore at videoId-specific path
    const cacheDocId = videoId || "legacy";
    await this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc(cacheDocId)
      .set(cacheDoc);

    logger.info("Created Vertex AI context cache successfully", {
      matchId,
      videoId,
      cacheId,
      fileUri,
      ttlSeconds,
      expiresAt: cacheDoc.expiresAt,
    });

    return cacheDoc;
  }

  /**
   * Get a valid (non-expired) cache for a match
   */
  async getValidCache(matchId: string, videoId?: string): Promise<GeminiCacheDoc | null> {
    const cacheDocId = videoId || "legacy";
    const cacheRef = this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc(cacheDocId);

    const doc = await cacheRef.get();
    if (!doc.exists) return null;

    const cache = doc.data() as GeminiCacheDoc;
    const expiresAt = new Date(cache.expiresAt);
    const now = new Date();

    // Check if cache is expired or about to expire
    const thresholdMs = this.config.autoRefreshThresholdMinutes * 60 * 1000;
    if (expiresAt.getTime() - now.getTime() < thresholdMs) {
      logger.info("Gemini cache expired or expiring soon", {
        matchId,
        videoId,
        expiresAt: cache.expiresAt,
      });
      return null;
    }

    return cache;
  }

  /**
   * Update cache usage tracking
   */
  async updateCacheUsage(matchId: string, videoId?: string): Promise<void> {
    const cacheDocId = videoId || "legacy";
    const cacheRef = this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc(cacheDocId);

    await cacheRef.update({
      usageCount: FieldValue.increment(1),
      lastUsedAt: new Date().toISOString(),
    });
  }

  /**
   * Delete cache for a match (both from Vertex AI and Firestore)
   */
  async deleteCache(matchId: string, videoId?: string): Promise<void> {
    const cacheDocId = videoId || "legacy";
    const cacheRef = this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc(cacheDocId);

    // Get cache document to retrieve resource name
    const cacheDoc = await cacheRef.get();

    if (cacheDoc.exists) {
      const cache = cacheDoc.data() as GeminiCacheDoc;

      // Delete from Vertex AI API if cacheId looks like a resource name
      if (cache.cacheId && cache.cacheId.startsWith("projects/")) {
        try {
          await deleteActualCache(cache.cacheId);
          logger.info("Deleted Vertex AI context cache", {
            matchId,
            videoId,
            cacheId: cache.cacheId,
          });
        } catch (error) {
          // Log error but continue to delete from Firestore
          logger.warn("Failed to delete Vertex AI context cache", {
            matchId,
            videoId,
            cacheId: cache.cacheId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Delete from Firestore
    await cacheRef.delete();

    logger.info("Deleted Gemini cache metadata", { matchId, videoId });
  }

  /**
   * Extend cache TTL if it exists and is valid
   * Updates both Vertex AI cache and Firestore metadata
   */
  async extendCacheTtl(
    matchId: string,
    additionalSeconds: number,
    videoId?: string
  ): Promise<GeminiCacheDoc | null> {
    const cache = await this.getValidCache(matchId, videoId);
    if (!cache) return null;

    const newTtlSeconds = cache.ttlSeconds + additionalSeconds;

    // Max TTL is 7 days (604800 seconds)
    const maxTtlSeconds = 7 * 24 * 60 * 60;
    const finalTtlSeconds = Math.min(newTtlSeconds, maxTtlSeconds);

    const cacheDocId = videoId || "legacy";

    // Update cache TTL via Vertex AI API if cacheId is a resource name
    if (cache.cacheId && cache.cacheId.startsWith("projects/")) {
      try {
        const updatedCache = await updateCacheTtl(cache.cacheId, finalTtlSeconds);

        const updatedCacheDoc: GeminiCacheDoc = {
          ...cache,
          ttlSeconds: finalTtlSeconds,
          expiresAt: updatedCache.expireTime || cache.expiresAt,
        };

        // Update Firestore
        await this.db
          .collection("matches")
          .doc(matchId)
          .collection("geminiCache")
          .doc(cacheDocId)
          .set(updatedCacheDoc);

        logger.info("Extended Vertex AI cache TTL", {
          matchId,
          videoId,
          cacheId: cache.cacheId,
          newTtlSeconds: finalTtlSeconds,
          newExpiresAt: updatedCacheDoc.expiresAt,
        });

        return updatedCacheDoc;
      } catch (error) {
        logger.error("Failed to extend Vertex AI cache TTL", error, { matchId, videoId });
        return null;
      }
    }

    // Fallback: update only Firestore metadata (legacy behavior)
    const currentExpiry = new Date(cache.expiresAt);
    const newExpiry = new Date(currentExpiry.getTime() + additionalSeconds * 1000);
    const maxExpiry = new Date(Date.now() + maxTtlSeconds * 1000);
    const finalExpiry = newExpiry > maxExpiry ? maxExpiry : newExpiry;

    const updatedCache: GeminiCacheDoc = {
      ...cache,
      ttlSeconds: finalTtlSeconds,
      expiresAt: finalExpiry.toISOString(),
    };

    await this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc(cacheDocId)
      .set(updatedCache);

    logger.info("Extended cache TTL (metadata only)", {
      matchId,
      videoId,
      newExpiresAt: finalExpiry.toISOString(),
    });

    return updatedCache;
  }

  /**
   * Build the cached content parts for Vertex AI calls
   *
   * This returns the parts array that should be used when calling
   * the Gemini model with cached video content.
   */
  buildCachedContentParts(cache: GeminiCacheDoc): {
    fileUri: string;
    mimeType: string;
  } {
    return {
      fileUri: cache.storageUri || cache.fileUri || "",
      mimeType: "video/mp4", // Default to mp4, could be extended
    };
  }

  /**
   * Get cache details from Vertex AI API
   * Useful for verifying cache status and debugging
   */
  async getCacheDetails(matchId: string, videoId?: string): Promise<VertexAICachedContent | null> {
    const cache = await this.getValidCache(matchId, videoId);
    if (!cache || !cache.cacheId || !cache.cacheId.startsWith("projects/")) {
      return null;
    }

    try {
      return await getCacheFromApi(cache.cacheId);
    } catch (error) {
      logger.warn("Failed to get cache details from API", {
        matchId,
        videoId,
        cacheId: cache.cacheId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get estimated cost savings from caching
   *
   * Calculation based on:
   * - Normal input: $0.075/1M tokens (gemini-1.5-flash)
   * - Cached input: $0.01875/1M tokens (75% discount)
   */
  getCostSavings(tokenCount: number, usageCount: number): {
    withoutCache: number;
    withCache: number;
    savings: number;
    savingsPercent: number;
  } {
    const normalCostPer1M = 0.075;
    const cachedCostPer1M = 0.01875;

    const withoutCache = (tokenCount / 1_000_000) * normalCostPer1M * usageCount;
    const withCache =
      (tokenCount / 1_000_000) * normalCostPer1M + // First call (creates cache)
      (tokenCount / 1_000_000) * cachedCostPer1M * (usageCount - 1); // Subsequent calls

    const savings = withoutCache - withCache;
    const savingsPercent = usageCount > 1 ? (savings / withoutCache) * 100 : 0;

    return {
      withoutCache,
      withCache,
      savings,
      savingsPercent,
    };
  }

  /**
   * Clean up expired caches across all matches
   * Should be run periodically (e.g., daily)
   */
  async cleanupExpiredCaches(): Promise<number> {
    const now = new Date();
    let deletedCount = 0;

    try {
      // Query all matches with geminiCache
      const matchesSnapshot = await this.db.collection("matches").get();

      for (const matchDoc of matchesSnapshot.docs) {
        // Query all cache documents (including videoId-specific ones)
        const cacheCollectionSnap = await matchDoc.ref.collection("geminiCache").get();

        for (const cacheDoc of cacheCollectionSnap.docs) {
          if (cacheDoc.exists) {
            const cache = cacheDoc.data() as GeminiCacheDoc;
            const expiresAt = new Date(cache.expiresAt);

            if (expiresAt < now) {
              await cacheDoc.ref.delete();
              deletedCount++;
              logger.debug("Deleted expired cache", {
                matchId: cache.matchId,
                videoId: cache.videoId,
                expiredAt: cache.expiresAt,
              });
            }
          }
        }
      }

      logger.info("Cleaned up expired Gemini caches", { deletedCount });

      return deletedCount;
    } catch (error) {
      logger.error("Failed to cleanup expired caches", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}

/**
 * Utility function to check if context caching is enabled
 *
 * Context caching uses Vertex AI cachedContents API to cache video content
 * and achieve 90% cost reduction on subsequent API calls.
 *
 * Implementation:
 * 1. Creates cached content via cachedContents.create API
 * 2. Stores the resource name in Firestore for tracking
 * 3. Uses cachedContent parameter in generateContent calls
 *
 * Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
 */
export function isContextCachingEnabled(): boolean {
  const enabled = process.env.GEMINI_CONTEXT_CACHE_ENABLED === "true";
  if (enabled) {
    logger.info("Vertex AI Context Caching is enabled - 90% cost reduction active");
  }
  return enabled;
}

/**
 * Get the configured cache TTL in seconds
 */
export function getCacheTtlSeconds(): number {
  const envTtl = process.env.GEMINI_CONTEXT_CACHE_TTL;
  return envTtl ? parseInt(envTtl, 10) : DEFAULT_CONFIG.defaultTtlSeconds;
}

/**
 * Phase 3.1: Calculate dynamic TTL based on match duration
 *
 * Longer videos require more processing time, so we extend the cache TTL.
 * This ensures the cache remains valid throughout the entire analysis pipeline.
 *
 * @param durationSeconds - Video duration in seconds
 * @returns TTL in seconds
 */
export function calculateDynamicTtl(durationSeconds: number): number {
  // Check for environment override first
  const envTtl = process.env.GEMINI_CONTEXT_CACHE_TTL;
  if (envTtl) {
    return parseInt(envTtl, 10);
  }

  // Dynamic TTL based on video duration:
  // - Under 10 min (600s): 30 min TTL (1800s) - quick analysis
  // - 10-30 min: 1 hour TTL (3600s)
  // - 30-90 min: 2 hours TTL (7200s) - standard match
  // - Over 90 min: 3 hours TTL (10800s) - long match or extended coverage

  if (durationSeconds < 600) {
    return 1800; // 30 minutes
  } else if (durationSeconds < 1800) {
    return 3600; // 1 hour
  } else if (durationSeconds < 5400) {
    return 7200; // 2 hours (default)
  } else {
    return 10800; // 3 hours
  }
}

/**
 * Phase 3.1: Record cache access for monitoring
 * Tracks hits, misses, and fallbacks per step for hit rate calculation
 */
export async function recordCacheAccess(
  matchId: string,
  stepName: string,
  accessType: CacheAccessType,
  options?: {
    cacheId?: string;
    remainingTtlSeconds?: number;
    fallbackReason?: string;
  }
): Promise<void> {
  try {
    const db = getDb();
    const record: CacheAccessRecord = {
      matchId,
      stepName,
      accessType,
      timestamp: new Date().toISOString(),
      cacheId: options?.cacheId,
      remainingTtlSeconds: options?.remainingTtlSeconds,
      fallbackReason: options?.fallbackReason,
    };

    // Store access record
    await db
      .collection("matches")
      .doc(matchId)
      .collection("cacheAccessLogs")
      .add(record);

    // Log with clear hit/miss indicator
    const logLevel = accessType === "hit" ? "info" : "warn";
    const logFn = logLevel === "info" ? logger.info : logger.warn;
    logFn(`Cache ${accessType.toUpperCase()}`, {
      matchId,
      stepName,
      accessType,
      cacheId: options?.cacheId,
      remainingTtlSeconds: options?.remainingTtlSeconds,
      fallbackReason: options?.fallbackReason,
    });
  } catch (error) {
    // Non-blocking - don't fail the pipeline for monitoring
    logger.warn("Failed to record cache access", {
      matchId,
      stepName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Phase 3.1: Calculate cache hit statistics for a match
 */
export async function getCacheHitStats(matchId: string): Promise<CacheHitStats> {
  const db = getDb();
  const logsSnap = await db
    .collection("matches")
    .doc(matchId)
    .collection("cacheAccessLogs")
    .get();

  const stats: CacheHitStats = {
    matchId,
    totalAccesses: 0,
    hits: 0,
    misses: 0,
    fallbacks: 0,
    hitRate: 0,
    accessesByStep: {},
  };

  for (const doc of logsSnap.docs) {
    const record = doc.data() as CacheAccessRecord;
    stats.totalAccesses++;

    // Initialize step stats if needed
    if (!stats.accessesByStep[record.stepName]) {
      stats.accessesByStep[record.stepName] = { hits: 0, misses: 0, fallbacks: 0 };
    }

    if (record.accessType === "hit") {
      stats.hits++;
      stats.accessesByStep[record.stepName].hits++;
    } else if (record.accessType === "fallback") {
      stats.fallbacks++;
      stats.accessesByStep[record.stepName].fallbacks++;
    } else {
      stats.misses++;
      stats.accessesByStep[record.stepName].misses++;
    }
  }

  // Calculate hit rate
  stats.hitRate = stats.totalAccesses > 0
    ? (stats.hits / stats.totalAccesses) * 100
    : 0;

  return stats;
}

/**
 * Get cache or fallback to geminiUpload data from match document
 * This ensures Gemini steps can work even without active context caching
 *
 * Phase 3.1: Enhanced with cache hit/miss tracking
 * Phase 5.2.2: Enhanced with videoId support for split video analysis
 */
export async function getValidCacheOrFallback(
  matchId: string,
  videoId?: string,
  stepName?: string
): Promise<GeminiCacheDoc | null> {
  const cacheManager = getCacheManager();

  // First try to get valid cache
  const cache = await cacheManager.getValidCache(matchId, videoId);
  if (cache) {
    // Phase 3.1: Record cache hit (non-blocking to avoid latency)
    if (stepName) {
      const expiresAt = new Date(cache.expiresAt);
      const now = new Date();
      const remainingTtlSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

      void recordCacheAccess(matchId, stepName, "hit", {
        cacheId: cache.cacheId,
        remainingTtlSeconds,
      });
    }
    return cache;
  }

  // Fallback: try to get file URI from match document
  const db = getDb();
  const matchSnap = await db.collection("matches").doc(matchId).get();
  if (!matchSnap.exists) {
    logger.warn("Match not found for cache fallback", { matchId, videoId });
    if (stepName) {
      void recordCacheAccess(matchId, stepName, "miss_not_found", {
        fallbackReason: "match_not_found",
      });
    }
    return null;
  }

  const match = matchSnap.data();
  let fileUri: string | null = null;
  let videoDurationSec: number | undefined;

  // If videoId is provided, try to get file URI from videos subcollection
  if (videoId) {
    try {
      const videoSnap = await db
        .collection("matches")
        .doc(matchId)
        .collection("videos")
        .doc(videoId)
        .get();

      if (videoSnap.exists) {
        const videoData = videoSnap.data();
        const storagePath = videoData?.storagePath as string | undefined;
        const bucket = process.env.STORAGE_BUCKET;

        if (storagePath && bucket) {
          fileUri = `gs://${bucket}/${storagePath}`;
          logger.info("Using video-specific file URI for fallback", { matchId, videoId, fileUri });
        }
        // Try to get video duration from video document
        videoDurationSec = videoData?.durationSec as number | undefined;
      }
    } catch (error) {
      logger.warn("Failed to get video document for fallback", {
        matchId,
        videoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // If videoId not provided or video not found, try legacy paths
  if (!fileUri) {
    const geminiUpload = match?.geminiUpload as {
      fileUri?: string;
      cacheId?: string;
      modelId?: string;
    } | undefined;

    // Also check video.storagePath as last resort
    const storagePath = match?.video?.storagePath as string | undefined;
    const bucket = process.env.STORAGE_BUCKET;

    fileUri = geminiUpload?.fileUri ||
      (storagePath && bucket ? `gs://${bucket}/${storagePath}` : null);
  }

  if (!fileUri) {
    logger.warn("No file URI available for fallback", { matchId, videoId });
    if (stepName) {
      void recordCacheAccess(matchId, stepName, "miss_not_found", {
        fallbackReason: "no_file_uri",
      });
    }
    return null;
  }

  // Phase 3.1: Record fallback usage (non-blocking)
  if (stepName) {
    void recordCacheAccess(matchId, stepName, "fallback", {
      fallbackReason: "no_valid_cache",
    });
  }

  logger.info("Using fallback file URI (no context caching)", { matchId, videoId, fileUri });

  // Try to get video duration from match document if not found in video doc
  if (!videoDurationSec) {
    videoDurationSec = match?.video?.durationSec as number | undefined;
  }

  // Return a minimal cache doc with just the file URI
  return {
    matchId,
    videoId,
    cacheId: `fallback_${matchId}${videoId ? `_${videoId}` : ''}`,
    fileUri,
    storageUri: fileUri,
    model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
    ttlSeconds: 0, // Indicates no actual cache
    expiresAt: new Date(0).toISOString(), // Already expired
    createdAt: new Date().toISOString(),
    version: "fallback",
    videoDurationSec, // Include video duration for dynamic token calculation
  };
}
