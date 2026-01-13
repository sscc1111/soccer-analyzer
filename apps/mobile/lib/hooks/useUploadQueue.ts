import { useState, useEffect, useCallback, useRef } from "react";
import type { ProcessingMode } from "@soccer/shared";
import { useNetworkState } from "./useNetworkState";
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  updateQueueItem,
  getPendingUploads,
  type QueuedUpload,
} from "../upload/queue";

export type UseUploadQueueReturn = {
  /** Current queue items */
  queue: QueuedUpload[];
  /** Whether queue is currently processing uploads */
  isProcessing: boolean;
  /** Add an upload to the queue */
  addUpload: (matchId: string, videoUri: string, mode: ProcessingMode) => Promise<string>;
  /** Cancel/remove an upload from the queue */
  cancelUpload: (id: string) => Promise<void>;
  /** Retry a failed upload */
  retryUpload: (id: string) => Promise<void>;
  /** Manually trigger queue processing (auto-runs when online) */
  processQueue: () => Promise<void>;
  /** Refresh queue from storage */
  refreshQueue: () => Promise<void>;
};

/**
 * Hook for managing upload queue
 *
 * Features:
 * - Queue uploads when offline or user chooses to queue
 * - Auto-process pending uploads when network comes back online
 * - Retry failed uploads with exponential backoff (max 3 retries)
 * - Persist queue in AsyncStorage
 *
 * @example
 * ```tsx
 * const { queue, isProcessing, addUpload, cancelUpload } = useUploadQueue();
 *
 * // Add upload to queue
 * const uploadId = await addUpload(matchId, videoUri, "standard");
 *
 * // Cancel upload
 * await cancelUpload(uploadId);
 *
 * // Show queue status
 * {queue.map(item => (
 *   <Text key={item.id}>{item.status}: {item.matchId}</Text>
 * ))}
 * ```
 */
export function useUploadQueue(): UseUploadQueueReturn {
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { isConnected } = useNetworkState();
  const processingRef = useRef(false);

  /**
   * Load queue from storage
   */
  const refreshQueue = useCallback(async () => {
    const currentQueue = await getQueue();
    setQueue(currentQueue);
  }, []);

  /**
   * Load queue on mount
   */
  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  /**
   * Auto-process queue when network comes back online
   */
  useEffect(() => {
    if (isConnected && !processingRef.current) {
      // Small delay to ensure network is stable
      const timer = setTimeout(() => {
        processQueue();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  /**
   * Add an upload to the queue
   */
  const addUpload = useCallback(
    async (matchId: string, videoUri: string, mode: ProcessingMode) => {
      const uploadId = await addToQueue({
        matchId,
        videoUri,
        processingMode: mode,
      });

      await refreshQueue();

      // If online, immediately try to process
      if (isConnected && !isProcessing) {
        processQueue();
      }

      return uploadId;
    },
    [isConnected, isProcessing, refreshQueue]
  );

  /**
   * Cancel/remove an upload from the queue
   */
  const cancelUpload = useCallback(
    async (id: string) => {
      await removeFromQueue(id);
      await refreshQueue();
    },
    [refreshQueue]
  );

  /**
   * Retry a failed upload
   */
  const retryUpload = useCallback(
    async (id: string) => {
      await updateQueueItem(id, {
        status: "pending",
        error: undefined,
      });
      await refreshQueue();

      // Trigger processing if online
      if (isConnected && !isProcessing) {
        processQueue();
      }
    },
    [isConnected, isProcessing, refreshQueue]
  );

  /**
   * Process pending uploads in the queue
   */
  const processQueue = useCallback(async () => {
    // Prevent concurrent processing
    if (processingRef.current || !isConnected) {
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);

    try {
      const pending = await getPendingUploads();

      // Process uploads sequentially
      for (const upload of pending) {
        try {
          // Mark as uploading
          await updateQueueItem(upload.id, { status: "uploading" });
          await refreshQueue();

          // Call the actual upload function (placeholder for now)
          await uploadVideoWithRetry(upload);

          // Mark as completed
          await updateQueueItem(upload.id, { status: "completed" });
          await refreshQueue();

          // Remove completed uploads after a short delay
          setTimeout(async () => {
            await removeFromQueue(upload.id);
            await refreshQueue();
          }, 2000);
        } catch (error) {
          // Handle upload failure
          const errorMessage = error instanceof Error ? error.message : "Upload failed";
          const newRetryCount = upload.retryCount + 1;

          if (newRetryCount >= 3) {
            // Max retries reached - mark as failed
            await updateQueueItem(upload.id, {
              status: "failed",
              error: errorMessage,
              retryCount: newRetryCount,
            });
          } else {
            // Schedule retry with exponential backoff
            await updateQueueItem(upload.id, {
              status: "pending",
              error: errorMessage,
              retryCount: newRetryCount,
            });

            // Wait before next retry (exponential backoff: 2s, 4s, 8s)
            const backoffMs = Math.pow(2, newRetryCount) * 1000;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }

          await refreshQueue();
        }
      }
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [isConnected, refreshQueue]);

  return {
    queue,
    isProcessing,
    addUpload,
    cancelUpload,
    retryUpload,
    processQueue,
    refreshQueue,
  };
}

/**
 * Placeholder upload function - to be replaced with actual Firebase upload
 * This simulates the upload process for now
 */
async function uploadVideoWithRetry(upload: QueuedUpload): Promise<void> {
  // TODO: Replace with actual uploadVideo call from firebase/storage.ts
  // For now, this is a placeholder that simulates an upload

  console.log(`[Upload Queue] Processing upload ${upload.id} for match ${upload.matchId}`);

  // Simulate upload with random success/failure for testing
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // Simulate 80% success rate for testing
      if (Math.random() > 0.2) {
        console.log(`[Upload Queue] Upload ${upload.id} completed successfully`);
        resolve();
      } else {
        console.log(`[Upload Queue] Upload ${upload.id} failed`);
        reject(new Error("Simulated upload failure"));
      }
    }, 2000);
  });

  // Real implementation would be:
  /*
  import { uploadVideo } from "../firebase/storage";

  await uploadVideo(upload.matchId, upload.videoUri, (progress) => {
    console.log(`Upload progress: ${progress.progress}%`);
    // Optionally update queue item with progress
  });
  */
}
