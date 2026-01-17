# Clip-Event Matcher Architecture

## システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                     Clip-Event Matcher System                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Input Data Layer                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐           ┌──────────────────┐            │
│  │     Clips        │           │     Events       │            │
│  ├──────────────────┤           ├──────────────────┤            │
│  │ - id             │           │ - id             │            │
│  │ - startTime      │           │ - timestamp      │            │
│  │ - endTime        │           │ - type           │            │
│  └──────────────────┘           │ - details        │            │
│                                  └──────────────────┘            │
│                                                                   │
│  ┌────────────────────────────────────────────┐                 │
│  │          Match Context (Optional)          │                 │
│  ├────────────────────────────────────────────┤                 │
│  │ - matchMinute                              │                 │
│  │ - totalMatchMinutes                        │                 │
│  │ - scoreDifferential                        │                 │
│  │ - isHomeTeam                               │                 │
│  └────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Matching Engine Layer                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────┐         │
│  │         matchClipToEvents(clip, events)            │         │
│  └────────────────────────────────────────────────────┘         │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────┐        │
│  │          Temporal Matching Algorithm                │        │
│  ├─────────────────────────────────────────────────────┤        │
│  │                                                       │        │
│  │  1. Calculate clipCenter = (start + end) / 2        │        │
│  │  2. For each event:                                  │        │
│  │     - Calculate temporalOffset                       │        │
│  │     - Determine matchType:                           │        │
│  │       • exact:     event in [start, end]            │        │
│  │       • overlap:   offset ≤ clipDuration/2          │        │
│  │       • proximity: offset ≤ tolerance (2.0s)        │        │
│  │     - Calculate confidence (0-1)                     │        │
│  │  3. Calculate importanceBoost from event type       │        │
│  │  4. Sort matches by confidence                       │        │
│  │                                                       │        │
│  └─────────────────────────────────────────────────────┘        │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────┐               │
│  │         ClipEventMatch[]                     │               │
│  ├──────────────────────────────────────────────┤               │
│  │ - clipId, eventId                            │               │
│  │ - matchType: exact|overlap|proximity         │               │
│  │ - confidence: 0-1                            │               │
│  │ - temporalOffset: seconds                    │               │
│  │ - importanceBoost: 0-1                       │               │
│  └──────────────────────────────────────────────┘               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Importance Scoring Layer                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   calculateClipImportance(clip, matches, context)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                Four Component Calculation                  │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │                                                              │ │
│  │  1. BASE IMPORTANCE                                         │ │
│  │     ├─ Top match importance × confidence                   │ │
│  │     └─ Weight from EVENT_TYPE_WEIGHTS                      │ │
│  │                                                              │ │
│  │  2. EVENT TYPE BOOST                                        │ │
│  │     ├─ Additional events (exponential decay)               │ │
│  │     └─ Capped at 30% of total                              │ │
│  │                                                              │ │
│  │  3. CONTEXT BOOST                                           │ │
│  │     ├─ Late match time (80%+): up to +15%                  │ │
│  │     ├─ Close score (0-1 diff): +10%                        │ │
│  │     └─ Behind team goal: +15%                              │ │
│  │                                                              │ │
│  │  4. RARITY BOOST                                            │ │
│  │     ├─ From RARITY_WEIGHTS                                 │ │
│  │     └─ Capped at 20% of total                              │ │
│  │                                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────┐               │
│  │      ClipImportanceFactors                   │               │
│  ├──────────────────────────────────────────────┤               │
│  │ - baseImportance                             │               │
│  │ - eventTypeBoost                             │               │
│  │ - contextBoost                               │               │
│  │ - rarityBoost                                │               │
│  │ - finalImportance (sum, capped at 1.0)      │               │
│  └──────────────────────────────────────────────┘               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Ranking Layer                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │   rankClipsByImportance(clips, events, context)      │       │
│  └──────────────────────────────────────────────────────┘       │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  For each clip:                                        │     │
│  │    1. Match to events                                  │     │
│  │    2. Calculate importance                             │     │
│  │    3. Create RankedClip                                │     │
│  └────────────────────────────────────────────────────────┘     │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  Sort by finalImportance (descending)                  │     │
│  │  Assign ranks (1, 2, 3, ...)                           │     │
│  └────────────────────────────────────────────────────────┘     │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────┐               │
│  │           RankedClip[]                       │               │
│  ├──────────────────────────────────────────────┤               │
│  │ - clip: Clip                                 │               │
│  │ - matches: ClipEventMatch[]                  │               │
│  │ - importance: ClipImportanceFactors          │               │
│  │ - rank: number                               │               │
│  └──────────────────────────────────────────────┘               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Output/Filtering Layer                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │   getTopClips    │  │ filterClipsByImp │  │ rankClipsByImp│ │
│  │   (topN)         │  │ (threshold)      │  │ (all)         │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
│          │                      │                      │         │
│          └──────────────────────┴──────────────────────┘         │
│                              │                                    │
│                              ▼                                    │
│              ┌──────────────────────────────┐                    │
│              │    Filtered RankedClip[]     │                    │
│              └──────────────────────────────┘                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## データフロー図

