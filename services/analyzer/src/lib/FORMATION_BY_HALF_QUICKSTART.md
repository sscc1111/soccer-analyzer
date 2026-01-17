# Formation By Half - Quick Start Guide

## Overview

The `analyzeFormationByHalf()` function analyzes formation changes separately for the first and second halves of a soccer match, enabling detection of tactical adjustments made at half-time.

## Basic Usage

```typescript
import { analyzeFormationByHalf } from '@/lib/formationTracking';

// Get match events
const events = [
  { type: 'pass', timestamp: 0, metadata: {} },
  { type: 'shot', timestamp: 1500, metadata: {} },
  { type: 'pass', timestamp: 3000, metadata: {} },  // Second half (after 2700s)
  // ... more events
];

// Analyze formations by half
const analysis = analyzeFormationByHalf(events, 45);  // 45 minutes per half

// Check results
console.log(analysis.comparison);
// {
//   formationChanged: true,
//   firstHalfDominant: "4-4-2",
//   secondHalfDominant: "4-3-3",
//   variabilityChange: -0.25  // More stable in 2nd half
// }
```

## API Reference

### Function Signature

```typescript
function analyzeFormationByHalf(
  events: MatchEvent[],
  halfDurationMinutes?: number,    // Default: 45
  playerPositions?: PlayerPosition[][],  // Optional
  interval?: number                 // Default: 300s (5 min)
): FormationHalfComparison
```

### Parameters

- **events**: Array of match events with `timestamp` and `type` properties
- **halfDurationMinutes**: Duration of each half in minutes (default: 45 for 11-a-side)
  - Use 25 for 5-a-side
  - Use 30 for 7-a-side
  - Use 45 for 11-a-side (default)
- **playerPositions**: Optional array of player position snapshots
- **interval**: Analysis interval in seconds (default: 300s = 5 minutes)

### Return Type

```typescript
interface FormationHalfComparison {
  firstHalf: FormationTimeline;
  secondHalf: FormationTimeline;
  comparison: {
    formationChanged: boolean;
    firstHalfDominant: string;
    secondHalfDominant: string;
    variabilityChange: number;
  };
}
```

## Common Use Cases

### 1. Detect Half-Time Tactical Changes

```typescript
const analysis = analyzeFormationByHalf(events);

if (analysis.comparison.formationChanged) {
  console.log(`Formation changed from ${analysis.comparison.firstHalfDominant} to ${analysis.comparison.secondHalfDominant}`);
  // → "Formation changed from 4-4-2 to 4-3-3"
}
```

### 2. Analyze Tactical Flexibility

```typescript
const { variabilityChange } = analysis.comparison;

if (variabilityChange > 0.2) {
  console.log("Team became more flexible in second half");
} else if (variabilityChange < -0.2) {
  console.log("Team stabilized their formation in second half");
} else {
  console.log("Tactical flexibility remained consistent");
}
```

### 3. Count Formation Changes Per Half

```typescript
const firstHalfChanges = analysis.firstHalf.changes.length;
const secondHalfChanges = analysis.secondHalf.changes.length;

console.log(`First half: ${firstHalfChanges} changes`);
console.log(`Second half: ${secondHalfChanges} changes`);

if (secondHalfChanges > firstHalfChanges) {
  console.log("More tactical adjustments in second half");
}
```

### 4. Custom Half Duration (5-a-side)

```typescript
// 5-a-side match with 25-minute halves
const analysis = analyzeFormationByHalf(events, 25);

console.log(analysis.comparison);
// Correctly splits at 25 * 60 = 1500 seconds
```

### 5. Detailed Formation Timeline

```typescript
// Access detailed states for each half
analysis.firstHalf.states.forEach(state => {
  console.log(`${state.timestamp}s: ${state.formation} (${state.phase})`);
});
// → "0s: 4-4-2 (defending)"
// → "300s: 4-4-2 (attacking)"
// → "600s: 4-2-3-1 (attacking)"

// Access formation changes
analysis.firstHalf.changes.forEach(change => {
  console.log(`${change.timestamp}s: ${change.fromFormation} → ${change.toFormation} (${change.trigger})`);
});
// → "600s: 4-4-2 → 4-2-3-1 (tactical_switch)"
```

## Integration Examples

### In Step 10: generateTacticalInsights

