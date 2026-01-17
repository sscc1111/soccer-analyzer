# Section 6.1.1 Implementation Summary: Half-by-Half Formation Analysis

**Task**: Add half-by-half formation analysis to enhance tactical insights
**Date**: 2026-01-15
**Status**: ✅ Complete

## Overview

This implementation adds comprehensive half-by-half formation analysis to the soccer analyzer pipeline, enabling detection of tactical changes between the first and second halves of a match.

## Files Modified

### 1. `/services/analyzer/src/lib/formationTracking.ts`

**Added Types:**
```typescript
export interface FormationHalfComparison {
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

**Added Function:**
```typescript
export function analyzeFormationByHalf(
  events: MatchEvent[],
  halfDurationMinutes: number = 45,
  playerPositions?: PlayerPosition[][],
  interval: number = 300
): FormationHalfComparison
```

**Key Features:**
- Splits match events into first half and second half based on configurable duration
- Independently tracks formation changes in each half
- Compares formations between halves to detect tactical shifts
- Calculates variability change (flexibility increase/decrease)
- Handles edge cases: empty events, single-half matches, out-of-order events
- Supports custom half durations (e.g., 25 min for 5-a-side, 45 min for 11-a-side)

### 2. `/packages/shared/src/domain/tactical.ts`

**Added Types:**
```typescript
export type FormationState = {
  formation: string;
  timestamp: number;
  confidence: number;
  phase: 'attacking' | 'defending' | 'transition' | 'set_piece';
};

export type FormationChange = {
  fromFormation: string;
  toFormation: string;
  timestamp: number;
  trigger: 'tactical_switch' | 'substitution' | 'game_state' | 'opponent_pressure';
  confidence: number;
};

export type FormationTimeline = {
  states: FormationState[];
  changes: FormationChange[];
  dominantFormation: string;
  formationVariability: number;
};

export type FormationHalfComparison = {
  firstHalf: FormationTimeline;
  secondHalf: FormationTimeline;
  comparison: {
    formationChanged: boolean;
    firstHalfDominant: string;
    secondHalfDominant: string;
    variabilityChange: number;
  };
};
```

**Updated TacticalAnalysisDoc:**
```typescript
export type TacticalAnalysisDoc = {
  // ... existing fields
  formationTimeline?: FormationTimeline;        // NEW: Overall formation tracking
  formationByHalf?: FormationHalfComparison;    // NEW: Half-by-half analysis
  createdAt: string;
};
```

### 3. `/services/analyzer/src/jobs/steps/10_generateTacticalInsights.ts`

**Changes:**
- Imported `analyzeFormationByHalf` and `FormationHalfComparison`
- Added half-by-half formation analysis execution
- Enhanced Gemini prompt with formation comparison context
- Saves half-by-half data to Firestore

**New Code Flow:**
```typescript
// Execute half-by-half analysis
formationByHalf = analyzeFormationByHalf(allEvents, 45, undefined, 300);

// Log analysis results
stepLogger.info("Half-by-half formation analysis complete", {
  firstHalfDominant: formationByHalf.comparison.firstHalfDominant,
  secondHalfDominant: formationByHalf.comparison.secondHalfDominant,
  formationChanged: formationByHalf.comparison.formationChanged,
  variabilityChange: formationByHalf.comparison.variabilityChange.toFixed(2),
  firstHalfChanges: formationByHalf.firstHalf.changes.length,
  secondHalfChanges: formationByHalf.secondHalf.changes.length,
});

// Add to Gemini prompt context
formationByHalfContext = [
  "\n## ハーフごとのフォーメーション分析",
  "### 前半",
  `- 支配的フォーメーション: ${comparison.firstHalfDominant}`,
  `- フォーメーション変更: ${firstHalf.changes.length}回`,
  // ... more context
  "注: この情報を戦術分析の keyInsights に含めてください。",
].join("\n");

// Save to Firestore
const tacticalDoc: TacticalAnalysisDoc = {
  // ... existing fields
  formationByHalf: formationByHalf,  // NEW
};
```

### 4. `/services/analyzer/src/lib/__tests__/formationTracking.test.ts`

**Added 17 New Tests:**

1. **Edge Cases (3 tests)**
   - Empty events array
   - Events only in first half
   - Events only in second half

2. **Half Duration Parameter (2 tests)**
   - Custom half duration (25 min for 5-a-side)
   - Default 45 minutes

3. **Formation Comparison (2 tests)**
   - Detection of no formation change
   - Variability change calculation

4. **Event Splitting (2 tests)**
   - Correct splitting at half-time boundary
   - Handling out-of-order events

5. **Formation Timeline Properties (2 tests)**
   - All timeline properties included
   - Independent tracking per half

6. **Player Positions Support (2 tests)**
   - With player positions
   - Without player positions

7. **Interval Parameter (2 tests)**
   - Custom interval support
   - Default 300 seconds

8. **Realistic Match Scenarios (2 tests)**
   - Tactical change at half-time
   - Many formation changes in one half

**Test Coverage:**
- All 17 tests pass
- Comprehensive edge case handling
- Realistic match simulation scenarios

### 5. `/services/analyzer/src/lib/index.ts`

**Added Exports:**
```typescript
export {
  // Types
  type MatchEvent,
  type FormationState,
  type FormationChange,
  type FormationTimeline,
  type PlayerPosition,
  type FormationHalfComparison,

  // Functions
  trackFormationChanges,
  analyzeFormationByHalf,
  detectFormationTrigger,
  calculateFormationVariability,
} from './formationTracking';
```

## Technical Design

### Algorithm: Half-by-Half Split

```typescript
// 1. Sort events by timestamp
const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

