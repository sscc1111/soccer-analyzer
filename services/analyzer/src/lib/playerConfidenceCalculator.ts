/**
 * Player Confidence Calculator
 *
 * 選手識別の総合信頼度を計算
 *
 * 信頼度コンポーネント:
 * 1. OCR信頼度 (50%): 背番号の直接認識
 * 2. チームマッチング信頼度 (25%): チームカラーとの一致
 * 3. トラッキング一貫性 (25%): 行動パターンの整合性
 */

import type { TrackFrame } from "@soccer/shared";

/**
 * 信頼度コンポーネント
 */
export interface ConfidenceComponents {
  ocrConfidence: number;
  teamMatchingConfidence: number;
  trackingConsistency: number;
}

/**
 * 総合信頼度計算結果
 */
export interface PlayerConfidenceResult {
  overall: number;
  components: ConfidenceComponents;
  qualityScore: "high" | "medium" | "low";
  needsReview: boolean;
  reviewReasons: string[];
}

/**
 * 信頼度閾値
 */
export const CONFIDENCE_THRESHOLDS = {
  high: 0.8,
  medium: 0.6,
  low: 0.4,
};

/**
 * 信頼度の重み
 */
export const CONFIDENCE_WEIGHTS = {
  ocr: 0.5,
  teamMatching: 0.25,
  tracking: 0.25,
};

/**
 * TrackFrameの配列からトラッキング一貫性スコアを計算
 *
 * トラッキング一貫性は以下の3つの要素から計算されます：
 * 1. フレーム連続性 (40%): 選手が検出されたフレーム数の割合
 * 2. 信頼度の安定性 (30%): 各フレームでの検出信頼度の平均
 * 3. 位置の滑らかさ (30%): フレーム間の位置変化の滑らかさ
 *
 * @param frames - 選手のトラッキングフレーム配列
 * @param expectedFrameCount - 期待されるフレーム数（動画の総フレーム数）
 * @param videoDuration - 動画の長さ（秒）- 位置変化の滑らかさ計算に使用
 * @returns トラッキング一貫性スコア (0-1)
 */
export function calculateTrackingConsistency(
  frames: TrackFrame[],
  expectedFrameCount: number,
  videoDuration?: number
): number {
  // 空の配列の場合はデフォルト値を返す
  if (frames.length === 0 || expectedFrameCount <= 0) {
    return 0.5;
  }

  // 1. フレーム連続性 (40%)
  const frameCoverage = Math.min(1.0, frames.length / expectedFrameCount);

  // 2. 信頼度の安定性 (30%)
  const avgConfidence =
    frames.reduce((sum, frame) => sum + frame.confidence, 0) / frames.length;

  // 3. 位置の滑らかさ (30%)
  let smoothnessScore = 1.0;

  if (frames.length >= 2) {
    // フレームを時系列でソート
    const sortedFrames = [...frames].sort((a, b) => a.frameNumber - b.frameNumber);

    // フレーム間の位置変化を計算
    const positionChanges: number[] = [];
    for (let i = 1; i < sortedFrames.length; i++) {
      const prev = sortedFrames[i - 1];
      const curr = sortedFrames[i];

      // 2点間の距離を計算（ユークリッド距離）
      const dx = curr.center.x - prev.center.x;
      const dy = curr.center.y - prev.center.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // フレーム間隔を考慮（飛ばされたフレームがある場合）
      const frameGap = curr.frameNumber - prev.frameNumber;
      // frameGap <= 0 の場合（同一フレームまたは時間逆行）は移動なしとして扱う
      const normalizedDistance = frameGap > 0 ? distance / frameGap : 0;

      positionChanges.push(normalizedDistance);
    }

    if (positionChanges.length > 0) {
      // 平均移動距離を計算
      const avgMovement =
        positionChanges.reduce((sum, d) => sum + d, 0) / positionChanges.length;

      // 移動距離の標準偏差を計算
      const variance =
        positionChanges.reduce((sum, d) => sum + Math.pow(d - avgMovement, 2), 0) /
        positionChanges.length;
      const stdDev = Math.sqrt(variance);

      // 変動係数（CV: Coefficient of Variation）を計算
      // CVが高いほど不規則な動き
      // avgMovementが極小の場合はCV計算が意味をなさないため0とする
      // また、CVが異常に高くなることを防ぐため上限10.0を設定
      const cv = avgMovement > 0.001 ? Math.min(stdDev / avgMovement, 10.0) : 0;

      // CVが1.0を超えると非常に不規則な動き
      // 平均移動距離が大きい場合は標準偏差の影響を強くする
      const irregularityScore = Math.min(cv, 5.0) / 5.0;

      // 大きな移動距離そのものもペナルティとする
      const largeMovementPenalty = Math.min(avgMovement * 2, 1.0);

      smoothnessScore = Math.max(0, 1 - irregularityScore * 0.7 - largeMovementPenalty * 0.3);
    }
  }

  // 重み付き平均を計算
  const trackingConsistency =
    frameCoverage * 0.4 + avgConfidence * 0.3 + smoothnessScore * 0.3;

  // 0-1の範囲にクランプ
  return Math.max(0, Math.min(1, trackingConsistency));
}

