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

export async function stepComputeStats({
  matchId,
  videoId,
  version,
}: {
  matchId: string;
  videoId?: string;
  version: string;
}) {
  const stepLogger = logger.child ? logger.child({ step: "compute_stats" }) : logger;
  stepLogger.info("Starting compute stats", { matchId, videoId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new Error(`match not found: ${matchId}`);

  const matchData = matchSnap.data() as { settings?: MatchSettings } | undefined;

  // Fetch existing clip-based data
  // P0修正: videoIdが指定されている場合、そのvideoIdのデータのみをフィルタリング
  // 前半/後半の分割アップロード時にデータが混在するのを防ぐ
  const buildQuery = (collectionName: string) => {
    let query = matchRef.collection(collectionName).where("version", "==", version);
    if (videoId) {
      query = query.where("videoId", "==", videoId);
    }
    return query;
  };

  const [shotsSnap, clipsSnap, eventsSnap] = await Promise.all([
    buildQuery("shots").get(),
    buildQuery("clips").get(),
    buildQuery("events").get(),
  ]);

  // Fetch auto-stats tracking data (Phase 3)
  // P0修正: videoIdフィルタリングを適用
  const [passEventsSnap, carryEventsSnap, turnoverEventsSnap, shotEventsSnap, setPieceEventsSnap, possessionSnap, trackMappingsSnap] =
    await Promise.all([
      buildQuery("passEvents").get(),
      buildQuery("carryEvents").get(),
      buildQuery("turnoverEvents").get(),
      buildQuery("shotEvents").get(),
      buildQuery("setPieceEvents").get(),
      buildQuery("possessionSegments").get(),
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
    videoId,
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
    // P2.10修正: playerIdにコロン等が含まれる場合があるためsafeIdでサニタイズ
    // 例: player:away:N/A → player_away_N_A
    const safePlayerId = safeId(output.playerId ?? "match");
    const statId = output.statId ?? `stat_${safeVersion}_${output.calculatorId}_${safePlayerId}`;
    batch.set(
      statsRef.doc(statId),
      {
        ...output,
        statId,
        videoId,
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
