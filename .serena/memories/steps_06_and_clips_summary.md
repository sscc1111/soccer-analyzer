# Services/analyzer/src/jobs/steps - Stats計算とClip関連ファイル最終サマリー

## 概要

このドキュメントは、以下の3つの質問に対する完全な回答をまとめています：

1. **06_computeStats.ts - statsがどのように計算されているか**
2. **clips コレクションがどこで作成されているか**
3. **Event Breakdown のデータソースはどこか**

---

## 質問1: 06_computeStats.ts - statsがどのように計算されているか

### ファイルの役割

`services/analyzer/src/jobs/steps/06_computeStats.ts` は、パイプラインの最終ステップで、収集された全てのデータを複数の計算器で処理して、統計メトリクスを生成します。

### 処理フロー

```
入力データを Firestore から取得:
├─ shots (version filter)
├─ clips (version filter)
├─ events (version filter)
├─ passEvents (version filter) ← Phase 3.1
├─ carryEvents (version filter) ← Phase 3.2
├─ turnoverEvents (version filter) ← Phase 3.4
├─ possessionSegments (version filter) ← Phase 3.3
└─ trackMappings (unversioned)

↓

runCalculators(context) 実行:

並列実行 (Promise.all):
  ├─ calcMatchSummary()
  │  └─ input: events, passEvents, carryEvents, turnoverEvents
  │     output: matchEventsCountByLabel (event type 集計), matchTopMoments
  │
  ├─ calcPlayerInvolvement()
  │  └─ input: events (involved.players フィールド)
  │     output: playerInvolvementCount per player
  │
  ├─ calcProxySprintIndex()
  │  └─ input: clips (motionScore)
  │     output: playerPeakSpeedIndex, playerSprintCount
  │
  ├─ calcHeatmapV1()
  │  └─ input: settings.formation.assignments
  │     output: playerHeatmapZones (3x3 grid)
  │
  ├─ calcPassesV1()          ← Phase 3.1
  │  └─ input: passEvents, trackMappings
  │     output: playerPassesAttempted, playerPassesCompleted,
  │              playerPassesSuccessRate per player
  │
  ├─ calcCarryV1()           ← Phase 3.2
  │  └─ input: carryEvents
  │     output: playerCarryCount, playerCarryIndex, playerCarryProgressIndex
  │
  ├─ calcPossessionV1()      ← Phase 3.3
  │  └─ input: possessionSegments
  │     output: playerPossessionTimeSec, playerPossessionCount,
  │              teamPossessionPercent
  │
  └─ calcTurnoversV1()       ← Phase 3.4
     └─ input: turnoverEvents
        output: playerTurnoversLost, playerTurnoversWon per player

↓

StatsOutput[] 配列 (複数のスコープとプレイヤーのメトリクス)

↓

Firestore に保存 (batch.set with merge: true):

stats/{statId} = {
  statId: "stat_{version}_{calculatorId}_{playerId_or_match}",
  scope: "match" | "player",
  playerId?: string | null,
  metrics: { [metricKey]: value },
  confidence: { [metricKey]: confidence },
  explanations?: { [metricKey]: text },
  version: string,
  pipelineVersion: string,
  computedAt: timestamp
}
```

### 重要なポイント

1. **複数の入力ソース**:
   - Phase 1: clips を使った既存のメトリクス
   - Phase 3: tracking-based 新しいメトリクス (passEvents, carryEvents, etc.)

2. **Version フィルタリング**: 
   - passEvents, carryEvents, turnoverEvents, possessionSegments は全て version フィルターが必須
   - trackMappings は unversioned

3. **Batch処理**:
   ```typescript
   const batch = db.batch();
   for (const output of outputs) {
     batch.set(statsRef.doc(statId), {...}, { merge: true });
   }
   if (outputs.length > 0) await batch.commit();
   ```
   - merge: true で既存データを上書きせず更新

4. **計算器の実装パターン**:
   ```typescript
   calcPassesV1(ctx: CalculatorContext): Promise<StatsOutput[]>
   // 複数の player-level outputs を返す
   ```

### サンプル出力構造

