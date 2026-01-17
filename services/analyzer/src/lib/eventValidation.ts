/**
 * Event Validation and Cross-Validation Utilities
 *
 * イベント間の整合性検証とクロスバリデーションを行うユーティリティ
 *
 * 検証項目:
 * 1. 時間的整合性: イベントの時間順序が妥当か
 * 2. 論理的整合性: チームの連続性、ボール支配権の移動
 * 3. 位置的整合性: 連続イベント間の位置移動が物理的に可能か
 */

import type { Point2D, TeamId } from "@soccer/shared";
import { calculateDistanceMeters } from "./zoneToCoordinate";
import type { DeduplicatedEvent } from "./deduplication";

/**
 * 検証結果
 */
export interface ValidationResult {
  valid: boolean;
  warnings: ValidationWarning[];
  errors: ValidationError[];
}

/**
 * 検証警告
 */
export interface ValidationWarning {
  type: "temporal" | "logical" | "positional";
  message: string;
  eventIndex: number;
  relatedEventIndex?: number;
  severity: "low" | "medium" | "high";
}

/**
 * 検証エラー
 */
export interface ValidationError {
  type: "temporal" | "logical" | "positional";
  message: string;
  eventIndex: number;
  relatedEventIndex?: number;
}

/**
 * 検証設定
 */
export interface ValidationConfig {
  /** 最小イベント間隔（秒） */
  minEventInterval: number;
  /** 最大移動速度（m/s） - 選手の最大スプリント速度 */
  maxMovementSpeed: number;
  /** 警告を有効にするか */
  enableWarnings: boolean;
}

/**
 * デフォルト設定
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  minEventInterval: 0.5, // 500ms
  maxMovementSpeed: 12, // 12 m/s (約43 km/h - スプリント速度)
  enableWarnings: true,
};

/**
 * イベントリストの時間的整合性を検証
 */
