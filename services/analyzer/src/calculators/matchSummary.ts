import { metricKeys } from "@soccer/shared";
import type { CalculatorContext, StatsOutput } from "./registry";

type EventLike = {
  eventId: string;
  type: string;
  timestamp: number;
  confidence: number;
  team?: string;
  player?: string | null;
};

type ClipLike = {
  clipId: string;
  t0: number;
  gemini?: {
    label?: string;
    confidence?: number;
    title?: string;
    summary?: string;
  };
};

export async function calcMatchSummary(ctx: CalculatorContext): Promise<StatsOutput> {
  // First try legacy events collection (from build_events)
  const legacyEvents = (ctx.events ?? []) as {
    eventId: string;
    label: string;
    confidence: number;
    title?: string | null;
    summary?: string | null;
  }[];

  // Also collect Gemini-detected events (from detect_events_gemini)
  const passEvents = ctx.passEvents ?? [];
  const carryEvents = ctx.carryEvents ?? [];
  const turnoverEvents = ctx.turnoverEvents ?? [];
  const shotEvents = ctx.shotEvents ?? [];
  const setPieceEvents = ctx.setPieceEvents ?? [];

  // Get clips for top moments (with clipId for mobile app)
  const clips = (ctx.clips ?? []) as ClipLike[];

  // Combine all events for counting
  const allEvents: EventLike[] = [];

  // Add legacy events if available
  for (const e of legacyEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: e.label,
      timestamp: 0,
      confidence: e.confidence,
    });
  }

  // Add Gemini-detected events
  for (const e of passEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: "pass",
      timestamp: e.timestamp,
      confidence: e.confidence,
      team: e.kicker?.teamId,
      player: e.kicker?.playerId,
    });
  }

  for (const e of carryEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: "carry",
      timestamp: e.startTime,
      confidence: e.confidence,
      team: e.teamId,
      player: e.playerId,
    });
  }

  for (const e of turnoverEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: "turnover",
      timestamp: e.timestamp,
      confidence: e.confidence,
      team: e.player?.teamId,
      player: e.player?.playerId,
    });
  }

  // Add shot events
  for (const e of shotEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: "shot",
      timestamp: e.timestamp,
      confidence: e.confidence,
      team: e.team,
      player: e.player ?? e.playerId ?? null,
    });
  }

  // Add set piece events
  for (const e of setPieceEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: "setPiece",
      timestamp: e.timestamp,
      confidence: e.confidence,
      team: e.team,
      player: e.player ?? null,
    });
  }

  // Count events by type
  const counts: Record<string, number> = {};
  for (const event of allEvents) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }

  // Get top moments from clips (with clipId for mobile app navigation)
  // Prefer clips with Gemini labels for better UX
  const labeledClips = clips.filter((c) => c.gemini?.label && c.gemini?.confidence);
  const topMomentsFromClips = labeledClips
    .slice()
    .sort((a, b) => (b.gemini?.confidence ?? 0) - (a.gemini?.confidence ?? 0))
    .slice(0, 5)
    .map((clip) => ({
      clipId: clip.clipId,
      label: clip.gemini?.label ?? "other",
      confidence: clip.gemini?.confidence ?? 0.5,
      title: clip.gemini?.title ?? `Clip at ${clip.t0}s`,
      summary: clip.gemini?.summary ?? "",
    }));

  // If no labeled clips, fall back to events (without clipId - will show "clip not found")
  const topMoments =
    topMomentsFromClips.length > 0
      ? topMomentsFromClips
      : allEvents
          .slice()
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
          .slice(0, 5)
          .map((event) => ({
            clipId: "", // No clip available
            label: event.type,
            confidence: event.confidence,
            title: `${event.type} by ${event.player || "unknown"}`,
            summary: `${event.type} event at ${event.timestamp?.toFixed(1) ?? 0}s`,
          }));

  const avgConfidence =
    allEvents.length > 0
      ? allEvents.reduce((sum, event) => sum + (event.confidence ?? 0), 0) / allEvents.length
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
      [metricKeys.matchEventsCountByLabel]: "Events detected by Gemini are counted per type.",
      [metricKeys.matchTopMoments]: "Top moments are ranked by Gemini confidence.",
    },
  };
  return output;
}
