import { PIPELINE_VERSION } from "@soccer/shared";
import type {
  MetricKey,
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  ShotEventDoc,
  SetPieceEventDoc,
  PossessionSegment,
  TrackPlayerMapping,
  MatchSettings,
} from "@soccer/shared";
import { calcMatchSummary } from "./matchSummary";
import { calcPlayerInvolvement } from "./playerInvolvement";
import { calcProxySprintIndex } from "./proxySprintIndex";
import { calcHeatmapV1 } from "./heatmapV1";
import { calcPassesV1 } from "./passesV1";
import { calcCarryV1 } from "./carryV1";
import { calcPossessionV1 } from "./possessionV1";
import { calcTurnoversV1 } from "./turnoversV1";

export type CalculatorContext = {
  matchId: string;
  version: string;
  match: any;
  shots: any[];
  clips: any[];
  events: any[];
  // Phase 3: Auto-stats data
  passEvents?: PassEventDoc[];
  carryEvents?: CarryEventDoc[];
  turnoverEvents?: TurnoverEventDoc[];
  shotEvents?: ShotEventDoc[];
  setPieceEvents?: SetPieceEventDoc[];
  possessionSegments?: PossessionSegment[];
  trackMappings?: TrackPlayerMapping[];
  settings?: MatchSettings;
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
  // Phase 3: Auto-stats data
  passEvents?: PassEventDoc[];
  carryEvents?: CarryEventDoc[];
  turnoverEvents?: TurnoverEventDoc[];
  shotEvents?: ShotEventDoc[];
  setPieceEvents?: SetPieceEventDoc[];
  possessionSegments?: PossessionSegment[];
  trackMappings?: TrackPlayerMapping[];
  settings?: MatchSettings;
}): Promise<StatsOutput[]> {
  const context: CalculatorContext = {
    matchId: ctx.matchId,
    version: ctx.version ?? PIPELINE_VERSION,
    match: ctx.match ?? null,
    shots: ctx.shots ?? [],
    clips: ctx.clips ?? [],
    events: ctx.events ?? [],
    // Phase 3: Auto-stats data
    passEvents: ctx.passEvents ?? [],
    carryEvents: ctx.carryEvents ?? [],
    turnoverEvents: ctx.turnoverEvents ?? [],
    shotEvents: ctx.shotEvents ?? [],
    setPieceEvents: ctx.setPieceEvents ?? [],
    possessionSegments: ctx.possessionSegments ?? [],
    trackMappings: ctx.trackMappings ?? [],
    settings: ctx.settings,
  };

  // Each calculator should return { scope, playerId?, metrics, confidence, explanations }
  const outputs = (
    await Promise.all([
      // Existing calculators
      calcMatchSummary(context),
      calcPlayerInvolvement(context),
      calcProxySprintIndex(context),
      calcHeatmapV1(context),
      // Phase 3: Auto-stats calculators
      calcPassesV1(context),
      calcCarryV1(context),
      calcPossessionV1(context),
      calcTurnoversV1(context),
    ])
  ).flat();

  return outputs;
}
