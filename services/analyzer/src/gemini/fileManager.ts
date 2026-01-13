/**
 * Gemini File API Manager
 *
 * Vertex AI の Files API を使用して大きな動画ファイルをアップロード・管理
 * Context Caching と組み合わせて 90% のコスト削減を実現
 */

import { Storage } from "@google-cloud/storage";
import { createReadStream, statSync } from "node:fs";
import { VertexAI } from "@google-cloud/vertexai";
import { defaultLogger as logger } from "../lib/logger";
import { downloadToTmp } from "../lib/storage";
import path from "node:path";

// Types for File API responses
export type GeminiFileState = "PROCESSING" | "ACTIVE" | "FAILED";

export type GeminiUploadedFile = {
  name: string; // files/{file_id}
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
  uri: string;
  state: GeminiFileState;
  videoMetadata?: {
    videoDuration: string;
  };
};

export type FileUploadOptions = {
  displayName?: string;
  mimeType?: string;
};

// File Manager instance cache
let fileManagerInstance: GeminiFileManager | null = null;

/**
 * Get or create the GeminiFileManager singleton
 */
export function getFileManager(): GeminiFileManager {
  if (fileManagerInstance) return fileManagerInstance;

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const location = process.env.GEMINI_LOCATION || "global";

  fileManagerInstance = new GeminiFileManager(projectId, location);
  return fileManagerInstance;
}

/**
 * GeminiFileManager - Vertex AI Files API wrapper
 *
 * Note: Vertex AI uses a different approach than Google AI Studio.
 * For Vertex AI, we upload files to GCS and reference them via URI.
 */
export class GeminiFileManager {
  private projectId: string;
  private location: string;
  private storage: Storage;
  private vertexAI: VertexAI;

  constructor(projectId: string, location: string) {
    this.projectId = projectId;
    this.location = location;
    this.storage = new Storage({ projectId });
    this.vertexAI = new VertexAI({ project: projectId, location });
  }

  /**
   * Upload a video file for Gemini processing
   *
   * For Vertex AI, we need to ensure the file is in GCS.
   * If it's already in GCS, we return the URI directly.
   * If it's a local file, we upload it to GCS first.
   */
  async uploadVideo(
    sourcePath: string,
    options: FileUploadOptions = {}
  ): Promise<{ uri: string; mimeType: string }> {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_BUCKET not set");

    // Check if source is already a GCS path
    if (sourcePath.startsWith("gs://")) {
      const mimeType = options.mimeType || this.getMimeType(sourcePath);
      logger.info("Using existing GCS file for Gemini", { uri: sourcePath, mimeType });
      return { uri: sourcePath, mimeType };
    }

    // If it's a relative GCS path (no gs:// prefix), construct the full URI
    if (!sourcePath.startsWith("/")) {
      const uri = `gs://${bucket}/${sourcePath}`;
      const mimeType = options.mimeType || this.getMimeType(sourcePath);
      logger.info("Constructed GCS URI for Gemini", { uri, mimeType });
      return { uri, mimeType };
    }

    // It's a local file path - upload to GCS
    const displayName =
      options.displayName || path.basename(sourcePath, path.extname(sourcePath));
    const extension = path.extname(sourcePath);
    const destPath = `gemini-uploads/${displayName}_${Date.now()}${extension}`;
    const mimeType = options.mimeType || this.getMimeType(sourcePath);

    logger.info("Uploading local file to GCS for Gemini", {
      source: sourcePath,
      destination: destPath,
      mimeType,
    });

    const file = this.storage.bucket(bucket).file(destPath);
    const fileSize = statSync(sourcePath).size;

    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(sourcePath);
      const writeStream = file.createWriteStream({
        metadata: {
          contentType: mimeType,
        },
        resumable: fileSize > 5 * 1024 * 1024, // Use resumable upload for > 5MB
      });

      // Handle errors from both streams
      readStream.on("error", (err) => {
        writeStream.destroy();
        reject(new Error(`Read stream error: ${err.message}`));
      });
      writeStream.on("error", (err) => {
        readStream.destroy();
        reject(new Error(`Write stream error: ${err.message}`));
      });

      readStream.pipe(writeStream).on("finish", () => resolve());
    });

    const uri = `gs://${bucket}/${destPath}`;
    logger.info("File uploaded to GCS for Gemini", { uri, sizeBytes: fileSize });

    return { uri, mimeType };
  }

  /**
   * Prepare a video for Gemini analysis from Cloud Storage
   *
   * Downloads the video to a temp location if needed and returns
   * the appropriate URI for Gemini API calls.
   */
  async prepareVideoForGemini(
    storagePath: string,
    matchId: string
  ): Promise<{ uri: string; mimeType: string; localPath?: string }> {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_BUCKET not set");

    // For Vertex AI, we can reference GCS URIs directly
    const uri = storagePath.startsWith("gs://")
      ? storagePath
      : `gs://${bucket}/${storagePath}`;

    const mimeType = this.getMimeType(storagePath);

    logger.info("Prepared video for Gemini", { matchId, uri, mimeType });

    return { uri, mimeType };
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".mkv": "video/x-matroska",
      ".webm": "video/webm",
      ".m4v": "video/x-m4v",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Check if a video can be processed by Gemini
   *
   * Gemini has limits on video size and duration:
   * - Max size: ~2GB for long context models
   * - Max duration: depends on model (Gemini 1.5 Pro supports up to 1 hour)
   */
  async validateVideoForGemini(
    storagePath: string,
    maxDurationSec: number = 7200 // 2 hours default
  ): Promise<{ valid: boolean; reason?: string }> {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_BUCKET not set");

    const gcsPath = storagePath.startsWith("gs://")
      ? storagePath.replace(`gs://${bucket}/`, "")
      : storagePath;

    try {
      const [metadata] = await this.storage.bucket(bucket).file(gcsPath).getMetadata();
      const sizeBytes = parseInt(metadata.size as string, 10);
      const maxSizeBytes = 2 * 1024 * 1024 * 1024; // 2GB

      if (sizeBytes > maxSizeBytes) {
        return {
          valid: false,
          reason: `File size ${(sizeBytes / 1e9).toFixed(2)}GB exceeds Gemini limit of 2GB`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: `Failed to check file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Clean up temporary Gemini upload files older than specified age
   */
  async cleanupOldUploads(maxAgeHours: number = 24): Promise<number> {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) {
      logger.warn("STORAGE_BUCKET not set, skipping cleanup");
      return 0;
    }

    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    try {
      const [files] = await this.storage.bucket(bucket).getFiles({
        prefix: "gemini-uploads/",
      });

      let deletedCount = 0;
      for (const file of files) {
        const created = new Date(file.metadata.timeCreated as string);
        if (created < cutoffTime) {
          await file.delete();
          deletedCount++;
        }
      }

      logger.info("Cleaned up old Gemini uploads", { deletedCount, maxAgeHours });

      return deletedCount;
    } catch (error) {
      logger.error("Failed to cleanup Gemini uploads", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