/**
 * 総合信頼度を計算
 *
 * @param ocrConfidence - 背番号OCRの信頼度 (0-1)
 * @param teamMatchingConfidence - チームカラーマッチングの信頼度 (0-1)
 * @param trackingConsistency - トラッキング一貫性 (0-1)
 * @returns 総合信頼度と品質スコア
 */
export function calculatePlayerConfidence(
  ocrConfidence: number,
  teamMatchingConfidence: number = 0.5,
  trackingConsistency: number = 0.5
): PlayerConfidenceResult {
  const components: ConfidenceComponents = {
    ocrConfidence: Math.max(0, Math.min(1, ocrConfidence)),
    teamMatchingConfidence: Math.max(0, Math.min(1, teamMatchingConfidence)),
    trackingConsistency: Math.max(0, Math.min(1, trackingConsistency)),
  };

  // 重み付き平均を計算
  const overall =
    components.ocrConfidence * CONFIDENCE_WEIGHTS.ocr +
    components.teamMatchingConfidence * CONFIDENCE_WEIGHTS.teamMatching +
    components.trackingConsistency * CONFIDENCE_WEIGHTS.tracking;

  // 品質スコアを決定
  let qualityScore: "high" | "medium" | "low";
  if (overall >= CONFIDENCE_THRESHOLDS.high) {
    qualityScore = "high";
  } else if (overall >= CONFIDENCE_THRESHOLDS.medium) {
    qualityScore = "medium";
  } else {
    qualityScore = "low";
  }

  // レビュー理由を収集
  const reviewReasons: string[] = [];
  if (components.ocrConfidence < CONFIDENCE_THRESHOLDS.medium) {
    reviewReasons.push("low_ocr_confidence");
  }
  if (components.teamMatchingConfidence < CONFIDENCE_THRESHOLDS.medium) {
    reviewReasons.push("low_team_matching");
  }
  if (components.trackingConsistency < CONFIDENCE_THRESHOLDS.medium) {
    reviewReasons.push("low_tracking_consistency");
  }

  return {
    overall,
    components,
    qualityScore,
    needsReview: overall < CONFIDENCE_THRESHOLDS.medium || reviewReasons.length > 0,
    reviewReasons,
  };
}

/**
 * イベント実行者識別の信頼度を計算
 *
 * @param eventConfidence - イベント検出自体の信頼度
 * @param playerConfidence - 選手識別の信頼度
 * @param positionProximity - ボール/イベント位置への近接度 (0-1)
 * @returns 実行者識別の総合信頼度
 */
export function calculatePerformerIdentificationConfidence(
  eventConfidence: number,
  playerConfidence: number,
  positionProximity: number = 0.5
): {
  confidence: number;
  quality: "high" | "medium" | "low";
  reliable: boolean;
} {
  // イベント信頼度と選手信頼度を組み合わせ
  // 位置近接度で調整
  const baseConfidence = (eventConfidence * 0.4 + playerConfidence * 0.6) * positionProximity;

  // ベイズ的な組み合わせ（両方が高いときにブースト）
  const boost = Math.min(eventConfidence, playerConfidence) * 0.1;
  const confidence = Math.min(1.0, baseConfidence + boost);

  let quality: "high" | "medium" | "low";
  if (confidence >= CONFIDENCE_THRESHOLDS.high) {
    quality = "high";
  } else if (confidence >= CONFIDENCE_THRESHOLDS.medium) {
    quality = "medium";
  } else {
    quality = "low";
  }

  return {
    confidence,
    quality,
    reliable: confidence >= CONFIDENCE_THRESHOLDS.medium,
  };
}

/**
 * 複数の候補から最適な選手を選択
 *
 * @param candidates - 選手候補リスト
 * @returns 最適な選手と代替候補
 */
