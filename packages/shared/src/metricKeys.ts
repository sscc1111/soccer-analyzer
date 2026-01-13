export const metricKeys = {
  // match
  matchEventsCountByLabel: "match.events.countByLabel",
  matchTopMoments: "match.events.topMoments",

  // player - existing
  playerInvolvementCount: "player.involvement.count",
  playerPeakSpeedIndex: "player.speed.peakIndex",
  playerSprintCount: "player.speed.sprintCount",
  playerHeatmapZones: "player.heatmap.zones",
  playerOnScreenTimeSec: "player.time.onScreenSec",
  playerDistanceMeters: "player.distance.meters",

  // player - passes (Phase 3.1)
  playerPassesAttempted: "player.passes.attempted",
  playerPassesCompleted: "player.passes.completed",
  playerPassesIncomplete: "player.passes.incomplete",
  playerPassesSuccessRate: "player.passes.successRate",
  playerPassesIntercepted: "player.passes.intercepted",

  // player - carry (Phase 3.2)
  playerCarryCount: "player.carry.count",
  playerCarryIndex: "player.carry.index",
  playerCarryProgressIndex: "player.carry.progressIndex",
  playerCarryMeters: "player.carry.meters",

  // player - possession (Phase 3.3)
  playerPossessionTimeSec: "player.possession.timeSec",
  playerPossessionCount: "player.possession.count",

  // player - turnovers (Phase 3.4)
  playerTurnoversLost: "player.turnovers.lost",
  playerTurnoversWon: "player.turnovers.won",

  // player - shots (future)
  playerShotsCount: "player.shots.count",
  playerShotsOnTarget: "player.shots.onTarget",

  // team - possession
  teamPossessionPercent: "team.possession.percent",
} as const;

export type MetricKey = typeof metricKeys[keyof typeof metricKeys];
