# Upload Queue System

Offline-first upload queue management for video uploads with automatic retry and exponential backoff.

## Overview

The upload queue system enables:

- **Offline queueing**: Store upload requests when offline
- **Auto-processing**: Automatically process queue when network returns
- **Retry logic**: Exponential backoff with max 3 retries
- **Persistence**: Queue stored in AsyncStorage
- **Status tracking**: Monitor upload status in real-time

## Architecture

```
lib/upload/
├── queue.ts          # Core queue management (AsyncStorage)
├── index.ts          # Public exports
└── README.md         # This file

lib/hooks/
└── useUploadQueue.ts # React hook for queue integration
```

## Usage

### Basic Usage

```tsx
import { useUploadQueue } from "../lib/hooks";

function UploadScreen() {
  const { queue, isProcessing, addUpload, cancelUpload } = useUploadQueue();

  const handleUpload = async () => {
    const uploadId = await addUpload(matchId, videoUri, "standard");
    console.log("Upload queued:", uploadId);
  };

  return (
    <View>
      {queue.map((item) => (
        <Text key={item.id}>
          {item.matchId}: {item.status}
        </Text>
      ))}

      <Button onPress={handleUpload}>Upload</Button>
    </View>
  );
}
```

### Queue Status Component

```tsx
import { UploadQueueStatus } from "../components/UploadQueueStatus";

function HomeScreen() {
  return (
    <View>
      <UploadQueueStatus />
      {/* Other content */}
    </View>
  );
}
```

## API Reference

### `useUploadQueue()` Hook

Returns an object with:

#### Properties

- `queue: QueuedUpload[]` - Current queue items
- `isProcessing: boolean` - Whether queue is currently processing

#### Methods

- `addUpload(matchId, videoUri, mode): Promise<string>` - Add upload to queue
- `cancelUpload(id): Promise<void>` - Cancel/remove upload
- `retryUpload(id): Promise<void>` - Retry a failed upload
- `processQueue(): Promise<void>` - Manually trigger queue processing
- `refreshQueue(): Promise<void>` - Reload queue from storage

### Core Queue Functions

#### `addToQueue(upload): Promise<string>`

Add an upload to the queue.

```typescript
import { addToQueue } from "@soccer/mobile/lib/upload";

const uploadId = await addToQueue({
  matchId: "match_123",
  videoUri: "file:///path/to/video.mp4",
  processingMode: "standard",
});
```

#### `getQueue(): Promise<QueuedUpload[]>`

Get all queued uploads.

```typescript
import { getQueue } from "@soccer/mobile/lib/upload";

const queue = await getQueue();
console.log(`${queue.length} uploads in queue`);
```

#### `updateQueueItem(id, updates): Promise<void>`

Update a queue item.

```typescript
import { updateQueueItem } from "@soccer/mobile/lib/upload";

await updateQueueItem(uploadId, {
  status: "uploading",
});
```

#### `removeFromQueue(id): Promise<void>`

Remove an upload from the queue.

```typescript
import { removeFromQueue } from "@soccer/mobile/lib/upload";

await removeFromQueue(uploadId);
```

#### `getPendingUploads(): Promise<QueuedUpload[]>`

Get only pending uploads.

```typescript
import { getPendingUploads } from "@soccer/mobile/lib/upload";

const pending = await getPendingUploads();
```

## Types

### `QueuedUpload`

```typescript
type QueuedUpload = {
  id: string;                    // Unique upload ID
  matchId: string;               // Associated match ID
  videoUri: string;              // Local video file URI
  processingMode: ProcessingMode; // quick | standard | detailed
  queuedAt: string;              // ISO timestamp
  retryCount: number;            // Current retry count
  status: "pending" | "uploading" | "completed" | "failed";
  error?: string;                // Error message if failed
};
```

## Behavior

### Auto-Processing

The queue automatically processes pending uploads when:

1. Network connectivity is restored (detected via `useNetworkState`)
2. A new upload is added while online
3. User manually triggers `processQueue()`

### Retry Logic

Failed uploads are automatically retried with exponential backoff:

- 1st retry: 2 seconds delay
- 2nd retry: 4 seconds delay
- 3rd retry: 8 seconds delay
- After 3 retries: marked as "failed"

### Cleanup

Completed uploads are automatically removed from the queue after 2 seconds.

## Integration Example

### Modify `upload.tsx` to use queue

```typescript
import { useUploadQueue, useNetworkState } from "../lib/hooks";

export default function UploadScreen() {
  const { addUpload } = useUploadQueue();
  const { isConnected } = useNetworkState();

  const handleUpload = async () => {
    if (!videoUri) return;

    if (!isConnected) {
      // Queue for later
      await addUpload(matchId, videoUri, processingMode);
      toast({ title: "Queued for upload when online", variant: "success" });
      router.back();
    } else {
      // Upload immediately or queue
      const uploadId = await addUpload(matchId, videoUri, processingMode);
      // Queue will auto-process
    }
  };

  return (
    <View>
      {!isConnected && (
        <Banner variant="warning">
          Offline mode - uploads will be queued
        </Banner>
      )}
      {/* Rest of UI */}
    </View>
  );
}
```

## Storage

Queue is persisted in AsyncStorage under the key:

```
@soccer-analyzer/upload-queue
```

Data format: JSON array of `QueuedUpload` objects.

## TODO

- [ ] Replace placeholder `uploadVideoWithRetry` with actual Firebase upload
- [ ] Add upload progress tracking to queue items
- [ ] Support pausing/resuming uploads
- [ ] Add background upload support (requires expo-task-manager)
- [ ] Implement queue size limits
- [ ] Add analytics/telemetry for queue operations

## Testing

### Manual Testing

1. Enable airplane mode
2. Try to upload a video
3. Check queue shows pending upload
4. Disable airplane mode
5. Queue should auto-process

### Simulated Failures

The current implementation simulates 20% failure rate for testing retry logic.
Replace `uploadVideoWithRetry` in `useUploadQueue.ts` with actual Firebase upload.