```javascript
// Match-level stats
{
  statId: "stat_v1_matchSummary_match",
  scope: "match",
  metrics: {
    "match.events.countByLabel": {
      "shot": 5,
      "chance": 12,
      "pass": 156,
      "carry": 98,
      "turnover": 42,
      "dribble": 24,
      "defense": 31,
      "other": 12
    },
    "match.events.topMoments": [
      { eventId: "...", label: "shot", confidence: 0.95, ... },
      ...
    ]
  },
  confidence: {
    "match.events.countByLabel": 0.85,
    "match.events.topMoments": 0.85
  }
}

// Player-level stats
{
  statId: "stat_v1_passesV1_player_001",
  scope: "player",
  playerId: "player_001",
  metrics: {
    "player.passes.attempted": 28,
    "player.passes.completed": 24,
    "player.passes.incomplete": 2,
    "player.passes.intercepted": 2,
    "player.passes.successRate": 86
  },
  confidence: {
    "player.passes.attempted": 0.88,
    "player.passes.completed": 0.88,
    ...
  }
}
```

---

## 質問2: clips コレクションがどこで作成されているか

### 主なステップ

#### Step 03: Extract Clips (`03_extractClips.ts`)

**ファイルパス**: `/services/analyzer/src/jobs/steps/03_extractClips.ts`

**目的**: 動画をモーション/オーディオ分析して、興味深いクリップを抽出

**処理**:

```
1. 入力チェック:
   - match.video.storagePath (動画ファイル位置)
   - match.video.durationSec (動画長)

2. 既存クリップチェック:
   - clips.where("version", "==", version).limit(1).get()
   - 既に存在したら skip

3. FFmpeg 処理:
   - getMotionScores(localPath, MOTION_FPS=1)
     └─ { fps: 1, scores: [{ t: 0, score: 0.15 }, ...] }
   
   - getAudioLevels(localPath, AUDIO_FPS=1)
     └─ [0.05, 0.08, ..., 0.92, ...]

4. ピーク検出 (pickPeaks):
   - 最大値の60%以上で、かつ局所最大値を検出
   - motionPeaks[] と audioPeaks[] を生成

5. クリップウィンドウ生成:
   - 各ピークを中心に ±8/12秒のウィンドウを作成
   - オーバーラップを 1秒以内でマージ

6. トップ選択:
   - スコア順でソート
   - MAX_CLIPS=60 個に制限

7. 各クリップについて:
   a. 動画抽出 (extractClip)
      └─ matches/{matchId}/clips/{version}/{clipId}.mp4
   
   b. サムネイル抽出 (extractThumbnail)
      └─ matches/{matchId}/clips/{version}/{clipId}.jpg
   
   c. プロキシ生成（オプション）
      └─ matches/{matchId}/proxies/{version}/proxy_240p.mp4
   
   d. Firestore 保存
      └─ matches/{matchId}/clips/{clipId}

8. Firestore ドキュメント:
   {
     clipId: "clip_v1_1",
     shotId: "shot_v1_1",
     t0: 107,
     t1: 132,
     reason: "motionPeak",
     media: {
       clipPath: "matches/{matchId}/clips/{version}/clip_v1_1.mp4",
       thumbPath: "matches/{matchId}/clips/{version}/clip_v1_1.jpg"
     },
     motionScore: 0.95,
     version: "v1",
     createdAt: "2024-01-13T10:30:00Z"
   }
```

#### Step 04: Label Clips with Gemini (`04_labelClipsGemini.ts`)

**ファイルパス**: `/services/analyzer/src/jobs/steps/04_labelClipsGemini.ts`

**目的**: Gemini 視覚APIを使ってクリップを分類

**処理**:

```
1. クリップ取得:
   - clips.where("version", "==", version).get()

2. フィルター:
   - gemini.promptVersion !== PROMPT_VERSION のクリップのみ処理

3. 最大30クリップまで:
   - MAX_GEMINI_CLIPS (環境変数)

4. 各クリップについて:
   
   a. サムネイル画像をロード
      └─ thumbPath から GCS ダウンロード
   
   b. Gemini API 呼び出し
      ├─ 入力: 画像 + JSON prompt
      ├─ プロンプト:
      │  {
      │    "label": "shot|chance|setPiece|dribble|defense|other",
      │    "confidence": 0.0-1.0,
      │    "title": "短い説明",
      │    "summary": "詳細説明",
      │    "tags": ["tag1", "tag2"],
      │    "coachTips": ["tip1", "tip2"]
      │  }
      └─ 応答: JSON 形式の結果
   
   c. Batch update with merge:
      └─ clips/{clipId}.gemini = {
           label: "shot",
           confidence: 0.85,
           title: "...",
           summary: "...",
           tags: [...],
           coachTips: [...],
           promptVersion: PROMPT_VERSION,
           model: "gemini-3-flash-preview",
           createdAt: timestamp
         }

5. コスト追跡:
   - match.analysis.cost.geminiCalls += processed
   - match.analysis.cost.estimatedUsd += (GEMINI_COST_PER_CLIP * processed)

6. 環境変数:
   - MAX_GEMINI_CLIPS: 1実行のクリップ数（デフォルト: 30）
   - GEMINI_COST_PER_CLIP_USD: コスト追跡（デフォルト: 0）
```

