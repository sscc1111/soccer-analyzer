import { PIPELINE_VERSION } from "@soccer/shared";
import type { MetricKey } from "@soccer/shared";
import { calcMatchSummary } from "./matchSummary";
import { calcPlayerInvolvement } from "./playerInvolvement";
import { calcProxySprintIndex } from "./proxySprintIndex";
import { calcHeatmapV1 } from "./heatmapV1";

export type CalculatorContext = {
  matchId: string;
  version: string;
  match: any;
  shots: any[];
  clips: any[];
  events: any[];
};

export type StatsOutput = {
  calculatorId: string;
  statId?: string;
  scope: "match" | "player";
  playerId?: string | null;
  metrics: Partial<Record<MetricKey, unknown>>;
  confidence: Partial<Record<MetricKey, number>>;
  explanations?: Partial<Record<MetricKey, string>>;
};

export async function runCalculators(ctx: {
  matchId: string;
  version?: string;
  match?: any;
  shots?: any[];
  clips?: any[];
  events?: any[];
}): Promise<StatsOutput[]> {
  const context: CalculatorContext = {
    matchId: ctx.matchId,
    version: ctx.version ?? PIPELINE_VERSION,
    match: ctx.match ?? null,
    shots: ctx.shots ?? [],
    clips: ctx.clips ?? [],
    events: ctx.events ?? [],
  };

  // Each calculator should return { scope, playerId?, metrics, confidence, explanations }
  const outputs = (
    await Promise.all([
      calcMatchSummary(context),
      calcPlayerInvolvement(context),
      calcProxySprintIndex(context),
      calcHeatmapV1(context),
    ])
  ).flat();

  return outputs;
}
