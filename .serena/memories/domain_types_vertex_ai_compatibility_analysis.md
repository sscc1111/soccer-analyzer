# Domain Types & Vertex AI Expansion Plan Compatibility Analysis

## Executive Summary

The **vertex-ai-expansion-plan.md** proposes a Gemini-first architecture migration with new data types for:
- Gemini events (passes, carries, turnovers, shots, set pieces)
- Tactical analysis data
- Match summaries

**Key Finding**: The plan introduces **new event types not yet defined** in the domain model. The existing type definitions are **compatible but require extensions**.

---

## 1. Current Domain Types (packages/shared/src/domain/)

### 1.1 Match Types (match.ts)
```typescript
// Existing types
- GameFormat: "eleven" | "eight" | "five"
- MatchDuration: { halfDuration, numberOfHalves, extraTime? }
- FieldSize: { length, width }
- ProcessingMode: "quick" | "standard" | "detailed"
- AnalysisStep: phase enum (extract_meta, detect_shots, ..., compute_stats, done)
- MatchSettings: camera, teamColors, formation, gameFormat, etc.
- MatchDoc: complete match document with analysis status + progress
```

### 1.2 Clip Types (clip.ts)
```typescript
// Existing type
ClipDoc = {
  clipId, shotId, t0, t1,
  reason: "motionPeak" | "audioPeak" | "manual" | "other",
  media: { clipPath, thumbPath? },
  gemini?: {
    model, promptVersion, label, confidence,
    title?, summary?, tags?, coachTips?,
    rawResponse?, rawOriginalResponse?,
    createdAt
  }
}
```

### 1.3 Event Types (event.ts)
```typescript
// Existing type
EventLabel = "shot" | "chance" | "setPiece" | "dribble" | "defense" | "other"

EventDoc = {
  eventId, clipId, label, confidence,
  title?, summary?,
  involved?: { players?: { playerId, confidence }[] },
  source: "gemini" | "manual" | "hybrid",
  createdAt
}
```

### 1.4 Pass/Carry/Turnover Types (passEvent.ts)
```typescript
// Existing types for Phase 2 events
- PassEventDoc: { frameNumber, timestamp, kicker, receiver, outcome, passType?, ... }
- CarryEventDoc: { trackId, startFrame, endFrame, startPosition, endPosition, carryIndex, ... }
- TurnoverEventDoc: { frameNumber, timestamp, player, otherPlayer?, context?, ... }
- PossessionSegment: { trackId, teamId, startFrame, endFrame, confidence, endReason, ... }
- TrackedEvent: union of Pass | Carry | Turnover
- PendingReviewDoc: { eventId, eventType, reason, candidates?, resolution?, ... }
```

### 1.5 Tracking Types (tracking.ts)
```typescript
// Existing types for Phase 1
- BoundingBox: { x, y, w, h } (normalized 0-1)
- Point2D: { x, y } (normalized 0-1)
- TrackFrame: { trackId, frameNumber, timestamp, bbox, center, confidence }
- TrackDoc: { trackId, matchId, frames[], startFrame, endFrame, avgConfidence, entityType, ... }
- TeamId: "home" | "away" | "unknown"
- TrackTeamMeta: { trackId, teamId, teamConfidence, dominantColor?, classificationMethod, ... }
- BallDetection: { frameNumber, timestamp, position, confidence, visible, interpolated? }
- BallTrackDoc: { matchId, detections[], modelId, avgConfidence, visibilityRate, ... }
- TrackPlayerMapping: { trackId, playerId?, jerseyNumber?, ocrConfidence, source, ... }
- HomographyData: { matchId, frameNumber, matrix, keypoints, confidence, fieldSize?, ... }
- PredictedPosition: { trackId, frameNumber, position, velocity, isPredicted, ... }
```