### Clips コレクション生成の全フロー

```
Step 03: Extract Clips
├─ 入力: 動画ファイル
├─ 処理: モーション/オーディオ分析 → ピーク検出 → クリップ抽出
└─ 出力: clips collection に 60個のドキュメント
   ├─ clipId
   ├─ t0, t1, motionScore
   ├─ media { clipPath, thumbPath }
   └─ gemini: undefined ← まだラベルなし

        ↓

Step 04: Label Clips with Gemini
├─ 入力: clips collection（最大30個/実行）
├─ 処理: Gemini で各クリップを分類
└─ 出力: clips.gemini フィールドに追加
   ├─ label: "shot"
   ├─ confidence: 0.85
   ├─ title, summary, tags, coachTips
   └─ promptVersion: PROMPT_VERSION

        ↓

Step 05: Build Events
├─ 入力: clips collection（gemini.label付き）
├─ 処理: label を正規化 → events に変換
└─ 出力: events collection
   ├─ eventId
   ├─ label (normalized)
   ├─ confidence
   └─ source: "gemini" | "hybrid"
```

---

## 質問3: Event Breakdown のデータソースはどこか

### 「Event Breakdown」とは

モバイルアプリ (`apps/mobile/app/match/[id]/stats.tsx`) で表示される以下のメトリクス：

```
Events by Type:
  - shot: 5
  - chance: 12
  - setPiece: 8
  - dribble: 24
  - defense: 31
  - pass: 156
  - carry: 98
  - turnover: 42
  - other: 12
```

### データソース

#### レイヤー1: Clips-based Events（Step 05）

```
clips collection
├─ clip_v1_1: gemini.label = "shot"
├─ clip_v1_2: gemini.label = "chance"
├─ clip_v1_3: gemini.label = "setPiece"
├─ clip_v1_4: gemini.label = "dribble"
├─ clip_v1_5: gemini.label = "defense"
├─ clip_v1_6: gemini.label = "other"
└─ ...

        ↓ Step 05: Build Events

events collection (clip-based)
├─ event_v1_clip_v1_1: label = "shot"
├─ event_v1_clip_v1_2: label = "chance"
├─ event_v1_clip_v1_3: label = "setPiece"
├─ event_v1_clip_v1_4: label = "dribble"
├─ event_v1_clip_v1_5: label = "defense"
├─ event_v1_clip_v1_6: label = "other"
└─ ...
```

#### レイヤー2: Tracking-based Events（Step 10）

```
tracks collection, ballTrack collection, trackTeamMetas collection
├─ トラッキングデータ
└─ ボール検出データ

        ↓ Step 10: Detect Events

passEvents collection
├─ pass_001: type = "pass"
├─ pass_002: type = "pass"
└─ ... (複数個)

carryEvents collection
├─ carry_001: type = "carry"
└─ ... (複数個)

turnoverEvents collection
├─ turnover_001: type = "turnover"
└─ ... (複数個)
```

#### 集計: calcMatchSummary (Step 06)

ファイル: `/services/analyzer/src/calculators/matchSummary.ts`

