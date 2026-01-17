/**
 * Gemini-first Architecture: Context Caching types
 *
 * Gemini Context Cache のメタデータ型定義
 * Firestore: matches/{matchId}/geminiCache/current
 */

/**
 * Gemini Cache document
 * Stores metadata about the cached video content
 */
export type GeminiCacheDoc = {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  /** Gemini Cache Manager ID (e.g., "cachedContents/xxx") */
  cacheId: string;
  /** Cloud Storage URI of the uploaded video (gs://...) */
  storageUri: string;
  /** Gemini File API URI (for non-Cloud Storage uploads) */
  fileUri?: string;
  /** Cache TTL in seconds */
  ttlSeconds: number;
  /** Expiration timestamp */
  expiresAt: string;
  /** Model used for caching */
  model: string;
  /** Video duration in seconds */
  videoDurationSec?: number;
  /** Estimated token count for the video */
  estimatedTokens?: number;
  /** Processing version */
  version: string;
  createdAt: string;
};

/**
 * Cache status for a match
 */
export type CacheStatus = "none" | "uploading" | "caching" | "ready" | "expired" | "error";

/**
 * Cache operation result
 */
export type CacheOperationResult = {
  success: boolean;
  cacheId?: string;
  storageUri?: string;
  error?: string;
  expiresAt?: string;
};
