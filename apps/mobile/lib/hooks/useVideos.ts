import { useState, useEffect } from "react";
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { VideoDoc, VideoType } from "@soccer/shared";

/**
 * P1修正: VideoTypeの実行時型ガード
 * Firestoreデータの不正を防ぐ
 */
function isValidVideoType(value: unknown): value is VideoType {
  return value === "firstHalf" || value === "secondHalf" || value === "single";
}

/**
 * P1修正: VideoDocの実行時検証
 * Firestoreから取得したデータが期待する形式か確認
 */
function isValidVideoDoc(data: unknown): data is Partial<VideoDoc> {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  // typeは必須かつ有効な値であること
  if (!isValidVideoType(obj.type)) return false;
  // storagePathは存在する場合はstringであること
  if (obj.storagePath !== undefined && typeof obj.storagePath !== "string") return false;
  return true;
}

/**
 * Convert Firestore Timestamp to ISO string
 */
function toISOString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const ts = value as { seconds: number; nanoseconds?: number };
    return new Date(ts.seconds * 1000).toISOString();
  }
  return null;
}

type UseVideosResult = {
  videos: VideoDoc[];
  loading: boolean;
  error: Error | null;
};

/**
 * Hook to fetch videos for a match
 */
export function useVideos(matchId: string | null): UseVideosResult {
  const [videos, setVideos] = useState<VideoDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // P1修正: アンマウント後のstate更新を防ぐためのフラグ
    let mounted = true;

    if (!matchId) {
      setVideos([]);
      setLoading(false);
      setError(null); // P0修正: エラー状態もリセット
      // P0修正: 早期リターン時もcleanup関数を返す（メモリリーク防止）
      return () => {
        mounted = false;
      };
    }

    const videosRef = collection(db, "matches", matchId, "videos");
    const q = query(videosRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        // P1修正: アンマウント後は更新しない
        if (!mounted) return;

        const docs: VideoDoc[] = [];
        for (const d of snapshot.docs) {
          const data = d.data();

          // P1修正: 実行時型検証
          if (!isValidVideoDoc(data)) {
            console.warn(`[useVideos] Invalid video document skipped: ${d.id}`, data);
            continue;
          }

          docs.push({
            videoId: d.id,
            matchId,
            type: data.type as VideoType, // isValidVideoDocで検証済み
            storagePath: data.storagePath ?? "",
            durationSec: typeof data.durationSec === "number" ? data.durationSec : undefined,
            width: typeof data.width === "number" ? data.width : undefined,
            height: typeof data.height === "number" ? data.height : undefined,
            fps: typeof data.fps === "number" ? data.fps : undefined,
            uploadedAt: toISOString(data.uploadedAt) ?? new Date().toISOString(),
            analysis: data.analysis
              ? {
                  status: data.analysis.status ?? "idle",
                  errorMessage: data.analysis.errorMessage,
                  lastRunAt: toISOString(data.analysis.lastRunAt) ?? undefined,
                  progress: typeof data.analysis.progress === "number" ? data.analysis.progress : undefined,
                }
              : undefined,
          });
        }

        // Sort by type order: single, firstHalf, secondHalf
        const typeOrder: Record<VideoType, number> = { single: 0, firstHalf: 1, secondHalf: 2 };
        docs.sort((a, b) => {
          const orderA = typeOrder[a.type] ?? 999;
          const orderB = typeOrder[b.type] ?? 999;
          return orderA - orderB;
        });

        setVideos(docs);
        setLoading(false);
      },
      (err) => {
        // P1修正: アンマウント後は更新しない
        if (!mounted) return;

        console.error("Error loading videos:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [matchId]);

  return { videos, loading, error };
}

/**
 * Create a video document in the videos subcollection
 */
export async function createVideoDoc(
  matchId: string,
  data: Omit<VideoDoc, "videoId" | "matchId" | "uploadedAt">
): Promise<string> {
  const videoRef = doc(collection(db, "matches", matchId, "videos"));
  await setDoc(videoRef, {
    ...data,
    matchId,
    uploadedAt: serverTimestamp(),
  });
  return videoRef.id;
}

/**
 * Update a video document
 */
export async function updateVideoDoc(
  matchId: string,
  videoId: string,
  data: Partial<Omit<VideoDoc, "videoId" | "matchId">>
): Promise<void> {
  const videoRef = doc(db, "matches", matchId, "videos", videoId);
  await updateDoc(videoRef, data);
}

/**
 * Delete a video document (P0修正: アップロード失敗時のクリーンアップ用)
 */
export async function deleteVideoDoc(
  matchId: string,
  videoId: string
): Promise<void> {
  const videoRef = doc(db, "matches", matchId, "videos", videoId);
  await deleteDoc(videoRef);
}

/**
 * Alias for useVideos (backward compatibility)
 * @deprecated Use useVideos instead
 */
export const useMatchVideos = useVideos;
