/**
 * Zone to Coordinate Conversion Utilities
 *
 * ゾーン情報（defensive_third, middle_third, attacking_third）を
 * ピッチ座標（0-1正規化座標）に変換するユーティリティ
 *
 * ピッチ座標系:
 * - x: 0（左ゴールライン）→ 1（右ゴールライン）
 * - y: 0（上タッチライン）→ 1（下タッチライン）
 *
 * ゾーン定義:
 * - defensive_third: x = 0.0 - 0.333（自陣）
 * - middle_third: x = 0.333 - 0.667（中盤）
 * - attacking_third: x = 0.667 - 1.0（敵陣）
 */

import type { Point2D } from "@soccer/shared";

export type EventZone = "defensive_third" | "middle_third" | "attacking_third";

/**
 * ゾーンの座標範囲定義
 */
export interface ZoneBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * ゾーンごとの座標範囲マッピング
 *
 * ホームチーム視点（左から右へ攻撃）で定義:
 * - defensive_third: 自陣（左側 1/3）
 * - middle_third: 中盤（中央 1/3）
 * - attacking_third: 敵陣（右側 1/3）
 */
export const ZONE_BOUNDS: Record<EventZone, ZoneBounds> = {
  defensive_third: {
    xMin: 0.0,
    xMax: 0.333,
    yMin: 0.0,
    yMax: 1.0,
  },
  middle_third: {
    xMin: 0.333,
    xMax: 0.667,
    yMin: 0.0,
    yMax: 1.0,
  },
  attacking_third: {
    xMin: 0.667,
    xMax: 1.0,
    yMin: 0.0,
    yMax: 1.0,
  },
};

/**
 * アウェイチーム用にゾーンを反転
 * アウェイチームは右から左へ攻撃するため、x座標を反転
 */
export const ZONE_BOUNDS_AWAY: Record<EventZone, ZoneBounds> = {
  // アウェイのdefensive_thirdは右側
  defensive_third: {
    xMin: 0.667,
    xMax: 1.0,
    yMin: 0.0,
    yMax: 1.0,
  },
  middle_third: {
    xMin: 0.333,
    xMax: 0.667,
    yMin: 0.0,
    yMax: 1.0,
  },
  // アウェイのattacking_thirdは左側
  attacking_third: {
    xMin: 0.0,
    xMax: 0.333,
    yMin: 0.0,
    yMax: 1.0,
  },
};

/**
 * ゾーンの中心座標を取得
 *
 * @param zone - イベントゾーン
 * @param team - チーム（home または away）
 * @returns ゾーン中心の Point2D 座標
 */
export function getZoneCenterCoordinate(
  zone: EventZone,
  team: "home" | "away" = "home"
): Point2D {
  const bounds = team === "home" ? ZONE_BOUNDS[zone] : ZONE_BOUNDS_AWAY[zone];

  return {
    x: (bounds.xMin + bounds.xMax) / 2,
    y: (bounds.yMin + bounds.yMax) / 2,
  };
}

/**
 * ゾーン内のランダムな座標を取得
 * テスト用またはバリエーションが必要な場合に使用
 *
 * @param zone - イベントゾーン
 * @param team - チーム（home または away）
 * @returns ゾーン内のランダムな Point2D 座標
 */
export function getRandomPositionInZone(
  zone: EventZone,
  team: "home" | "away" = "home"
): Point2D {
  const bounds = team === "home" ? ZONE_BOUNDS[zone] : ZONE_BOUNDS_AWAY[zone];

  return {
    x: bounds.xMin + Math.random() * (bounds.xMax - bounds.xMin),
    y: bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin),
  };
}

/**
 * ゾーン内の特定の相対位置の座標を取得
 *
 * @param zone - イベントゾーン
 * @param relativeX - ゾーン内のx相対位置 (0-1)
 * @param relativeY - ゾーン内のy相対位置 (0-1)
 * @param team - チーム（home または away）
 * @returns 指定位置の Point2D 座標
 */
export function getPositionInZone(
  zone: EventZone,
  relativeX: number,
  relativeY: number,
  team: "home" | "away" = "home"
): Point2D {
  const bounds = team === "home" ? ZONE_BOUNDS[zone] : ZONE_BOUNDS_AWAY[zone];

  // 0-1の範囲にクランプ
  const clampedX = Math.max(0, Math.min(1, relativeX));
  const clampedY = Math.max(0, Math.min(1, relativeY));

  return {
    x: bounds.xMin + clampedX * (bounds.xMax - bounds.xMin),
    y: bounds.yMin + clampedY * (bounds.yMax - bounds.yMin),
  };
}

/**
 * 座標がどのゾーンに属するかを判定
 *
 * @param position - 座標
 * @param team - チーム（home または away）
 * @returns イベントゾーン
 */
