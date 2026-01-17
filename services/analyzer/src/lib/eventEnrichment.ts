/**
 * Event Enrichment Utilities
 *
 * 位置データを使用したイベント情報の強化
 *
 * 機能:
 * 1. パス方向の計算（forward/backward/lateral）
 * 2. キャリー距離の正確な計算
 * 3. シュート位置に基づくxG計算
 * 4. イベント間の関連性分析
 * 5. キャリー/ドリブルの分類（Phase 2.2.2）
 */

import type { Point2D, TeamId } from "@soccer/shared";
import { calculateDistanceMeters, normalizedToMeters } from "./zoneToCoordinate";
import type { DeduplicatedEvent } from "./deduplication";

/**
 * パス方向
 */
export type PassDirection = "forward" | "backward" | "lateral";

/**
 * xGモデルの係数（簡易モデル）
 * 位置、角度、シュートタイプに基づく
 */
export interface XGFactors {
  distanceFromGoal: number;
  angleToGoal: number;
  inPenaltyArea: boolean;
  inGoalArea: boolean;
  shotType?: string;
}

/**
 * イベント強化結果
 */
export interface EnrichedEvent extends DeduplicatedEvent {
  /** パス方向（passイベントのみ） */
  passDirection?: PassDirection;
  /** 正確なキャリー距離（メートル） */
  carryDistanceMeters?: number;
  /** ドリブルフラグ（carryイベントのみ、Phase 2.2.2） */
  isDribble?: boolean;
  /** ドリブル判定の信頼度（carryイベントのみ、Phase 2.2.2） */
  dribbleConfidence?: number;
  /** 期待得点（shotイベントのみ） */
  xG?: number;
  /** xG計算の要因 */
  xGFactors?: XGFactors;
}

/**
 * パス方向を計算
 *
 * @param startPos - パス開始位置（正規化座標 0-1）
 * @param endPos - パス終了位置（正規化座標 0-1）
 * @param team - チーム（home: 左→右攻撃、away: 右→左攻撃）
 * @returns パス方向
 */
export function calculatePassDirection(
  startPos: Point2D,
  endPos: Point2D | null,
  team: TeamId
): PassDirection {
  if (!endPos) {
    // 終了位置がない場合はlateralとする
    return "lateral";
  }

  // チームによって攻撃方向が異なる
  // home: 左(0)→右(1)へ攻撃
  // away: 右(1)→左(0)へ攻撃
  const attackDirection = team === "home" ? 1 : -1;

  // X方向の移動量を計算
  const xDiff = (endPos.x - startPos.x) * attackDirection;

  // Y方向の移動量を計算
  const yDiff = Math.abs(endPos.y - startPos.y);

  // 閾値: 10%（約10m相当）の移動で方向を判定
  const threshold = 0.1;

  if (xDiff > threshold) {
    // 攻撃方向への大きな移動
    return "forward";
  } else if (xDiff < -threshold) {
    // 攻撃方向と逆への大きな移動
    return "backward";
  } else {
    // 横方向への移動、または小さな移動
    return "lateral";
  }
}

/**
 * キャリー距離を計算（メートル単位）
 *
 * @param startPos - 開始位置（正規化座標 0-1）
 * @param endPos - 終了位置（正規化座標 0-1）
 * @returns 距離（メートル）
 */
export function calculateCarryDistance(
  startPos: Point2D | undefined,
  endPos: Point2D | undefined
): number {
  if (!startPos || !endPos) {
    return 0;
  }

  return calculateDistanceMeters(startPos, endPos);
}

/**
 * Phase 2.2.2: キャリーがドリブルかどうかを判定
 *
 * ドリブルの判定基準:
 * 1. 継続時間が2秒以上
 * 2. 移動距離が10メートル以上
 * 3. ゾーン変化（守備→中盤→攻撃の進行）
 * 4. 攻撃方向への進行（X軸方向の変化）
 *
 * @param carry - キャリーイベント
 * @param distance - キャリー距離（メートル）
 * @param startPos - 開始位置（正規化座標）
 * @param endPos - 終了位置（正規化座標）
 * @returns { isDribble: boolean; confidence: number }
 */
