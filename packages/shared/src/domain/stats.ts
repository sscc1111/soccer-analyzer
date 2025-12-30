import type { MetricKey } from "../metricKeys";

export type StatsDoc = {
  statId: string;
  version: string;
  pipelineVersion?: string;
  scope: "match" | "player";
  playerId?: string | null;
  metrics: Partial<Record<MetricKey, unknown>>;
  confidence: Partial<Record<MetricKey, number>>;
  explanations?: Partial<Record<MetricKey, string>>;
  computedAt: string;
};
