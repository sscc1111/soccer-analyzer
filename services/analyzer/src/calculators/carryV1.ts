/**
 * Phase 3.2: Carry (Dribble) Calculator
 *
 * Calculates carry/dribble statistics per player from CarryEventDoc data.
 */

import { metricKeys } from "@soccer/shared";
import type { CarryEventDoc, TrackPlayerMapping } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

type PlayerCarryStats = {
  playerId: string;
  count: number;
  totalCarryIndex: number;
  totalProgressIndex: number;
  totalDistanceMeters: number;
  hasCalibration: boolean;
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

export async function calcCarryV1(
  ctx: CalculatorContext
): Promise<StatsOutput[]> {
  const carryEvents = ctx.carryEvents ?? [];
  const trackMappings = ctx.trackMappings ?? [];

  // No carry events - return empty
  if (carryEvents.length === 0) {
    return [];
  }

  const trackToPlayer = buildTrackToPlayerMap(trackMappings);

  // Aggregate stats per player
  const playerStats = new Map<string, PlayerCarryStats>();

  const getOrCreateStats = (playerId: string): PlayerCarryStats => {
    let stats = playerStats.get(playerId);
    if (!stats) {
      stats = {
        playerId,
        count: 0,
        totalCarryIndex: 0,
        totalProgressIndex: 0,
        totalDistanceMeters: 0,
        hasCalibration: false,
        totalConfidence: 0,
        eventCount: 0,
      };
      playerStats.set(playerId, stats);
    }
    return stats;
  };

  for (const event of carryEvents) {
    const playerId = getPlayerId(
      event.trackId,
      event.playerId,
      event.teamId,
      trackToPlayer
    );
    const stats = getOrCreateStats(playerId);

    stats.count++;
    stats.totalCarryIndex += event.carryIndex;
    stats.totalProgressIndex += event.progressIndex;
    stats.totalConfidence += event.confidence;
    stats.eventCount++;

    if (event.distanceMeters !== undefined) {
      stats.totalDistanceMeters += event.distanceMeters;
      stats.hasCalibration = true;
    }
  }

  // Generate output for each player
  const outputs: StatsOutput[] = [];

  for (const stats of playerStats.values()) {
    const avgConfidence =
      stats.eventCount > 0 ? stats.totalConfidence / stats.eventCount : 0;

    const metrics: Record<string, unknown> = {
      [metricKeys.playerCarryCount]: stats.count,
      [metricKeys.playerCarryIndex]: Math.round(stats.totalCarryIndex * 100) / 100,
      [metricKeys.playerCarryProgressIndex]:
        Math.round(stats.totalProgressIndex * 100) / 100,
    };

    const confidence: Record<string, number> = {
      [metricKeys.playerCarryCount]: avgConfidence,
      [metricKeys.playerCarryIndex]: avgConfidence,
      [metricKeys.playerCarryProgressIndex]: avgConfidence,
    };

    const explanations: Record<string, string> = {
      [metricKeys.playerCarryCount]:
        "Number of times the player carried the ball",
      [metricKeys.playerCarryIndex]:
        "Cumulative movement index while carrying the ball (relative units)",
      [metricKeys.playerCarryProgressIndex]:
        "Net progress toward attacking goal (positive = forward, relative units)",
    };

    // Only include meters metric if calibration was available
    if (stats.hasCalibration) {
      metrics[metricKeys.playerCarryMeters] =
        Math.round(stats.totalDistanceMeters * 10) / 10;
      confidence[metricKeys.playerCarryMeters] = avgConfidence;
      explanations[metricKeys.playerCarryMeters] =
        "Total distance carried in meters (requires field calibration)";
    }

    outputs.push({
      calculatorId: "carryV1",
      scope: "player",
      playerId: stats.playerId,
      metrics,
      confidence,
      explanations,
    });
  }

  return outputs;
}