export function classifyCarryAsDribble(
  carry: DeduplicatedEvent,
  distance: number | undefined,
  startPos: Point2D | undefined,
  endPos: Point2D | undefined
): { isDribble: boolean; confidence: number } {
  // デフォルト値: 単純なキャリー
  let isDribble = false;
  let confidence = 0.5; // 中立的な信頼度

  // 基本データの検証
  if (!distance || !startPos || !endPos) {
    // 位置データがない場合は判定不可
    return { isDribble: false, confidence: 0.3 };
  }

  // 判定要因のスコアリング
  const factors = {
    duration: 0,
    distance: 0,
    zoneChange: 0,
    attackProgression: 0,
  };

  // 1. 継続時間（details から推定、デフォルト1秒と仮定）
  const duration = (carry.details?.duration as number | undefined) ?? 1.0;
  if (duration >= 3.0) {
    factors.duration = 1.0; // 3秒以上: 明確なドリブル
  } else if (duration >= 2.0) {
    factors.duration = 0.7; // 2-3秒: ドリブルの可能性高
  } else if (duration >= 1.5) {
    factors.duration = 0.4; // 1.5-2秒: 境界線
  } else {
    factors.duration = 0.1; // 1.5秒未満: 単純なキャリー
  }

  // 2. 移動距離
  if (distance >= 15) {
    factors.distance = 1.0; // 15m以上: 明確なドリブル
  } else if (distance >= 10) {
    factors.distance = 0.8; // 10-15m: ドリブルの可能性高
  } else if (distance >= 7) {
    factors.distance = 0.5; // 7-10m: 境界線
  } else if (distance >= 5) {
    factors.distance = 0.3; // 5-7m: やや低め
  } else {
    factors.distance = 0.1; // 5m未満: 単純なキャリー
  }

  // 3. ゾーン変化の検出
  const startZone = carry.zone as string | undefined;
  const endZone = carry.details?.endZone as string | undefined;

  if (startZone && endZone && startZone !== endZone) {
    // ゾーン変化がある場合
    const team = carry.team as "home" | "away";
    const isProgressingForward =
      (team === "home" &&
        ((startZone === "defensive_third" && endZone === "middle_third") ||
         (startZone === "middle_third" && endZone === "attacking_third") ||
         (startZone === "defensive_third" && endZone === "attacking_third"))) ||
      (team === "away" &&
        ((startZone === "attacking_third" && endZone === "middle_third") ||
         (startZone === "middle_third" && endZone === "defensive_third") ||
         (startZone === "attacking_third" && endZone === "defensive_third")));

    if (isProgressingForward) {
      factors.zoneChange = 1.0; // 攻撃方向へのゾーン変化
    } else {
      factors.zoneChange = 0.3; // 後退方向へのゾーン変化（低いスコア）
    }
  } else {
    factors.zoneChange = 0.5; // ゾーン変化なし（中立）
  }

  // 4. 攻撃方向への進行（X軸の変化）
  const team = carry.team as "home" | "away";
  // home: 左(0)→右(1)へ攻撃、away: 右(1)→左(0)へ攻撃
  const attackDirection = team === "home" ? 1 : -1;
  const xProgress = (endPos.x - startPos.x) * attackDirection;

  // X方向の進行度合い（正規化座標の10%以上で有意な進行とみなす）
  if (xProgress > 0.15) {
    factors.attackProgression = 1.0; // 大きく前進
  } else if (xProgress > 0.10) {
    factors.attackProgression = 0.8; // 明確な前進
  } else if (xProgress > 0.05) {
    factors.attackProgression = 0.5; // やや前進
  } else if (xProgress > 0) {
    factors.attackProgression = 0.3; // わずかに前進
  } else {
    factors.attackProgression = 0.1; // 横移動または後退
  }

  // 総合判定: 各要因の加重平均
  // 重要度: 距離 40%, 継続時間 30%, 攻撃進行 20%, ゾーン変化 10%
  const totalScore =
    factors.distance * 0.40 +
    factors.duration * 0.30 +
    factors.attackProgression * 0.20 +
    factors.zoneChange * 0.10;

  // 閾値による判定
  // 連続的なconfidence計算で境界値での不連続を防止
  if (totalScore >= 0.7) {
    // 高スコア: 明確なドリブル
    isDribble = true;
    // 0.7→0.85, 1.0→0.95 (線形補間)
    confidence = Math.min(0.95, 0.85 + (totalScore - 0.7) * (0.1 / 0.3));
  } else if (totalScore >= 0.5) {
    // 中スコア: ドリブル
    isDribble = true;
    // 0.5→0.75, 0.7→0.85 (線形補間)
    confidence = 0.75 + (totalScore - 0.5) * (0.1 / 0.2);
  } else if (totalScore >= 0.35) {
    // 低スコア: 弱いドリブル
    isDribble = true;
    // 0.35→0.60, 0.5→0.75 (線形補間)
    confidence = 0.60 + (totalScore - 0.35) * (0.15 / 0.15);
  } else {
    // 単純なキャリー
    isDribble = false;
    // 0.0→0.75, 0.35→0.60 (線形補間、信頼度が高い = キャリーでない確率が高い)
    confidence = 0.75 - totalScore * (0.15 / 0.35);
  }

  return { isDribble, confidence };
}

