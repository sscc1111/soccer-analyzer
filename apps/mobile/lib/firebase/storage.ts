import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { getFirebaseApp } from "./client";

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
