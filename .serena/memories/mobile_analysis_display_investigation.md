# Mobile App Analysis Display Issue Investigation

## Issue Summary
新しい分析（Tactical Analysis、Match Summary）がmatches一覧に表示されない問題

## Investigation Findings

### 1. Mobile App Architecture - Firestore Data Flow

#### Matches List Display (apps/mobile/app/(tabs)/index.tsx)
```
useMatches() Hook
├─ Query: collection("matches").where("deviceId", "==", deviceId).orderBy("date", "desc")
├─ Listener: onSnapshot (real-time updates enabled)
└─ Displays: match.analysis?.status (ステータスのみ表示)
   └─ Shows: "idle", "queued", "running", "done", "error"
```

**現在の表示内容:**
- Match title
- Date
- Analysis status badge (match.analysis?.status)
- Last analyzed timestamp (match.analysis?.lastRunAt)

**問題点:** Tactical AnalysisやMatch Summaryは表示されていない
- Firestore path: matches/{matchId}/tactical/current
- Firestore path: matches/{matchId}/summary/current
- これらのサブコレクションは一覧画面に統合されていない

#### Match Detail Screen (apps/mobile/app/match/[id]/index.tsx)
```
Component Hooks:
├─ useMatch(id) - matches/{matchId} document
├─ useStats(id) - matches/{matchId}/stats subcollection
├─ useEvents(id) - events data
├─ usePendingReviews(id) - review tasks
└─ [新規] useTacticalAnalysis(id) - matches/{matchId}/tactical/current
└─ [新規] useMatchSummary(id) - matches/{matchId}/summary/current
```

**Recent Changes (Git diff confirmed):**
- topMoments type修正: clipId を nullable に (clipId: string | null)
- Highlights tab での clipId nullチェック追加
- Tactical View screen に TacticalInsightsコンポーネント統合
- Match Summary Viewコンポーネント追加

### 2. Backend Analysis Pipeline - Status Update Flow

#### Match Document Updates
```
runMatchPipeline() → updateMatchAnalysis()
├─ analysis.status: "idle" → "queued" → "running" → "done" or "error"
├─ analysis.activeVersion: version を更新
├─ analysis.lastRunAt: timestamp 更新
├─ analysis.progress: ProgressDetail (running時のみ)
└─ analysis.errorMessage: error時のみ
```

**Line 146-148 (runMatchPipeline.ts):**
```typescript
const updateMatchAnalysis = async (data: Record<string, unknown>) => {
  await matchRef.set({ analysis: { ...data, lastRunAt: now() } }, { merge: true });
};
```

#### Tactical Analysis Generation (10_generateTacticalInsights.ts)
```
Saves to: matches/{matchId}/tactical/current
- TacticalAnalysisDoc type に従い保存
- formation, tempo, attackPatterns, defensivePatterns, keyInsights
- pressingIntensity, buildUpStyle (optional)
```

#### Match Summary Generation (11_generateMatchSummary.ts)
```
Saves to: matches/{matchId}/summary/current
- MatchSummaryDoc type に従い保存
- headline, narrative, keyMoments, playerHighlights, score, mvp
- Event statistics を基に生成
- Clip-to-moment マッピングで clipId を含める
```

### 3. Data Type Definitions

#### MatchDoc (packages/shared/src/domain/match.ts)
```typescript
type MatchDoc = {
  matchId: string;
  ownerUid: string;
  teamId?: string | null;
  title?: string | null;
  date?: string | null;
  video?: {...};
  settings?: MatchSettings;
  analysis?: {
    status: "idle" | "queued" | "running" | "partial" | "done" | "error";
    activeVersion?: string;
    lastRunAt?: string;
    progress?: AnalysisProgress;
    errorMessage?: string;
    needsRecalculation?: boolean;
    recalculationRequestedAt?: string;
    cost?: {...};
  };
};
```

#### StatsDoc (packages/shared/src/domain/stats.ts)
```typescript
type StatsDoc = {
  statId: string;
  version: string;
  pipelineVersion?: string;
  scope: "match" | "player";
  metrics: Partial<Record<MetricKey, unknown>>;
  confidence: Partial<Record<MetricKey, number>>;
  computedAt: string;
};
```