/**
 * ゴールまでの距離を計算
 *
 * @param position - シュート位置（正規化座標 0-1）
 * @param team - シュートしたチーム
 * @returns ゴールまでの距離（メートル）
 */
export function calculateDistanceToGoal(position: Point2D, team: TeamId): number {
  // ゴール位置（正規化座標）
  // home: away側のゴール（x=1, y=0.5）
  // away: home側のゴール（x=0, y=0.5）
  const goalPos: Point2D = team === "home"
    ? { x: 1.0, y: 0.5 }
    : { x: 0.0, y: 0.5 };

  return calculateDistanceMeters(position, goalPos);
}

/**
 * ゴールへの角度を計算
 *
 * @param position - シュート位置（正規化座標 0-1）
 * @param team - シュートしたチーム
 * @returns 角度（度）- 中央から0度、サイドで大きくなる
 */
export function calculateAngleToGoal(position: Point2D, team: TeamId): number {
  // メートル座標に変換
  const posMeters = normalizedToMeters(position);

  // ゴールポストの位置（フィールド幅68m、ゴール幅7.32m）
  const goalY = 68 / 2; // 34m（フィールド中央）
  const goalWidth = 7.32;
  const leftPostY = goalY - goalWidth / 2; // 30.34m
  const rightPostY = goalY + goalWidth / 2; // 37.66m

  // ゴール位置（X座標）
  const goalX = team === "home" ? 105 : 0;

  // 両ポストへの角度を計算
  const dx = Math.abs(goalX - posMeters.x);
  if (dx === 0) {
    // ゴールライン上にいる場合
    return 0;
  }

  const angleLeft = Math.atan2(Math.abs(posMeters.y - leftPostY), dx);
  const angleRight = Math.atan2(Math.abs(posMeters.y - rightPostY), dx);

  // ゴールを見込む角度（両ポスト間の角度）
  const viewAngle = Math.abs(angleLeft - angleRight) * (180 / Math.PI);

  return viewAngle;
}

/**
 * ペナルティエリア内かどうかを判定
 *
 * @param position - 位置（正規化座標 0-1）
 * @param team - シュートしたチーム
 * @returns ペナルティエリア内ならtrue
 */
export function isInPenaltyArea(position: Point2D, team: TeamId): boolean {
  // ペナルティエリアの範囲（正規化座標）
  // フィールド長105m、PA深さ16.5m
  const paDepth = 16.5 / 105; // ≈0.157

  // PA幅はフィールド幅68mに対して40.32m（約0.593）
  const paWidth = 40.32 / 68;
  const paYMin = (1 - paWidth) / 2; // ≈0.203
  const paYMax = 1 - paYMin; // ≈0.797

  // チームによって攻撃側のPAを判定
  if (team === "home") {
    // away側のPA（右側、x > 1 - paDepth）
    return position.x > (1 - paDepth) && position.y > paYMin && position.y < paYMax;
  } else {
    // home側のPA（左側、x < paDepth）
    return position.x < paDepth && position.y > paYMin && position.y < paYMax;
  }
}

/**
 * ゴールエリア内かどうかを判定
 *
 * @param position - 位置（正規化座標 0-1）
 * @param team - シュートしたチーム
 * @returns ゴールエリア内ならtrue
 */