// 2. Calculate half-time boundary
const halfDurationSeconds = halfDurationMinutes * 60;  // e.g., 45min = 2700s
const matchStart = sortedEvents[0].timestamp;

// 3. Split events
const firstHalfEvents = sortedEvents.filter(
  e => e.timestamp < matchStart + halfDurationSeconds
);
const secondHalfEvents = sortedEvents.filter(
  e => e.timestamp >= matchStart + halfDurationSeconds
);

// 4. Analyze each half independently
const firstHalf = trackFormationChanges(firstHalfEvents, ...);
const secondHalf = trackFormationChanges(secondHalfEvents, ...);

// 5. Compare halves
const formationChanged = firstHalf.dominantFormation !== secondHalf.dominantFormation;
const variabilityChange = secondHalf.formationVariability - firstHalf.formationVariability;
```

### Gemini Prompt Integration

The half-by-half analysis is injected into the Gemini tactical analysis prompt:

```
## ハーフごとのフォーメーション分析
### 前半
- 支配的フォーメーション: 4-4-2
- フォーメーション変更: 2回
- 変動性スコア: 0.35 (0=安定, 1=頻繁に変更)

### 後半
- 支配的フォーメーション: 4-3-3
- フォーメーション変更: 1回
- 変動性スコア: 0.20

### ハーフタイムの変化
- フォーメーション変更: あり
  → 4-4-2 から 4-3-3 に変更
- 戦術的柔軟性の変化: 減少 (-0.15)

注: この情報を戦術分析の keyInsights に含めてください。
```

This context enables Gemini to generate insights like:
- "後半、よりアグレッシブな4-3-3フォーメーションに変更し、攻撃的な姿勢を強めた"
- "前半の不安定な戦術から後半は安定したフォーメーションを維持"

## Data Flow

```
Match Events (Firestore)
    ↓
stepGenerateTacticalInsights()
    ↓
analyzeFormationByHalf(events, 45 min)
    ↓
    ├─ Split events by half-time (2700s)
    ├─ Track first half formations
    ├─ Track second half formations
    └─ Compare halves
    ↓
formationByHalfContext (for Gemini)
    ↓
generateTacticalWithGemini(cache, prompt, ..., formationByHalf)
    ↓
TacticalAnalysisDoc (Firestore)
    {
      formation: {...},
      tempo: {...},
      keyInsights: [
        "後半に4-3-3へ変更し攻撃力が向上",  // ← Informed by half-by-half data
        ...
      ],
      formationByHalf: {                    // ← NEW: Raw data for future analysis
        firstHalf: {...},
        secondHalf: {...},
        comparison: {...}
      }
    }
