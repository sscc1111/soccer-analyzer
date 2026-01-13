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

export type CreateCacheOptions = {
  matchId: string;
  fileUri: string;
  mimeType: string;
  displayName?: string;
  ttlSeconds?: number;
  systemInstruction?: string;
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
 */
async function vertexAIRequest<T>(
  url: string,
  method: string,
  body?: unknown
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
        let errorData: { error?: { message?: string; code?: number } } = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Ignore JSON parse errors
        }

        // Handle rate limiting
        if (response.status === 429) {
          throw new RateLimitError("vertex-ai", {
            statusCode: response.status,
            details: errorData,
          });
        }

        // Handle other API errors
        throw new ExternalServiceError(
          "vertex-ai",
          errorData.error?.message || errorText,
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
      operationName: `${method} ${url}`,
      logger,
    }
  );
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
  systemInstruction?: string
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

  logger.info("Creating Vertex AI context cache", {
    projectId,
    location,
    modelId,
    fileUri,
    ttlSeconds,
    displayName,
  });

  const response = await vertexAIRequest<CreateCachedContentResponse>(
    url,
    "POST",
    requestBody
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
  async getOrCreateCache(options: CreateCacheOptions): Promise<GeminiCacheDoc> {
    const { matchId, fileUri, mimeType, displayName, ttlSeconds, systemInstruction } =
      options;

    // Check for existing valid cache
    const existingCache = await this.getValidCache(matchId);
    if (existingCache) {
      logger.info("Using existing Gemini cache", {
        matchId,
        cacheId: existingCache.cacheId,
        expiresAt: existingCache.expiresAt,
      });

      // Update usage tracking
      await this.updateCacheUsage(matchId);
      return existingCache;
    }

    // Create new cache
    const newCache = await this.createCache({
      matchId,
      fileUri,
      mimeType,
      displayName,
      ttlSeconds: ttlSeconds || this.config.defaultTtlSeconds,
      systemInstruction,
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
    const { matchId, fileUri, mimeType, ttlSeconds = this.config.defaultTtlSeconds, systemInstruction } =
      options;

    const displayName = options.displayName || `match_${matchId}_video`;
    const now = new Date();

    logger.info("Creating Vertex AI context cache via API", {
      matchId,
      fileUri,
      mimeType,
      ttlSeconds,
      displayName,
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
      systemInstruction
    );

    const cacheDoc: GeminiCacheDoc = {
      matchId,
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

    // Store cache metadata in Firestore
    await this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc("current")
      .set(cacheDoc);

    logger.info("Created Vertex AI context cache successfully", {
      matchId,
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
  async getValidCache(matchId: string): Promise<GeminiCacheDoc | null> {
    const cacheRef = this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc("current");

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
        expiresAt: cache.expiresAt,
      });
      return null;
    }

    return cache;
  }

  /**
   * Update cache usage tracking
   */
  async updateCacheUsage(matchId: string): Promise<void> {
    const cacheRef = this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc("current");

    await cacheRef.update({
      usageCount: FieldValue.increment(1),
      lastUsedAt: new Date().toISOString(),
    });
  }

  /**
   * Delete cache for a match (both from Vertex AI and Firestore)
   */
  async deleteCache(matchId: string): Promise<void> {
    const cacheRef = this.db
      .collection("matches")
      .doc(matchId)
      .collection("geminiCache")
      .doc("current");

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
            cacheId: cache.cacheId,
          });
        } catch (error) {
          // Log error but continue to delete from Firestore
          logger.warn("Failed to delete Vertex AI context cache", {
            matchId,
            cacheId: cache.cacheId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Delete from Firestore
    await cacheRef.delete();

    logger.info("Deleted Gemini cache metadata", { matchId });
  }

  /**
   * Extend cache TTL if it exists and is valid
   * Updates both Vertex AI cache and Firestore metadata
   */
  async extendCacheTtl(
    matchId: string,
    additionalSeconds: number
  ): Promise<GeminiCacheDoc | null> {
    const cache = await this.getValidCache(matchId);
    if (!cache) return null;

    const newTtlSeconds = cache.ttlSeconds + additionalSeconds;

    // Max TTL is 7 days (604800 seconds)
    const maxTtlSeconds = 7 * 24 * 60 * 60;
    const finalTtlSeconds = Math.min(newTtlSeconds, maxTtlSeconds);

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
          .doc("current")
          .set(updatedCacheDoc);

        logger.info("Extended Vertex AI cache TTL", {
          matchId,
          cacheId: cache.cacheId,
          newTtlSeconds: finalTtlSeconds,
          newExpiresAt: updatedCacheDoc.expiresAt,
        });

        return updatedCacheDoc;
      } catch (error) {
        logger.error("Failed to extend Vertex AI cache TTL", error, { matchId });
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
      .doc("current")
      .set(updatedCache);

    logger.info("Extended cache TTL (metadata only)", {
      matchId,
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
  async getCacheDetails(matchId: string): Promise<VertexAICachedContent | null> {
    const cache = await this.getValidCache(matchId);
    if (!cache || !cache.cacheId || !cache.cacheId.startsWith("projects/")) {
      return null;
    }

    try {
      return await getCacheFromApi(cache.cacheId);
    } catch (error) {
      logger.warn("Failed to get cache details from API", {
        matchId,
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
        const cacheRef = matchDoc.ref.collection("geminiCache").doc("current");
        const cacheDoc = await cacheRef.get();

        if (cacheDoc.exists) {
          const cache = cacheDoc.data() as GeminiCacheDoc;
          const expiresAt = new Date(cache.expiresAt);

          if (expiresAt < now) {
            await cacheRef.delete();
            deletedCount++;
            logger.debug("Deleted expired cache", {
              matchId: cache.matchId,
              expiredAt: cache.expiresAt,
            });
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
 * Get cache or fallback to geminiUpload data from match document
 * This ensures Gemini steps can work even without active context caching
 */
export async function getValidCacheOrFallback(
  matchId: string
): Promise<GeminiCacheDoc | null> {
  const cacheManager = getCacheManager();

  // First try to get valid cache
  const cache = await cacheManager.getValidCache(matchId);
  if (cache) {
    return cache;
  }

  // Fallback: try to get file URI from match document's geminiUpload field
  const db = getDb();
  const matchSnap = await db.collection("matches").doc(matchId).get();
  if (!matchSnap.exists) {
    logger.warn("Match not found for cache fallback", { matchId });
    return null;
  }

  const match = matchSnap.data();
  const geminiUpload = match?.geminiUpload as {
    fileUri?: string;
    cacheId?: string;
    modelId?: string;
  } | undefined;

  // Also check video.storagePath as last resort
  const storagePath = match?.video?.storagePath as string | undefined;
  const bucket = process.env.STORAGE_BUCKET;

  const fileUri = geminiUpload?.fileUri ||
    (storagePath && bucket ? `gs://${bucket}/${storagePath}` : null);

  if (!fileUri) {
    logger.warn("No file URI available for fallback", { matchId });
    return null;
  }

  logger.info("Using fallback file URI (no context caching)", { matchId, fileUri });

  // Return a minimal cache doc with just the file URI
  return {
    matchId,
    cacheId: geminiUpload?.cacheId || `fallback_${matchId}`,
    fileUri,
    storageUri: fileUri,
    model: geminiUpload?.modelId || process.env.GEMINI_MODEL || "gemini-3-flash-preview",
    ttlSeconds: 0, // Indicates no actual cache
    expiresAt: new Date(0).toISOString(), // Already expired
    createdAt: new Date().toISOString(),
    version: "fallback",
  };
}