```typescript
// 複数のソースを統合
const allEvents = [];

// Source 1: Clips-based events
for (const e of legacyEvents) {  // events collection
  allEvents.push({
    eventId: e.eventId,
    type: e.label,  // "shot", "chance", "setPiece", etc.
    timestamp: 0,
    confidence: e.confidence,
  });
}

// Source 2: Pass events
for (const e of passEvents) {
  allEvents.push({
    eventId: e.eventId,
    type: "pass",
    timestamp: e.timestamp,
    confidence: e.confidence,
    team: e.kicker?.teamId,
    player: e.kicker?.playerId,
  });
}

// Source 3: Carry events
for (const e of carryEvents) {
  allEvents.push({
    eventId: e.eventId,
    type: "carry",
    timestamp: e.startTime,
    confidence: e.confidence,
    team: e.teamId,
    player: e.playerId,
  });
}

// Source 4: Turnover events
for (const e of turnoverEvents) {
  allEvents.push({
    eventId: e.eventId,
    type: "turnover",
    timestamp: e.timestamp,
    confidence: e.confidence,
    team: e.player?.teamId,
    player: e.player?.playerId,
  });
}

// 集計
const counts = {};
for (const event of allEvents) {
  counts[event.type] = (counts[event.type] ?? 0) + 1;
}

// 出力
metrics: {
  "match.events.countByLabel": counts,  // ← Event Breakdown
  "match.events.topMoments": topMoments,
}
```

### モバイルアプリでの表示

ファイル: `apps/mobile/app/match/[id]/stats.tsx`

```typescript
const MATCH_METRICS = [
  {
    key: "matchEventsCountByLabel",
    label: "Events by Type",
    format: (v) => {
      if (!v || typeof v !== "object") return "N/A";
      const counts = v as Record<string, number>;
      return Object.entries(counts)
        .map(([k, c]) => `${k}: ${c}`)
        .join(", ");
    }
  },
  // ...
];

// useStats hook で取得
const [stats] = useStats(matchId);
const matchStats = stats.find((s) => s.scope === "match");
const breakdown = matchStats?.metrics?.matchEventsCountByLabel ?? {};
```

### データフロー完全図

```
モバイルアプリから:
  useStats(matchId) → onSnapshot(matches/{matchId}/stats)

        ↓

Firestore stats collection から取得:
  stat_v1_matchSummary_match
  └─ metrics: {
       matchEventsCountByLabel: { shot: 5, chance: 12, pass: 156, ... }
     }

        ↓

コンポーネントが format 関数で表示:
  "shot: 5, chance: 12, pass: 156, ..."

        ↓

背後でのデータソース:
  ├─ clips.gemini.label (Gemini 分類)
      → events.label (正規化)
      → matchSummary の counts 集計
  │
  ├─ passEvents (tracking-based)
      → matchSummary で "pass" として集計
  │
  ├─ carryEvents (tracking-based)
      → matchSummary で "carry" として集計
  │
  └─ turnoverEvents (tracking-based)
      → matchSummary で "turnover" として集計

全て Step 06 (Compute Stats) の calcMatchSummary で統合
```

---

## PassEvent/CarryEvent/TurnoverEvent → Stats のフロー

### データ型

#### PassEventDoc

```typescript
type PassEventDoc = {
  eventId: string;
  timestamp: number;
  kicker: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    confidence: number;
  };
  receiver: { ... } | null;
  outcome: "complete" | "incomplete" | "intercepted";
  confidence: number;
  // ...
};
```

#### 計算器: calcPassesV1

```typescript
// Input: passEvents[], trackMappings[]
// Output: StatsOutput[] (player-level)

for (const event of passEvents) {
  const kickerPlayerId = getPlayerId(
    event.kicker.trackId,
    event.kicker.playerId,
    trackToPlayer  // trackMappings から build
  );
  
  const stats = getOrCreateStats(kickerPlayerId);
  stats.attempted++;
  
  switch (event.outcome) {
    case "complete": stats.completed++; break;
    case "incomplete": stats.incomplete++; break;
    case "intercepted": stats.intercepted++; break;
  }
}

// Output
{
  calculatorId: "passesV1",
  scope: "player",
  playerId: "player_001",
  metrics: {
    playerPassesAttempted: 28,
    playerPassesCompleted: 24,
    playerPassesIncomplete: 2,
    playerPassesIntercepted: 2,
    playerPassesSuccessRate: 86
  },
  confidence: { ... }
}
```

### 他の計算器

| 計算器 | 入力 | 出力メトリクス |
|--------|------|---------------|
| `calcCarryV1` | carryEvents[] | playerCarryCount, playerCarryIndex, playerCarryProgressIndex |
| `calcPossessionV1` | possessionSegments[] | playerPossessionTimeSec, playerPossessionCount, teamPossessionPercent |
| `calcTurnoversV1` | turnoverEvents[] | playerTurnoversLost, playerTurnoversWon |

---

## 重要な関係図

### File Dependencies