export function isInGoalArea(position: Point2D, team: TeamId): boolean {
  // ゴールエリアの範囲（正規化座標）
  // フィールド長105m、GA深さ5.5m
  const gaDepth = 5.5 / 105; // ≈0.052

  // GA幅はフィールド幅68mに対して18.32m（約0.269）
  const gaWidth = 18.32 / 68;
  const gaYMin = (1 - gaWidth) / 2; // ≈0.365
  const gaYMax = 1 - gaYMin; // ≈0.635

  // チームによって攻撃側のGAを判定
  if (team === "home") {
    return position.x > (1 - gaDepth) && position.y > gaYMin && position.y < gaYMax;
  } else {
    return position.x < gaDepth && position.y > gaYMin && position.y < gaYMax;
  }
}

/**
 * 期待得点（xG）を計算
 *
 * 簡易モデル: 距離と角度に基づく基本的なxG計算
 * 実際のモデルは機械学習で訓練されたものを使用すべきだが、
 * ここでは位置情報に基づく近似値を計算
 *
 * @param position - シュート位置（正規化座標 0-1）
 * @param team - シュートしたチーム
 * @param shotType - シュートタイプ
 * @returns xG値（0-1）
 */
export function calculateXG(
  position: Point2D | undefined,
  team: TeamId,
  shotType?: string
): { xG: number; factors: XGFactors } {
  if (!position) {
    // 位置情報がない場合はデフォルト値
    return {
      xG: 0.1,
      factors: {
        distanceFromGoal: 20,
        angleToGoal: 15,
        inPenaltyArea: false,
        inGoalArea: false,
        shotType,
      },
    };
  }

  const distanceFromGoal = calculateDistanceToGoal(position, team);
  const angleToGoal = calculateAngleToGoal(position, team);
  const inPenaltyArea = isInPenaltyArea(position, team);
  const inGoalArea = isInGoalArea(position, team);

  const factors: XGFactors = {
    distanceFromGoal,
    angleToGoal,
    inPenaltyArea,
    inGoalArea,
    shotType,
  };

  // 基本xG計算（距離と角度に基づく）
  // 参考: 一般的なxGモデルの傾向
  // - ペナルティスポット（11m）からのxG ≈ 0.76
  // - 6ヤードボックス内のxG ≈ 0.35-0.50
  // - ペナルティエリア縁からのxG ≈ 0.05-0.10

  let xG = 0;

  // 距離による基本値（指数関数的減衰）
  // 近いほど高い
  if (distanceFromGoal <= 5) {
    xG = 0.6; // ゴール目前
  } else if (distanceFromGoal <= 11) {
    xG = 0.5 - (distanceFromGoal - 5) * 0.05; // 5-11m: 0.6 → 0.2
  } else if (distanceFromGoal <= 18) {
    xG = 0.2 - (distanceFromGoal - 11) * 0.02; // 11-18m: 0.2 → 0.06
  } else if (distanceFromGoal <= 30) {
    xG = 0.06 - (distanceFromGoal - 18) * 0.003; // 18-30m: 0.06 → 0.02
  } else {
    xG = Math.max(0.01, 0.02 - (distanceFromGoal - 30) * 0.001); // 30m+: very low
  }

  // 角度による調整（狭い角度はxG低下）
  // angleToGoalは見込み角度なので、大きいほど有利
  if (angleToGoal < 10) {
    xG *= 0.5; // 非常に狭い角度
  } else if (angleToGoal < 20) {
    xG *= 0.7; // やや狭い角度
  } else if (angleToGoal < 30) {
    xG *= 0.85; // 通常の角度
  }
  // 30度以上は調整なし

  // エリアによる調整
  if (inGoalArea) {
    xG = Math.max(xG, 0.35); // 6ヤードボックス内は最低0.35
  } else if (inPenaltyArea) {
    xG = Math.max(xG, 0.08); // PA内は最低0.08
  }

  // シュートタイプによる調整
  if (shotType) {
    switch (shotType) {
      case "header":
        xG *= 0.8; // ヘディングはやや難しい
        break;
      case "volley":
        xG *= 0.9; // ボレーもやや難しい
        break;
      case "penalty":
        xG = 0.76; // PKは固定値
        break;
      case "chip":
        xG *= 0.7; // チップは難しい
        break;
      case "long_range":
        xG *= 0.6; // ロングレンジは難しい
        break;
      // power, placed は調整なし
    }
  }

  // 最終的に0-1の範囲に収める
  xG = Math.min(1.0, Math.max(0.01, xG));

  return { xG, factors };
}

/**
 * イベントを強化（追加情報を計算）
 *
 * @param events - 重複排除されたイベント
 * @returns 強化されたイベント
 */