### 1.6 Stats Types (stats.ts)
```typescript
// Minimal type
StatsDoc = {
  statId, version, pipelineVersion?, scope: "match" | "player",
  playerId?: string | null,
  metrics: Partial<Record<MetricKey, unknown>>,
  confidence: Partial<Record<MetricKey, number>>,
  explanations?: Partial<Record<MetricKey, string>>,
  computedAt: string
}
```

### 1.7 Settings Types (settings.ts)
```typescript
// User preferences
DefaultSettings = {
  gameFormat?, teamColors?, formation?, roster?
}

RosterItem = { jerseyNo, name? }
```

### 1.8 Metric Keys (metricKeys.ts)
```typescript
// Current keys
- Match-level: matchEventsCountByLabel, matchTopMoments
- Player-level: passes (attempted/completed/incomplete/successRate/intercepted),
  carry (count/index/progressIndex/meters), possession (timeSec/count),
  turnovers (lost/won), shots (count/onTarget), involvement, speed, sprint, heatmap
- Team-level: teamPossessionPercent
```

---

## 2. New Types Required by Vertex AI Expansion Plan

### 2.1 Gemini Events (Step 07: detectEventsGemini)

**NEW: ShotEventDoc** (not in current types)
```typescript
// Required for: "Shot: ゴールへの攻撃 - result: goal | saved | blocked | missed"
ShotEventDoc = {
  eventId: string;
  matchId: string;
  type: "shot";
  frameNumber: number;
  timestamp: number;
  player: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    position: Point2D;
  };
  result: "goal" | "saved" | "blocked" | "missed";
  confidence: number;
  source: "gemini" | "manual" | "corrected";
  version: string;
  createdAt: string;
}
```

**NEW: SetPieceEventDoc** (not in current types)
```typescript
// Required for: "セットピース - type: corner | free_kick | penalty | throw_in"
SetPieceEventDoc = {
  eventId: string;
  matchId: string;
  type: "setPiece";
  frameNumber: number;
  timestamp: number;
  setPieceType: "corner" | "free_kick" | "penalty" | "throw_in";
  team: TeamId;
  position: Point2D;
  confidence: number;
  source: "gemini" | "manual" | "corrected";
  version: string;
  createdAt: string;
}
```

**EXISTING + EXTENSIONS**: PassEventDoc, CarryEventDoc, TurnoverEventDoc
- Can accommodate Gemini output structure (team, player, details all present)
- `source` field already supports "gemini" value
- May need to add Gemini-specific confidence metrics

### 2.2 Tactical Analysis Types (Step 10: generateTacticalInsights)

**NEW: TacticalAnalysisDoc** (not in current types)
```typescript
// Firestore: matches/{matchId}/tactical/{version or singleton}
TacticalAnalysisDoc = {
  matchId: string;
  version: string;
  generatedAt: string;
  
  // Formation analysis
  formations?: {
    home?: {
      formation: string;      // "4-3-3"
      confidence: number;
      keyPlayers?: string[];  // player IDs or jersey numbers
    };
    away?: {...};
  };
  
  // Possession & tempo
  tempo?: {
    homeAvgPassRate: number;  // passes per minute
    awayAvgPassRate: number;
    homeAvgCarryRate: number;
    awayAvgCarryRate: number;
  };
  
  // Attack patterns
  attackPatterns?: {
    team: TeamId;
    patterns: Array<{
      description: string;
      frequency: number;
      effectiveness: number; // 0-1
      examples?: string[];   // clip IDs
    }>;
  }[];
  
  // Defensive patterns
  defensivePatterns?: {
    team: TeamId;
    patterns: Array<{
      description: string;
      frequency: number;
      effectiveness: number;
    }>;
  }[];
  
  // Key performance indicators
  keyInsights?: string[];
  
  // Source
  source: "gemini" | "manual";
}
```

### 2.3 Match Summary Types (Step 11: generateMatchSummary)

