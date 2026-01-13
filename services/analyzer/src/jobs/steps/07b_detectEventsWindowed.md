# Step 07b: Windowed Event Detection

**Phase:** 2.2 - Windowed Analysis
**Status:** ✅ Implemented
**Dependencies:** Step 07a (Video Segmentation), Gemini Cache Manager

## Overview

This step implements windowed event detection for soccer video analysis. Instead of analyzing the entire video at once, it breaks video segments into overlapping windows for more accurate and granular event detection.

## Architecture

```
Video Segments (from 07a)
    ↓
Generate Overlapping Windows (60s with 15s overlap)
    ↓
Process Windows in Parallel (5 concurrent)
    ↓
Detect Events per Window (Gemini API)
    ↓
Convert to Absolute Timestamps
    ↓
Return Raw Events (for deduplication in 07c)
```

## Key Features

### 1. Window Generation

- **Default Window Size:** 60 seconds
- **Overlap:** 15 seconds (25% overlap between consecutive windows)
- **Adaptive FPS by Segment Type:**
  - `active_play`: 3 FPS
  - `set_piece`: 2 FPS
  - `goal_moment`: 5 FPS
  - `stoppage`: 1 FPS (or skipped entirely)

### 2. Segment Handling

- Short segments (<60s): Single window covering entire segment
- Long segments (≥60s): Multiple overlapping windows
- Stoppage segments: Skipped by default to save API costs
- Safety limit: Max 100 windows per segment

### 3. Parallel Processing

- Process up to 5 windows concurrently
- Batched execution to prevent API rate limits
- Retry logic with exponential backoff (3 retries per window)
- 3-minute timeout per window

### 4. Event Detection

Uses Gemini 3 Flash with:
- Event detection v2 prompt (high-precision mode)
- Window-specific context injection
- Confidence filtering (events <0.5 excluded)
- Visual evidence requirements

## Data Structures

### Input Types

```typescript
interface VideoSegment {
  segmentId: string;
  startSec: number;
  endSec: number;
  type: "active_play" | "set_piece" | "goal_moment" | "stoppage";
  description?: string;
  team?: "home" | "away" | "unknown";
  importance?: number;
}
```

### Output Types

```typescript
interface RawEvent {
  windowId: string;
  relativeTimestamp: number;  // Relative to window start
  absoluteTimestamp: number;  // Relative to video start
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece";
  team: "home" | "away";
  player?: string;
  zone?: "defensive_third" | "middle_third" | "attacking_third";
  details: {
    passType?: "short" | "medium" | "long" | "through" | "cross";
    outcome?: "complete" | "incomplete" | "intercepted";
    // ... other event-specific details
  };
  confidence: number;
  visualEvidence?: string;
}
```

### Internal Types

```typescript
interface AnalysisWindow {
  windowId: string;
  absoluteStart: number;
  absoluteEnd: number;
  overlap: { before: number; after: number };
  targetFps: number;
  segmentContext: VideoSegment;
}
```

## Usage

```typescript
import { stepDetectEventsWindowed } from "./steps/07b_detectEventsWindowed";

const result = await stepDetectEventsWindowed({
  matchId: "match_123",
  version: "v1",
  segments: [
    {
      segmentId: "seg1",
      startSec: 0,
      endSec: 120,
      type: "active_play",
    },
    // ... more segments
  ],
  logger: customLogger, // optional
});

console.log(result.rawEventCount); // Total events detected
console.log(result.eventsByType);  // { pass: 45, carry: 23, ... }
console.log(result.rawEvents);     // Array of RawEvent objects
```

## Window Overlap Strategy

### Why Overlap?

Events that occur near window boundaries might be:
- Partially visible in one window
- Missed if split across windows
- Detected with lower confidence

**Solution:** 15-second overlap ensures events near boundaries appear in 2 consecutive windows.

### Example

```
Segment: 0s → 200s (active_play)

Window 0:   0s → 60s   [overlap after: 15s]
Window 1:  45s → 105s  [overlap before: 15s, after: 15s]
Window 2:  90s → 150s  [overlap before: 15s, after: 15s]
Window 3: 135s → 195s  [overlap before: 15s, after: 15s]
Window 4: 180s → 200s  [overlap before: 15s]
```

Events between 45-60s appear in both Window 0 and Window 1, allowing deduplication step (07c) to choose the best detection.

## Performance Characteristics

### API Costs

