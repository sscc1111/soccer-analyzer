/**
 * Ball Position Matcher Utilities
 *
 * イベントタイムスタンプとボール検出データを照合し、
 * イベント発生時のボール位置を取得するユーティリティ
 *
 * 優先順位:
 * 1. ボール検出データ（最も正確）
 * 2. Gemini出力の位置
 * 3. ゾーン変換
 */

import type { Point2D, BallDetection, BallTrackDoc } from "@soccer/shared";
import { getDb } from "../firebase/admin";
import type { PositionSource, PositionWithMetadata } from "./zoneToCoordinate";

/**
 * ボール位置マッチングの設定
 */
export interface BallMatchConfig {
  /** 許容する最大時間差（秒） */
  maxTimeDiffSec: number;
  /** 補間を有効にするか */
  enableInterpolation: boolean;
  /** 最小信頼度フィルタ */
  minConfidence: number;
}

/**
 * デフォルト設定
 */
export const DEFAULT_BALL_MATCH_CONFIG: BallMatchConfig = {
  maxTimeDiffSec: 0.5, // 500ms以内
  enableInterpolation: true,
  minConfidence: 0.3,
};

/**
 * ボール位置マッチング結果
 */
export interface BallPositionMatch {
  position: Point2D;
  confidence: number;
  source: PositionSource;
  /** マッチしたフレーム番号 */
  frameNumber?: number;
  /** タイムスタンプとの時間差（秒） */
  timeDiff: number;
  /** 補間されたかどうか */
  interpolated: boolean;
}

/**
 * キャッシュされたボールトラックデータ
 */
let cachedBallTrack: {
  matchId: string;
  data: BallTrackDoc | null;
  timestamp: number;
} | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

/**
 * ボールトラックデータを取得（キャッシュ付き）
 */
export async function getBallTrackData(matchId: string): Promise<BallTrackDoc | null> {
  const now = Date.now();

  // キャッシュが有効なら使用
  if (
    cachedBallTrack &&
    cachedBallTrack.matchId === matchId &&
    now - cachedBallTrack.timestamp < CACHE_TTL_MS
  ) {
    return cachedBallTrack.data;
  }

  // Firestoreから取得
  const db = getDb();
  const ballTrackDoc = await db
    .collection("matches")
    .doc(matchId)
    .collection("ballTrack")
    .doc("current")
    .get();

  const data = ballTrackDoc.exists ? (ballTrackDoc.data() as BallTrackDoc) : null;

  // キャッシュを更新
  cachedBallTrack = {
    matchId,
    data,
    timestamp: now,
  };

  return data;
}

/**
 * キャッシュをクリア
 */
export function clearBallTrackCache(): void {
  cachedBallTrack = null;
}

/**
 * タイムスタンプに最も近いボール検出を取得
 */