export function selectBestPlayerCandidate(
  candidates: Array<{
    jerseyNumber: number | null;
    confidence: number;
    team: "home" | "away";
    trackId?: string;
  }>
): {
  best: (typeof candidates)[0] | null;
  alternatives: typeof candidates;
  hasMultipleCandidates: boolean;
  needsReview: boolean;
} {
  if (candidates.length === 0) {
    return {
      best: null,
      alternatives: [],
      hasMultipleCandidates: false,
      needsReview: true,
    };
  }

  // 信頼度でソート
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  const alternatives = sorted.slice(1);

  // 複数の高信頼度候補がある場合はレビューが必要
  const highConfidenceCandidates = candidates.filter(
    (c) => c.confidence >= CONFIDENCE_THRESHOLDS.medium
  );
  const hasMultipleCandidates = highConfidenceCandidates.length > 1;

  // 最高信頼度が低い場合もレビューが必要
  const needsReview =
    best.confidence < CONFIDENCE_THRESHOLDS.medium ||
    (hasMultipleCandidates &&
      sorted[1].confidence > sorted[0].confidence * 0.8); // 2番目が1番目の80%以上

  return {
    best,
    alternatives,
    hasMultipleCandidates,
    needsReview,
  };
}

/**
 * 選手-イベント紐付けの妥当性を検証
 *
 * @param playerTeam - 選手のチーム
 * @param eventTeam - イベントのチーム
 * @param playerJersey - 選手の背番号
 * @param eventPlayer - イベントで検出された選手識別子
 * @returns 妥当性検証結果
 */
export function validatePlayerEventLinkage(
  playerTeam: "home" | "away",
  eventTeam: "home" | "away",
  playerJersey: number | null,
  eventPlayer: string | undefined
): {
  valid: boolean;
  issues: string[];
  matchConfidence: number;
} {
  const issues: string[] = [];
  let matchConfidence = 1.0;

  // チーム一致チェック
  if (playerTeam !== eventTeam) {
    issues.push("team_mismatch");
    matchConfidence *= 0.1; // 大幅にペナルティ
  }

  // 背番号一致チェック
  if (playerJersey !== null && eventPlayer) {
    // eventPlayerから背番号を抽出 (例: "#10" -> 10)
    const eventJerseyMatch = eventPlayer.match(/#?(\d+)/);
    if (eventJerseyMatch) {
      const eventJersey = parseInt(eventJerseyMatch[1], 10);
      if (eventJersey !== playerJersey) {
        issues.push("jersey_mismatch");
        matchConfidence *= 0.3;
      }
    }
  }

  // 背番号がない場合は信頼度を下げる
  if (playerJersey === null) {
    issues.push("no_jersey_number");
    matchConfidence *= 0.7;
  }

  return {
    valid: issues.length === 0,
    issues,
    matchConfidence,
  };
}

/**
 * 選手識別の統計を計算
 */
export interface PlayerIdentificationStats {
  totalPlayers: number;
  identifiedWithJersey: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  needsReview: number;
  identificationRate: number;
  averageConfidence: number;
}

/**
 * 選手識別統計を計算
 */
export function calculatePlayerIdentificationStats(
  players: Array<{
    jerseyNumber: number | null;
    confidence: number;
    needsReview?: boolean;
  }>
): PlayerIdentificationStats {
  const totalPlayers = players.length;
  if (totalPlayers === 0) {
    return {
      totalPlayers: 0,
      identifiedWithJersey: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      needsReview: 0,
      identificationRate: 0,
      averageConfidence: 0,
    };
  }

  const identifiedWithJersey = players.filter((p) => p.jerseyNumber !== null).length;
  const highConfidence = players.filter(
    (p) => p.confidence >= CONFIDENCE_THRESHOLDS.high
  ).length;
  const mediumConfidence = players.filter(
    (p) =>
      p.confidence >= CONFIDENCE_THRESHOLDS.medium &&
      p.confidence < CONFIDENCE_THRESHOLDS.high
  ).length;
  const lowConfidence = players.filter(
    (p) => p.confidence < CONFIDENCE_THRESHOLDS.medium
  ).length;
  const needsReview = players.filter((p) => p.needsReview === true).length;

  const totalConfidence = players.reduce((sum, p) => sum + p.confidence, 0);

  return {
    totalPlayers,
    identifiedWithJersey,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    needsReview,
    identificationRate: identifiedWithJersey / totalPlayers,
    averageConfidence: totalConfidence / totalPlayers,
  };
}