```typescript
// Analyze formation by half
const formationByHalf = analyzeFormationByHalf(allEvents, 45);

// Add to Gemini prompt context
const formationContext = `
## ハーフごとのフォーメーション分析
前半: ${formationByHalf.comparison.firstHalfDominant}
後半: ${formationByHalf.comparison.secondHalfDominant}
変更: ${formationByHalf.comparison.formationChanged ? 'あり' : 'なし'}
`;

// Save to Firestore
const tacticalDoc: TacticalAnalysisDoc = {
  // ... other fields
  formationByHalf: formationByHalf,
};
```

### In Mobile App (React)

```typescript
import { useTacticalAnalysis } from '@/lib/hooks/useTacticalAnalysis';

function FormationComparisonCard({ matchId }) {
  const { data } = useTacticalAnalysis(matchId);
  const { formationByHalf } = data || {};

  if (!formationByHalf) return null;

  return (
    <Card>
      <h3>Half-Time Tactical Analysis</h3>
      <div>
        <strong>First Half:</strong> {formationByHalf.comparison.firstHalfDominant}
        <span>({formationByHalf.firstHalf.changes.length} changes)</span>
      </div>
      <div>
        <strong>Second Half:</strong> {formationByHalf.comparison.secondHalfDominant}
        <span>({formationByHalf.secondHalf.changes.length} changes)</span>
      </div>
      {formationByHalf.comparison.formationChanged && (
        <Alert>
          Formation changed at half-time: tactical adjustment detected!
        </Alert>
      )}
    </Card>
  );
}
```

## Interpretation Guide

### Formation Change

```typescript
formationChanged: boolean
```

- **true**: Team used different dominant formations in each half
- **false**: Same formation maintained throughout (or no significant change)

### Variability Change

```typescript
variabilityChange: number  // Range: -1.0 to +1.0
```

- **Positive (> 0)**: Team became more flexible/unstable in second half
  - Example: +0.45 → "Significantly more tactical adjustments"
- **Negative (< 0)**: Team became more stable/consistent in second half
  - Example: -0.25 → "Settled into consistent formation"
- **Near zero (~0)**: Tactical flexibility remained similar
  - Example: -0.05 → "Consistent approach throughout"

### Formation Variability

```typescript
formationVariability: number  // Range: 0.0 to 1.0
```

- **0.0 - 0.2**: Very stable (1-2 formations used)
- **0.2 - 0.5**: Moderate flexibility (2-3 formations, occasional changes)
- **0.5 - 0.8**: High flexibility (3-4 formations, frequent changes)
- **0.8 - 1.0**: Very unstable (5+ formations, constant changes)

## Edge Cases

### Empty Events

```typescript
const analysis = analyzeFormationByHalf([]);
// Returns default values:
// - Empty states
// - dominantFormation: "4-4-2" (default)
// - formationChanged: false
// - variabilityChange: 0
```

### Events Only in One Half

```typescript
// Only first half events
const analysis = analyzeFormationByHalf([
  { type: 'pass', timestamp: 0 },
  { type: 'pass', timestamp: 1000 },
]);
// firstHalf: populated
// secondHalf: empty (default values)
```

### Out-of-Order Events

```typescript
// Events automatically sorted by timestamp
const analysis = analyzeFormationByHalf([
  { type: 'pass', timestamp: 3000 },  // Second half
  { type: 'pass', timestamp: 500 },   // First half
  { type: 'pass', timestamp: 1000 },  // First half
]);
// Correctly sorted and split
```

## Performance Considerations

- **Complexity**: O(n log n) due to sorting
- **Memory**: O(n) for event storage
- **Recommended**: Use for matches with < 10,000 events (typical match: 500-2000 events)

## Testing

Run tests with:

```bash
npm test formationTracking.test.ts
```

17 tests covering:
- Edge cases (empty, single-half)
- Parameter validation
- Event splitting logic
- Formation comparison
- Realistic match scenarios

## See Also

- `trackFormationChanges()` - Overall formation tracking
- `calculateFormationVariability()` - Variability calculation
- `detectFormationTrigger()` - Change trigger detection
- [ACCURACY_IMPROVEMENT_PLAN.md](../../../x-pending/ACCURACY_IMPROVEMENT_PLAN.md) - Section 6.1.1
