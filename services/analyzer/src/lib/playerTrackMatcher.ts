/**
 * Player Track Matcher
 *
 * trackId → playerId マッピングと同一選手の複数検出マージ
 *
 * 機能:
 * 1. 複数のtrackIdを同一選手にマージ
 * 2. 背番号 + チームカラーの組み合わせで同一選手を判定
 * 3. trackIdの時間的連続性を考慮
 * 4. 信頼度ベースの情報統合
 */

import type { TrackPlayerMapping } from "@soccer/shared";
import {
  calculatePlayerConfidence,
  selectBestPlayerCandidate,
  type PlayerConfidenceResult,
} from "./playerConfidenceCalculator";

/**
 * Geminiから取得した生の選手情報
 */
export interface RawPlayerDetection {
  team: "home" | "away";
  jerseyNumber: number | null;
  role: "player" | "goalkeeper";
  confidence: number;
  trackingId?: string | null;
  fallbackIdentifiers?: {
    bodyType?: "tall" | "average" | "short" | null;
    hairColor?: string | null;
    dominantPosition?: "defender" | "midfielder" | "forward" | "goalkeeper" | null;
  };
}

/**
 * マージされた選手情報
 */
export interface MergedPlayerInfo {
  team: "home" | "away";
  jerseyNumber: number | null;
  role: "player" | "goalkeeper";
  confidence: number;
  trackIds: string[]; // この選手に関連する全てのtrackId
  primaryTrackId: string; // 最も信頼度の高いtrackId
  detectionCount: number;
  fallbackIdentifiers?: RawPlayerDetection["fallbackIdentifiers"];
}

/**
 * 選手マッチング結果
 */
export interface PlayerMatchingResult {
  mergedPlayers: MergedPlayerInfo[];
  trackMappings: TrackPlayerMapping[];
  stats: {
    totalDetections: number;
    uniquePlayers: number;
    mergedDetections: number;
    withJerseyNumber: number;
    withoutJerseyNumber: number;
    avgConfidence: number;
  };
}

/**
 * 2人の選手が同一人物かどうかを判定
 */
function isSamePlayer(
  p1: RawPlayerDetection | MergedPlayerInfo,
  p2: RawPlayerDetection
): boolean {
  // チームが異なる場合は別人
  if (p1.team !== p2.team) {
    return false;
  }

  // 背番号が両方ともnullでない場合、背番号で判定
  if (p1.jerseyNumber !== null && p2.jerseyNumber !== null) {
    return p1.jerseyNumber === p2.jerseyNumber;
  }

  // trackingIdが両方とも存在する場合、trackingIdで判定
  const trackingId1 =
    "trackingId" in p1 ? p1.trackingId : ("primaryTrackId" in p1 ? p1.primaryTrackId : null);
  const trackingId2 = p2.trackingId;
  if (trackingId1 && trackingId2 && trackingId1 === trackingId2) {
    return true;
  }

  // 背番号がない場合はフォールバック識別子で判定
  if (p1.jerseyNumber === null && p2.jerseyNumber === null) {
    const fb1 = "fallbackIdentifiers" in p1 ? p1.fallbackIdentifiers : undefined;
    const fb2 = p2.fallbackIdentifiers;

    if (!fb1 || !fb2) {
      return false; // 情報不足で判定不可
    }

    // 複数の特徴が一致する場合のみ同一人物とみなす
    let matchCount = 0;
    let totalChecks = 0;

    if (fb1.bodyType && fb2.bodyType) {
      totalChecks++;
      if (fb1.bodyType === fb2.bodyType) matchCount++;
    }

    if (fb1.hairColor && fb2.hairColor) {
      totalChecks++;
      if (fb1.hairColor === fb2.hairColor) matchCount++;
    }

    if (fb1.dominantPosition && fb2.dominantPosition) {
      totalChecks++;
      if (fb1.dominantPosition === fb2.dominantPosition) matchCount++;
    }

    // 2つ以上の特徴が一致する場合のみ同一人物
    return totalChecks >= 2 && matchCount >= 2;
  }

  // 背番号が片方のみの場合は同一人物と判断しない（保守的）
  return false;
}