export function validateTemporalConsistency(
  events: DeduplicatedEvent[],
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const errors: ValidationError[] = [];

  // イベントを時間順にソート
  const sorted = [...events].sort((a, b) => a.absoluteTimestamp - b.absoluteTimestamp);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const timeDiff = curr.absoluteTimestamp - prev.absoluteTimestamp;

    // 同一タイムスタンプのイベントチェック
    if (timeDiff === 0 && prev.type === curr.type && prev.team === curr.team) {
      errors.push({
        type: "temporal",
        message: `Duplicate event at timestamp ${curr.absoluteTimestamp}: same type (${curr.type}) and team (${curr.team})`,
        eventIndex: i,
        relatedEventIndex: i - 1,
      });
    }

    // 不自然に短い間隔のイベントチェック
    if (timeDiff > 0 && timeDiff < config.minEventInterval) {
      // 同じチームの連続イベントは許容（パス→シュートなど）
      if (prev.team === curr.team) {
        // pass→shotやcarry→passは正常
        const validSequences = [
          ["pass", "shot"],
          ["carry", "pass"],
          ["carry", "shot"],
          ["setPiece", "pass"],
          ["setPiece", "shot"],
        ];

        const isValidSequence = validSequences.some(
          ([prevType, currType]) => prev.type === prevType && curr.type === currType
        );

        if (!isValidSequence && config.enableWarnings) {
          warnings.push({
            type: "temporal",
            message: `Short interval (${timeDiff.toFixed(2)}s) between ${prev.type} and ${curr.type} by same team`,
            eventIndex: i,
            relatedEventIndex: i - 1,
            severity: "low",
          });
        }
      }
    }

    // 逆順タイムスタンプチェック（ソート後なので発生しないはずだが念のため）
    if (timeDiff < 0) {
      errors.push({
        type: "temporal",
        message: `Events out of order: event at ${curr.absoluteTimestamp} comes before event at ${prev.absoluteTimestamp}`,
        eventIndex: i,
        relatedEventIndex: i - 1,
      });
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * イベントリストの論理的整合性を検証
 */
export function validateLogicalConsistency(
  events: DeduplicatedEvent[],
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const errors: ValidationError[] = [];

  // イベントを時間順にソート
  const sorted = [...events].sort((a, b) => a.absoluteTimestamp - b.absoluteTimestamp);

  let currentPossession: TeamId | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const prevEvent = i > 0 ? sorted[i - 1] : null;

    // ボール支配権の追跡
    if (event.type === "pass" || event.type === "carry" || event.type === "shot") {
      currentPossession = event.team;
    } else if (event.type === "turnover") {
      // ターンオーバー後は相手チームに移行するはず
      const newPossession = event.team === "home" ? "away" : "home";
      currentPossession = newPossession;
    }

    // パス完了後のイベントチェック
    if (prevEvent?.type === "pass" && prevEvent.details?.outcome === "complete") {
      // 完了パスの後は同じチームのイベントが来るべき
      if (event.team !== prevEvent.team && event.type !== "turnover") {
        if (config.enableWarnings) {
          warnings.push({
            type: "logical",
            message: `Completed pass by ${prevEvent.team} followed by ${event.type} by ${event.team} without turnover`,
            eventIndex: i,
            relatedEventIndex: i - 1,
            severity: "medium",
          });
        }
      }
    }

    // インターセプト後のイベントチェック
    if (prevEvent?.type === "pass" && prevEvent.details?.outcome === "intercepted") {
      // インターセプト後は相手チームのイベントが来るべき
      if (event.team === prevEvent.team && event.type !== "turnover") {
        if (config.enableWarnings) {
          warnings.push({
            type: "logical",
            message: `Intercepted pass followed by same team (${event.team}) action without possession change`,
            eventIndex: i,
            relatedEventIndex: i - 1,
            severity: "medium",
          });
        }
      }
    }

    // ゴール後のイベントチェック
    if (prevEvent?.type === "shot" && prevEvent.details?.shotResult === "goal") {
      // ゴール後はセットピース（キックオフ）が来るべき
      const timeSinceGoal = event.absoluteTimestamp - prevEvent.absoluteTimestamp;
      if (timeSinceGoal < 30 && event.type !== "setPiece") {
        if (config.enableWarnings) {
          warnings.push({
            type: "logical",
            message: `Goal scored but no kickoff detected within 30 seconds`,
            eventIndex: i,
            relatedEventIndex: i - 1,
            severity: "low",
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * イベントリストの位置的整合性を検証
 */
export function validatePositionalConsistency(
  events: DeduplicatedEvent[],
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const errors: ValidationError[] = [];

  // イベントを時間順にソート
  const sorted = [...events].sort((a, b) => a.absoluteTimestamp - b.absoluteTimestamp);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // 位置情報がない場合はスキップ
    if (!prev.mergedPosition || !curr.mergedPosition) {
      continue;
    }

    const timeDiff = curr.absoluteTimestamp - prev.absoluteTimestamp;
    if (timeDiff <= 0) continue;

    // 距離を計算（メートル単位）
    const distance = calculateDistanceMeters(prev.mergedPosition, curr.mergedPosition);

    // 必要な速度を計算
    const requiredSpeed = distance / timeDiff;

    // 物理的に不可能な移動をチェック
    if (requiredSpeed > config.maxMovementSpeed) {
      // 同一チームの連続イベントで、ボールが移動した場合は許容
      // （パスでボールが移動するので）
      if (prev.type === "pass" && prev.team === curr.team) {
        // パスによるボールの移動は高速でも許容
        continue;
      }

      if (config.enableWarnings) {
        warnings.push({
          type: "positional",
          message: `Impossible movement: ${distance.toFixed(1)}m in ${timeDiff.toFixed(2)}s (${requiredSpeed.toFixed(1)} m/s required)`,
          eventIndex: i,
          relatedEventIndex: i - 1,
          severity: requiredSpeed > config.maxMovementSpeed * 2 ? "high" : "medium",
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * イベントリストの全ての整合性を検証
 */
export function validateEvents(
  events: DeduplicatedEvent[],
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const temporal = validateTemporalConsistency(events, config);
  const logical = validateLogicalConsistency(events, config);
  const positional = validatePositionalConsistency(events, config);

  return {
    valid: temporal.valid && logical.valid && positional.valid,
    warnings: [...temporal.warnings, ...logical.warnings, ...positional.warnings],
    errors: [...temporal.errors, ...logical.errors, ...positional.errors],
  };
}

/**
 * 検証結果のサマリーを生成
 */
export function summarizeValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push(`Validation ${result.valid ? "PASSED" : "FAILED"}`);
  lines.push(`  Errors: ${result.errors.length}`);
  lines.push(`  Warnings: ${result.warnings.length}`);

  if (result.errors.length > 0) {
    lines.push("\nErrors:");
    for (const error of result.errors) {
      lines.push(`  [${error.type}] Event ${error.eventIndex}: ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("\nWarnings:");
    const warningsByType: Record<string, number> = {};
    for (const warning of result.warnings) {
      warningsByType[warning.type] = (warningsByType[warning.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(warningsByType)) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  return lines.join("\n");
}

/**
 * イベント間のアンサンブル信頼度を計算
 *
 * 複数のソースから検出されたイベントは信頼度がブースト
 */
export function calculateEnsembleConfidence(
  event: DeduplicatedEvent,
  hasSceneMatch: boolean,
  hasClipMatch: boolean,
  hasBallPositionMatch: boolean
): number {
  let baseConfidence = event.adjustedConfidence;

  // マッチしたソースの数に応じてブースト
  let matchCount = 1; // 最低1（イベント自体）
  if (hasSceneMatch) matchCount++;
  if (hasClipMatch) matchCount++;
  if (hasBallPositionMatch) matchCount++;

  // ブースト計算: 追加ソースごとに5%ブースト（上限1.0）
  const boost = (matchCount - 1) * 0.05;
  const boostedConfidence = Math.min(1.0, baseConfidence + boost * (1 - baseConfidence));

  return boostedConfidence;
}
