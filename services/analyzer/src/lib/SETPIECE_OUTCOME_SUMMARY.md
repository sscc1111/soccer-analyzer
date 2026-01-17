# Set Piece Outcome Detection - Implementation Summary

## Overview

Implementation of **Section 3.2.2** from ACCURACY_IMPROVEMENT_PLAN: セットピース後の展開検出

## What was implemented

### 1. Domain Type Extension (`packages/shared/src/domain/passEvent.ts`)

Added `outcomeDetails` field to `SetPieceEventDoc`:

```typescript
outcomeDetails?: {
  resultType: "shot" | "goal" | "cleared" | "turnover" | "continued_play" | "unknown";
  timeToOutcome: number;
  scoringChance: boolean;
  outcomeEventId?: string;
}
```

### 2. Core Analysis Logic (`services/analyzer/src/lib/setPieceOutcomeAnalysis.ts`)

**Function**: `analyzeSetPieceOutcomes()`

**Algorithm**:
1. For each set piece event:
   - Define outcome window (default 15 seconds)
   - Find all events within the window
   - Apply priority-based detection:
     - **Priority 1**: Goal (shot with result="goal")
     - **Priority 2**: Shot (any shot event)
     - **Priority 3**: Turnover (interception/tackle)
     - **Priority 4**: Cleared (opponent pass within 5s)
     - **Priority 5**: Continued play (same team pass)
     - **Default**: Unknown

2. Determine scoring chance:
   - Goal → always true
   - Shot → true if saved/post, false if missed/blocked
   - Other → false

3. Calculate time to outcome (seconds from set piece)

### 3. Pipeline Integration (`services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts`)

**Added**:
- Import of `analyzeSetPieceOutcomes` function
- Analysis execution after event enrichment
- Outcome statistics logging
- Attachment of outcome details to SetPieceEventDoc before Firestore save

**Logging**:
```typescript
{
  total: number,
  goals: number,
  shots: number,
  cleared: number,
  turnovers: number,
  continuedPlay: number,
  scoringChances: number,
  averageTimeToOutcome: string
}
```

### 4. Comprehensive Tests (`services/analyzer/src/lib/__tests__/setPieceOutcomeAnalysis.test.ts`)

**Test Coverage**:
- ✅ Goal detection from various set piece types
- ✅ Shot outcome classification (on target vs missed)
- ✅ Clearance detection (opponent pass within 5s)
- ✅ Turnover detection (interception/tackle)
- ✅ Continued play detection
- ✅ Priority order validation
- ✅ Custom outcome window support
- ✅ Multiple set pieces analysis
- ✅ Edge cases (empty list, match end, quick outcomes)

**Total**: 20+ test cases

### 5. Library Exports (`services/analyzer/src/lib/index.ts`)

Exported:
- `SetPieceOutcomeAnalysis` type
- `analyzeSetPieceOutcomes` function

## Usage Example

```typescript
import { analyzeSetPieceOutcomes } from './lib/setPieceOutcomeAnalysis';

const setPieceEvents = deduplicatedEvents.filter(e => e.type === 'setPiece');
const outcomes = analyzeSetPieceOutcomes(setPieceEvents, deduplicatedEvents);

// Results example:
[
  {
    setPieceEventId: "setPiece_100",
    resultType: "goal",
    timeToOutcome: 3.5,
    scoringChance: true,
    outcomeEventId: "shot_103.5"
  },
  {
    setPieceEventId: "setPiece_200",
    resultType: "cleared",
    timeToOutcome: 2.1,
    scoringChance: false,
    outcomeEventId: "pass_202.1"
  }
]
```

## Detection Logic Details

### Result Type Priority

1. **Goal** (Highest)
   - Condition: Shot event with `shotResult === "goal"` by same team
   - Scoring chance: Always `true`

2. **Shot**
   - Condition: Any shot event by same team
   - Scoring chance: `true` if saved/post, `false` if missed/blocked

3. **Turnover**
   - Condition: Turnover event with context="interception" or "tackle"
   - Scoring chance: Always `false`

4. **Cleared**
   - Condition: Opponent team pass within 5 seconds
   - Scoring chance: Always `false`

5. **Continued Play**
   - Condition: Same team event (first event after set piece)
   - Scoring chance: Always `false`

6. **Unknown** (Default)
   - Condition: No events in window or outside time limits
   - Scoring chance: Always `false`

### Time Window

- **Default**: 15 seconds
- **Clearance detection**: 5 seconds (stricter)
- **Configurable**: `outcomeWindow` parameter

## Integration Points

### Before (07c_deduplicateEvents.ts)
```typescript
const enrichedEvents = enrichEvents(deduplicatedEvents);
const passChains = detectPassChains(deduplicatedEvents);
// → Save to Firestore
```

### After
```typescript
const enrichedEvents = enrichEvents(deduplicatedEvents);
const passChains = detectPassChains(deduplicatedEvents);

// NEW: Section 3.2.2
const setPieceOutcomes = analyzeSetPieceOutcomes(
  deduplicatedEvents.filter(e => e.type === 'setPiece'),
  deduplicatedEvents
);

// Attach outcomes to SetPieceEventDoc
const outcomeAnalysis = setPieceOutcomes.find(
  outcome => outcome.setPieceEventId === `${e.type}_${e.absoluteTimestamp}`
);

const eventDoc: SetPieceEventDoc = {
  ...otherFields,
  outcomeDetails: outcomeAnalysis ? { ... } : undefined
};
```

## Data Flow

```
Raw Events (07b)
  ↓
Deduplicated Events (07c)
  ↓
Event Enrichment (passDirection, xG, etc.)
  ↓
Set Piece Outcome Analysis ← NEW
  ↓
Firestore (with outcomeDetails)
```

## Benefits

1. **Tactical Analysis**: Understand which set pieces create scoring chances
2. **Performance Metrics**: Track set piece effectiveness per team
3. **Pattern Detection**: Identify successful set piece routines
4. **Video Analysis**: Quick navigation to dangerous set pieces
5. **Historical Data**: Compare set piece success rates over time

## Future Enhancements

Potential improvements (not implemented):
- [ ] Detect set piece routine patterns (near post, far post, short corner)
- [ ] Track specific player involvement in outcomes
- [ ] Analyze defensive set piece organization
- [ ] Correlate set piece outcomes with formation
- [ ] Machine learning for set piece danger prediction

## Files Changed

1. ✅ `packages/shared/src/domain/passEvent.ts` - Type definition
2. ✅ `services/analyzer/src/lib/setPieceOutcomeAnalysis.ts` - Core logic (new)
3. ✅ `services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts` - Integration
4. ✅ `services/analyzer/src/lib/index.ts` - Exports
5. ✅ `services/analyzer/src/lib/__tests__/setPieceOutcomeAnalysis.test.ts` - Tests (new)

## Testing

Run tests:
```bash
npm test -- setPieceOutcomeAnalysis.test.ts
```

Expected: 20+ tests passing

## Status

✅ **Section 3.2.2 Complete**

- [x] セットピース → シュート/クリアの連鎖検出
- [x] セットピースからの得点機会の追跡
- [x] Type definitions
- [x] Core implementation
- [x] Pipeline integration
- [x] Comprehensive tests
- [x] Documentation

---

**Implementation Date**: 2026-01-15
**Implemented By**: Claude Code (TypeScript Pro)