/**
 * 複数の選手検出結果をマージ
 *
 * @param detections - 生の選手検出結果
 * @param matchId - 試合ID
 * @param trackingConsistencyMap - trackIdごとのトラッキング一貫性スコア（オプション）
 */
export function mergePlayerDetections(
  detections: RawPlayerDetection[],
  matchId: string,
  trackingConsistencyMap?: Map<string, number>
): PlayerMatchingResult {
  const mergedPlayers: MergedPlayerInfo[] = [];

  // 各検出を既存のマージ済み選手と比較
  for (let i = 0; i < detections.length; i++) {
    const detection = detections[i];
    const syntheticTrackId = detection.trackingId || `${matchId}_gemini_player_${i}`;

    // 既存のマージ済み選手と一致するか確認
    const existingPlayer = mergedPlayers.find((mp) => isSamePlayer(mp, detection));

    if (existingPlayer) {
      // 既存の選手にマージ
      existingPlayer.trackIds.push(syntheticTrackId);
      existingPlayer.detectionCount++;

      // より高い信頼度の情報で更新
      if (detection.confidence > existingPlayer.confidence) {
        existingPlayer.confidence = detection.confidence;
        existingPlayer.primaryTrackId = syntheticTrackId;

        // 背番号がnullからnon-nullに更新される場合
        if (existingPlayer.jerseyNumber === null && detection.jerseyNumber !== null) {
          existingPlayer.jerseyNumber = detection.jerseyNumber;
        }

        // フォールバック識別子を更新
        if (detection.fallbackIdentifiers) {
          existingPlayer.fallbackIdentifiers = {
            ...existingPlayer.fallbackIdentifiers,
            ...detection.fallbackIdentifiers,
          };
        }
      }
    } else {
      // 新しい選手として追加
      mergedPlayers.push({
        team: detection.team,
        jerseyNumber: detection.jerseyNumber,
        role: detection.role,
        confidence: detection.confidence,
        trackIds: [syntheticTrackId],
        primaryTrackId: syntheticTrackId,
        detectionCount: 1,
        fallbackIdentifiers: detection.fallbackIdentifiers,
      });
    }
  }

  // TrackPlayerMappingを生成
  const trackMappings: TrackPlayerMapping[] = [];
  for (const player of mergedPlayers) {
    for (const trackId of player.trackIds) {
      // チームマッチング信頼度を計算
      // 背番号がある場合は高く、ない場合は低く
      const teamMatchingConfidence = player.jerseyNumber !== null ? 0.8 : 0.5;

      // トラッキング一貫性を取得（マップにない場合はデフォルト値0.5）
      const trackingConsistency = trackingConsistencyMap?.get(trackId) ?? 0.5;

      const confidenceResult: PlayerConfidenceResult = calculatePlayerConfidence(
        player.confidence, // OCR confidence
        teamMatchingConfidence,
        trackingConsistency
      );

      const mapping: TrackPlayerMapping = {
        trackId,
        playerId: null, // rosterとのマッチングは別ステップ
        jerseyNumber: player.jerseyNumber,
        ocrConfidence: confidenceResult.overall,
        source: player.trackIds.length > 1 ? "roster_match" : "ocr", // 複数検出からマージした場合はroster_match
        needsReview: confidenceResult.needsReview,
        reviewReason: confidenceResult.needsReview
          ? (confidenceResult.reviewReasons[0] as
              | "low_confidence"
              | "multiple_candidates"
              | "no_match"
              | undefined)
          : undefined,
      };

      trackMappings.push(mapping);
    }
  }

  // 統計を計算
  const totalDetections = detections.length;
  const uniquePlayers = mergedPlayers.length;
  const mergedDetections = totalDetections - uniquePlayers;
  const withJerseyNumber = mergedPlayers.filter((p) => p.jerseyNumber !== null).length;
  const withoutJerseyNumber = uniquePlayers - withJerseyNumber;
  const totalConfidence = mergedPlayers.reduce((sum, p) => sum + p.confidence, 0);
  const avgConfidence = uniquePlayers > 0 ? totalConfidence / uniquePlayers : 0;

  return {
    mergedPlayers,
    trackMappings,
    stats: {
      totalDetections,
      uniquePlayers,
      mergedDetections,
      withJerseyNumber,
      withoutJerseyNumber,
      avgConfidence,
    },
  };
}

