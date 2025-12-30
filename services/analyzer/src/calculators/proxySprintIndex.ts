import { metricKeys } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

export async function calcProxySprintIndex(ctx: CalculatorContext): Promise<StatsOutput[]> {
  const clips = (ctx.clips ?? []) as { clipId: string; motionScore?: number }[];
  const events = (ctx.events ?? []) as {
    clipId: string;
    involved?: { players?: { playerId: string }[] };
  }[];

  const clipScores = new Map<string, number>();
  for (const clip of clips) {
    clipScores.set(clip.clipId, clip.motionScore ?? 0);
  }

  const playerScores = new Map<string, number[]>();
  for (const event of events) {
    const score = clipScores.get(event.clipId) ?? 0;
    const players = event.involved?.players ?? [];
    for (const player of players) {
      const list = playerScores.get(player.playerId) ?? [];
      list.push(score);
      playerScores.set(player.playerId, list);
    }
  }

  const outputs: StatsOutput[] = [];
  for (const [playerId, scores] of playerScores.entries()) {
    const max = scores.length ? Math.max(...scores) : 0;
    const threshold = max > 0 ? max * 0.7 : 0.5;
    const sprintCount = scores.filter((score) => score >= threshold).length;
    outputs.push({
      calculatorId: "proxySprintIndex",
      scope: "player",
      playerId,
      metrics: {
        [metricKeys.playerPeakSpeedIndex]: Number(max.toFixed(3)),
        [metricKeys.playerSprintCount]: sprintCount,
      },
      confidence: {
        [metricKeys.playerPeakSpeedIndex]: 0.2,
        [metricKeys.playerSprintCount]: 0.2,
      },
      explanations: {
        [metricKeys.playerPeakSpeedIndex]: "Proxy index derived from clip motion scores.",
        [metricKeys.playerSprintCount]: "Proxy sprint count based on high-motion clips.",
      },
    });
  }

  return outputs;
}