**Key Metrics for Analysis:**
- match.events.countByLabel: Record<string, number>
- match.events.topMoments: Array<{label, title, clipId, ...}>
- Player metrics: distance, passes, carry, etc.

#### TacticalAnalysisDoc (packages/shared/src/domain/tactical.ts)
- firestore path: matches/{matchId}/tactical/current
- Contains: formation, tempo, attackPatterns, defensivePatterns, keyInsights

#### MatchSummaryDoc (packages/shared/src/domain/tactical.ts)
- firestore path: matches/{matchId}/summary/current
- Contains: headline, narrative, keyMoments, playerHighlights, score, mvp

### 4. New Components Added

#### TacticalInsights Component
- Props: analysis (TacticalAnalysisDoc | null), loading, error, homeColor, awayColor
- Displays: formations, tempo, pressing intensity, build-up style, attack patterns, defensive patterns, key insights

#### MatchSummaryView Component
- Props: summary (MatchSummaryDoc | null), loading, error, matchId, homeColor, awayColor
- Displays: headline, narrative, key moments, player highlights, MVP, score, tags

### 5. Current Issues & Root Causes

#### ISSUE 1: Matches List (ホーム画面)
**Problem:** Tactical AnalysisやMatch Summaryがmatches一覧に表示されない

**Root Cause:**
- useMatches() はmain matches collectionのみ購読
- Subcollections (tactical, summary) の購読なし
- MatchDoc に tactical/summary データが統合されていない
- Frontend が stat キーか summary キーを直接参照していない

**Flow Issue:**
1. ホーム一覧が matches.analysis.status のみ表示
2. 詳細ページで useTacticalAnalysis, useMatchSummary フック実行
3. サブコレクション購読されるが、一覧では反映されない

#### ISSUE 2: Clips List Integration
**Problem:** matchSummary.topMoments の clipId が null の場合がある

**Root Cause (matchSummary.ts: line 148-172):**
```typescript
// Labeled clips から topMoments を作成
if (topMomentsFromClips.length > 0) {
  topMoments = topMomentsFromClips;  // ✓ clipId 有り
} else {
  // Fallback: events をマッチし、clipId を探す
  topMoments = allEvents
    .map(event => ({
      clipId: findClipByTimestamp(event.timestamp),  // ← null の可能性
      ...
    }));
}
```

**Scenario where clipId becomes null:**
1. Gemini labeling で clip に confidence が無い
2. Event-to-clip timestamp matching が失敗
3. findClipByTimestamp が matchingClip を見つけられない (tolerance外)

#### ISSUE 3: Stats Computation
**Problem:** matchStats['match.events.topMoments'] の clipId が UI で null チェックが必要

**Current Implementation (index.tsx line 249-255):**
```typescript
if (moment.clipId) {
  router.push(`/match/${id}/clip/${moment.clipId}`);
}
disabled={!moment.clipId}  // UI disabled when no clip
```

This is defensive programming but indicates upstream data issue.

### 6. Pipeline Verification

#### Step Sequence (runMatchPipeline.ts)
1. extract_meta
2. detect_shots
3. upload_video_to_gemini (Tier 1)
4. extract_clips
5. extract_important_scenes (Tier 1)
6. label_clips → Clips に gemini metadata
7. build_events
8. detect_events_gemini / segment + window + deduplicate
9. identify_players_gemini
10. **generate_tactical_insights** ← Saves to tactical/current
11. **generate_match_summary** ← Saves to summary/current
12. compute_stats → Calls calculators including matchSummary calculator

#### Stats Calculation Order (computeStats line 37-end)
```
runCalculators()
├─ Collects: passEvents, carryEvents, turnoverEvents, shotEvents, setPieceEvents
├─ Feeds to: matchSummary calculator
└─ matchSummary.calcMatchSummary()
   ├─ Source: clips, events, passEvents, carryEvents, etc.
   ├─ Output metric: match.events.topMoments (with clipId)
   └─ Saves to: matches/{matchId}/stats collection
```

### 7. Data Update Timeline

