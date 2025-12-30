import { runCalculators } from "../../calculators/registry";
import { getDb } from "../../firebase/admin";
import { safeId } from "../../lib/ids";

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
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new Error(`match not found: ${matchId}`);

  const [shotsSnap, clipsSnap, eventsSnap] = await Promise.all([
    matchRef.collection("shots").where("version", "==", version).get(),
    matchRef.collection("clips").where("version", "==", version).get(),
    matchRef.collection("events").where("version", "==", version).get(),
  ]);

  const shots = shotsSnap.docs.map((doc) => doc.data() as ShotDoc);
  const clips = clipsSnap.docs.map((doc) => doc.data() as ClipDoc);
  const events = eventsSnap.docs.map((doc) => doc.data() as EventDoc);

  const outputs = await runCalculators({
    matchId,
    version,
    match: matchSnap.data() as any,
    shots,
    clips,
    events,
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

  if (outputs.length > 0) await batch.commit();
  return { matchId, ok: true, count: outputs.length };
}
