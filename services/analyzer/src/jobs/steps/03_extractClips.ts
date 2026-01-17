import path from "node:path";
import { getDb } from "../../firebase/admin";
import { extractClip, extractThumbnail, getAudioLevels, getMotionScores, makeProxyVideo } from "../../lib/ffmpeg";
import { safeId } from "../../lib/ids";
import { downloadToTmp, storageFileExists, uploadFromTmp } from "../../lib/storage";

/**
 * Get video info from videoId (subcollection) or fallback to legacy match.video
 */
async function getVideoInfo(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId?: string
): Promise<{ storagePath: string | null; durationSec?: number }> {
  if (videoId) {
    const videoDoc = await matchRef.collection("videos").doc(videoId).get();
    if (videoDoc.exists) {
      const data = videoDoc.data();
      return {
        storagePath: data?.storagePath ?? null,
        durationSec: data?.durationSec,
      };
    }
  }
  const matchDoc = await matchRef.get();
  const video = matchDoc.data()?.video;
  return {
    storagePath: video?.storagePath ?? null,
    durationSec: video?.durationSec,
  };
}

type ShotDoc = {
  shotId: string;
  t0: number;
  t1: number;
};

const MAX_CLIPS = 60;
const CLIP_TARGET_SEC = 12;
const MOTION_FPS = 1;
const AUDIO_FPS = 1;
const PEAK_WINDOW_BEFORE = 8;
const PEAK_WINDOW_AFTER = 12;
const MERGE_GAP_SEC = 1;