export function findNearestBallDetection(
  detections: BallDetection[],
  timestamp: number,
  config: BallMatchConfig = DEFAULT_BALL_MATCH_CONFIG
): BallDetection | null {
  if (!detections || detections.length === 0) {
    return null;
  }

  // 信頼度フィルタと可視性フィルタを適用
  const validDetections = detections.filter(
    (d) => d.visible && d.confidence >= config.minConfidence
  );

  if (validDetections.length === 0) {
    return null;
  }

  // 二分探索で最も近い検出を見つける
  let left = 0;
  let right = validDetections.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (validDetections[mid].timestamp < timestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // 前後の検出を比較して最も近いものを選択
  const candidates: BallDetection[] = [];
  if (left > 0) candidates.push(validDetections[left - 1]);
  if (left < validDetections.length) candidates.push(validDetections[left]);

  let nearest: BallDetection | null = null;
  let minDiff = Infinity;

  for (const candidate of candidates) {
    const diff = Math.abs(candidate.timestamp - timestamp);
    if (diff < minDiff && diff <= config.maxTimeDiffSec) {
      minDiff = diff;
      nearest = candidate;
    }
  }

  return nearest;
}

/**
 * 2つの検出間で位置を補間
 */
export function interpolateBallPosition(
  before: BallDetection,
  after: BallDetection,
  timestamp: number
): Point2D {
  const totalDiff = after.timestamp - before.timestamp;
  if (totalDiff === 0) {
    return before.position;
  }

  const ratio = (timestamp - before.timestamp) / totalDiff;

  return {
    x: before.position.x + (after.position.x - before.position.x) * ratio,
    y: before.position.y + (after.position.y - before.position.y) * ratio,
  };
}

/**
 * タイムスタンプからボール位置を取得（補間付き）
 */
export function getBallPositionAtTimestamp(
  detections: BallDetection[],
  timestamp: number,
  config: BallMatchConfig = DEFAULT_BALL_MATCH_CONFIG
): BallPositionMatch | null {
  if (!detections || detections.length === 0) {
    return null;
  }

  // 信頼度フィルタと可視性フィルタを適用
  const validDetections = detections.filter(
    (d) => d.visible && d.confidence >= config.minConfidence
  );

  if (validDetections.length === 0) {
    return null;
  }

  // タイムスタンプでソート
  const sorted = [...validDetections].sort((a, b) => a.timestamp - b.timestamp);

  // 完全一致またはほぼ一致を探す
  const exactMatch = sorted.find(
    (d) => Math.abs(d.timestamp - timestamp) < 0.05 // 50ms以内は完全一致
  );

  if (exactMatch) {
    return {
      position: exactMatch.position,
      confidence: exactMatch.confidence,
      source: "ball_detection",
      frameNumber: exactMatch.frameNumber,
      timeDiff: Math.abs(exactMatch.timestamp - timestamp),
      interpolated: false,
    };
  }

  // 補間が無効なら最近傍を返す
  if (!config.enableInterpolation) {
    const nearest = findNearestBallDetection(sorted, timestamp, config);
    if (!nearest) return null;

    return {
      position: nearest.position,
      confidence: nearest.confidence * 0.9, // 補間なしの場合は信頼度を下げる
      source: "ball_detection",
      frameNumber: nearest.frameNumber,
      timeDiff: Math.abs(nearest.timestamp - timestamp),
      interpolated: false,
    };
  }

  // 前後の検出を見つけて補間
  let before: BallDetection | null = null;
  let after: BallDetection | null = null;

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].timestamp <= timestamp) {
      before = sorted[i];
    }
    if (sorted[i].timestamp >= timestamp && !after) {
      after = sorted[i];
      break;
    }
  }

  // 両方がない場合
  if (!before && !after) {
    return null;
  }

  // 片方しかない場合
  if (!before || !after) {
    const single = before || after;
    if (!single) return null;

    const timeDiff = Math.abs(single.timestamp - timestamp);
    if (timeDiff > config.maxTimeDiffSec) {
      return null;
    }

    return {
      position: single.position,
      confidence: single.confidence * Math.max(0.5, 1 - timeDiff / config.maxTimeDiffSec),
      source: "ball_detection",
      frameNumber: single.frameNumber,
      timeDiff,
      interpolated: false,
    };
  }

  // 両方がある場合、時間差をチェック
  const beforeDiff = timestamp - before.timestamp;
  const afterDiff = after.timestamp - timestamp;

  if (beforeDiff > config.maxTimeDiffSec || afterDiff > config.maxTimeDiffSec) {
    // 時間差が大きすぎる場合は近い方を使用
    const nearest = beforeDiff < afterDiff ? before : after;
    const timeDiff = Math.min(beforeDiff, afterDiff);

    if (timeDiff > config.maxTimeDiffSec) {
      return null;
    }

    return {
      position: nearest.position,
      confidence: nearest.confidence * 0.8,
      source: "ball_detection",
      frameNumber: nearest.frameNumber,
      timeDiff,
      interpolated: false,
    };
  }

  // 補間
  const interpolatedPosition = interpolateBallPosition(before, after, timestamp);

  // 補間の信頼度は両方の検出の信頼度の平均に基づく
  const avgConfidence = (before.confidence + after.confidence) / 2;
  const totalTimeDiff = after.timestamp - before.timestamp;
  const interpolationPenalty = Math.max(0.7, 1 - totalTimeDiff / 2); // 2秒以上離れていると信頼度低下

  return {
    position: interpolatedPosition,
    confidence: avgConfidence * interpolationPenalty,
    source: "ball_detection",
    timeDiff: Math.min(beforeDiff, afterDiff),
    interpolated: true,
  };
}

/**
 * 複数のイベントに対してボール位置を一括取得
 */
export async function matchBallPositionsToEvents(
  matchId: string,
  eventTimestamps: number[],
  config: BallMatchConfig = DEFAULT_BALL_MATCH_CONFIG
): Promise<Map<number, BallPositionMatch | null>> {
  const ballTrack = await getBallTrackData(matchId);
  const results = new Map<number, BallPositionMatch | null>();

  if (!ballTrack || !ballTrack.detections) {
    // ボールトラックデータがない場合は全てnull
    for (const ts of eventTimestamps) {
      results.set(ts, null);
    }
    return results;
  }

  for (const ts of eventTimestamps) {
    const match = getBallPositionAtTimestamp(ballTrack.detections, ts, config);
    results.set(ts, match);
  }

  return results;
}

/**
 * ボール位置をPositionWithMetadata形式に変換
 */
export function ballMatchToPositionMetadata(
  match: BallPositionMatch | null
): PositionWithMetadata | null {
  if (!match) {
    return null;
  }

  return {
    position: match.position,
    source: match.source,
    confidence: match.confidence,
  };
}

/**
 * イベント位置の優先順位に基づいて最終位置を決定
 *
 * 優先順位:
 * 1. ボール検出 (ball_detection)
 * 2. Gemini出力 (gemini_output)
 * 3. ゾーン変換 (zone_conversion)
 */
export function selectBestPosition(
  ballPosition: PositionWithMetadata | null,
  geminiPosition: PositionWithMetadata | null,
  zonePosition: PositionWithMetadata | null
): PositionWithMetadata {
  // ボール検出が最優先（信頼度が十分な場合）
  if (ballPosition && ballPosition.confidence >= 0.5) {
    return ballPosition;
  }

  // Gemini出力が次に優先
  if (geminiPosition && geminiPosition.confidence >= 0.4) {
    return geminiPosition;
  }

  // ボール検出の信頼度が低い場合でも、他にない場合は使用
  if (ballPosition) {
    return ballPosition;
  }

  // Gemini出力の信頼度が低い場合でも使用
  if (geminiPosition) {
    return geminiPosition;
  }

  // ゾーン変換をフォールバック
  if (zonePosition) {
    return zonePosition;
  }

  // 全てない場合はデフォルト（中央）
  return {
    position: { x: 0.5, y: 0.5 },
    source: "unknown",
    confidence: 0.1,
  };
}
