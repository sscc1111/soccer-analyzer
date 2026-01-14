/**
 * Step 03: Upload Video to Gemini
 *
 * Gemini-first アーキテクチャの基盤ステップ
 * フル動画を Gemini 用にアップロードし、Context Caching を設定
 *
 * 処理フロー:
 * 1. 動画ファイルの検証（サイズ、形式）
 * 2. GCS URI の準備（Vertex AI は GCS から直接読み取り）
 * 3. Context Cache の作成または取得
 * 4. キャッシュメタデータの保存
 */

import { getDb } from "../../firebase/admin";
import { getFileManager } from "../../gemini/fileManager";
import {
  getCacheManager,
  isContextCachingEnabled,
  getCacheTtlSeconds,
  calculateDynamicTtl,
  type GeminiCacheDoc,
} from "../../gemini/cacheManager";
import { defaultLogger as logger } from "../../lib/logger";

export type UploadVideoToGeminiOptions = {
  matchId: string;
  version: string;
};

export type UploadVideoToGeminiResult = {
  matchId: string;
  ok: boolean;
  skipped?: boolean;
  cacheId?: string;
  fileUri?: string;
  expiresAt?: string;
  error?: string;
};

/**
 * Upload video to Gemini and create/retrieve context cache
 */
export async function stepUploadVideoToGemini({
  matchId,
  version,
}: UploadVideoToGeminiOptions): Promise<UploadVideoToGeminiResult> {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // 1. Get match data
  const snap = await matchRef.get();
  if (!snap.exists) {
    throw new Error(`match not found: ${matchId}`);
  }

  const match = snap.data() as {
    video?: {
      storagePath?: string;
      durationSec?: number;
    };
    geminiUpload?: {
      version?: string;
      cacheId?: string;
      fileUri?: string;
      expiresAt?: string;
    };
  };

  const storagePath = match?.video?.storagePath;
  if (!storagePath) {
    throw new Error("video.storagePath missing");
  }

  // 2. Check if context caching is enabled
  const cachingEnabled = isContextCachingEnabled();
  if (!cachingEnabled) {
    logger.info("Context caching disabled, skipping cache creation", { matchId });
    return {
      matchId,
      ok: true,
      skipped: true,
    };
  }

  // 3. Check for existing valid cache
  const existingUpload = match?.geminiUpload;
  if (existingUpload?.version === version && existingUpload?.cacheId) {
    const expiresAt = existingUpload.expiresAt
      ? new Date(existingUpload.expiresAt)
      : null;
    const now = new Date();
    const bufferMinutes = 10;

    if (expiresAt && expiresAt.getTime() - now.getTime() > bufferMinutes * 60 * 1000) {
      logger.info("Using existing Gemini upload", {
        matchId,
        cacheId: existingUpload.cacheId,
        expiresAt: existingUpload.expiresAt,
      });
      return {
        matchId,
        ok: true,
        skipped: true,
        cacheId: existingUpload.cacheId,
        fileUri: existingUpload.fileUri,
        expiresAt: existingUpload.expiresAt,
      };
    }
  }

  // 4. Validate video for Gemini
  const fileManager = getFileManager();
  const validation = await fileManager.validateVideoForGemini(storagePath);
  if (!validation.valid) {
    logger.error("Video validation failed for Gemini", {
      matchId,
      reason: validation.reason,
    });
    return {
      matchId,
      ok: false,
      error: validation.reason,
    };
  }

  // 5. Prepare video URI for Gemini
  const { uri, mimeType } = await fileManager.prepareVideoForGemini(storagePath, matchId);

  logger.info("Video prepared for Gemini", { matchId, uri, mimeType });

  // 6. Create or get context cache
  const cacheManager = getCacheManager();
  // Phase 3.1: Use dynamic TTL based on video duration
  const durationSec = match?.video?.durationSec;
  const ttlSeconds = durationSec ? calculateDynamicTtl(durationSec) : getCacheTtlSeconds();

  let cacheDoc: GeminiCacheDoc;
  try {
    cacheDoc = await cacheManager.getOrCreateCache({
      matchId,
      fileUri: uri,
      mimeType,
      displayName: `match_${matchId}_video`,
      ttlSeconds,
      systemInstruction: buildSystemInstruction(),
      videoDurationSec: durationSec,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create Gemini cache", { matchId, error: errorMessage });
    return {
      matchId,
      ok: false,
      error: `Cache creation failed: ${errorMessage}`,
    };
  }

  // 7. Save upload metadata to match document
  await matchRef.set(
    {
      geminiUpload: {
        version,
        cacheId: cacheDoc.cacheId,
        fileUri: cacheDoc.storageUri || cacheDoc.fileUri,
        modelId: cacheDoc.model,
        expiresAt: cacheDoc.expiresAt,
        createdAt: cacheDoc.createdAt,
      },
    },
    { merge: true }
  );

  const fileUri = cacheDoc.storageUri || cacheDoc.fileUri || "";
  logger.info("Gemini upload completed", {
    matchId,
    cacheId: cacheDoc.cacheId,
    fileUri,
    expiresAt: cacheDoc.expiresAt,
  });

  return {
    matchId,
    ok: true,
    cacheId: cacheDoc.cacheId,
    fileUri,
    expiresAt: cacheDoc.expiresAt,
  };
}

/**
 * Build system instruction for soccer video analysis
 */
function buildSystemInstruction(): string {
  return `あなたはサッカー分析の専門家です。

この試合動画を分析する際は、以下の点に注意してください：

## 分析の観点
1. プレイヤーの動き（ポジショニング、ランニング、プレッシング）
2. ボールの動き（パス、ドリブル、シュート）
3. チームの戦術（フォーメーション、攻撃パターン、守備組織）
4. 重要なイベント（ゴール、チャンス、セットピース、ターンオーバー）

## チーム識別
- ユニフォームの色でホーム/アウェイを区別
- ゴールキーパーは異なる色のユニフォーム
- 審判は通常黒または蛍光色

## 出力形式
- すべての応答は JSON 形式で返してください
- タイムスタンプは秒単位（小数点以下1桁）で記録
- 信頼度は 0.0 〜 1.0 の範囲で評価

## 重要
- 不確実な情報には低い信頼度を設定
- 見えない/不明確な情報は推測せず "unknown" と記録`;
}

/**
 * Estimate token count for a video
 *
 * Gemini processes video at approximately 258 tokens per second at 1 FPS
 */
export function estimateVideoTokens(durationSec: number): number {
  const tokensPerSecond = 258;
  return Math.ceil(durationSec * tokensPerSecond);
}

/**
 * Check if a video is large enough to benefit from caching
 *
 * Context caching requires minimum 32,768 tokens
 */
export function shouldUseContextCache(durationSec: number): boolean {
  const minTokensForCache = 32768;
  const estimatedTokens = estimateVideoTokens(durationSec);
  return estimatedTokens >= minTokensForCache;
}