export async function stepExtractClips({
  matchId,
  videoId,
  version
}: {
  matchId: string;
  videoId?: string;
  version: string
}) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw new Error(`match not found: ${matchId}`);

  // Get video info from subcollection or legacy location
  const videoInfo = await getVideoInfo(matchRef, videoId);
  const storagePath = videoInfo.storagePath;
  const durationSec = videoInfo.durationSec ?? 0;
  if (!storagePath) throw new Error("video.storagePath missing");
  if (!durationSec) throw new Error("video.durationSec missing");

  const existing = await matchRef
    .collection("clips")
    .where("version", "==", version)
    .limit(1)
    .get();
  if (!existing.empty) return { matchId, ok: true, skipped: true };

  const localPath = await downloadToTmp(storagePath);

  const safeVersion = safeId(version);
  const proxyPath = `matches/${matchId}/proxies/${safeVersion}/proxy_240p.mp4`;
  const proxyExists = await storageFileExists(proxyPath);
  if (!proxyExists) {
    const proxyLocal = path.join("/tmp", `proxy_${matchId}_${safeVersion}.mp4`);
    try {
      await makeProxyVideo(localPath, proxyLocal);
      await uploadFromTmp(proxyLocal, proxyPath, "video/mp4");
    } catch {
      // proxy is optional; continue without blocking
    }
  }

  const shotsSnap = await matchRef.collection("shots").where("version", "==", version).get();
  let shots = shotsSnap.docs.map((doc) => doc.data() as ShotDoc);
  if (!shots.length && durationSec) {
    shots = [{ shotId: `shot_${safeVersion}_1`, t0: 0, t1: durationSec }];
  }

  const motionScores = await getMotionScores(localPath, MOTION_FPS).catch(() => ({ fps: MOTION_FPS, scores: [] }));
  const audioLevels = await getAudioLevels(localPath, AUDIO_FPS).catch(() => []);

  const motionPeaks = pickPeaks(motionScores.scores, 0.6);
  const audioPeaks = pickPeaks(audioLevels, 0.6);
  const peakWindows = [
    ...motionPeaks.map((peak) => ({ t: peak.t, score: peak.score, reason: "motionPeak" as const })),
    ...audioPeaks.map((peak) => ({ t: peak.t, score: peak.score, reason: "audioPeak" as const })),
  ];

  const clipWindows = peakWindows.map((peak) => ({
    t0: Math.max(0, peak.t - PEAK_WINDOW_BEFORE),
    t1: Math.min(durationSec, peak.t + PEAK_WINDOW_AFTER),
    score: peak.score,
    reason: peak.reason,
  }));

  const fallbackWindows =
    clipWindows.length === 0
      ? shots.map((shot) => {
          const duration = shot.t1 - shot.t0;
          const end = Math.min(shot.t1, durationSec);
          if (duration <= CLIP_TARGET_SEC * 1.5) {
            return { t0: shot.t0, t1: end, score: 0.2, reason: "other" as const };
          }
          const mid = shot.t0 + duration / 2;
          const half = CLIP_TARGET_SEC / 2;
          return {
            t0: Math.max(0, mid - half),
            t1: Math.min(durationSec, mid + half),
            score: 0.2,
            reason: "other" as const,
          };
        })
      : [];

  const merged = mergeWindows(clipWindows.length ? clipWindows : fallbackWindows, MERGE_GAP_SEC);
  const clipped = selectTopWindows(merged, MAX_CLIPS);
  const clips = clipped.sort((a, b) => a.t0 - b.t0);
  const batch = db.batch();
  const clipsRef = matchRef.collection("clips");

  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const clipId = `clip_${safeVersion}_${i + 1}`;
    const clipLocal = path.join("/tmp", `clip_${matchId}_${i + 1}.mp4`);
    const clipThumbLocal = path.join("/tmp", `clip_${matchId}_${i + 1}.jpg`);
    const clipPath = `matches/${matchId}/clips/${safeVersion}/${clipId}.mp4`;
    const thumbPath = `matches/${matchId}/clips/${safeVersion}/${clipId}.jpg`;
    const duration = Math.max(0, clip.t1 - clip.t0);
    const motionScore = Number((clip.score ?? 0).toFixed(3));
    const shotId = findShotForTime(shots, clip.t0 + duration / 2);

    await extractClip(localPath, clip.t0, clip.t1, clipLocal);
    await uploadFromTmp(clipLocal, clipPath, "video/mp4");

    let storedThumbPath: string | undefined;
    try {
      const mid = clip.t0 + duration / 2;
      await extractThumbnail(localPath, mid, clipThumbLocal);
      await uploadFromTmp(clipThumbLocal, thumbPath, "image/jpeg");
      storedThumbPath = thumbPath;
    } catch {
      // thumbnail optional
    }

    batch.set(
      clipsRef.doc(clipId),
      {
        clipId,
        shotId,
        videoId,
        t0: clip.t0,
        t1: clip.t1,
        reason: clip.reason,
        media: storedThumbPath ? { clipPath, thumbPath: storedThumbPath } : { clipPath },
        motionScore,
        version,
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { matchId, ok: true, count: clips.length };
}

type Window = { t0: number; t1: number; score: number; reason: "motionPeak" | "audioPeak" | "other" };

function pickPeaks(values: { t: number; score: number }[], ratio: number) {
  if (!values.length) return [];
  const max = values.reduce((m, v) => Math.max(m, v.score), 0);
  const threshold = max * ratio;
  const peaks: { t: number; score: number }[] = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    const prev = values[i - 1].score;
    const cur = values[i].score;
    const next = values[i + 1].score;
    if (cur >= threshold && cur >= prev && cur >= next) {
      peaks.push(values[i]);
    }
  }
  return peaks;
}

function mergeWindows(windows: Window[], gapSec: number) {
  const sorted = windows.slice().sort((a, b) => a.t0 - b.t0);
  const merged: Window[] = [];
  for (const win of sorted) {
    if (!merged.length) {
      merged.push({ ...win });
      continue;
    }
    const last = merged[merged.length - 1];
    if (win.t0 <= last.t1 + gapSec) {
      last.t1 = Math.max(last.t1, win.t1);
      last.score = Math.max(last.score, win.score);
      if (last.reason === "other") last.reason = win.reason;
    } else {
      merged.push({ ...win });
    }
  }
  return merged;
}

function selectTopWindows(windows: Window[], max: number) {
  if (windows.length <= max) return windows;
  return windows
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.t0 - b.t0);
}

function findShotForTime(shots: ShotDoc[], t: number) {
  const found = shots.find((shot) => t >= shot.t0 && t <= shot.t1);
  return found?.shotId ?? shots[0]?.shotId ?? "unknown";
}