**NEW: MatchSummaryDoc** (not in current types)
```typescript
// Firestore: matches/{matchId}/summary/{version or singleton}
MatchSummaryDoc = {
  matchId: string;
  version: string;
  generatedAt: string;
  
  // Overview
  title: string;
  headline: string;
  summary: string;
  
  // Narrative by half
  firstHalf?: {
    summary: string;
    keyMoments?: string[];
  };
  secondHalf?: {
    summary: string;
    keyMoments?: string[];
  };
  
  // Team performance
  teamPerformance?: {
    home?: {
      overallRating: number;         // 1-10
      strengthAreas: string[];
      improvementAreas: string[];
      tacticalNotes?: string;
    };
    away?: {...};
  };
  
  // Player highlights
  playerHighlights?: Array<{
    playerId?: string | null;
    jerseyNumber: number;
    team: TeamId;
    highlights: string[];
  }>;
  
  // Key statistics (summary)
  keyStats?: {
    home?: {
      passCompletionRate: number;
      possession: number;
      shotsOnTarget: number;
      tackles: number;
    };
    away?: {...};
  };
  
  // Verdict
  verdict?: string;
  recommendations?: string[];
  
  // Source
  source: "gemini" | "manual";
}
```

---

## 3. Firestore Collection Structure

### Current Collections (from firestore.indexes.json):
```
matches/
├─ {matchId}/
   ├─ clips/
   ├─ events/           (EventDoc - currently only "shot|chance|setPiece|dribble|defense")
   ├─ stats/
   ├─ tracks/           (TrackDoc from tracking.ts)
   ├─ trackMappings/    (TrackPlayerMapping)
   ├─ ballTrack         (BallTrackDoc)
   ├─ homography/
   ├─ passEvents/       (PassEventDoc)
   ├─ carryEvents/      (CarryEventDoc)
   ├─ turnoverEvents/   (TurnoverEventDoc)
   ├─ pendingReviews/   (PendingReviewDoc)
   └─ (MatchDoc stored as root document)

jobs/
└─ {jobId}/
```

### New Collections Required by Plan:
```
matches/
├─ {matchId}/
   ├─ shotEvents/      [NEW] Step 07 output
   ├─ setPieceEvents/  [NEW] Step 07 output
   ├─ tactical/        [NEW] Step 10 output (TacticalAnalysisDoc)
   ├─ summary/         [NEW] Step 11 output (MatchSummaryDoc)
   ├─ geminiCache/     [NEW] Step 03 cache metadata
   └─ importantScenes/ [NEW] Step 04 output (scene timestamps for FFmpeg)
```

---

## 4. Type Compatibility Analysis

### 4.1 Compatible Types (No Changes Needed)
| Type | Location | Status | Notes |
|------|----------|--------|-------|
| ClipDoc | clip.ts | ✅ Ready | Already supports gemini output |
| PassEventDoc | passEvent.ts | ✅ Ready | `source` field supports "gemini" |
| CarryEventDoc | passEvent.ts | ✅ Ready | Already typed for event data |
| TurnoverEventDoc | passEvent.ts | ✅ Ready | Already typed correctly |
| TrackDoc | tracking.ts | ✅ Ready | Phase 1 data structure unchanged |
| StatsDoc | stats.ts | ✅ Ready | MetricKey system handles any stat |

### 4.2 Extensions Needed (Minor)
| Type | Location | Required Change | Reason |
|------|----------|-----------------|--------|
| EventDoc | event.ts | Add union type support or add `shotEventId`, `setPieceEventId` fields | Currently clips to EventDoc, but now have separate shot/setPiece collections |
| PassEventDoc | passEvent.ts | Optional: Add `gemini.model`, `gemini.confidence` fields for Gemini metadata | To track Gemini-specific processing info |
| StatsDoc | stats.ts | Optional: Add `computedFrom: "gemini" | "yolo" | "hybrid"` field | For Tier 1 vs Tier 2 tracking |

