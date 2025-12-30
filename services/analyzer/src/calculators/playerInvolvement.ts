import { metricKeys } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

export async function calcPlayerInvolvement(ctx: CalculatorContext): Promise<StatsOutput[]> {
  const events = (ctx.events ?? []) as {
    involved?: { players?: { playerId: string; confidence: number }[] };
  }[];

  const map = new Map<string, { count: number; confidenceSum: number; confidenceCount: number }>();

  for (const event of events) {
    const players = event.involved?.players ?? [];
    for (const player of players) {
      const entry = map.get(player.playerId) ?? { count: 0, confidenceSum: 0, confidenceCount: 0 };
      entry.count += 1;
      entry.confidenceSum += player.confidence ?? 0;
      entry.confidenceCount += 1;
      map.set(player.playerId, entry);
    }
  }

  const outputs: StatsOutput[] = [];
  for (const [playerId, data] of map.entries()) {
    const avg = data.confidenceCount ? data.confidenceSum / data.confidenceCount : 0.2;
    outputs.push({
      calculatorId: "playerInvolvement",
      scope: "player",
      playerId,
      metrics: {
        [metricKeys.playerInvolvementCount]: data.count,
      },
      confidence: {
        [metricKeys.playerInvolvementCount]: Math.min(0.8, avg + 0.1),
      },
      explanations: {
        [metricKeys.playerInvolvementCount]: "Manual tagging from events contributes to involvement counts.",
      },
    });
  }

  return outputs;
}