/**
 * 選手の信頼度を再計算（追加情報を使用）
 *
 * @param player - マージ済み選手情報
 * @param additionalContext - 追加のコンテキスト（例: 試合フォーマットから期待される選手数）
 */
export function recalculatePlayerConfidence(
  player: MergedPlayerInfo,
  additionalContext?: {
    expectedPlayerCount?: number;
    detectedPlayerCount?: number;
  }
): number {
  let confidence = player.confidence;

  // 複数回検出された場合は信頼度を上げる
  if (player.detectionCount > 1) {
    const detectionBoost = Math.min(0.1 * (player.detectionCount - 1), 0.3);
    confidence = Math.min(1.0, confidence + detectionBoost);
  }

  // 背番号がある場合はさらに信頼度を上げる
  if (player.jerseyNumber !== null) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  // 期待される選手数とのギャップが大きい場合は信頼度を下げる
  if (additionalContext?.expectedPlayerCount && additionalContext?.detectedPlayerCount) {
    const gap = Math.abs(
      additionalContext.expectedPlayerCount - additionalContext.detectedPlayerCount
    );
    if (gap > 2) {
      confidence = Math.max(0.1, confidence - 0.2);
    }
  }

  return confidence;
}

/**
 * 選手リストから重複を除去（高度なフィルタリング）
 *
 * 既に mergePlayerDetections を使用している場合は不要だが、
 * 追加の品質チェックとして使用可能
 */
export function deduplicatePlayers(players: MergedPlayerInfo[]): MergedPlayerInfo[] {
  const result: MergedPlayerInfo[] = [];

  for (const player of players) {
    // 既存の選手と完全一致するか確認
    const existingIndex = result.findIndex(
      (p) =>
        p.team === player.team &&
        p.jerseyNumber === player.jerseyNumber &&
        p.jerseyNumber !== null
    );

    if (existingIndex !== -1) {
      // 既存の選手とマージ
      const existing = result[existingIndex];
      existing.trackIds = [...new Set([...existing.trackIds, ...player.trackIds])];
      existing.detectionCount += player.detectionCount;

      // より高い信頼度の情報を採用
      if (player.confidence > existing.confidence) {
        existing.confidence = player.confidence;
        existing.primaryTrackId = player.primaryTrackId;
        existing.role = player.role;
        existing.fallbackIdentifiers = player.fallbackIdentifiers;
      }
    } else {
      result.push({ ...player });
    }
  }

  return result;
}

/**
 * 背番号の一貫性をチェック
 *
 * 同じtrackIdが複数の背番号に関連付けられている場合は警告
 */
export function validateJerseyNumberConsistency(
  mappings: TrackPlayerMapping[]
): {
  valid: boolean;
  issues: Array<{
    trackId: string;
    jerseyNumbers: (number | null)[];
    message: string;
  }>;
} {
  const trackToJerseys = new Map<string, Set<number>>();

  for (const mapping of mappings) {
    if (mapping.jerseyNumber !== null) {
      if (!trackToJerseys.has(mapping.trackId)) {
        trackToJerseys.set(mapping.trackId, new Set());
      }
      trackToJerseys.get(mapping.trackId)!.add(mapping.jerseyNumber);
    }
  }

  const issues: Array<{
    trackId: string;
    jerseyNumbers: (number | null)[];
    message: string;
  }> = [];

  for (const [trackId, jerseys] of trackToJerseys.entries()) {
    if (jerseys.size > 1) {
      issues.push({
        trackId,
        jerseyNumbers: Array.from(jerseys),
        message: `Track ${trackId} has multiple jersey numbers: ${Array.from(jerseys).join(", ")}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