- **With Caching:** ~90% cost reduction after first analysis
- **Without Caching:** Full cost per window
- **Stoppage Skipping:** 20-30% cost savings in typical matches

### Processing Time

Example: 30-minute match video
- Segments: ~20 segments (15 active_play, 3 set_piece, 2 goal_moment)
- Windows: ~60 windows total
- Batches: 12 batches (5 windows per batch)
- Time: ~15-20 minutes (assuming 60-90s per window with retries)

### Rate Limits

- Max concurrent requests: 5 (configurable)
- Retry strategy: 3 attempts with exponential backoff
- Timeout per window: 3 minutes

## Configuration

Environment variables:
- `GEMINI_MODEL`: Model to use (default: `gemini-3-flash-preview`)
- `PROMPT_VERSION`: Prompt version (default: `v2`)
- `GCP_PROJECT_ID`: Google Cloud project ID (required)

Internal configuration (in code):
```typescript
const WINDOW_CONFIG = {
  defaultDurationSec: 60,
  overlapSec: 15,
  fpsBySegment: {
    active_play: 3,
    set_piece: 2,
    goal_moment: 5,
    stoppage: 1,
  },
  parallelism: 5,
  skipStoppages: true,
};
```

## Error Handling

### Recoverable Errors
- **API Rate Limits:** Retry with exponential backoff
- **Timeout:** Retry up to 3 times
- **Partial Block:** Skip blocked windows, continue with others

### Non-Recoverable Errors
- **No Video Cache:** Return empty result
- **Invalid Prompt:** Fail fast
- **Authentication Failure:** Fail fast

## Integration Points

### Upstream (Step 07a)
- Receives `VideoSegment[]` from segmentation step
- If 07a not implemented, can generate segments from `ImportantSceneDoc`

### Downstream (Step 07c)
- Outputs `RawEvent[]` for deduplication
- Events from overlapping windows need merging
- Duplicate detection based on timestamp proximity and confidence

### Database
- **Reads:** Gemini cache documents (`matches/{matchId}/geminiCache`)
- **Writes:** None (in-memory processing only)
- **Updates:** Cache usage metadata (via CacheManager)

## Testing

### Unit Tests
```bash
cd services/analyzer
pnpm test 07b_detectEventsWindowed.test.ts
```

Coverage:
- ✅ Window generation logic
- ✅ Overlap calculations
- ✅ Segment type FPS mapping
- ✅ Edge cases (empty, short, long segments)
- ✅ Safety limits
- ✅ Configuration exposure

### Integration Tests
```bash
pnpm test:integration 07b
```

Tests with:
- Real Gemini API calls
- Sample video segments
- Cache manager integration
- End-to-end flow

## Future Enhancements

### Short Term
1. **Adaptive Window Size:** Adjust window size based on segment type
2. **Smart Overlap:** Reduce overlap in low-activity segments
3. **Confidence Calibration:** Learn optimal confidence thresholds

### Medium Term
1. **Multi-Model Support:** Use different models for different segment types
2. **Progressive Analysis:** Return results as windows complete
3. **Cost Optimization:** Dynamic batching based on cache hit rate

### Long Term
1. **Temporal Attention:** Focus analysis on high-motion regions
2. **Cross-Window Context:** Pass previous window results as context
3. **Adaptive FPS:** Automatically adjust FPS based on video quality

## Troubleshooting

### Issue: Too many windows generated
**Symptom:** Warning "Too many windows generated for segment"
**Cause:** Very long segments (>1 hour)
**Solution:** Safety limit caps at 100 windows per segment

### Issue: No events detected
**Symptom:** `rawEventCount: 0`
**Cause:** All events below confidence threshold (0.5)
**Solution:** Check video quality, adjust prompt, or lower threshold

### Issue: API timeout
**Symptom:** "Timeout" errors in logs
**Cause:** Network issues or complex video analysis
**Solution:** Automatic retry (3 attempts) with exponential backoff

### Issue: High API costs
**Symptom:** Unexpected billing increase
**Cause:** Cache not being reused
**Solution:** Check cache TTL, verify cache manager configuration

## References

- [Gemini API Documentation](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini)
- [Event Detection v2 Prompt](../gemini/prompts/event_detection_v2.json)
- [Cache Manager](../../gemini/cacheManager.ts)
- [Phase 2 Implementation Plan](../../../../../../PHASE_2_IMPLEMENTATION.md)
