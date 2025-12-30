export const metricKeys = {
  // match
  matchEventsCountByLabel: "match.events.countByLabel",
  matchTopMoments: "match.events.topMoments",

  // player
  playerInvolvementCount: "player.involvement.count",
  playerPeakSpeedIndex: "player.speed.peakIndex",
  playerSprintCount: "player.speed.sprintCount",
  playerHeatmapZones: "player.heatmap.zones",
  playerOnScreenTimeSec: "player.time.onScreenSec",

  // future
  playerDistanceMeters: "player.distance.meters"
} as const;

export type MetricKey = typeof metricKeys[keyof typeof metricKeys];
