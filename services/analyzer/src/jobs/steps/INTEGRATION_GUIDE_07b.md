# Integration Guide: Step 07b Windowed Event Detection

## Quick Start

### 1. Import the Step

```typescript
import { stepDetectEventsWindowed, type VideoSegment } from "./steps/07b_detectEventsWindowed";
```

### 2. Prepare Video Segments

You have two options:

#### Option A: Use existing segments (from Step 07a)
```typescript
// If Step 07a is implemented
const segments = await getVideoSegments(matchId);
```

#### Option B: Generate from ImportantScenes
```typescript
import { getDb } from "../../firebase/admin";

async function convertScenesToSegments(matchId: string): Promise<VideoSegment[]> {
  const db = getDb();
  const scenesSnap = await db
    .collection("matches")
    .doc(matchId)
    .collection("importantScenes")
    .orderBy("startSec")
    .get();

  return scenesSnap.docs.map((doc) => {
    const scene = doc.data();
    return {
      segmentId: doc.id,
      startSec: scene.startSec,
      endSec: scene.endSec,
      type: mapSceneTypeToSegmentType(scene.type),
      description: scene.description,
      team: scene.team || "unknown",
      importance: scene.importance,
    };
  });
}

function mapSceneTypeToSegmentType(sceneType: string): "active_play" | "set_piece" | "goal_moment" | "stoppage" {
  switch (sceneType) {
    case "shot":
    case "chance":
      return "active_play";
    case "setPiece":
      return "set_piece";
    case "goal":
      return "goal_moment";
    default:
      return "active_play";
  }
}
```

### 3. Run the Detection

```typescript
const result = await stepDetectEventsWindowed({
  matchId: "your_match_id",
  version: "v1",
  segments: segments,
  logger: customLogger, // optional
});
```

### 4. Process Results

```typescript
console.log(`Detected ${result.rawEventCount} raw events`);
console.log(`Events by type:`, result.eventsByType);

// Access raw events
for (const event of result.rawEvents) {
  console.log(`${event.type} at ${event.absoluteTimestamp}s by ${event.team}`);
}
```

## Integration into Pipeline (runMatchPipeline.ts)

### Add to Pipeline Steps

```typescript
// File: services/analyzer/src/jobs/runMatchPipeline.ts

import { stepDetectEventsWindowed } from "./steps/07b_detectEventsWindowed";
import { convertScenesToSegments } from "./steps/07b_helpers"; // Your converter

// ... existing imports

async function runMatchPipeline(matchId: string, version: string) {
  // ... existing steps (01-06)

  // Step 07a: Segment video (or convert from scenes)
  log.info("Step 07a: Preparing video segments");
  const segments = await convertScenesToSegments(matchId);

  // Step 07b: Windowed event detection
  log.info("Step 07b: Detecting events with windowed analysis");
  const windowedResult = await stepDetectEventsWindowed({
    matchId,
    version,
    segments,
    logger: log,
  });

  // Step 07c: Deduplicate events (next phase)
  log.info("Step 07c: Deduplicating events");
  const finalEvents = await deduplicateEvents(windowedResult.rawEvents);

  // Step 08: Save to Firestore
  log.info("Step 08: Saving events to Firestore");
  await saveEventsToFirestore(matchId, version, finalEvents);

  // ... continue pipeline
}
```

## Helper Functions

### 1. Scene to Segment Converter

```typescript
// File: services/analyzer/src/jobs/steps/07b_helpers.ts

import { getDb } from "../../firebase/admin";
import type { VideoSegment } from "./07b_detectEventsWindowed";
import type { SceneType } from "@soccer/shared";

export async function convertScenesToSegments(matchId: string): Promise<VideoSegment[]> {
  const db = getDb();
  const scenesSnap = await db
    .collection("matches")
    .doc(matchId)
    .collection("importantScenes")
    .orderBy("startSec")
    .get();

  if (scenesSnap.empty) {
    throw new Error(`No scenes found for match ${matchId}`);
  }

  return scenesSnap.docs.map((doc, index) => {
    const scene = doc.data();
    return {
      segmentId: doc.id,
      startSec: scene.startSec,
      endSec: scene.endSec,
      type: mapSceneTypeToSegmentType(scene.type),
      description: scene.description,
      team: scene.team,
      importance: scene.importance,
    };
  });
}

function mapSceneTypeToSegmentType(sceneType: SceneType): VideoSegment["type"] {
  const mapping: Record<SceneType, VideoSegment["type"]> = {
    shot: "active_play",
    chance: "active_play",
    setPiece: "set_piece",
    goal: "goal_moment",
    save: "goal_moment",
    dribble: "active_play",
    defense: "active_play",
    turnover: "active_play",
    other: "active_play",
  };
  return mapping[sceneType] || "active_play";
}
```

### 2. Result Logger

```typescript
export function logWindowedDetectionResults(result: DetectEventsWindowedResult) {
  console.log("\n=== Windowed Detection Results ===");
  console.log(`Match ID: ${result.matchId}`);
  console.log(`Windows Analyzed: ${result.windowCount}`);
  console.log(`Raw Events Detected: ${result.rawEventCount}`);
  console.log("\nEvents by Type:");

  for (const [type, count] of Object.entries(result.eventsByType)) {
    const percentage = ((count / result.rawEventCount) * 100).toFixed(1);
    console.log(`  ${type.padEnd(12)}: ${count.toString().padStart(4)} (${percentage}%)`);
  }

  console.log("\nNext Step: Deduplication (07c)");
}
```

