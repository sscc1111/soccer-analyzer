# Gemini API Cost Tracking

This module provides comprehensive cost tracking for Gemini API usage with context caching support.

## Features

- Track individual API call costs
- Aggregate costs per match
- Calculate savings from context caching
- Detailed breakdown by pipeline step
- Automatic cost calculations based on current pricing

## Quick Start

```typescript
import { getCostTracker, createCostRecordBuilder } from './costTracker';
import { getDb } from '../firebase/admin';

const db = getDb();
const costTracker = getCostTracker(db);

// Create cost record
const costRecord = createCostRecordBuilder(matchId, 'detect_events_gemini');

// After Gemini API call
costRecord.inputTokens = usageMetadata.promptTokenCount || 0;
costRecord.outputTokens = usageMetadata.candidatesTokenCount || 0;
costRecord.cachedInputTokens = usageMetadata.cachedContentTokenCount || 0;
costRecord.usedCache = costRecord.cachedInputTokens > 0;

// Record cost
await costTracker.recordCost(costRecord);
```

## Data Model

### CostRecord (Individual API Call)
Stored at: `matches/{matchId}/costRecords/{requestId}`

```typescript
{
  matchId: string;
  requestId: string;  // Auto-generated UUID
  step: string;        // e.g., 'detect_events_gemini'
  timestamp: string;   // ISO 8601
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  inputCost: number;   // USD, calculated
  outputCost: number;  // USD, calculated
  totalCost: number;   // USD, calculated
  usedCache: boolean;
  cacheId?: string;    // Optional cache identifier
}
```

### MatchCostSummary (Aggregated)
Stored at: `matches/{matchId}/costTracking/summary`

```typescript
{
  matchId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCost: number;                  // Actual cost with caching
  estimatedCostWithoutCache: number;  // What it would cost without caching
  savings: number;                    // USD saved
  savingsPercent: number;             // % saved
  requestCount: number;
  createdAt: string;
  updatedAt: string;
}
```

## Current Pricing (Gemini 1.5 Flash)

| Token Type | Price per 1M tokens |
|------------|---------------------|
| Input | $0.075 |
| Output | $0.30 |
| Cached Input | $0.01875 (75% discount) |

**Note:** Context Cache Storage: $1.00 per 1M tokens per hour (not tracked by this module)

## API Reference

### CostTracker Class

#### `recordCost(record: Omit<CostRecord, 'inputCost' | 'outputCost' | 'totalCost'>): Promise<CostRecord>`
Records a single API call cost and updates the match summary.

```typescript
const costRecord = createCostRecordBuilder(matchId, 'step_name');
costRecord.inputTokens = 1000;
costRecord.outputTokens = 500;
costRecord.cachedInputTokens = 800;
costRecord.usedCache = true;

await costTracker.recordCost(costRecord);
```

#### `getMatchCostSummary(matchId: string): Promise<MatchCostSummary | null>`
Retrieves the aggregated cost summary for a match.

```typescript
const summary = await costTracker.getMatchCostSummary(matchId);
console.log(`Total cost: ${formatCost(summary.totalCost)}`);
console.log(`Savings: ${summary.savingsPercent.toFixed(1)}%`);
```

#### `updateMatchCostSummary(matchId: string): Promise<void>`
Manually recalculates the match cost summary (automatically called by `recordCost`).

```typescript
await costTracker.updateMatchCostSummary(matchId);
```

#### `getCostBreakdownByStep(matchId: string): Promise<Array<StepBreakdown>>`
Returns detailed cost breakdown grouped by pipeline step.

```typescript
const breakdown = await costTracker.getCostBreakdownByStep(matchId);
for (const step of breakdown) {
  console.log(`${step.step}: ${formatCost(step.totalCost)}`);
}
```

#### `static calculateCost(inputTokens, outputTokens, cachedInputTokens): CostBreakdown`
Calculate costs without recording to database.

```typescript
const { inputCost, outputCost, totalCost } = CostTracker.calculateCost(
  1000,  // input tokens
  500,   // output tokens
  800    // cached input tokens
);
```

### Utility Functions

#### `getCostTracker(db?: Firestore): CostTracker`
Get or create the singleton CostTracker instance.

```typescript
const costTracker = getCostTracker(db);
```

#### `createCostRecordBuilder(matchId: string, step: string): CostRecord`
Create a new cost record with auto-generated requestId and timestamp.

```typescript
const record = createCostRecordBuilder(matchId, 'detect_events_gemini');
```

#### `formatCost(usd: number): string`
Format USD amount with appropriate precision.

```typescript
formatCost(0.002345) // => "$0.0023"
formatCost(1.234567) // => "$1.23"
```

#### `formatTokenCount(tokens: number): string`
Format token count with appropriate unit.

```typescript
formatTokenCount(1234)      // => "1.2K tokens"
formatTokenCount(1234567)   // => "1.2M tokens"
```

## Integration Examples

### Basic Integration

```typescript
async function detectEventsWithCostTracking(matchId: string, videoPath: string) {
  const costTracker = getCostTracker(getDb());
  const costRecord = createCostRecordBuilder(matchId, 'detect_events_gemini');

  try {
    const response = await geminiClient.detectEvents(videoPath);

    // Extract usage metadata
    const usage = response.usageMetadata;
    costRecord.inputTokens = usage.promptTokenCount || 0;
    costRecord.outputTokens = usage.candidatesTokenCount || 0;
    costRecord.cachedInputTokens = usage.cachedContentTokenCount || 0;
    costRecord.usedCache = costRecord.cachedInputTokens > 0;

    // Record cost (don't fail on error)
    await costTracker.recordCost(costRecord).catch(console.error);

    return response;
  } catch (error) {
    // Try to record partial costs even on error
    await costTracker.recordCost(costRecord).catch(() => {});
    throw error;
  }
}
```

