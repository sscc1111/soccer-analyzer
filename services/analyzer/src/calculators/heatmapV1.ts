import { metricKeys } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

export async function calcHeatmapV1(ctx: CalculatorContext): Promise<StatsOutput[]> {
  const assignments =
    (ctx.match?.settings?.formation?.assignments as
      | { jerseyNo: number; slot?: { x: number; y: number } }[]
      | undefined) ?? [];

  const gridSize = 3;
  const zoneMap = new Map<string, Record<string, number>>();

  for (const assignment of assignments) {
    if (!assignment.slot) continue;
    const x = Math.min(0.999, Math.max(0, assignment.slot.x));
    const y = Math.min(0.999, Math.max(0, assignment.slot.y));
    const zone = `${Math.floor(x * gridSize)}_${Math.floor(y * gridSize)}`;
    const playerId = `jersey:${assignment.jerseyNo}`;
    const current = zoneMap.get(playerId) ?? {};
    current[zone] = (current[zone] ?? 0) + 1;
    zoneMap.set(playerId, current);
  }

  const outputs: StatsOutput[] = [];
  for (const [playerId, zones] of zoneMap.entries()) {
    outputs.push({
      calculatorId: "heatmapV1",
      scope: "player",
      playerId,
      metrics: {
        [metricKeys.playerHeatmapZones]: zones,
      },
      confidence: {
        [metricKeys.playerHeatmapZones]: 0.2,
      },
      explanations: {
        [metricKeys.playerHeatmapZones]: "Formation slots used as a low-confidence heatmap seed.",
      },
    });
  }

  return outputs;
}