```
┌──────────────────────────────────────────────────────────────────┐
│                         Data Flow                                 │
└──────────────────────────────────────────────────────────────────┘

Input Clips (n clips)  ─┐
                        ├──> matchClipToEvents ──> ClipEventMatch[]
Input Events (m events)─┘                                │
                                                          │
                                                          ▼
Match Context ──────────────────────────────> calculateClipImportance
                                                          │
                                                          ▼
                                              ClipImportanceFactors
                                                          │
                                                          │
        ┌─────────────────────────────────────────────────┘
        │
        ▼
rankClipsByImportance ──> Sort by finalImportance ──> RankedClip[]
        │
        ├──> getTopClips(N) ──────────────────────> Top N RankedClip[]
        │
        └──> filterClipsByImportance(threshold) ──> Filtered RankedClip[]
```

## イベントタイプ重要度マップ

```
                    Event Type Importance Hierarchy

                           1.0  ══════════════
                                    GOAL
                           0.95 ══════════════
                                   PENALTY
                           0.9  ══════════════
                                  RED_CARD
                           0.85 ══════════════
                                  OWN_GOAL

                           0.75 ══════════════
                                    SAVE
                           0.7  ══════════════
                                    SHOT
                           0.65 ══════════════
                                   CHANCE

                           0.6  ══════════════
                                  KEY_PASS
                           0.55 ══════════════
                               FOUL, YELLOW_CARD
                           0.5  ══════════════
                               SETPIECE, TACKLE

                           0.45 ══════════════
                                  TURNOVER
                           0.3  ══════════════
                                    PASS
                           0.25 ══════════════
                                   CARRY
```

## マッチング信頼度計算

```
                        Confidence Calculation

     Clip Timeline:    [──────────────────────]
                       start      center      end

     Event Position:

     1. EXACT MATCH (0.7 - 1.0)
        ────────────●────────────
                 Event inside clip
        confidence = 1.0 at center
                   = 0.7 at edges

     2. OVERLAP MATCH (0.4 - 0.7)
        ●───────────────────────  or  ───────────────────────●
        Event near clip                   Event near clip
        (within clipDuration/2)           (within clipDuration/2)

     3. PROXIMITY MATCH (0.2 - 0.4)
        ●                     or                          ●
        Event close            Event close
        (within tolerance)     (within tolerance)

     4. NO MATCH (confidence = 0)
        ●                                                      ●
        Too far                                           Too far
```

## 重要度計算フロー

```
                    Importance Calculation Flow

    ClipEventMatch[]
          │
          ├─> Top Match ──────────────────> Base Importance
          │                                  (boost × confidence)
          │
          ├─> Additional Matches ─────────> Event Type Boost
          │   (exponential decay)            (max 30%)
          │
          ▼
    Match Context?
          │
          ├─> Match Time ─────────────────> Context Boost
          │   (80%+ → +15%)                 (max 30%)
          │
          ├─> Score Differential ─────────>
          │   (close score → +10%)
          │   (behind → +15%)
          │
          ▼
    Event Types
          │
          └─> Rarity Weights ─────────────> Rarity Boost
              (rare events)                 (max 20%)

                      │
                      ▼
          ┌───────────────────────┐
          │  Sum All Components   │
          │  Cap at 1.0           │
          └───────────────────────┘
                      │
                      ▼
              Final Importance (0-1)
```

## 統合アーキテクチャ

```
┌────────────────────────────────────────────────────────────────┐
│                    Soccer Analyzer Pipeline                     │
└────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  Step 1: Upload Video to Gemini                             │
  └─────────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Step 2: Extract Important Scenes (Gemini)                  │
  │          → ImportantSceneDoc[]                               │
  └─────────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Step 3: Detect Events (Gemini)                             │
  │          → DeduplicatedEvent[]                               │
  └─────────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Step 4: Clip-Event Matcher (NEW!)                          │
  │  ├─ Convert ImportantSceneDoc → Clip                        │
  │  ├─ Convert DeduplicatedEvent → Event                       │
  │  ├─ Match clips to events                                   │
  │  ├─ Calculate importance scores                             │
  │  └─ Re-rank scenes by importance                            │
  │          → RankedClip[]                                      │
  └─────────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Step 5: Filter & Store Top Clips                           │
  │          → Store to Firestore                                │
  └─────────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Frontend: Display Ranked Highlights                        │
  └─────────────────────────────────────────────────────────────┘
```

## パフォーマンス特性

```
Time Complexity Analysis:

matchClipToEvents(1 clip, m events):
  O(m) - iterate through all events
  O(m log m) - sort matches by confidence
  Total: O(m log m)

calculateClipImportance(1 clip, k matches):
  O(k) - iterate through matches
  Total: O(k) where k << m

rankClipsByImportance(n clips, m events):
  O(n × m log m) - match all clips
  O(n × k) - calculate importance
  O(n log n) - sort clips
  Total: O(n × m log m)

Space Complexity:
  O(n × k) where k = average matches per clip
  Typically k = 1-5, so O(n) in practice
```

## まとめ

このアーキテクチャは、クリップとイベントの時間的な関連性を判定し、
複数の要素（イベントタイプ、試合状況、希少性）を考慮した
包括的な重要度スコアリングシステムを提供します。

モジュラー設計により、各レイヤーが独立してテスト可能で、
拡張性も高くなっています。