```
Step 03: 03_extractClips.ts
  ├─ ffmpeg.ts (FFmpeg operations)
  └─ Firestore output: clips collection

Step 04: 04_labelClipsGemini.ts
  ├─ Input: clips collection
  ├─ gemini/labelClip.ts (Gemini API)
  └─ Output: clips.gemini field

Step 05: 05_buildEvents.ts
  ├─ Input: clips collection (gemini.label)
  └─ Output: events collection

Step 06: 06_computeStats.ts
  ├─ Input: shots, clips, events, pass/carry/turnover Events, trackMappings
  ├─ calculators/registry.ts
  │  ├─ calculators/matchSummary.ts
  │  ├─ calculators/passesV1.ts
  │  ├─ calculators/carryV1.ts
  │  ├─ calculators/possessionV1.ts
  │  ├─ calculators/turnoversV1.ts
  │  ├─ calculators/playerInvolvement.ts
  │  ├─ calculators/proxySprintIndex.ts
  │  └─ calculators/heatmapV1.ts
  └─ Output: stats collection

Step 10: 10_detectEvents.ts
  ├─ Input: tracks, ballTrack, trackTeamMetas, trackMappings
  ├─ detection/events.ts (event detection logic)
  └─ Output: passEvents, carryEvents, turnoverEvents, possessionSegments
```

---

## 要約表

| 項目 | ファイル | 入力 | 出力 | 主要処理 |
|------|---------|------|------|---------|
| **Clips生成** | 03_extractClips.ts | 動画 | clips | FFmpeg分析 + ピーク検出 |
| **Clips分類** | 04_labelClipsGemini.ts | clips (thumbnail) | clips.gemini | Gemini分類 |
| **Events作成** | 05_buildEvents.ts | clips.gemini | events | ラベル正規化 |
| **Event検出（追跡）** | 10_detectEvents.ts | tracks + ballTrack | passEvents, carryEvents, turnoverEvents | 近接分析 |
| **Stats計算** | 06_computeStats.ts | 全コレクション | stats | 8つの計算器実行 |
| **Event Breakdown** | matchSummary.ts | events + pass/carry/turnover | counts by type | 全イベント集計 |

---

## メトリクスキー対応表

### Event Breakdown に含まれるキー

```typescript
// packages/shared/src/metricKeys.ts
matchEventsCountByLabel: "match.events.countByLabel"
matchTopMoments: "match.events.topMoments"
```

### Pass関連メトリクス

```typescript
playerPassesAttempted: "player.passes.attempted"
playerPassesCompleted: "player.passes.completed"
playerPassesIncomplete: "player.passes.incomplete"
playerPassesIntercepted: "player.passes.intercepted"
playerPassesSuccessRate: "player.passes.successRate"
```

### Carry関連メトリクス

```typescript
playerCarryCount: "player.carry.count"
playerCarryIndex: "player.carry.index"
playerCarryProgressIndex: "player.carry.progressIndex"
playerCarryMeters: "player.carry.meters"  // キャリブレーション時のみ
```

### Possession関連メトリクス

```typescript
playerPossessionTimeSec: "player.possession.timeSec"
playerPossessionCount: "player.possession.count"
teamPossessionPercent: "team.possession.percent"
```

### Turnover関連メトリクス

```typescript
playerTurnoversLost: "player.turnovers.lost"
playerTurnoversWon: "player.turnovers.won"
```

---

## 最終チェックリスト

### 06_computeStats.ts 理解度

- [x] 複数のコレクションから version フィルターでデータ取得
- [x] 8つの計算器を並列実行
- [x] 各計算器が複数の StatsOutput を返す
- [x] Stats を Firestore に batch.set で保存
- [x] merge: true で既存データを保持

### Clips コレクション理解度

- [x] Step 03 で FFmpeg でモーション/オーディオ分析
- [x] ピーク検出とウィンドウ生成ロジック
- [x] Step 04 で Gemini で各クリップを分類
- [x] clips.gemini フィールドに label, confidence, title, summary 等を保存
- [x] サムネイルと動画ファイルは GCS に保存

### Event Breakdown データソース理解度

- [x] Clips-based events (events collection) からカウント
- [x] Pass/Carry/Turnover events (tracking-based) からもカウント
- [x] calcMatchSummary が全ソースを統合
- [x] matchEventsCountByLabel メトリクスに集計結果を格納
- [x] モバイルアプリが stats から取得して表示