export function enrichEvents(events: DeduplicatedEvent[]): EnrichedEvent[] {
  return events.map((event, index) => {
    const enriched: EnrichedEvent = { ...event };

    // パス方向を計算
    if (event.type === "pass" && event.mergedPosition) {
      // 次のイベント（同じチーム）の位置を探す
      const nextSameTeamEvent = events
        .slice(index + 1)
        .find((e) => e.team === event.team && e.mergedPosition);

      enriched.passDirection = calculatePassDirection(
        event.mergedPosition,
        nextSameTeamEvent?.mergedPosition ?? null,
        event.team
      );
    }

    // キャリー距離を計算
    if (event.type === "carry" && event.mergedPosition) {
      // endZoneから終了位置を推定（詳細な位置がない場合）
      const endZone = event.details?.endZone as string | undefined;
      let endPos: Point2D | undefined;

      if (endZone) {
        // ゾーンの中心を使用（簡易実装）
        switch (endZone) {
          case "defensive_third":
            endPos = event.team === "home" ? { x: 0.165, y: 0.5 } : { x: 0.835, y: 0.5 };
            break;
          case "middle_third":
            endPos = { x: 0.5, y: 0.5 };
            break;
          case "attacking_third":
            endPos = event.team === "home" ? { x: 0.835, y: 0.5 } : { x: 0.165, y: 0.5 };
            break;
        }
      }

      if (endPos) {
        enriched.carryDistanceMeters = calculateCarryDistance(event.mergedPosition, endPos);
      } else {
        // Geminiから推定された距離を使用
        const estimatedDistance = event.details?.distance as number | undefined;
        enriched.carryDistanceMeters = estimatedDistance;
      }

      // Phase 2.2.2: ドリブル判定を追加
      const { isDribble, confidence: dribbleConfidence } = classifyCarryAsDribble(
        event,
        enriched.carryDistanceMeters,
        event.mergedPosition,
        endPos
      );
      enriched.isDribble = isDribble;
      enriched.dribbleConfidence = dribbleConfidence;
    }

    // シュートのxGを計算
    if (event.type === "shot") {
      const shotType = event.details?.shotType as string | undefined;
      const { xG, factors } = calculateXG(event.mergedPosition, event.team, shotType);
      enriched.xG = xG;
      enriched.xGFactors = factors;
    }

    return enriched;
  });
}

/**
 * パス連鎖を検出
 *
 * 連続するパスを検出し、パス連鎖の情報を返す
 *
 * @param events - イベントリスト
 * @param maxGapSeconds - パス間の最大許容間隔（秒）
 * @returns パス連鎖のリスト
 */
export function detectPassChains(
  events: DeduplicatedEvent[],
  maxGapSeconds: number = 5
): Array<{
  teamId: TeamId;
  startTimestamp: number;
  endTimestamp: number;
  passCount: number;
  passIndices: number[];
}> {
  const chains: Array<{
    teamId: TeamId;
    startTimestamp: number;
    endTimestamp: number;
    passCount: number;
    passIndices: number[];
  }> = [];

  let currentChain: {
    teamId: TeamId;
    startTimestamp: number;
    passIndices: number[];
  } | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type !== "pass") {
      // パス以外のイベントでチェーンを終了
      if (currentChain && currentChain.passIndices.length >= 3) {
        const lastPassIndex = currentChain.passIndices[currentChain.passIndices.length - 1];
        chains.push({
          teamId: currentChain.teamId,
          startTimestamp: currentChain.startTimestamp,
          endTimestamp: events[lastPassIndex].absoluteTimestamp,
          passCount: currentChain.passIndices.length,
          passIndices: currentChain.passIndices,
        });
      }
      currentChain = null;
      continue;
    }

    if (!currentChain) {
      // 新しいチェーンを開始
      currentChain = {
        teamId: event.team,
        startTimestamp: event.absoluteTimestamp,
        passIndices: [i],
      };
    } else {
      const lastPassIndex = currentChain.passIndices[currentChain.passIndices.length - 1];
      const lastPass = events[lastPassIndex];
      const timeDiff = event.absoluteTimestamp - lastPass.absoluteTimestamp;

      if (event.team === currentChain.teamId && timeDiff <= maxGapSeconds) {
        // 同じチームの連続パス
        currentChain.passIndices.push(i);
      } else {
        // チェーンが途切れた
        if (currentChain.passIndices.length >= 3) {
          chains.push({
            teamId: currentChain.teamId,
            startTimestamp: currentChain.startTimestamp,
            endTimestamp: lastPass.absoluteTimestamp,
            passCount: currentChain.passIndices.length,
            passIndices: currentChain.passIndices,
          });
        }

        // 新しいチェーンを開始
        currentChain = {
          teamId: event.team,
          startTimestamp: event.absoluteTimestamp,
          passIndices: [i],
        };
      }
    }
  }

  // 最後のチェーンを追加
  if (currentChain && currentChain.passIndices.length >= 3) {
    const lastPassIndex = currentChain.passIndices[currentChain.passIndices.length - 1];
    chains.push({
      teamId: currentChain.teamId,
      startTimestamp: currentChain.startTimestamp,
      endTimestamp: events[lastPassIndex].absoluteTimestamp,
      passCount: currentChain.passIndices.length,
      passIndices: currentChain.passIndices,
    });
  }

  return chains;
}