### With Cache ID Tracking

```typescript
const cacheManager = getCacheManager();
const cache = await cacheManager.getOrCreateCache(matchId, videoFile);

const costRecord = createCostRecordBuilder(matchId, 'label_clips_gemini');
costRecord.cacheId = cache.name; // Track which cache was used

// ... make API call with cache ...

await costTracker.recordCost(costRecord);
```

### Pipeline Integration

```typescript
export async function runMatchPipeline(matchId: string) {
  const steps = [
    { name: 'extract_scenes', fn: extractScenes },
    { name: 'detect_events', fn: detectEvents },
    { name: 'identify_players', fn: identifyPlayers },
  ];

  for (const step of steps) {
    const costRecord = createCostRecordBuilder(matchId, step.name);

    const result = await step.fn(matchId);

    if (result.usageMetadata) {
      costRecord.inputTokens = result.usageMetadata.promptTokenCount || 0;
      costRecord.outputTokens = result.usageMetadata.candidatesTokenCount || 0;
      costRecord.cachedInputTokens = result.usageMetadata.cachedContentTokenCount || 0;
      costRecord.usedCache = costRecord.cachedInputTokens > 0;

      await costTracker.recordCost(costRecord).catch(console.error);
    }
  }

  // Get final summary
  const summary = await costTracker.getMatchCostSummary(matchId);
  console.log(`Total cost: ${formatCost(summary.totalCost)}`);
  console.log(`Cache savings: ${formatCost(summary.savings)}`);
}
```

## Querying Cost Data

### Get Summary via Firebase Console
```
matches/{matchId}/costTracking/summary
```

### Get Individual Records via Firebase Console
```
matches/{matchId}/costRecords
```

### Query in Code

```typescript
// Get all cost records for a match
const records = await db
  .collection('matches')
  .doc(matchId)
  .collection('costRecords')
  .orderBy('timestamp', 'desc')
  .get();

// Get records for a specific step
const stepRecords = await db
  .collection('matches')
  .doc(matchId)
  .collection('costRecords')
  .where('step', '==', 'detect_events_gemini')
  .get();

// Get records that used cache
const cachedRecords = await db
  .collection('matches')
  .doc(matchId)
  .collection('costRecords')
  .where('usedCache', '==', true)
  .get();
```

## Best Practices

1. **Always record costs**: Even on API failures, try to record partial costs if usage metadata is available.

2. **Don't fail operations on cost tracking errors**: Wrap cost recording in try-catch to prevent tracking failures from breaking main functionality.

3. **Use descriptive step names**: Use consistent, descriptive names for steps to enable meaningful analysis (e.g., `detect_events_gemini`, `extract_scenes_v2`).

4. **Track cache IDs**: Include cache IDs to analyze which caches are most effective.

5. **Regular analysis**: Periodically review cost summaries to identify optimization opportunities.

6. **Update pricing**: Review and update pricing constants when Google updates pricing.

## Monitoring & Alerts

### Setting Up Cost Alerts

You can create Firestore triggers to monitor costs:

```typescript
export const onCostThresholdExceeded = functions.firestore
  .document('matches/{matchId}/costTracking/summary')
  .onUpdate(async (change, context) => {
    const after = change.after.data() as MatchCostSummary;

    if (after.totalCost > 1.00) { // $1 threshold
      // Send alert
      await sendCostAlert(context.params.matchId, after.totalCost);
    }
  });
```

### Aggregating Costs Across Matches

```typescript
async function getTotalCostsForPeriod(startDate: Date, endDate: Date) {
  const matches = await db.collection('matches')
    .where('createdAt', '>=', startDate.toISOString())
    .where('createdAt', '<=', endDate.toISOString())
    .get();

  let totalCost = 0;
  let totalSavings = 0;

  for (const match of matches.docs) {
    const summary = await db
      .collection('matches')
      .doc(match.id)
      .collection('costTracking')
      .doc('summary')
      .get();

    if (summary.exists) {
      const data = summary.data() as MatchCostSummary;
      totalCost += data.totalCost;
      totalSavings += data.savings;
    }
  }

  return { totalCost, totalSavings };
}
```

## Troubleshooting

### Cost not being recorded
- Verify Firestore permissions allow writes to `matches/{matchId}/costRecords`
- Check that usage metadata is present in Gemini API response
- Review logs for cost tracking errors

### Summary not updating
- Check that `updateMatchCostSummary` is being called (automatically called by `recordCost`)
- Verify Firestore permissions for `matches/{matchId}/costTracking/summary`
- Ensure cost records exist in the `costRecords` subcollection

### Incorrect cost calculations
- Verify current pricing constants match Google's pricing
- Check that token counts are being extracted correctly from API responses
- Ensure `cachedInputTokens` is properly counted (don't double-count with `inputTokens`)

## Future Enhancements

- [ ] Context cache storage cost tracking (per hour charges)
- [ ] Cost prediction based on video duration/complexity
- [ ] Budget management and automatic throttling
- [ ] Cost optimization recommendations
- [ ] Export cost data to BigQuery for advanced analysis
- [ ] Dashboard for real-time cost monitoring
