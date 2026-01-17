import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ProcessingMode, VideoType } from "@soccer/shared";

const QUEUE_KEY = "@soccer-analyzer/upload-queue";

// P0: Race condition防止用のロック機構
let queueLock: Promise<void> | null = null;

/**
 * P0: 排他制御付きでqueue操作を実行
 * 並行実行時のread-modify-writeによるデータ損失を防ぐ
 */
async function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  // 既存のロックが解放されるまで待機
  while (queueLock) {
    await queueLock;
  }

  let resolveLock: () => void;
  queueLock = new Promise((resolve) => {
    resolveLock = resolve;
  });

  try {
    return await operation();
  } finally {
    queueLock = null;
    resolveLock!();
  }
}

export type QueuedUpload = {
  id: string;
  matchId: string;
  videoUri: string;
  processingMode: ProcessingMode;
  /** Video type for subcollection uploads */
  videoType: VideoType;
  /** Video document ID in Firestore (if created) */
  videoId?: string;
  queuedAt: string;
  retryCount: number;
  status: "pending" | "uploading" | "completed" | "failed";
  error?: string;
};

/**
 * Add an upload to the queue
 * @param upload - Upload details without id, queuedAt, retryCount, and status (auto-generated)
 * @returns The generated upload ID
 */
export async function addToQueue(
  upload: Omit<QueuedUpload, "id" | "queuedAt" | "retryCount" | "status">
): Promise<string> {
  // P0: 排他制御でrace conditionを防止
  return withQueueLock(async () => {
    const queue = await getQueue();

    const newUpload: QueuedUpload = {
      ...upload,
      id: generateUploadId(),
      queuedAt: new Date().toISOString(),
      retryCount: 0,
      status: "pending",
    };

    queue.push(newUpload);
    await saveQueue(queue);

    return newUpload.id;
  });
}

/**
 * Get all queued uploads
 * @returns Array of queued uploads
 */
export async function getQueue(): Promise<QueuedUpload[]> {
  try {
    const json = await AsyncStorage.getItem(QUEUE_KEY);
    if (!json) return [];

    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to load upload queue:", error);
    return [];
  }
}

/**
 * Remove an upload from the queue
 * @param id - Upload ID to remove
 */
export async function removeFromQueue(id: string): Promise<void> {
  // P0: 排他制御でrace conditionを防止
  return withQueueLock(async () => {
    const queue = await getQueue();
    const filtered = queue.filter((item) => item.id !== id);
    await saveQueue(filtered);
  });
}

/**
 * Update a queue item
 * @param id - Upload ID to update
 * @param updates - Partial updates to apply
 */
export async function updateQueueItem(
  id: string,
  updates: Partial<Omit<QueuedUpload, "id">>
): Promise<void> {
  // P0: 排他制御でrace conditionを防止
  return withQueueLock(async () => {
    const queue = await getQueue();
    const index = queue.findIndex((item) => item.id === id);

    if (index === -1) {
      throw new Error(`Upload with id ${id} not found in queue`);
    }

    queue[index] = { ...queue[index], ...updates };
    await saveQueue(queue);
  });
}

/**
 * Clear all items from the queue
 */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/**
 * Get a specific upload by ID
 * @param id - Upload ID
 * @returns The upload or null if not found
 */
export async function getUploadById(id: string): Promise<QueuedUpload | null> {
  const queue = await getQueue();
  return queue.find((item) => item.id === id) || null;
}

/**
 * Get pending uploads (status = pending)
 * @returns Array of pending uploads
 */
export async function getPendingUploads(): Promise<QueuedUpload[]> {
  const queue = await getQueue();
  return queue.filter((item) => item.status === "pending");
}

/**
 * Get failed uploads that can be retried
 * @param maxRetries - Maximum retry count to filter
 * @returns Array of failed uploads
 */
export async function getRetriableUploads(maxRetries = 3): Promise<QueuedUpload[]> {
  const queue = await getQueue();
  return queue.filter(
    (item) => item.status === "failed" && item.retryCount < maxRetries
  );
}

// --- Helper functions ---

/**
 * Save queue to AsyncStorage
 */
async function saveQueue(queue: QueuedUpload[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error("Failed to save upload queue:", error);
    throw error;
  }
}

/**
 * Generate a unique upload ID
 */
function generateUploadId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
