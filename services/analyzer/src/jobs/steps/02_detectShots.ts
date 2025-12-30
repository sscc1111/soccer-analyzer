import path from "node:path";
import { getDb } from "../../firebase/admin";
import { detectSceneCuts, extractThumbnail, getMotionScores, probeVideo } from "../../lib/ffmpeg";
import { safeId } from "../../lib/ids";
import { downloadToTmp, uploadFromTmp } from "../../lib/storage";

type ShotDoc = {
  shotId: string;
  t0: number;
  t1: number;
  type: "cut" | "full";
  motionAvg?: number;
  motionType?: "panZoom";
  thumbPath?: string;
  version: string;
  createdAt: string;
};

const MAX_SHOTS = 120;
const MIN_SHOT_SEC = 2;
const MOTION_FPS = 1;
const MOTION_THRESHOLD = 0.12;

export async function stepDetectShots({ matchId, version }: { matchId: string; version: string }) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new Error(`match not found: ${matchId}`);

  const match = matchSnap.data() as { video?: { storagePath?: string; durationSec?: number } } | undefined;
  const storagePath = match?.video?.storagePath;
  let durationSec = match?.video?.durationSec ?? 0;
  if (!storagePath) throw new Error("video.storagePath missing");

  const existing = await matchRef
    .collection("shots")
    .where("version", "==", version)
    .limit(1)
    .get();
  if (!existing.empty) return { matchId, ok: true, skipped: true };

  const localPath = await downloadToTmp(storagePath);
  if (!durationSec) {
    const meta = await probeVideo(localPath);
    durationSec = meta.durationSec;
  }
  if (!durationSec) throw new Error("video.durationSec missing");
  let cuts: number[] = [];
  const motionScores = await getMotionScores(localPath, MOTION_FPS).catch(() => ({ fps: MOTION_FPS, scores: [] }));
  const motionCache = new Map<string, number>();
  try {
    cuts = await detectSceneCuts(localPath, 0.35);
  } catch {
    cuts = [];
  }

  const sortedCuts = cuts.filter((t) => t > 0 && t < durationSec).sort((a, b) => a - b);
  const shots: ShotDoc[] = [];
  let start = 0;
  for (const cut of sortedCuts) {
    if (cut - start < MIN_SHOT_SEC) continue;
    const motionAvg = getMotionAvg(motionCache, motionScores.scores, start, cut);
    shots.push({
      shotId: "",
      t0: start,
      t1: cut,
      type: "cut",
      motionAvg,
      motionType: motionAvg >= MOTION_THRESHOLD ? "panZoom" : undefined,
      version,
      createdAt: new Date().toISOString(),
    });
    start = cut;
  }
  if (durationSec > start + 0.5) {
    const motionAvg = getMotionAvg(motionCache, motionScores.scores, start, durationSec);
    shots.push({
      shotId: "",
      t0: start,
      t1: durationSec,
      type: shots.length ? "cut" : "full",
      motionAvg,
      motionType: motionAvg >= MOTION_THRESHOLD ? "panZoom" : undefined,
      version,
      createdAt: new Date().toISOString(),
    });
  }

  if (!shots.length) {
    const motionAvg = getMotionAvg(motionCache, motionScores.scores, 0, durationSec || 0);
    shots.push({
      shotId: "",
      t0: 0,
      t1: durationSec || 0,
      type: "full",
      motionAvg,
      motionType: motionAvg >= MOTION_THRESHOLD ? "panZoom" : undefined,
      version,
      createdAt: new Date().toISOString(),
    });
  }

  const clippedShots = shots.slice(0, MAX_SHOTS);
  const safeVersion = safeId(version);
  const batch = db.batch();
  const shotsRef = matchRef.collection("shots");

  for (let i = 0; i < clippedShots.length; i += 1) {
    const shot = clippedShots[i];
    const shotId = `shot_${safeVersion}_${i + 1}`;
    const mid = Math.max(0, shot.t0 + (shot.t1 - shot.t0) / 2);
    const thumbLocal = path.join("/tmp", `shot_${matchId}_${i + 1}.jpg`);
    let thumbPath: string | undefined;
    try {
      await extractThumbnail(localPath, mid, thumbLocal);
      thumbPath = `matches/${matchId}/shots/${safeVersion}/${shotId}.jpg`;
      await uploadFromTmp(thumbLocal, thumbPath, "image/jpeg");
    } catch {
      thumbPath = undefined;
    }
    const doc: ShotDoc = { ...shot, shotId, thumbPath };
    batch.set(shotsRef.doc(shotId), doc, { merge: true });
  }

  await batch.commit();
  return { matchId, ok: true, count: clippedShots.length };
}

function getMotionAvg(cache: Map<string, number>, scores: { t: number; score: number }[], t0: number, t1: number) {
  const key = `${t0.toFixed(3)}_${t1.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const window = scores.filter((score) => score.t >= t0 && score.t <= t1);
  if (!window.length) {
    cache.set(key, 0);
    return 0;
  }
  const sum = window.reduce((acc, score) => acc + score.score, 0);
  const avg = Number((sum / window.length).toFixed(4));
  cache.set(key, avg);
  return avg;
}