## Error Handling

### Handle No Cache Scenario

```typescript
try {
  const result = await stepDetectEventsWindowed({
    matchId,
    version,
    segments,
  });

  if (result.rawEventCount === 0) {
    console.warn("No events detected. Check:");
    console.warn("- Video cache exists and is valid");
    console.warn("- Segments are not all stoppage type");
    console.warn("- Gemini API is accessible");
  }
} catch (error) {
  if (error.message.includes("No valid cache")) {
    console.error("Video not cached. Run step 03 (uploadVideoToGemini) first.");
  } else if (error.message.includes("Gemini blocked")) {
    console.error("Content blocked by safety filters");
  } else {
    throw error;
  }
}
```

### Handle API Quota Limits

```typescript
import { sleep } from "../../lib/utils";

async function runWithQuotaRetry() {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await stepDetectEventsWindowed({
        matchId,
        version,
        segments,
      });
    } catch (error) {
      if (error.message.includes("429") || error.message.includes("quota")) {
        attempt++;
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.warn(`API quota limit hit. Waiting ${waitTime}ms before retry ${attempt}/${maxRetries}`);
        await sleep(waitTime);
      } else {
        throw error;
      }
    }
  }

  throw new Error("Max retries exceeded for API quota");
}
```

## Testing Integration

### Unit Test Template

```typescript
// File: services/analyzer/src/jobs/__tests__/integration_07b.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { stepDetectEventsWindowed } from "../steps/07b_detectEventsWindowed";
import { convertScenesToSegments } from "../steps/07b_helpers";

describe("Step 07b Integration", () => {
  it("should integrate with scene extraction", async () => {
    const matchId = "test_match_with_scenes";

    // Ensure scenes exist
    const segments = await convertScenesToSegments(matchId);
    expect(segments.length).toBeGreaterThan(0);

    // Run detection
    const result = await stepDetectEventsWindowed({
      matchId,
      version: "test",
      segments,
    });

    expect(result.rawEventCount).toBeGreaterThan(0);
    expect(result.windowCount).toBeGreaterThan(0);
  });
});
```

## Performance Optimization

### 1. Parallel Match Processing

```typescript
async function processMultipleMatches(matchIds: string[]) {
  const results = await Promise.all(
    matchIds.map(async (matchId) => {
      const segments = await convertScenesToSegments(matchId);
      return stepDetectEventsWindowed({
        matchId,
        version: "v1",
        segments,
      });
    })
  );

  return results;
}
```

### 2. Batch Processing with Rate Limiting

```typescript
import pLimit from "p-limit";

async function processBatchWithLimit(matchIds: string[], concurrency = 3) {
  const limit = pLimit(concurrency);

  const results = await Promise.all(
    matchIds.map((matchId) =>
      limit(async () => {
        const segments = await convertScenesToSegments(matchId);
        return stepDetectEventsWindowed({
          matchId,
          version: "v1",
          segments,
        });
      })
    )
  );

  return results;
}
```

## Monitoring and Logging

### Add Telemetry

```typescript
import { performance } from "perf_hooks";

async function runWithTelemetry(matchId: string, segments: VideoSegment[]) {
  const startTime = performance.now();

  const result = await stepDetectEventsWindowed({
    matchId,
    version: "v1",
    segments,
  });

  const duration = performance.now() - startTime;

  // Log metrics
  console.log("Telemetry:", {
    matchId,
    duration: `${(duration / 1000).toFixed(2)}s`,
    windowCount: result.windowCount,
    rawEventCount: result.rawEventCount,
    eventsPerWindow: (result.rawEventCount / result.windowCount).toFixed(2),
    eventsPerSecond: (result.rawEventCount / (duration / 1000)).toFixed(2),
  });

  return result;
}
```

## Next Steps

After integrating Step 07b, implement:

1. **Step 07c: Event Deduplication**
   - Merge duplicate events from overlapping windows
   - Choose highest confidence detections
   - Ensure temporal consistency

2. **Database Persistence**
   - Convert RawEvent to domain event types
   - Batch write to Firestore
   - Update match metadata

3. **Step 08: Stats Computation**
   - Use deduplicated events
   - Calculate possession, passes, etc.
   - Generate match statistics

## Troubleshooting

### Issue: Empty results
**Check:**
- Video cache exists (`matches/{matchId}/geminiCache`)
- Segments are not all stoppage type
- Gemini API credentials are valid
- Firestore rules allow reading cache

### Issue: Slow processing
**Solutions:**
- Increase parallelism (default: 5)
- Use Gemini caching to reduce API calls
- Skip stoppage segments (enabled by default)

### Issue: High costs
**Solutions:**
- Enable context caching (automatic)
- Adjust segment types to skip low-value segments
- Use lower FPS for less important segments

## Support

For questions or issues:
1. Check documentation: `07b_detectEventsWindowed.md`
2. Run examples: `__examples__/07b_windowed_detection_example.ts`
3. Review tests: `__tests__/07b_detectEventsWindowed.test.ts`