**Firestore Updates in order:**
1. matches/{matchId}/analysis.status = "running"
2. matches/{matchId}/clips/* (extracted)
3. matches/{matchId}/events/* (Gemini labeled)
4. matches/{matchId}/passEvents/* (detected)
5. matches/{matchId}/shots/* 
6. matches/{matchId}/tactical/current ← Step 10
7. matches/{matchId}/summary/current ← Step 11
8. matches/{matchId}/stats/* ← Step 12 (matchStats に topMoments 含む)
9. matches/{matchId}/analysis.status = "done"

**Problem Timing:**
- matchStats が最後に書き込まれる
- その間も matches/{matchId} document は更新中
- useMatches() は status だけ購読→updateは来るが新規データは見えない
- subcollection購読は明示的に必要

## Proposed Solutions

### Solution 1: Matches List Enhancement (推奨)
Display summary data in matches list by:
1. useMatches() で stat キーを追加購読する
2. または matches document に summary データを denormalize する
3. または専用サマリーサブコレクション作成

```typescript
// Option A: Denormalize to matches document
analysis: {
  status: "done",
  lastRunAt: "...",
  summaryPreview?: {  // New field
    topMomentCount: number;
    tacticalAnalysisVersion: string;
  }
}

// Option B: Subscribe in useMatches hook
const useMatches = () => {
  // Subscribe to matches + stats subcollection
  const matchStatsRef = collection(db, "matches", matchId, "stats");
  const tacticalRef = doc(db, "matches", matchId, "tactical", "current");
  // ... combine results
};
```

### Solution 2: Firestore Denormalization
In backend (runMatchPipeline.ts):
```typescript
// After saving tactical/summary, denormalize key data
await matchRef.set({
  analysis: {
    ...,
    lastAnalysis?: {
      tacticalVersion?: string;
      summaryVersion?: string;
      topMomentCount?: number;
      hasKeyMoments?: boolean;
    }
  }
}, { merge: true });
```

### Solution 3: Improved Error Handling
In matchSummary.ts - ensure clipId persistence:
```typescript
// Enhance timestamp matching tolerance
const findClipByTimestamp = (timestamp: number): string | null => {
  const tolerance = 5;  // Increase from 2 seconds
  const matchingClip = clips.find(
    (c) => timestamp >= c.t0 - tolerance && 
           timestamp <= (c.t0 + 10 + tolerance)
  );
  if (!matchingClip) {
    // Fallback: find closest clip
    return clips.reduce((closest, c) => {
      const dist = Math.abs(c.t0 - timestamp);
      return dist < Math.abs(closest.t0 - timestamp) ? c : closest;
    })?.clipId ?? null;
  }
  return matchingClip.clipId;
};
```

### Solution 4: Add Loading States
Frontend should show loading indicators:
```typescript
// In MatchCard component
const status = match.analysis?.status;
const isAnalyzing = status === "running" || status === "queued";
const hasAnalysis = status === "done";

// Show what's analyzing in list
{hasAnalysis && (
  <Text className="text-xs text-muted-foreground">
    Tactical analysis available ✓
  </Text>
)}
```

## Key Files to Monitor

### Backend:
- services/analyzer/src/jobs/steps/10_generateTacticalInsights.ts
- services/analyzer/src/jobs/steps/11_generateMatchSummary.ts
- services/analyzer/src/jobs/steps/06_computeStats.ts
- services/analyzer/src/calculators/matchSummary.ts

### Frontend:
- apps/mobile/lib/hooks/useMatches.ts
- apps/mobile/app/(tabs)/index.tsx
- apps/mobile/lib/hooks/useMatchSummary.ts
- apps/mobile/lib/hooks/useTacticalAnalysis.ts
- apps/mobile/components/MatchSummaryView.tsx
- apps/mobile/components/TacticalInsights.tsx

## Testing Checklist

- [ ] Verify tactical analysis writes to firestore
- [ ] Verify match summary writes to firestore
- [ ] Check topMoments.clipId is not always null
- [ ] Verify useMatches detects new analysis completion
- [ ] Test UI shows analysis available in list after completion
- [ ] Check match detail page loads tactical/summary data
