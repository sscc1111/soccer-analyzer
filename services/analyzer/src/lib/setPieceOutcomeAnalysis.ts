/**
 * Set Piece Outcome Analysis (Section 3.2.2)
 *
 * セットピースの結果を追跡し、得点機会の創出を分析します。
 *
 * 機能:
 * 1. セットピース後15秒以内のイベント追跡
 * 2. 結果タイプの判定（goal/shot/cleared/turnover/continued_play）
 * 3. 得点機会の評価
 */

import type { TeamId } from "@soccer/shared";
import type { DeduplicatedEvent } from "./deduplication";

/**
 * セットピース結果分析
 */
export interface SetPieceOutcomeAnalysis {
  /** セットピースイベントID */
  setPieceEventId: string;
  /** 結果タイプ */
  resultType: "shot" | "goal" | "cleared" | "turnover" | "continued_play" | "unknown";
  /** セットピースから結果までの時間（秒） */
  timeToOutcome: number;
  /** 得点機会を作ったか */
  scoringChance: boolean;
  /** 結果イベントID（該当する場合） */
  outcomeEventId?: string;
}

/**
 * セットピース結果を分析
 *
 * セットピース後15秒以内のイベントを追跡し、結果を判定:
 * - goal: ゴールが入った
 * - shot: シュートに繋がった
 * - cleared: クリアされた（ターンオーバー or 相手チームのパス）
 * - turnover: ボールを失った
 * - continued_play: プレー継続（同じチームのパス連鎖）
 * - unknown: 判定不可
 *
 * @param setPieceEvents - セットピースイベント
 * @param allEvents - 全イベントリスト（時系列順）
 * @param outcomeWindow - 結果を追跡する時間ウィンドウ（秒、デフォルト15秒）
 * @returns セットピースごとの結果分析
 */
export function analyzeSetPieceOutcomes(
  setPieceEvents: DeduplicatedEvent[],
  allEvents: DeduplicatedEvent[],
  outcomeWindow: number = 15
): SetPieceOutcomeAnalysis[] {
  const outcomes: SetPieceOutcomeAnalysis[] = [];

  for (const setPiece of setPieceEvents) {
    const setPieceTimestamp = setPiece.absoluteTimestamp;
    const setPieceTeam = setPiece.team;
    const windowEnd = setPieceTimestamp + outcomeWindow;

    // Find events within the outcome window
    const subsequentEvents = allEvents.filter(
      (e) =>
        e.absoluteTimestamp > setPieceTimestamp &&
        e.absoluteTimestamp <= windowEnd
    );

    if (subsequentEvents.length === 0) {
      // No events found in the window
      outcomes.push({
        setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
        resultType: "unknown",
        timeToOutcome: 0,
        scoringChance: false,
      });
      continue;
    }

    // Priority order: goal > shot > turnover > pass (for clearing detection)
    let outcome: SetPieceOutcomeAnalysis | null = null;

    // Check for goal (highest priority)
    const goalEvent = subsequentEvents.find(
      (e) =>
        e.type === "shot" &&
        e.team === setPieceTeam &&
        e.details?.shotResult === "goal"
    );

    if (goalEvent) {
      outcome = {
        setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
        resultType: "goal",
        timeToOutcome: goalEvent.absoluteTimestamp - setPieceTimestamp,
        scoringChance: true,
        outcomeEventId: `shot_${goalEvent.absoluteTimestamp}`,
      };
    }

    // Check for shot (if no goal)
    if (!outcome) {
      const shotEvent = subsequentEvents.find(
        (e) => e.type === "shot" && e.team === setPieceTeam
      );

      if (shotEvent) {
        const shotResult = shotEvent.details?.shotResult as string | undefined;
        const isOnTarget = shotResult === "saved" || shotResult === "goal";

        outcome = {
          setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
          resultType: "shot",
          timeToOutcome: shotEvent.absoluteTimestamp - setPieceTimestamp,
          scoringChance: isOnTarget || shotResult === "post",
          outcomeEventId: `shot_${shotEvent.absoluteTimestamp}`,
        };
      }
    }

    // Check for immediate turnover (ball lost to opponent)
    if (!outcome) {
      const turnoverEvent = subsequentEvents.find(
        (e) =>
          e.type === "turnover" &&
          (e.team === setPieceTeam || // Player who lost the ball
            e.details?.context === "interception" || // Opponent intercepted
            e.details?.context === "tackle") // Opponent tackled
      );

      if (turnoverEvent) {
        outcome = {
          setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
          resultType: "turnover",
          timeToOutcome: turnoverEvent.absoluteTimestamp - setPieceTimestamp,
          scoringChance: false,
          outcomeEventId: `turnover_${turnoverEvent.absoluteTimestamp}`,
        };
      }
    }

    // Check for cleared (opponent gained possession via pass)
    if (!outcome) {
      const opponentTeam = setPieceTeam === "home" ? "away" : "home";
      const opponentPassEvent = subsequentEvents.find(
        (e) =>
          e.type === "pass" &&
          e.team === opponentTeam &&
          e.absoluteTimestamp - setPieceTimestamp <= 5 // Quick clearance within 5s
      );

      if (opponentPassEvent) {
        outcome = {
          setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
          resultType: "cleared",
          timeToOutcome: opponentPassEvent.absoluteTimestamp - setPieceTimestamp,
          scoringChance: false,
          outcomeEventId: `pass_${opponentPassEvent.absoluteTimestamp}`,
        };
      }
    }

    // Default: continued play (same team maintains possession)
    if (!outcome) {
      const nextEvent = subsequentEvents[0]; // First event after set piece
      if (nextEvent && nextEvent.team === setPieceTeam) {
        outcome = {
          setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
          resultType: "continued_play",
          timeToOutcome: nextEvent.absoluteTimestamp - setPieceTimestamp,
          scoringChance: false,
          outcomeEventId: `${nextEvent.type}_${nextEvent.absoluteTimestamp}`,
        };
      } else {
        // Unknown outcome
        outcome = {
          setPieceEventId: `${setPiece.type}_${setPieceTimestamp}`,
          resultType: "unknown",
          timeToOutcome: 0,
          scoringChance: false,
        };
      }
    }

    outcomes.push(outcome);
  }

  return outcomes;
}
