import { getDb } from "../../firebase/admin";
import { safeId } from "../../lib/ids";

type ClipDoc = {
  clipId: string;
  gemini?: {
    label?: string;
    confidence?: number;
    title?: string | null;
    summary?: string | null;
  } | null;
};

type EventDoc = {
  eventId: string;
  clipId: string;
  label: string;
  confidence: number;
  title?: string | null;
  summary?: string | null;
  involved?: { players?: { playerId: string; confidence: number }[] };
  source: "gemini" | "manual" | "hybrid";
  createdAt: string;
  version: string;
};

const labelMap: Record<string, string> = {
  shot: "shot",
  chance: "chance",
  setpiece: "setPiece",
  dribble: "dribble",
  defense: "defense",
  other: "other",
};

export async function stepBuildEvents({ matchId, version }: { matchId: string; version: string }) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const clipsSnap = await matchRef.collection("clips").where("version", "==", version).get();
  const clips = clipsSnap.docs.map((doc) => doc.data() as ClipDoc);
  const existingSnap = await matchRef.collection("events").where("version", "==", version).get();
  const existingMap = new Map<string, EventDoc>(
    existingSnap.docs.map((doc) => [doc.id, doc.data() as EventDoc])
  );

  const batch = db.batch();
  const safeVersion = safeId(version);
  const now = new Date().toISOString();
  let count = 0;

  for (const clip of clips) {
    if (!clip.gemini?.label) continue;
    const normalized = clip.gemini.label.toLowerCase();
    const label = labelMap[normalized] ?? "other";
    const eventId = `event_${safeVersion}_${clip.clipId}`;
    const eventRef = matchRef.collection("events").doc(eventId);
    const existing = existingMap.get(eventId) ?? null;

    const hasManual = existing?.source === "manual" || existing?.source === "hybrid";
    const source = hasManual ? "hybrid" : "gemini";

    const eventDoc: EventDoc = {
      eventId,
      clipId: clip.clipId,
      label,
      confidence: clip.gemini.confidence ?? 0.5,
      title: clip.gemini.title ?? null,
      summary: clip.gemini.summary ?? null,
      involved: existing?.involved,
      source,
      createdAt: existing?.createdAt ?? now,
      version,
    };

    if (hasManual) {
      // Preserve manual label/title/summary when explicitly set
      eventDoc.label = existing?.label ?? eventDoc.label;
      eventDoc.title = existing?.title ?? eventDoc.title;
      eventDoc.summary = existing?.summary ?? eventDoc.summary;
      eventDoc.confidence = existing?.confidence ?? eventDoc.confidence;
    }

    batch.set(eventRef, eventDoc, { merge: true });
    count += 1;
  }

  if (count > 0) await batch.commit();
  return { matchId, ok: true, count };
}
