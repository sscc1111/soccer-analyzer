import { metricKeys } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

export async function calcMatchSummary(ctx: CalculatorContext): Promise<StatsOutput> {
  const events = (ctx.events ?? []) as {
    eventId: string;
    label: string;
    confidence: number;
    title?: string | null;
    summary?: string | null;
  }[];

  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.label] = (counts[event.label] ?? 0) + 1;
  }

  const topMoments = events
    .slice()
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 5)
    .map((event) => ({
      eventId: event.eventId,
      label: event.label,
      confidence: event.confidence,
      title: event.title ?? null,
      summary: event.summary ?? null,
    }));

  const avgConfidence =
    events.length > 0
      ? events.reduce((sum, event) => sum + (event.confidence ?? 0), 0) / events.length
      : 0.2;

  const output: StatsOutput = {
    calculatorId: "matchSummary",
    scope: "match" as const,
    metrics: {
      [metricKeys.matchEventsCountByLabel]: counts,
      [metricKeys.matchTopMoments]: topMoments,
    },
    confidence: {
      [metricKeys.matchEventsCountByLabel]: Math.min(0.9, avgConfidence + 0.1),
      [metricKeys.matchTopMoments]: Math.min(0.9, avgConfidence + 0.1),
    },
    explanations: {
      [metricKeys.matchEventsCountByLabel]: "Events labeled by Gemini are counted per label.",
      [metricKeys.matchTopMoments]: "Top moments are ranked by Gemini confidence.",
    },
  };
  return output;
}