/**
 * イベント強化結果の統計を計算
 */
export interface EnrichmentStats {
  totalEvents: number;
  passEvents: {
    total: number;
    withDirection: number;
    forward: number;
    backward: number;
    lateral: number;
  };
  carryEvents: {
    total: number;
    withDistance: number;
    averageDistance: number;
    dribbles: number;
    simpleCarries: number;
    averageDribbleConfidence: number;
  };
  shotEvents: {
    total: number;
    withXG: number;
    averageXG: number;
    inPenaltyArea: number;
    goals: number;
    totalXG: number;
  };
  passChains: {
    total: number;
    averageLength: number;
    maxLength: number;
  };
}

/**
 * 強化統計を計算
 */
export function calculateEnrichmentStats(
  events: EnrichedEvent[],
  passChains: ReturnType<typeof detectPassChains>
): EnrichmentStats {
  const passEvents = events.filter((e) => e.type === "pass");
  const carryEvents = events.filter((e) => e.type === "carry");
  const shotEvents = events.filter((e) => e.type === "shot");

  const passWithDirection = passEvents.filter((e) => e.passDirection);
  const carryWithDistance = carryEvents.filter((e) => e.carryDistanceMeters !== undefined);
  const dribbles = carryEvents.filter((e) => e.isDribble === true);
  const simpleCarries = carryEvents.filter((e) => e.isDribble === false);
  const shotWithXG = shotEvents.filter((e) => e.xG !== undefined);
  const shotsInPA = shotEvents.filter((e) => e.xGFactors?.inPenaltyArea);
  const goals = shotEvents.filter((e) => e.details?.shotResult === "goal");

  return {
    totalEvents: events.length,
    passEvents: {
      total: passEvents.length,
      withDirection: passWithDirection.length,
      forward: passWithDirection.filter((e) => e.passDirection === "forward").length,
      backward: passWithDirection.filter((e) => e.passDirection === "backward").length,
      lateral: passWithDirection.filter((e) => e.passDirection === "lateral").length,
    },
    carryEvents: {
      total: carryEvents.length,
      withDistance: carryWithDistance.length,
      averageDistance: carryWithDistance.length > 0
        ? carryWithDistance.reduce((sum, e) => sum + (e.carryDistanceMeters || 0), 0) / carryWithDistance.length
        : 0,
      dribbles: dribbles.length,
      simpleCarries: simpleCarries.length,
      averageDribbleConfidence: dribbles.length > 0
        ? dribbles.reduce((sum, e) => sum + (e.dribbleConfidence || 0), 0) / dribbles.length
        : 0,
    },
    shotEvents: {
      total: shotEvents.length,
      withXG: shotWithXG.length,
      averageXG: shotWithXG.length > 0
        ? shotWithXG.reduce((sum, e) => sum + (e.xG || 0), 0) / shotWithXG.length
        : 0,
      inPenaltyArea: shotsInPA.length,
      goals: goals.length,
      totalXG: shotWithXG.reduce((sum, e) => sum + (e.xG || 0), 0),
    },
    passChains: {
      total: passChains.length,
      averageLength: passChains.length > 0
        ? passChains.reduce((sum, c) => sum + c.passCount, 0) / passChains.length
        : 0,
      maxLength: passChains.length > 0
        ? Math.max(...passChains.map((c) => c.passCount))
        : 0,
    },
  };
}
