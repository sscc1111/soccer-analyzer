# Carry/Dribble Classification (Phase 2.2.2)

## Overview

This document describes the implementation of the carry/dribble classification feature, which distinguishes between:
- **Simple carries**: Low intensity movement with the ball (e.g., goalkeeper distribution, short possession)
- **Dribbles**: Active running with the ball, often against defenders (e.g., counterattack runs, skillful evasion)

## Implementation

### 1. Type Definitions

**File**: `/packages/shared/src/domain/passEvent.ts`

Added two new fields to `CarryEventDoc`:

```typescript
/**
 * Whether this carry is classified as a dribble
 * true = dribble (active running with ball against defenders)
 * false = simple carry (low intensity movement with ball)
 */
isDribble?: boolean;

/**
 * Confidence in dribble classification (0-1)
 * Higher confidence indicates stronger evidence of dribbling behavior
 */
dribbleConfidence?: number;
```

### 2. Classification Algorithm

**File**: `/services/analyzer/src/lib/eventEnrichment.ts`

Function: `classifyCarryAsDribble(carry, distance, startPos, endPos)`

#### Classification Criteria

The algorithm evaluates four factors with weighted importance:

1. **Distance (40% weight)**
   - ≥ 15m → Strong dribble (score: 1.0)
   - 10-15m → Likely dribble (score: 0.8)
   - 7-10m → Borderline (score: 0.5)
   - 5-7m → Weak (score: 0.3)
   - < 5m → Simple carry (score: 0.1)

2. **Duration (30% weight)**
   - ≥ 3.0s → Clear dribble (score: 1.0)
   - 2.0-3.0s → Likely dribble (score: 0.7)
   - 1.5-2.0s → Borderline (score: 0.4)
   - < 1.5s → Simple carry (score: 0.1)

3. **Attack Progression (20% weight)**
   - X-axis progress in attack direction (normalized 0-1)
   - > 15% → Strong forward (score: 1.0)
   - 10-15% → Clear forward (score: 0.8)
   - 5-10% → Moderate forward (score: 0.5)
   - 0-5% → Slight forward (score: 0.3)
   - ≤ 0 → Lateral/backward (score: 0.1)

4. **Zone Change (10% weight)**
   - Forward zone progression → 1.0
   - No zone change → 0.5 (neutral)
   - Backward zone progression → 0.3

#### Scoring Thresholds

Total score is calculated as: `distance×0.40 + duration×0.30 + attackProgression×0.20 + zoneChange×0.10`

- **Score ≥ 0.70**: Dribble with high confidence (0.875-0.95)
- **Score 0.50-0.70**: Dribble with moderate confidence (0.70-0.78)
- **Score 0.35-0.50**: Weak dribble with low confidence (0.505-0.61)
- **Score < 0.35**: Simple carry with confidence (0.425-0.60)

### 3. Integration

**File**: `/services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts`

The classification is automatically applied during event enrichment:

```typescript
// In enrichEvents function (line ~380):
const { isDribble, confidence: dribbleConfidence } = classifyCarryAsDribble(
  event,
  enriched.carryDistanceMeters,
  event.mergedPosition,
  endPos
);
enriched.isDribble = isDribble;
enriched.dribbleConfidence = dribbleConfidence;
```

The results are then saved to Firestore as part of the `CarryEventDoc`.

### 4. Statistics Tracking

Enhanced statistics in `calculateEnrichmentStats`:

```typescript
carryEvents: {
  total: number;
  withDistance: number;
  averageDistance: number;
  dribbles: number;              // NEW
  simpleCarries: number;         // NEW
  averageDribbleConfidence: number; // NEW
}
```

These statistics are logged during pipeline execution:

```
Event enrichment complete:
  carryEvents:
    total: 45
    dribbles: 12
    simpleCarries: 33
    averageDistance: 8.3
    averageDribbleConfidence: 0.82
```

## Testing

**File**: `/services/analyzer/src/lib/__tests__/carryDribbleClassification.test.ts`

Comprehensive test suite with 28 test cases covering:

1. **Basic classification** (3 tests)
   - No position data
   - Short distance carries
   - Long distance dribbles

2. **Duration factor** (4 tests)
   - Very short duration (< 1.5s)
   - Moderate duration (~2s)
   - Good duration (≥ 3s)
   - Very long duration (> 5s)

3. **Distance factor** (3 tests)
   - Short range (< 7m)
   - Medium range (7-10m)
   - Long range (10-15m)
   - Very long range (15m+)

4. **Zone change factor** (5 tests)
   - Forward progression (home/away)
   - Backward progression
   - No zone change
   - Cross-zone dribbles

5. **Attack progression factor** (4 tests)
   - Strong forward movement
   - Backward movement
   - Lateral movement
   - Team-specific attack directions

6. **Combined factors** (3 tests)
   - All positive factors
   - All negative factors
   - Mixed factors

7. **Edge cases** (4 tests)
   - Zero distance
   - Missing duration
   - Very long values
   - Extreme scenarios

8. **Realistic scenarios** (5 tests)
   - Counterattack run
   - Winger dribble
   - Short possession
   - Goalkeeper distribution
   - Skillful midfielder dribble

Run tests:
```bash
cd services/analyzer
npm test carryDribbleClassification
```

## Usage Examples

### Example 1: Counterattack Dribble
```typescript
// Midfielder receives ball in own half, runs 30m forward in 3.5 seconds
const carry = {
  type: "carry",
  team: "home",
  zone: "defensive_third",
  details: { duration: 3.5, endZone: "attacking_third" }
};
const startPos = { x: 0.25, y: 0.5 };
const endPos = { x: 0.55, y: 0.4 };

const result = classifyCarryAsDribble(carry, 32.0, startPos, endPos);
// Result: { isDribble: true, confidence: 0.92 }
```

### Example 2: Simple Possession
```typescript
// Player receives ball, takes a few steps, passes - 1 second, 3m
const carry = {
  type: "carry",
  team: "home",
  zone: "middle_third",
  details: { duration: 1.0, endZone: "middle_third" }
};
const startPos = { x: 0.5, y: 0.5 };
const endPos = { x: 0.52, y: 0.51 };

const result = classifyCarryAsDribble(carry, 3.0, startPos, endPos);
// Result: { isDribble: false, confidence: 0.58 }
```

## Future Improvements

1. **Enhanced detection** (Section 2.2.1 - not yet implemented):
   - More accurate start/end timestamps from Gemini
   - Better end condition detection in prompts

2. **Opponent context** (Section 2.2.2 - partial):
   - Detect when carry happens against defenders
   - Incorporate pressure/contest data

3. **Machine learning**:
   - Train a classifier on labeled data
   - Use velocity profiles and acceleration patterns

4. **Direction changes**:
   - Track number of direction changes during carry
   - Detect cutting/feinting movements

## Related Files

- Type definitions: `/packages/shared/src/domain/passEvent.ts`
- Classification logic: `/services/analyzer/src/lib/eventEnrichment.ts`
- Integration: `/services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts`
- Tests: `/services/analyzer/src/lib/__tests__/carryDribbleClassification.test.ts`
- Plan: `/x-pending/ACCURACY_IMPROVEMENT_PLAN.md` (Section 2.2)

## Changelog

- **2026-01-15**: Initial implementation of Phase 2.2.2
  - Added `isDribble` and `dribbleConfidence` fields to `CarryEventDoc`
  - Implemented `classifyCarryAsDribble()` with 4-factor weighted scoring
  - Integrated into event enrichment pipeline
  - Added comprehensive test suite (28 tests)
  - Updated statistics tracking and logging
