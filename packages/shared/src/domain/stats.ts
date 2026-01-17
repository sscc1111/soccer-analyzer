import type { MetricKey } from "../metricKeys";

export type StatsDoc = {
  statId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  /** Match ID this stat belongs to */
  matchId?: string;
  version: string;
  pipelineVersion?: string;
  scope: "match" | "player";
  playerId?: string | null;
  metrics: Partial<Record<MetricKey, unknown>>;
  confidence: Partial<Record<MetricKey, number>>;
  explanations?: Partial<Record<MetricKey, string>>;
  computedAt: string;
  /** Whether this stat was merged from first and second half */
  mergedFromHalves?: boolean;
};