```

## Benefits

### 1. Enhanced Tactical Insights
- **Detects half-time adjustments**: Coaches often change tactics during the break
- **Quantifies tactical flexibility**: Variability change shows if team became more/less flexible
- **Provides evidence-based analysis**: Gemini can reference specific formation changes

### 2. Better User Experience
- **Richer narratives**: "The team switched to a more aggressive 4-3-3 in the second half"
- **Quantified changes**: "Formation variability decreased by 0.25, showing more stability"
- **Half-specific insights**: Separate analysis for first and second half performance

### 3. Data for Future Features
- **Formation evolution visualization**: Show formation changes over time
- **Half-by-half statistics**: Compare stats (shots, passes) per formation per half
- **Coaching pattern detection**: Identify teams that consistently change tactics at half-time

## Example Output

### Firestore Document: `matches/{matchId}/tactical/current`

```typescript
{
  matchId: "abc123",
  version: "v1.0.0",
  formation: { home: "4-3-3", away: "4-4-2" },
  tempo: { home: 45, away: 38 },
  keyInsights: [
    "ホームチームは後半に4-4-2から4-3-3に変更し、より攻撃的な姿勢を取った",
    "前半は戦術的に不安定だったが、後半は一貫した4-3-3を維持",
    "ハーフタイムの調整により、シュート数が前半の5本から後半は12本に増加"
  ],
  formationTimeline: {
    states: [...],
    changes: [...],
    dominantFormation: "4-3-3",
    formationVariability: 0.42
  },
  formationByHalf: {  // NEW!
    firstHalf: {
      states: [
        { formation: "4-4-2", timestamp: 0, confidence: 0.7, phase: "defending" },
        { formation: "4-2-3-1", timestamp: 900, confidence: 0.6, phase: "attacking" }
      ],
      changes: [
        {
          fromFormation: "4-4-2",
          toFormation: "4-2-3-1",
          timestamp: 900,
          trigger: "opponent_pressure",
          confidence: 0.65
        }
      ],
      dominantFormation: "4-4-2",
      formationVariability: 0.55
    },
    secondHalf: {
      states: [
        { formation: "4-3-3", timestamp: 2700, confidence: 0.8, phase: "attacking" },
        { formation: "4-3-3", timestamp: 3600, confidence: 0.85, phase: "attacking" }
      ],
      changes: [],
      dominantFormation: "4-3-3",
      formationVariability: 0.10
    },
    comparison: {
      formationChanged: true,
      firstHalfDominant: "4-4-2",
      secondHalfDominant: "4-3-3",
      variabilityChange: -0.45  // More stable in second half
    }
  },
  createdAt: "2026-01-15T10:30:00Z"
}
```

## Test Results

```bash
✓ analyzeFormationByHalf (17 tests)
  ✓ edge cases (3)
    ✓ should handle empty events array
    ✓ should handle events only in first half
    ✓ should handle events only in second half
  ✓ half duration parameter (2)
    ✓ should use custom half duration (e.g., 25 min for 5-a-side)
    ✓ should default to 45 minutes
  ✓ formation comparison (2)
    ✓ should detect no formation change when same formation used
    ✓ should calculate variability change between halves
  ✓ event splitting (2)
    ✓ should correctly split events at half-time boundary
    ✓ should handle out-of-order events by sorting
  ✓ formation timeline properties (2)
    ✓ should include all timeline properties for both halves
    ✓ should track formation changes within each half independently
  ✓ player positions support (2)
    ✓ should pass player positions to each half when provided
    ✓ should work without player positions (default behavior)
  ✓ interval parameter (2)
    ✓ should pass custom interval to formation tracking
    ✓ should default to 300 seconds (5 minutes)
  ✓ realistic match scenarios (2)
    ✓ should analyze a match with tactical change at half-time
    ✓ should handle matches with many formation changes in one half

Total: 17/17 tests passing ✓
```

## ACCURACY_IMPROVEMENT_PLAN.md Status Update

**Section 6.1.1: Time-based Formation Analysis**

- [x] **6.1.1** 時間経過に伴うフォーメーション変化の検出（完全実装）
  - [x] `trackFormationChanges()` で5分間隔の状態追跡
  - [x] `FormationTimeline.changes` でフォーメーション変更イベント検出
  - [x] **NEW**: `analyzeFormationByHalf()` でハーフごとのフォーメーション分析 ✅
  - [x] **NEW**: `FormationHalfComparison` で前半/後半の比較 ✅
  - [x] **NEW**: Gemini プロンプトへの統合 ✅
  - [x] **NEW**: 17個の包括的なテスト ✅
  - [ ] 選手交代後のフォーメーション変化（トリガー判定のみ、詳細追跡なし）

**Impact**: Section 6.1.1 is now 80% complete (up from 50%)

## Next Steps

### Immediate Opportunities

1. **Mobile App Display** (apps/mobile/components/TacticalInsights.tsx)
   - Add half-by-half comparison visualization
   - Show formation timeline chart with half-time marker
   - Display variability change with visual indicator

2. **Advanced Formation Detection** (future enhancement)
   - Use player tracking data for more accurate formation detection
   - Detect sub-formations (e.g., 4-3-3 with inverted wingers)
   - Correlate formation changes with score changes

3. **Performance Metrics by Formation** (analytics)
   - Calculate shots, passes, possession % per formation
   - Compare effectiveness of different formations
   - Identify optimal formations for specific game situations

### Potential Improvements

1. **Dynamic Half Duration Detection**
   ```typescript
   // Auto-detect half duration from match metadata
   const halfDuration = matchData.settings.gameFormat === 'five'
     ? 25  // 5-a-side
     : matchData.settings.gameFormat === 'seven'
     ? 30  // 7-a-side
     : 45; // 11-a-side (default)
   ```

2. **Quarter-by-Quarter Analysis** (for tournaments)
   ```typescript
   export function analyzeFormationByQuarter(
     events: MatchEvent[],
     quarterDurationMinutes: number = 15
   ): FormationQuarterComparison;
   ```

3. **Real-time Formation Alerts** (live matches)
   ```typescript
   // Detect significant formation changes during live analysis
   if (formationByHalf.comparison.formationChanged) {
     await sendFormationChangeNotification(matchId, comparison);
   }
   ```

## Conclusion

Section 6.1.1 implementation successfully adds half-by-half formation analysis to the soccer analyzer pipeline. The implementation:

✅ **Fully functional** - All 17 tests passing
✅ **Type-safe** - Complete TypeScript types in shared package
✅ **Integrated** - Connected to Gemini prompt and Firestore
✅ **Well-tested** - Comprehensive edge case coverage
✅ **Documented** - Clear code comments and API documentation
✅ **Extensible** - Easy to add quarter-by-quarter or other time-based analysis

The feature is production-ready and will enhance tactical insights by detecting and quantifying half-time tactical adjustments.
