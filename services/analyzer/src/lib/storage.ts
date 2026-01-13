import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { getBucket } from "../firebase/admin";

const TMP_BASE = "/tmp/soccer-analyzer";

async function ensureTmpDir() {
  await mkdir(TMP_BASE, { recursive: true });
  return TMP_BASE;
}

/**
 * Extract the file path from a gs:// URL or return the path as-is
 * @param storagePath - Either "gs://bucket/path/to/file" or just "path/to/file"
 */
function parseStoragePath(storagePath: string): string {
  if (storagePath.startsWith("gs://")) {
    // Remove gs://bucket/ prefix and return just the path
    const url = new URL(storagePath);
    return url.pathname.slice(1); // Remove leading slash
  }
  return storagePath;
}

export async function downloadToTmp(storagePath: string, filename?: string) {
  const filePath = parseStoragePath(storagePath);
  const dir = await ensureTmpDir();
  const localPath = path.join(dir, filename ?? path.basename(filePath));
  try {
    await stat(localPath);
    return localPath;
  } catch {
    // continue to download
  }
  const bucket = getBucket();
  await bucket.file(filePath).download({ destination: localPath });
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
  const filePath = parseStoragePath(storagePath);
  const bucket = getBucket();
  const [exists] = await bucket.file(filePath).exists();
  return exists;
}