### 4.3 New Types Required (Must Add)
| Type | Location | Firestore Path | Collection | Note |
|------|----------|-----------------|-----------|------|
| ShotEventDoc | **passEvent.ts** (or new shot.ts) | matches/{id}/shotEvents/{eventId} | shotEvents | Separate from PassEventDoc |
| SetPieceEventDoc | **passEvent.ts** (or new setPiece.ts) | matches/{id}/setPieceEvents/{eventId} | setPieceEvents | Separate from PassEventDoc |
| TacticalAnalysisDoc | **NEW: tactical.ts** | matches/{id}/tactical/v1 | tactical | Generated by Step 10 |
| MatchSummaryDoc | **NEW: summary.ts** | matches/{id}/summary/v1 | summary | Generated by Step 11 |
| ImportantSceneDoc | **NEW: scene.ts** | matches/{id}/importantScenes/{sceneId} | importantScenes | Generated by Step 04 |
| GeminiCacheMetadata | **NEW: cache.ts** | matches/{id}/geminiCache/v1 | geminiCache | Generated by Step 03 |

---

## 5. Recommended Type Organization

### Option A: Separate Files (Recommended)
```
packages/shared/src/domain/
├─ match.ts         (existing - MatchDoc)
├─ clip.ts          (existing - ClipDoc)
├─ event.ts         (existing - EventDoc)
├─ stats.ts         (existing - StatsDoc)
├─ settings.ts      (existing - DefaultSettings, RosterItem)
├─ tracking.ts      (existing - Phase 1 types)
├─ passEvent.ts     (existing - PassEventDoc, CarryEventDoc, TurnoverEventDoc + new ShotEventDoc, SetPieceEventDoc)
├─ tactical.ts      [NEW] - TacticalAnalysisDoc, TacticalPattern
├─ summary.ts       [NEW] - MatchSummaryDoc, TeamPerformanceAnalysis
├─ scene.ts         [NEW] - ImportantSceneDoc
└─ cache.ts         [NEW] - GeminiCacheMetadata
```

### Option B: Consolidate Events
```
packages/shared/src/domain/
├─ events.ts (consolidated)
  ├─ EventDoc (existing clip event)
  ├─ PassEventDoc (existing)
  ├─ CarryEventDoc (existing)
  ├─ TurnoverEventDoc (existing)
  ├─ ShotEventDoc (new)
  ├─ SetPieceEventDoc (new)
  └─ TrackedEvent union type
```

---

## 6. Firestore Schema Implications

### Indices to Add (firestore.indexes.json)
```json
{
  "collectionGroup": "shotEvents",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "version", "order": "ASCENDING" },
    { "fieldPath": "timestamp", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "setPieceEvents",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "version", "order": "ASCENDING" },
    { "fieldPath": "setPieceType", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "tactical",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "version", "order": "ASCENDING" },
    { "fieldPath": "generatedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "summary",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "version", "order": "ASCENDING" },
    { "fieldPath": "generatedAt", "order": "DESCENDING" }
  ]
}
```

### Firestore Rules Changes Needed
- Allow read/write to new collections: shotEvents, setPieceEvents, tactical, summary, importantScenes, geminiCache
- Maintain existing security patterns (ownerUid checks via match document)

---

## 7. MetricKeys Extensions (metricKeys.ts)

### New metrics needed for tactical analysis:
```typescript
// Team-level tactical metrics
teamFormation: "team.formation.current",
teamAvgPassRate: "team.tempo.passRatePerMin",
teamAttackEffectiveness: "team.attack.effectiveness",
teamDefenseEffectiveness: "team.defense.effectiveness",

// Advanced shot tracking (new in plan)
teamShotsCount: "team.shots.count",
teamShotsOnTarget: "team.shots.onTarget",
playerShotsCount: "player.shots.count",
playerShotsOnTarget: "player.shots.onTarget",
playerShotsExpectedGoals: "player.shots.expectedGoals",

// Set pieces
teamSetPiecesCount: "team.setPieces.count",
playerSetPieceParticipation: "player.setPieces.involvement",
```

