import { getDb } from "../../firebase/admin";
import { probeVideo } from "../../lib/ffmpeg";
import { downloadToTmp } from "../../lib/storage";

export async function stepExtractMeta({ matchId, version }: { matchId: string; version: string }) {
  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);
  const snap = await matchRef.get();
  if (!snap.exists) throw new Error(`match not found: ${matchId}`);
  const match = snap.data() as {
    video?: {
      storagePath?: string;
      metaVersion?: string;
      durationSec?: number;
      width?: number;
      height?: number;
      fps?: number;
    };
  } | undefined;
  const storagePath = match?.video?.storagePath;
  if (!storagePath) throw new Error("video.storagePath missing");

  if (match?.video?.metaVersion === version && match?.video?.durationSec) {
    return { matchId, ok: true, skipped: true };
  }

  const localPath = await downloadToTmp(storagePath);
  const meta = await probeVideo(localPath);

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

  return { matchId, ok: true, meta };
}