export function getZoneFromPosition(
  position: Point2D,
  team: "home" | "away" = "home"
): EventZone {
  const bounds = team === "home" ? ZONE_BOUNDS : ZONE_BOUNDS_AWAY;

  for (const [zone, zoneBounds] of Object.entries(bounds) as [EventZone, ZoneBounds][]) {
    if (
      position.x >= zoneBounds.xMin &&
      position.x <= zoneBounds.xMax &&
      position.y >= zoneBounds.yMin &&
      position.y <= zoneBounds.yMax
    ) {
      return zone;
    }
  }

  // デフォルトは中盤
  return "middle_third";
}

/**
 * 位置情報のソースを示すメタデータ
 */
export type PositionSource =
  | "ball_detection"    // ボール検出からの位置
  | "gemini_output"     // Geminiの出力からの位置
  | "zone_conversion"   // ゾーンからの変換
  | "merged"            // 複数検出のマージ（重複排除時）
  | "unknown";          // 不明

/**
 * 位置情報と信頼度を含む拡張型
 */
export interface PositionWithMetadata {
  position: Point2D;
  source: PositionSource;
  confidence: number;
}

/**
 * ゾーンから位置情報を生成（メタデータ付き）
 *
 * @param zone - イベントゾーン
 * @param team - チーム
 * @returns 位置情報とメタデータ
 */
export function getPositionFromZone(
  zone: EventZone | undefined,
  team: "home" | "away" = "home"
): PositionWithMetadata {
  if (!zone) {
    return {
      position: { x: 0.5, y: 0.5 }, // デフォルトは中央
      source: "unknown",
      confidence: 0.1,
    };
  }

  return {
    position: getZoneCenterCoordinate(zone, team),
    source: "zone_conversion",
    confidence: 0.5, // ゾーン変換は中程度の信頼度
  };
}

/**
 * 複数の位置情報をマージ（信頼度で加重平均）
 *
 * @param positions - 位置情報の配列
 * @returns マージされた位置情報
 */
export function mergePositions(positions: PositionWithMetadata[]): PositionWithMetadata {
  if (positions.length === 0) {
    return {
      position: { x: 0.5, y: 0.5 },
      source: "unknown",
      confidence: 0,
    };
  }

  if (positions.length === 1) {
    return positions[0];
  }

  // 信頼度でソート（降順）
  const sorted = [...positions].sort((a, b) => b.confidence - a.confidence);

  // 最も信頼度の高いソースを採用
  const bestSource = sorted[0].source;

  // 信頼度で加重平均
  const totalConfidence = positions.reduce((sum, p) => sum + p.confidence, 0);

  if (totalConfidence === 0) {
    return sorted[0];
  }

  const weightedX = positions.reduce(
    (sum, p) => sum + p.position.x * p.confidence,
    0
  ) / totalConfidence;

  const weightedY = positions.reduce(
    (sum, p) => sum + p.position.y * p.confidence,
    0
  ) / totalConfidence;

  // マージ後の信頼度（最大値 + ブースト）
  const mergedConfidence = Math.min(1.0, sorted[0].confidence + 0.1 * (positions.length - 1));

  return {
    position: { x: weightedX, y: weightedY },
    source: bestSource,
    confidence: mergedConfidence,
  };
}

/**
 * 2点間の距離を計算（正規化座標系）
 *
 * @param p1 - 点1
 * @param p2 - 点2
 * @returns 距離（0-√2の範囲）
 */
export function calculateDistance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 正規化座標をメートルに変換
 * 標準フィールドサイズ: 105m x 68m
 *
 * @param position - 正規化座標
 * @returns メートル座標
 */
export function normalizedToMeters(position: Point2D): Point2D {
  const FIELD_LENGTH = 105; // meters
  const FIELD_WIDTH = 68;   // meters

  return {
    x: position.x * FIELD_LENGTH,
    y: position.y * FIELD_WIDTH,
  };
}

/**
 * メートル座標を正規化座標に変換
 *
 * @param position - メートル座標
 * @returns 正規化座標
 */
export function metersToNormalized(position: Point2D): Point2D {
  const FIELD_LENGTH = 105;
  const FIELD_WIDTH = 68;

  return {
    x: position.x / FIELD_LENGTH,
    y: position.y / FIELD_WIDTH,
  };
}

/**
 * 2点間の距離をメートルで計算
 *
 * @param p1 - 正規化座標の点1
 * @param p2 - 正規化座標の点2
 * @returns 距離（メートル）
 */
export function calculateDistanceMeters(p1: Point2D, p2: Point2D): number {
  const p1Meters = normalizedToMeters(p1);
  const p2Meters = normalizedToMeters(p2);
  const dx = p2Meters.x - p1Meters.x;
  const dy = p2Meters.y - p1Meters.y;
  return Math.sqrt(dx * dx + dy * dy);
}
