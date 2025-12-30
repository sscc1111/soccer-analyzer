import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { getBucket } from "../firebase/admin";

const TMP_BASE = "/tmp/soccer-analyzer";

async function ensureTmpDir() {
  await mkdir(TMP_BASE, { recursive: true });
  return TMP_BASE;
}

export async function downloadToTmp(storagePath: string, filename?: string) {
  const dir = await ensureTmpDir();
  const localPath = path.join(dir, filename ?? path.basename(storagePath));
  try {
    await stat(localPath);
    return localPath;
  } catch {
    // continue to download
  }
  const bucket = getBucket();
  await bucket.file(storagePath).download({ destination: localPath });
  return localPath;
}

export async function uploadFromTmp(localPath: string, destinationPath: string, contentType?: string) {
  const bucket = getBucket();
  await bucket.upload(localPath, {
    destination: destinationPath,
    metadata: contentType ? { contentType } : undefined,
  });
  return destinationPath;
}

export async function storageFileExists(storagePath: string) {
  const bucket = getBucket();
  const [exists] = await bucket.file(storagePath).exists();
  return exists;
}
