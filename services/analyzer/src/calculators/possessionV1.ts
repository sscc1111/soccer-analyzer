/**
 * Phase 3.3: Possession Calculator
 *
 * Calculates possession statistics per player and per team from PossessionSegment data.
 */

import { metricKeys } from "@soccer/shared";
import type { PossessionSegment, TrackPlayerMapping, TeamId } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

type PlayerPossessionStats = {
  playerId: string;
  teamId: TeamId;
  timeSec: number;
  count: number;
  totalConfidence: number;
  segmentCount: number;
};

type TeamPossessionStats = {
  teamId: TeamId;
  timeSec: number;
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
 * Get player ID from track ID, falling back to trackId if no mapping
 */
function getPlayerId(
  trackId: string,
  trackToPlayer: Map<string, string | null>
): string {
  const playerId = trackToPlayer.get(trackId);
  return playerId ?? `track:${trackId}`;
}

export async function calcPossessionV1(
  ctx: CalculatorContext
): Promise<StatsOutput[]> {
  const possessionSegments = ctx.possessionSegments ?? [];
  const trackMappings = ctx.trackMappings ?? [];

  // No possession data - return empty
  if (possessionSegments.length === 0) {
    return [];
  }

  const trackToPlayer = buildTrackToPlayerMap(trackMappings);

  // Aggregate stats per player
  const playerStats = new Map<string, PlayerPossessionStats>();

  // Aggregate stats per team
  const teamStats = new Map<TeamId, TeamPossessionStats>();

  const getOrCreatePlayerStats = (
    playerId: string,
    teamId: TeamId
  ): PlayerPossessionStats => {
    let stats = playerStats.get(playerId);
    if (!stats) {
      stats = {
        playerId,
        teamId,
        timeSec: 0,
        count: 0,
        totalConfidence: 0,
        segmentCount: 0,
      };
      playerStats.set(playerId, stats);
    }
    return stats;
  };

  const getOrCreateTeamStats = (teamId: TeamId): TeamPossessionStats => {
    let stats = teamStats.get(teamId);
    if (!stats) {
      stats = {
        teamId,
        timeSec: 0,
      };
      teamStats.set(teamId, stats);
    }
    return stats;
  };

  for (const segment of possessionSegments) {
    const duration = segment.endTime - segment.startTime;
    const playerId = getPlayerId(segment.trackId, trackToPlayer);

    // Player stats
    const pStats = getOrCreatePlayerStats(playerId, segment.teamId);
    pStats.timeSec += duration;
    pStats.count++;
    pStats.totalConfidence += segment.confidence;
    pStats.segmentCount++;

    // Team stats
    if (segment.teamId !== "unknown") {
      const tStats = getOrCreateTeamStats(segment.teamId);
      tStats.timeSec += duration;
    }
  }

  // Calculate total possession time for percentage
  let totalPossessionTime = 0;
  for (const stats of teamStats.values()) {
    totalPossessionTime += stats.timeSec;
  }

  // Generate outputs
  const outputs: StatsOutput[] = [];

  // Player stats
  for (const stats of playerStats.values()) {
    const avgConfidence =
      stats.segmentCount > 0 ? stats.totalConfidence / stats.segmentCount : 0;

    outputs.push({
      calculatorId: "possessionV1",
      scope: "player",
      playerId: stats.playerId,
      metrics: {
        [metricKeys.playerPossessionTimeSec]:
          Math.round(stats.timeSec * 10) / 10,
        [metricKeys.playerPossessionCount]: stats.count,
      },
      confidence: {
        [metricKeys.playerPossessionTimeSec]: avgConfidence,
        [metricKeys.playerPossessionCount]: avgConfidence,
      },
      explanations: {
        [metricKeys.playerPossessionTimeSec]:
          "Total time the player had possession of the ball (seconds)",
        [metricKeys.playerPossessionCount]:
          "Number of times the player gained possession",
      },
    });
  }

  // Team possession percentages (as match-scope stats)
  if (totalPossessionTime > 0) {
    const homeStats = teamStats.get("home");
    const awayStats = teamStats.get("away");

    const homePct = homeStats
      ? Math.round((homeStats.timeSec / totalPossessionTime) * 100)
      : 0;
    const awayPct = awayStats
      ? Math.round((awayStats.timeSec / totalPossessionTime) * 100)
      : 0;

    // Calculate average confidence from all segments
    let totalConf = 0;
    let confCount = 0;
    for (const stats of playerStats.values()) {
      totalConf += stats.totalConfidence;
      confCount += stats.segmentCount;
    }
    const avgConfidence = confCount > 0 ? totalConf / confCount : 0;

    outputs.push({
      calculatorId: "possessionV1",
      scope: "match",
      metrics: {
        [metricKeys.teamPossessionPercent]: {
          home: homePct,
          away: awayPct,
        },
      },
      confidence: {
        [metricKeys.teamPossessionPercent]: avgConfidence,
      },
      explanations: {
        [metricKeys.teamPossessionPercent]:
          "Team possession percentage based on ball control time",
      },
    });
  }

  return outputs;
}
