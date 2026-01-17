import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { getFirebaseApp } from "./client";
import type { VideoType } from "@soccer/shared";

export const storage = getStorage(getFirebaseApp());

export type UploadProgress = {
  bytesTransferred: number;
  totalBytes: number;
  progress: number; // 0-100
};

export type UploadResult = {
  storagePath: string;
  downloadUrl: string;
};

/**
 * Upload video to match-level storage (deprecated path)
 * @deprecated Use uploadVideoToMatch instead for new uploads
 */
export async function uploadVideo(
  matchId: string,
  fileUri: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const response = await fetch(fileUri);
  const blob = await response.blob();

  const storagePath = `matches/${matchId}/video.mp4`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, blob);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress?.({
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          progress,
        });
      },
      (error) => {
        reject(error);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({ storagePath, downloadUrl });
      }
    );
  });
}

/**
 * Delete video file from storage
 * P1修正: アップロード成功後のvideoDoc更新失敗時のクリーンアップ用
 */
export async function deleteVideoFromStorage(storagePath: string): Promise<void> {
  try {
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
    console.log(`[storage] Deleted video: ${storagePath}`);
  } catch (error) {
    // ファイルが存在しない場合は無視
    console.log(`[storage] Delete skipped (file may not exist): ${storagePath}`, error);
  }
}

/**
 * Upload video to match videos subcollection storage
 * Storage path: matches/{matchId}/videos/{type}.mp4
 * @param matchId - Match ID
 * @param videoId - Video document ID
 * @param fileUri - Local file URI to upload
 * @param type - Video type (firstHalf, secondHalf, single)
 * @param onProgress - Progress callback
 * @returns Upload result with storage path and download URL
 */
export async function uploadVideoToMatch(
  matchId: string,
  videoId: string,
  fileUri: string,
  type: VideoType,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const response = await fetch(fileUri);
  const blob = await response.blob();

  // New path structure: matches/{matchId}/videos/{type}.mp4
  const storagePath = `matches/${matchId}/videos/${type}.mp4`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, blob);
    let cancelled = false; // P0: エラー後の進捗コールバック防止

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        // P1: エラー後の進捗更新を防ぐ
        if (cancelled) return;
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress?.({
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          progress,
        });
      },
      async (error) => {
        cancelled = true;
        // P0: アップロード失敗時に部分的にアップロードされたファイルをクリーンアップ
        try {
          await deleteObject(storageRef);
          console.log(`[storage] Cleaned up partial upload: ${storagePath}`);
        } catch (cleanupError) {
          // ファイルが存在しない場合は無視（まだアップロード開始前かもしれない）
          console.log(`[storage] Cleanup skipped (file may not exist): ${storagePath}`);
        }
        reject(error);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({ storagePath, downloadUrl });
      }
    );
  });
}
