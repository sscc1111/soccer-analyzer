/**
 * Phase 3.4: Turnovers Calculator
 *
 * Calculates turnover statistics (lost/won) per player from TurnoverEventDoc data.
 */

import { metricKeys } from "@soccer/shared";
import type { TurnoverEventDoc, TrackPlayerMapping } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

type PlayerTurnoverStats = {
  playerId: string;
  lost: number;
  won: number;
  totalConfidence: number;
  eventCount: number;
};

/**
 * Build a map from trackId to playerId using track mappings
 */
function buildTrackToPlayerMap(
  mappings: TrackPlayerMapping[]
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const m of mappings) {
    map.set(m.trackId, m.playerId);
  }
  return map;
}

/**
 * Get player ID from track ID, falling back to playerId or trackId if no mapping
 */
function getPlayerId(
  trackId: string | undefined,
  playerId: string | null | undefined,
  teamId: string | undefined,
  trackToPlayer: Map<string, string | null>
): string {
  // First try trackId mapping
  if (trackId && trackId.trim() !== "") {
    const mappedPlayerId = trackToPlayer.get(trackId);
    if (mappedPlayerId) {
      return mappedPlayerId;
    }
    return `track:${trackId}`;
  }

  // Fallback to playerId (Gemini's player description) + teamId for uniqueness
  if (playerId && playerId.trim() !== "") {
    const team = teamId || "unknown";
    return `player:${team}:${playerId}`;
  }

  // Last resort: unknown player
  return "player:unknown";
}

export async function calcTurnoversV1(
  ctx: CalculatorContext
): Promise<StatsOutput[]> {
  const turnoverEvents = ctx.turnoverEvents ?? [];
  const trackMappings = ctx.trackMappings ?? [];

  // No turnover events - return empty
  if (turnoverEvents.length === 0) {
    return [];
  }

  const trackToPlayer = buildTrackToPlayerMap(trackMappings);

  // Aggregate stats per player
  const playerStats = new Map<string, PlayerTurnoverStats>();

  const getOrCreateStats = (playerId: string): PlayerTurnoverStats => {
    let stats = playerStats.get(playerId);
    if (!stats) {
      stats = {
        playerId,
        lost: 0,
        won: 0,
        totalConfidence: 0,
        eventCount: 0,
      };
      playerStats.set(playerId, stats);
    }
    return stats;
  };

  for (const event of turnoverEvents) {
    const playerId = getPlayerId(
      event.player.trackId,
      event.player.playerId,
      event.player.teamId,
      trackToPlayer
    );
    const stats = getOrCreateStats(playerId);

    stats.totalConfidence += event.confidence;
    stats.eventCount++;

    switch (event.turnoverType) {
      case "lost":
        stats.lost++;
        break;
      case "won":
        stats.won++;
        break;
    }
  }

  // Generate output for each player
  const outputs: StatsOutput[] = [];

  for (const stats of playerStats.values()) {
    const avgConfidence =
      stats.eventCount > 0 ? stats.totalConfidence / stats.eventCount : 0;

    outputs.push({
      calculatorId: "turnoversV1",
      scope: "player",
      playerId: stats.playerId,
      metrics: {
        [metricKeys.playerTurnoversLost]: stats.lost,
        [metricKeys.playerTurnoversWon]: stats.won,
      },
      confidence: {
        [metricKeys.playerTurnoversLost]: avgConfidence,
        [metricKeys.playerTurnoversWon]: avgConfidence,
      },
      explanations: {
        [metricKeys.playerTurnoversLost]:
          "Number of times the player lost possession to the opponent",
        [metricKeys.playerTurnoversWon]:
          "Number of times the player won the ball from the opponent",
      },
    });
  }

  return outputs;
}
