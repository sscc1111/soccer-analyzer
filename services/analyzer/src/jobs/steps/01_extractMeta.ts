import { getDb } from "../../firebase/admin";
import { probeVideo } from "../../lib/ffmpeg";
import { downloadToTmp } from "../../lib/storage";

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

type ExtractMetaOptions = {
  matchId: string;
  videoId?: string;
  version: string;
};

export async function stepExtractMeta({ matchId, videoId, version }: ExtractMetaOptions) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const snap = await matchRef.get();
  if (!snap.exists) throw new Error(`match not found: ${matchId}`);

  const storagePath = await getVideoStoragePath(matchRef, videoId);
  if (!storagePath) throw new Error("video.storagePath missing");

  const existingDuration = await getVideoDuration(matchRef, videoId);

  // Check if already processed for this version
  if (videoId) {
    const videoDoc = await matchRef.collection("videos").doc(videoId).get();
    const videoData = videoDoc.data();
    if (videoData?.metaVersion === version && videoData?.durationSec) {
      return { matchId, ok: true, skipped: true };
    }
  } else {
    const match = snap.data();
    if (match?.video?.metaVersion === version && match?.video?.durationSec) {
      return { matchId, ok: true, skipped: true };
    }
  }

  const localPath = await downloadToTmp(storagePath);
  const meta = await probeVideo(localPath);

  // Save metadata to appropriate location
  if (videoId) {
    // New: Save to videos subcollection
    await matchRef.collection("videos").doc(videoId).set(
      {
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        metaVersion: version,
      },
      { merge: true }
    );
  } else {
    // Fallback: Save to legacy match.video field
    await matchRef.set(
      {
        video: {
          durationSec: meta.durationSec,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          metaVersion: version,
        },
      },
      { merge: true }
    );
  }

  return { matchId, ok: true, meta };
}
