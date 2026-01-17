import path from "node:path";
import { getDb } from "../../firebase/admin";
import { detectSceneCuts, extractThumbnail, getMotionScores, probeVideo } from "../../lib/ffmpeg";
import { safeId } from "../../lib/ids";
import { downloadToTmp, uploadFromTmp } from "../../lib/storage";

/**
 * Get video storage path from videoId (subcollection) or fallback to legacy match.video
 */
async function getVideoStoragePath(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId?: string
): Promise<string | null> {
  if (videoId) {
    // New: Get from videos subcollection
    const videoDoc = await matchRef.collection("videos").doc(videoId).get();
    if (videoDoc.exists) {
      return videoDoc.data()?.storagePath ?? null;
    }
  }
  // Fallback: Get from legacy match.video field
  const matchDoc = await matchRef.get();
  return matchDoc.data()?.video?.storagePath ?? null;
}

/**
 * Get video duration from videoId (subcollection) or fallback to legacy match.video
 */
async function getVideoDuration(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId?: string
): Promise<number | undefined> {
  if (videoId) {
    // New: Get from videos subcollection
    const videoDoc = await matchRef.collection("videos").doc(videoId).get();
    if (videoDoc.exists) {
      return videoDoc.data()?.durationSec;
    }
  }
  // Fallback: Get from legacy match.video field
  const matchDoc = await matchRef.get();
  return matchDoc.data()?.video?.durationSec;
}

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

type DetectShotsOptions = {
  matchId: string;
  videoId?: string;
  version: string;
};

export async function stepDetectShots({ matchId, videoId, version }: DetectShotsOptions) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new Error(`match not found: ${matchId}`);

  const storagePath = await getVideoStoragePath(matchRef, videoId);
  if (!storagePath) throw new Error("video.storagePath missing");

  let durationSec = (await getVideoDuration(matchRef, videoId)) ?? 0;

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