---

## 8. Migration/Compatibility Checklist

### Phase A (Immediate - Required for plan)
- [ ] Add ShotEventDoc type (passEvent.ts or new shot.ts)
- [ ] Add SetPieceEventDoc type (passEvent.ts or new setPiece.ts)
- [ ] Create tactical.ts with TacticalAnalysisDoc
- [ ] Create summary.ts with MatchSummaryDoc
- [ ] Update index.ts exports
- [ ] Add Firestore indices
- [ ] Update metricKeys.ts with new metrics

### Phase B (Optional - For better tracking)
- [ ] Add `source` field to all event types (gemini|manual|hybrid)
- [ ] Add `gemini.model`, `gemini.version` to event docs
- [ ] Extend StatsDoc with `computedFrom` field
- [ ] Add Tier-level tracking to AnalysisStep

### Phase C (Future)
- [ ] Consider consolidating event types into events/union
- [ ] Add validation schemas (Zod) for all new types
- [ ] Add TypeScript strict null checks

---

## 9. Risks & Considerations

### Type Safety
- **Risk**: Gemini output may not perfectly match types
- **Mitigation**: Add parsing/validation layer (Zod or similar) before saving to Firestore

### Firestore Size
- **Risk**: New collections (tactical, summary) add storage/cost
- **Mitigation**: Keep tactical/summary as singleton or limited versioning (max 5 versions)

### Backward Compatibility
- **Risk**: Existing analysis may not have new event types
- **Mitigation**: Make ShotEventDoc, SetPieceEventDoc optional in queries; use defensive checks

### Query Performance
- **Risk**: Need to join event collections for full event picture
- **Mitigation**: Ensure proper indices, consider denormalization to summary doc

---

## 10. Summary Table: Existing vs Required Types

| Type | File | Current Status | Vertex AI Need | Action |
|------|------|---|---|---|
| MatchDoc | match.ts | ✅ Exists | No change | None |
| ClipDoc | clip.ts | ✅ Exists | No change | None |
| EventDoc | event.ts | ✅ Exists | Consider expansion | Minor (optional) |
| PassEventDoc | passEvent.ts | ✅ Exists | No change | None |
| CarryEventDoc | passEvent.ts | ✅ Exists | No change | None |
| TurnoverEventDoc | passEvent.ts | ✅ Exists | No change | None |
| ShotEventDoc | **NEW** | ❌ Missing | **REQUIRED** | **Add to passEvent.ts** |
| SetPieceEventDoc | **NEW** | ❌ Missing | **REQUIRED** | **Add to passEvent.ts** |
| TacticalAnalysisDoc | **NEW** | ❌ Missing | **REQUIRED** | **New tactical.ts** |
| MatchSummaryDoc | **NEW** | ❌ Missing | **REQUIRED** | **New summary.ts** |
| ImportantSceneDoc | **NEW** | ❌ Missing | **Required for Step 04** | **New scene.ts** |
| GeminiCacheMetadata | **NEW** | ❌ Missing | **Required for Step 03** | **New cache.ts** |
| TrackDoc | tracking.ts | ✅ Exists | Optional enhancement | None (Tier 2) |
| StatsDoc | stats.ts | ✅ Exists | No change | None |
| settings | settings.ts | ✅ Exists | No change | None |

---

## Conclusion

**The vertex-ai-expansion-plan is compatible with the existing domain types**, but requires:

1. **6 New Type Definitions** (ShotEventDoc, SetPieceEventDoc, TacticalAnalysisDoc, MatchSummaryDoc, ImportantSceneDoc, GeminiCacheMetadata)
2. **3-4 New Firestore Collections** (shotEvents, setPieceEvents, tactical, summary)
3. **Minor MetricKeys Extensions** (for tactical metrics)
4. **Optional: Type Extensions** to existing PassEventDoc/etc for Gemini metadata

All changes are **additive and non-breaking** to the current schema and should not require migration of existing data.
