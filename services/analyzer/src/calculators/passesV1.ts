/**
 * Phase 3.1: Passes Calculator
 *
 * Calculates pass statistics per player from PassEventDoc data.
 */

import { metricKeys } from "@soccer/shared";
import type { PassEventDoc, TrackPlayerMapping } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

type PlayerPassStats = {
  playerId: string;
  attempted: number;
  completed: number;
  incomplete: number;
  intercepted: number;
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

export async function calcPassesV1(
  ctx: CalculatorContext
): Promise<StatsOutput[]> {
  const passEvents = ctx.passEvents ?? [];
  const trackMappings = ctx.trackMappings ?? [];

  // No pass events - return empty
  if (passEvents.length === 0) {
    return [];
  }

  const trackToPlayer = buildTrackToPlayerMap(trackMappings);

  // Aggregate stats per player
  const playerStats = new Map<string, PlayerPassStats>();

  const getOrCreateStats = (playerId: string): PlayerPassStats => {
    let stats = playerStats.get(playerId);
    if (!stats) {
      stats = {
        playerId,
        attempted: 0,
        completed: 0,
        incomplete: 0,
        intercepted: 0,
        totalConfidence: 0,
        eventCount: 0,
      };
      playerStats.set(playerId, stats);
    }
    return stats;
  };

  for (const event of passEvents) {
    const kickerPlayerId = getPlayerId(
      event.kicker.trackId,
      event.kicker.playerId,
      event.kicker.teamId,
      trackToPlayer
    );
    const stats = getOrCreateStats(kickerPlayerId);

    stats.attempted++;
    stats.totalConfidence += event.confidence;
    stats.eventCount++;

    switch (event.outcome) {
      case "complete":
        stats.completed++;
        break;
      case "incomplete":
        stats.incomplete++;
        break;
      case "intercepted":
        stats.intercepted++;
        break;
    }
  }

  // Generate output for each player
  const outputs: StatsOutput[] = [];

  for (const stats of playerStats.values()) {
    const avgConfidence =
      stats.eventCount > 0 ? stats.totalConfidence / stats.eventCount : 0;

    const successRate =
      stats.attempted > 0 ? stats.completed / stats.attempted : 0;

    outputs.push({
      calculatorId: "passesV1",
      scope: "player",
      playerId: stats.playerId,
      metrics: {
        [metricKeys.playerPassesAttempted]: stats.attempted,
        [metricKeys.playerPassesCompleted]: stats.completed,
        [metricKeys.playerPassesIncomplete]: stats.incomplete,
        [metricKeys.playerPassesIntercepted]: stats.intercepted,
        [metricKeys.playerPassesSuccessRate]: Math.round(successRate * 100),
      },
      confidence: {
        [metricKeys.playerPassesAttempted]: avgConfidence,
        [metricKeys.playerPassesCompleted]: avgConfidence,
        [metricKeys.playerPassesIncomplete]: avgConfidence,
        [metricKeys.playerPassesIntercepted]: avgConfidence,
        [metricKeys.playerPassesSuccessRate]: avgConfidence,
      },
      explanations: {
        [metricKeys.playerPassesAttempted]:
          "Total passes attempted by the player",
        [metricKeys.playerPassesCompleted]:
          "Passes successfully received by a teammate",
        [metricKeys.playerPassesIncomplete]:
          "Passes that went out of play or were not received",
        [metricKeys.playerPassesIntercepted]:
          "Passes intercepted by the opposing team",
        [metricKeys.playerPassesSuccessRate]:
          "Percentage of passes that were completed successfully",
      },
    });
  }

  return outputs;
}
