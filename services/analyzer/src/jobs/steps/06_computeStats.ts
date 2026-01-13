import { runCalculators } from "../../calculators/registry";
import { getDb } from "../../firebase/admin";
import { safeId } from "../../lib/ids";
import { defaultLogger as logger } from "../../lib/logger";
import type {
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  ShotEventDoc,
  SetPieceEventDoc,
  PossessionSegment,
  TrackPlayerMapping,
  MatchSettings,
} from "@soccer/shared";

type ShotDoc = { shotId: string; t0: number; t1: number; version?: string };
type ClipDoc = {
  clipId: string;
  shotId: string;
  t0: number;
  t1: number;
  version?: string;
  motionScore?: number;
  gemini?: { label?: string; confidence?: number; title?: string; summary?: string };
};
type EventDoc = {
  eventId: string;
  clipId: string;
  label: string;
  confidence: number;
  title?: string | null;
  summary?: string | null;
  involved?: { players?: { playerId: string; confidence: number }[] };
  version?: string;
};

export async function stepComputeStats({ matchId, version }: { matchId: string; version: string }) {
  const stepLogger = logger.child ? logger.child({ step: "compute_stats" }) : logger;
  stepLogger.info("Starting compute stats", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new Error(`match not found: ${matchId}`);

  const matchData = matchSnap.data() as { settings?: MatchSettings } | undefined;

  // Fetch existing clip-based data
  const [shotsSnap, clipsSnap, eventsSnap] = await Promise.all([
    matchRef.collection("shots").where("version", "==", version).get(),
    matchRef.collection("clips").where("version", "==", version).get(),
    matchRef.collection("events").where("version", "==", version).get(),
  ]);

  // Fetch auto-stats tracking data (Phase 3)
  const [passEventsSnap, carryEventsSnap, turnoverEventsSnap, shotEventsSnap, setPieceEventsSnap, possessionSnap, trackMappingsSnap] =
    await Promise.all([
      matchRef.collection("passEvents").where("version", "==", version).get(),
      matchRef.collection("carryEvents").where("version", "==", version).get(),
      matchRef.collection("turnoverEvents").where("version", "==", version).get(),
      matchRef.collection("shotEvents").where("version", "==", version).get(),
      matchRef.collection("setPieceEvents").where("version", "==", version).get(),
      matchRef.collection("possessionSegments").where("version", "==", version).get(),
      matchRef.collection("trackMappings").get(), // trackMappings are not versioned
    ]);

  const shots = shotsSnap.docs.map((doc) => doc.data() as ShotDoc);
  const clips = clipsSnap.docs.map((doc) => doc.data() as ClipDoc);
  const events = eventsSnap.docs.map((doc) => doc.data() as EventDoc);

  // Auto-stats data
  const passEvents = passEventsSnap.docs.map((doc) => doc.data() as PassEventDoc);
  const carryEvents = carryEventsSnap.docs.map((doc) => doc.data() as CarryEventDoc);
  const turnoverEvents = turnoverEventsSnap.docs.map((doc) => doc.data() as TurnoverEventDoc);
  const shotEvents = shotEventsSnap.docs.map((doc) => doc.data() as ShotEventDoc);
  const setPieceEvents = setPieceEventsSnap.docs.map((doc) => doc.data() as SetPieceEventDoc);
  const possessionSegments = possessionSnap.docs.map((doc) => doc.data() as PossessionSegment);
  const trackMappings = trackMappingsSnap.docs.map((doc) => doc.data() as TrackPlayerMapping);

  stepLogger.info("Fetched data for stats computation", {
    matchId,
    shotsCount: shots.length,
    clipsCount: clips.length,
    eventsCount: events.length,
    passEventsCount: passEvents.length,
    carryEventsCount: carryEvents.length,
    turnoverEventsCount: turnoverEvents.length,
    shotEventsCount: shotEvents.length,
    setPieceEventsCount: setPieceEvents.length,
    possessionSegmentsCount: possessionSegments.length,
    trackMappingsCount: trackMappings.length,
  });

  const outputs = await runCalculators({
    matchId,
    version,
    match: matchData,
    shots,
    clips,
    events,
    // Phase 3: Auto-stats data
    passEvents,
    carryEvents,
    turnoverEvents,
    shotEvents,
    setPieceEvents,
    possessionSegments,
    trackMappings,
    settings: matchData?.settings,
  });

  stepLogger.info("Calculators produced outputs", {
    matchId,
    outputCount: outputs.length,
    calculatorIds: outputs.map((o) => o.calculatorId),
  });

  const statsRef = matchRef.collection("stats");
  const batch = db.batch();
  const safeVersion = safeId(version);
  const now = new Date().toISOString();

  for (const output of outputs) {
    const statId = output.statId ?? `stat_${safeVersion}_${output.calculatorId}_${output.playerId ?? "match"}`;
    batch.set(
      statsRef.doc(statId),
      {
        ...output,
        statId,
        version,
        pipelineVersion: version,
        computedAt: now,
      },
      { merge: true }
    );
  }

  if (outputs.length > 0) {
    await batch.commit();
    stepLogger.info("Stats computation complete", { matchId, statsCount: outputs.length });
  } else {
    stepLogger.warn("No stats outputs to save", { matchId });
  }

  return { matchId, ok: true, count: outputs.length };
}
