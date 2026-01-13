# Stats計算とClip生成フロー - 詳細分析レポート

## エグゼクティブサマリー

このドキュメントは、`services/analyzer/src/jobs/steps/` ディレクトリ内でstats計算とclip生成がどのように行われているかを詳細に説明しています。

### 主なポイント

1. **Clipsの生成**: Step 03 (`03_extractClips.ts`) で動画からモーション/オーディオピークを検出して生成
2. **Events → Stats フロー**: Clipsから「イベント」に変換 → さらに「統計情報」に変換
3. **Event Breakdown データソース**: 複数のソース（clips-based events + Gemini-detected events）から集約
4. **Stats計算**: `06_computeStats.ts` で複数の計算器を実行してメトリクスを生成

---

## 1. Clips生成フロー（Step 03: Extract Clips）

### ファイル: `/services/analyzer/src/jobs/steps/03_extractClips.ts`

#### 目的
動画ファイルから興味深いクリップ（12秒前後）を抽出し、Firestoreに保存する。

#### 処理フロー

```
動画ファイル
    ↓
モーション分析（1 FPS） → モーションスコア配列
オーディオ分析（1 FPS）  → オーディオレベル配列
    ↓
ピーク検出（60%閾値）
    ├─ モーションピーク検出 (pickPeaks)
    └─ オーディオピーク検出 (pickPeaks)
    ↓
クリップウィンドウ生成
    ├─ ピーク前 8秒 + ピーク後 12秒 = 最大20秒ウィンドウ
    └─ オーバーラップするウィンドウはマージ（1秒の隙間でマージ）
    ↓
トップ60クリップ選択 (スコア順)
    ↓
各クリップについて
    ├─ 動画抽出
    ├─ サムネイル抽出
    ├─ プロキシ動画生成（240p）
    └─ Firestoreに保存
        ↓
    Firestore: matches/{matchId}/clips/{clipId}
```

#### 保存されるClipドキュメント

```typescript
type ClipDoc = {
  clipId: string;           // "clip_v1_1", "clip_v1_2", etc.
  shotId: string;           // どのショット内のクリップか
  t0: number;              // 開始時刻（秒）
  t1: number;              // 終了時刻（秒）
  reason: string;           // "motionPeak" | "audioPeak" | "other"
  media: {
    clipPath: string;      // GCS パス: matches/{matchId}/clips/{version}/{clipId}.mp4
    thumbPath: string;     // GCS パス: matches/{matchId}/clips/{version}/{clipId}.jpg
  };
  motionScore: number;     // 0-1 の正規化スコア
  version: string;         // パイプラインバージョン
  createdAt: string;       // ISO時刻
};
```

#### 重要な定数
- `MAX_CLIPS`: 60 - 最大クリップ数
- `CLIP_TARGET_SEC`: 12 - 目標クリップ長（秒）
- `MOTION_FPS`: 1 - モーション分析の周波数
- `AUDIO_FPS`: 1 - オーディオ分析の周波数
- `PEAK_WINDOW_BEFORE`: 8 - ピーク前のウィンドウ（秒）
- `PEAK_WINDOW_AFTER`: 12 - ピーク後のウィンドウ（秒）
- `MERGE_GAP_SEC`: 1 - ウィンドウマージ判定の隙間（秒）

#### 処理の詳細

**ピーク検出 (`pickPeaks` 関数)**:
```typescript
function pickPeaks(values: { t: number; score: number }[], ratio: number) {
  // 最大値の60%以上で、かつ局所最大値がピーク
  const max = values.reduce((m, v) => Math.max(m, v.score), 0);
  const threshold = max * ratio;  // 0.6 = 60%
  
  for (let i = 1; i < values.length - 1; i++) {
    const cur = values[i].score;
    const prev = values[i - 1].score;
    const next = values[i + 1].score;
    if (cur >= threshold && cur >= prev && cur >= next) {
      // これはピーク
    }
  }
}
```

**ウィンドウマージ (`mergeWindows` 関数)**:
```typescript
// 隣接するウィンドウをマージ（t1 + gapSec 以内なら統合）
// t0: 開始時刻, t1: 終了時刻, score: 信頼度
// スコアと理由（motionPeak/audioPeak）は最大値を取る
```

---

## 2. Events生成フロー（Step 05: Build Events）

### ファイル: `/services/analyzer/src/jobs/steps/05_buildEvents.ts`

#### 目的
Step 04で作成されたgemini labelsをイベントドキュメントに変換する。

#### 処理フロー

```
Clips（gemini.label付き）
    ↓
各クリップについて
    ├─ gemini.label を normalize して label に変換
    │   "shot" → "shot"
    │   "chance" → "chance"
    │   "setpiece" → "setPiece"
    │   "dribble" → "dribble"
    │   "defense" → "defense"
    │   その他 → "other"
    │
    ├─ 既存の manual edit を保持
    │   ├─ source が "manual" または "hybrid" なら手動編集あり
    │   └─ 手動値を優先（label, title, summary, confidence）
    │
    └─ EventDoc作成 → Firestoreに保存
        ↓
        Firestore: matches/{matchId}/events/{eventId}
```

#### 保存されるEventドキュメント

```typescript
type EventDoc = {
  eventId: string;                          // "event_v1_clip_001"
  clipId: string;                           // 元のクリップID
  label: string;                            // "shot", "chance", "setPiece", etc.
  confidence: number;                       // gemini.confidenceから取得
  title?: string | null;                    // gemini.title
  summary?: string | null;                  // gemini.summary
  source: "gemini" | "manual" | "hybrid";   // geminiかmanualか両方か
  involved?: {                              // 関連プレイヤー（optionalフィールド）
    players?: { playerId: string; confidence: number }[];
  };
  createdAt: string;                        // 作成日時（既存イベントなら保持）
  version: string;                          // パイプラインバージョン
};
```

#### 重要なロジック

```typescript
// Source の決定ロジック
const hasManual = existing?.source === "manual" || existing?.source === "hybrid";
const source = hasManual ? "hybrid" : "gemini";

// 既存に manual edit があったら、そちらを優先
if (hasManual) {
  eventDoc.label = existing?.label ?? eventDoc.label;
  eventDoc.title = existing?.title ?? eventDoc.title;
  eventDoc.summary = existing?.summary ?? eventDoc.summary;
  eventDoc.confidence = existing?.confidence ?? eventDoc.confidence;
}
```

---

## 3. Step 04: Label Clips with Gemini

### ファイル: `/services/analyzer/src/jobs/steps/04_labelClipsGemini.ts`

#### 目的
抽出されたクリップをGemini vision APIで分類し、ラベルを付与する。

#### 処理フロー

```
Clips（gemini.label未設定）
    ↓
最大30クリップまで
    ├─ サムネイル画像をロード
    ├─ Gemini API呼び出し
    │   ├─ 入力: クリップのサムネイル画像 + JSON prompt
    │   ├─ プロンプト内容:
    │   │   - label: "shot", "chance", "setPiece", "dribble", "defense", "other"
    │   │   - confidence: 0.0-1.0
    │   │   - title: 短い説明
    │   │   - summary: 詳細説明
    │   │   - tags: キーワード配列
    │   │   - coachTips: コーチのアドバイス
    │   │
    │   └─ 応答: JSON形式の結果
    │
    ├─ 結果をClipドキュメントに保存
    │   └─ batch.set({
    │       gemini: {
    │         label: "shot",
    │         confidence: 0.85,
    │         title: "...",
    │         summary: "...",
    │         tags: [...],
    │         coachTips: [...],
    │         promptVersion: "v1",
    │         createdAt: "..."
    │       }
    │     })
    │
    └─ コスト追跡（MAX_GEMINI_CLIPS = 30）
        ↓
        Firestore: matches/{matchId}/clips/{clipId}
```

#### 環境変数

- `MAX_GEMINI_CLIPS`: 実行ごとに処理するクリップ数（デフォルト: 30）
- `GEMINI_COST_PER_CLIP_USD`: コスト追跡用（デフォルト: 0）

---

## 4. Stats計算フロー（Step 06: Compute Stats）

### ファイル: `/services/analyzer/src/jobs/steps/06_computeStats.ts`

#### 目的
収集されたデータから複数の計算器を実行して、統計メトリクスを生成する。

#### 処理フロー

```
Firestore データ収集
    ├─ shots (version filter)
    ├─ clips (version filter)
    ├─ events (version filter)      ← clips から変換されたイベント
    ├─ passEvents (version filter)
    ├─ carryEvents (version filter)
    ├─ turnoverEvents (version filter)
    ├─ possessionSegments (version filter)
    └─ trackMappings (unversioned)
        ↓
    runCalculators(context) 実行
        ├─ calcMatchSummary(context)      → matchレベルのメトリクス
        ├─ calcPlayerInvolvement(context) → playerレベルのメトリクス
        ├─ calcProxySprintIndex(context)
        ├─ calcHeatmapV1(context)
        ├─ calcPassesV1(context)          ← passEventsを使用
        ├─ calcCarryV1(context)           ← carryEventsを使用
        ├─ calcPossessionV1(context)      ← possessionSegmentsを使用
        └─ calcTurnoversV1(context)       ← turnoverEventsを使用
        ↓
    StatsOutput[] 配列を取得
        ↓
    各出力について Firestore に保存
        ↓
        Firestore: matches/{matchId}/stats/{statId}
        statId = "stat_{version}_{calculatorId}_{playerId_or_match}"
```

#### 保存されるStatsドキュメント

```typescript
type StatsDoc = {
  statId: string;                           // 自動生成: "stat_v1_matchSummary_match"
  scope: "match" | "player";                // マッチレベルかプレイヤーレベル
  playerId?: string | null;                 // player scopeの場合プレイヤーID
  metrics: Partial<Record<MetricKey, unknown>>;  // メトリクスデータ
  confidence: Partial<Record<MetricKey, number>>; // 各メトリクスの信頼度
  explanations?: Partial<Record<MetricKey, string>>; // 説明文
  version: string;                          // パイプラインバージョン
  pipelineVersion: string;                  // 同上
  computedAt: string;                       // 計算時刻
};
```

---

## 5. Event Breakdown データソース

### 「Event Breakdown」とは？

モバイルアプリの stats.tsx で表示される、イベント数をタイプ別に集計したデータです。

```
Events by Type:
  - shot: 5
  - chance: 12
  - setPiece: 8
  - dribble: 24
  - defense: 31
  - other: 18
```

### データソース（複数のレイヤー）

#### レイヤー1: Clips-based Events（Step 05）

```
clips collection
    ├─ gemini.label: "shot"
    ├─ gemini.label: "chance"
    ├─ gemini.label: "setPiece"
    ├─ gemini.label: "dribble"
    ├─ gemini.label: "defense"
    └─ gemini.label: "other"
        ↓
    events collection に変換
        └─ label = normalized gemini.label
            ↓
            matchSummary.ts で集計
```

#### レイヤー2: Gemini-detected Events（Step 10）

```
passEvents collection     ← Step 10 detectAllEvents から生成
carryEvents collection
turnoverEvents collection
    ↓
    matchSummary.ts で集計
        ├─ passEvents → type: "pass"
        ├─ carryEvents → type: "carry"
        └─ turnoverEvents → type: "turnover"
```

### 計算: matchSummary Calculator

ファイル: `/services/analyzer/src/calculators/matchSummary.ts`

```typescript
export async function calcMatchSummary(ctx: CalculatorContext): Promise<StatsOutput> {
  // ソース1: Legacy events (clips から変換)
  const legacyEvents = ctx.events ?? [];
  
  // ソース2: Gemini-detected events
  const passEvents = ctx.passEvents ?? [];
  const carryEvents = ctx.carryEvents ?? [];
  const turnoverEvents = ctx.turnoverEvents ?? [];
  
  // 全イベントを統合
  const allEvents: EventLike[] = [];
  
  // Legacy イベントを追加
  for (const e of legacyEvents) {
    allEvents.push({
      eventId: e.eventId,
      type: e.label,  // "shot", "chance", etc.
      timestamp: 0,
      confidence: e.confidence,
    });
  }
  
  // Gemini イベントを追加
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
  
  // 同様に carryEvents, turnoverEvents も追加
  
  // イベント数をタイプ別に集計
  const counts: Record<string, number> = {};
  for (const event of allEvents) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  
  // 結果を保存
  return {
    calculatorId: "matchSummary",
    scope: "match",
    metrics: {
      [metricKeys.matchEventsCountByLabel]: counts,  // ← これが Event Breakdown
      [metricKeys.matchTopMoments]: topMoments,
    },
    confidence: {
      [metricKeys.matchEventsCountByLabel]: Math.min(0.9, avgConfidence + 0.1),
      [metricKeys.matchTopMoments]: Math.min(0.9, avgConfidence + 0.1),
    },
  };
}
```

#### MetricKey定義

```typescript
// packages/shared/src/metricKeys.ts
matchEventsCountByLabel: "match.events.countByLabel"   // イベント数集計
matchTopMoments: "match.events.topMoments"             // トップモーメント
```

#### モバイルアプリでの表示

```typescript
// apps/mobile/app/match/[id]/stats.tsx
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
  {
    key: "matchTopMoments",
    label: "Top Moments",
    // ...
  },
  // ...
];
```

---

## 6. Stats計算パイプライン全体図

### Phase 1: Clip-based Stats（既存）

```
↓ Step 03: Extract Clips
clips collection
↓ Step 04: Label Clips (Gemini)
clips.gemini.label populated
↓ Step 05: Build Events
events collection (label, confidence, title, summary)
↓ Step 06: Compute Stats
  ├─ matchSummary
  │   ├─ matchEventsCountByLabel ← events.label を集計
  │   └─ matchTopMoments
  ├─ playerInvolvement
  └─ proxySprintIndex
    ↓
stats collection (match-level)
```

### Phase 2: Tracking-based Stats（新規）

```
↓ Step 07: Detect Players (YOLO)
tracks collection (player positions)
↓ Step 08: Classify Teams (K-means)
trackTeamMetas collection
↓ Step 09: Detect Ball (YOLO + Kalman)
ballTrack collection
↓ Step 10: Detect Events (proximity analysis)
  ├─ possessionSegments collection
  ├─ passEvents collection
  ├─ carryEvents collection
  ├─ turnoverEvents collection
  └─ pendingReviews collection
↓ Step 06: Compute Stats
  ├─ matchSummary
  │   ├─ matchEventsCountByLabel ← pass/carry/turnover も集計
  │   └─ matchTopMoments
  ├─ passesV1 ← passEvents を集計
  ├─ carryV1 ← carryEvents を集計
  ├─ possessionV1 ← possessionSegments を集計
  ├─ turnoversV1 ← turnoverEvents を集計
  ├─ heatmapV1
  └─ calcPlayerInvolvement
    ↓
stats collection (both match-level and player-level)
```

---

## 7. 重要なデータ型の詳細

### PassEventDoc

```typescript
type PassEventDoc = {
  eventId: string;
  matchId: string;
  type: "pass";
  frameNumber: number;       // フレーム番号
  timestamp: number;         // 秒単位
  kicker: {
    trackId: string;         // どのトラック（プレイヤー）がキック
    playerId: string | null; // マップされたプレイヤーID
    teamId: TeamId;          // "home" | "away"
    position: Point2D;       // フィールド上の位置
    confidence: number;
  };
  receiver: {
    trackId: string | null;
    playerId: string | null;
    teamId: TeamId | null;
    position: Point2D | null;
    confidence: number;
  } | null;  // incomplete/intercepted の場合は null
  outcome: "complete" | "incomplete" | "intercepted";
  outcomeConfidence: number;
  passType?: "short" | "medium" | "long" | "through" | "cross";
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
  source: "auto" | "manual" | "corrected";
  version: string;
  createdAt: string;
};
```

### CarryEventDoc

```typescript
type CarryEventDoc = {
  eventId: string;
  matchId: string;
  type: "carry";
  trackId: string;           // プレイヤーのトラックID
  playerId: string | null;   // マップされたプレイヤーID
  teamId: TeamId;
  startFrame: number;
  endFrame: number;
  startTime: number;
  endTime: number;
  startPosition: Point2D;
  endPosition: Point2D;
  carryIndex: number;        // 相対的な移動距離（正規化）
  progressIndex: number;     // 前進度（攻撃方向を考慮）
  distanceMeters?: number;   // キャリブレーション有時のみ
  confidence: number;
  version: string;
  createdAt: string;
};
```

### TurnoverEventDoc

```typescript
type TurnoverEventDoc = {
  eventId: string;
  matchId: string;
  type: "turnover";
  turnoverType: "lost" | "won";
  frameNumber: number;
  timestamp: number;
  player: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    position: Point2D;
  };
  otherPlayer?: {
    trackId: string;
    playerId: string | null;
    teamId: TeamId;
    position: Point2D;
  };
  context?: "tackle" | "interception" | "bad_touch" | "out_of_bounds" | "other";
  confidence: number;
  needsReview: boolean;
  version: string;
  createdAt: string;
};
```

---

## 8. Calculator詳細: passesV1

ファイル: `/services/analyzer/src/calculators/passesV1.ts`

### 処理フロー

```typescript
const passEvents = ctx.passEvents ?? [];
const trackMappings = ctx.trackMappings ?? [];

// trackMappings: trackId → playerId のマッピング
const trackToPlayer = buildTrackToPlayerMap(trackMappings);

// プレイヤー別にパス統計を集計
const playerStats = new Map<string, PlayerPassStats>();

for (const event of passEvents) {
  const kickerPlayerId = getPlayerId(
    event.kicker.trackId,
    event.kicker.playerId,
    event.kicker.teamId,
    trackToPlayer
  );
  
  const stats = getOrCreateStats(kickerPlayerId);
  stats.attempted++;
  stats.totalConfidence += event.confidence;
  
  if (event.outcome === "complete") {
    stats.completed++;
  } else if (event.outcome === "incomplete") {
    stats.incomplete++;
  } else if (event.outcome === "intercepted") {
    stats.intercepted++;
  }
}

// 出力
for (const stats of playerStats.values()) {
  outputs.push({
    calculatorId: "passesV1",
    scope: "player",
    playerId: stats.playerId,
    metrics: {
      playerPassesAttempted: stats.attempted,
      playerPassesCompleted: stats.completed,
      playerPassesIncomplete: stats.incomplete,
      playerPassesIntercepted: stats.intercepted,
      playerPassesSuccessRate: Math.round(successRate * 100),
    },
    confidence: {
      [metricKeys.playerPassesAttempted]: avgConfidence,
      // 全メトリクスに同じ信頼度を適用
    },
  });
}
```

### プレイヤーID取得ロジック

```typescript
function getPlayerId(
  trackId: string | undefined,
  playerId: string | null | undefined,
  teamId: string | undefined,
  trackToPlayer: Map<string, string | null>
): string {
  // 優先順位:
  // 1. trackId が trackMappings に あれば、マップされた playerId を使用
  if (trackId) {
    const mappedPlayerId = trackToPlayer.get(trackId);
    if (mappedPlayerId) return mappedPlayerId;
    return `track:${trackId}`;  // フォールバック
  }
  
  // 2. playerId（Gemini から）+ teamId で一意性を確保
  if (playerId) {
    return `player:${teamId || "unknown"}:${playerId}`;
  }
  
  // 3. 最後の手段
  return "player:unknown";
}
```

---

## 9. 処理の全体タイムライン

```
┌─ Step 01: Extract Meta ─────────────────────────┐
│ 動画メタデータ抽出                               │
└──────────────────────────────────────────────┬──┘
                                               ↓
┌─ Step 02: Detect Shots ────────────────────────┐
│ シーン切り替え検出                             │
└──────────────────────────────────────────────┬──┘
                                               ↓
┌─ Step 03: Extract Clips ───────────────────────┐
│ モーション/オーディオピーク → クリップ抽出    │
│ 保存: clips collection                       │
└──────────────────────────────────────────────┬──┘
                                               ↓
┌─ Step 04: Label Clips (Gemini) ────────────────┐
│ Gemini視覚分析 → label, confidence付与         │
│ 保存: clips.gemini フィールド                  │
└──────────────────────────────────────────────┬──┘
                                               ↓
┌─ Step 05: Build Events ────────────────────────┐
│ clips → events に変換                          │
│ 保存: events collection                       │
└──────────────────────────────────────────────┬──┘
        ↓                               ↓
  ┌─────────────────────────────────────────────┐
  │ 同時並行: Step 07-09 (Tracking Pipeline)    │
  │                                             │
  │ Step 07: Detect Players (YOLO)             │
  │   保存: tracks collection                   │
  │ ↓                                           │
  │ Step 08: Classify Teams (K-means)          │
  │   保存: trackTeamMetas collection           │
  │ ↓                                           │
  │ Step 09: Detect Ball (YOLO + Kalman)       │
  │   保存: ballTrack/current collection        │
  │ ↓                                           │
  │ Step 10: Detect Events (proximity)         │
  │   保存: passEvents, carryEvents, etc.       │
  └─────────────────────────────────────────────┘
        ↓                               ↓
        └───────────────────┬───────────┘
                            ↓
        ┌─ Step 06: Compute Stats ──────────┐
        │ 全データを集計してメトリクス計算 │
        │ 保存: stats collection           │
        └──────────────────────────────────┘
                            ↓
        ┌─ Stats表示用データ完成 ───────┐
        │ モバイルアプリでフェッチ       │
        │ イベント数、プレイヤー統計表示 │
        └──────────────────────────────────┘
```

---

## 10. Firestore コレクション構造

```
matches/{matchId}/
  ├─ shots/               ← Step 02 の出力
  │   ├─ shot_v1_1
  │   └─ shot_v1_2
  │
  ├─ clips/               ← Step 03, 04 の出力
  │   ├─ clip_v1_1
  │   │   ├─ clipId
  │   │   ├─ t0, t1
  │   │   ├─ motionScore
  │   │   └─ gemini:
  │   │       ├─ label: "shot"
  │   │       ├─ confidence: 0.85
  │   │       ├─ title
  │   │       └─ summary
  │   └─ clip_v1_2
  │
  ├─ events/              ← Step 05 の出力
  │   ├─ event_v1_clip_v1_1
  │   │   ├─ eventId
  │   │   ├─ label: "shot"
  │   │   ├─ confidence
  │   │   └─ source: "gemini" | "hybrid"
  │   └─ event_v1_clip_v1_2
  │
  ├─ tracks/              ← Step 07 の出力
  │   ├─ track_001
  │   ├─ track_002
  │   └─ ...
  │
  ├─ trackTeamMetas/      ← Step 08 の出力
  │   ├─ track_001: { teamId: "home" }
  │   └─ track_002: { teamId: "away" }
  │
  ├─ trackMappings/       ← Step 08 の出力
  │   ├─ track_001: { playerId: "player_123" }
  │   └─ track_002: { playerId: null }
  │
  ├─ ballTrack/
  │   └─ current/          ← Step 09 の出力
  │
  ├─ passEvents/          ← Step 10 の出力
  │   ├─ pass_1
  │   ├─ pass_2
  │   └─ ...
  │
  ├─ carryEvents/         ← Step 10 の出力
  │   ├─ carry_1
  │   ├─ carry_2
  │   └─ ...
  │
  ├─ turnoverEvents/      ← Step 10 の出力
  │   ├─ turnover_1
  │   └─ ...
  │
  ├─ possessionSegments/  ← Step 10 の出力
  │   └─ ...
  │
  └─ stats/               ← Step 06 の出力
      ├─ stat_v1_matchSummary_match
      │   └─ metrics:
      │       ├─ matchEventsCountByLabel: { shot: 5, chance: 12, ... }
      │       └─ matchTopMoments: [...]
      │
      ├─ stat_v1_passesV1_player_001
      │   └─ metrics:
      │       ├─ playerPassesAttempted: 28
      │       ├─ playerPassesCompleted: 24
      │       └─ playerPassesSuccessRate: 86
      │
      ├─ stat_v1_carryV1_player_001
      │   └─ metrics:
      │       ├─ playerCarryCount: 12
      │       └─ playerCarryIndex: 0.45
      │
      └─ ...
```

---

## 11. 重要な発見とギャップ

### 発見1: 二重のイベント集計

「Event Breakdown」は以下の**両方**のソースから集計されます：

1. **Clips-based (Step 04-05)**: Gemini が thumbnails を分類
   - `shot`, `chance`, `setPiece`, `dribble`, `defense`, `other`

2. **Tracking-based (Step 10)**: ボール-プレイヤー近接分析
   - `pass`, `carry`, `turnover`

matchSummary.ts の `calcMatchSummary` で両方を合算します。

### 発見2: TrackMappings の重要性

passesV1, carryV1, turnoversV1 などで プレイヤーIDを取得する際に trackMappings を使用します。

```
trackMappings が空 → playerId null → player:unknown:... として処理
```

これがプレイヤー統計の正確性に大きく影響します。

### 発見3: Version フィルター

```typescript
// Step 06 で version フィルターを使用
matchRef.collection("passEvents").where("version", "==", version).get()
matchRef.collection("carryEvents").where("version", "==", version).get()
```

つまり、passEvents, carryEvents は **version フィールドが必須** です。

### 発見4: Stats保存戦略

```typescript
// merge: true で保存
batch.set(statsRef.doc(statId), {...}, { merge: true })
```

複数回実行しても上書きされず、既存データとマージされます。

---

## 12. クイックリファレンス

| ステップ | ファイル | 入力 | 出力 | 主要変換 |
|---------|---------|------|------|---------|
| 03 | `03_extractClips.ts` | 動画 | clips | モーション/オーディオピーク検出 |
| 04 | `04_labelClipsGemini.ts` | clips + thumbnail | clips.gemini | Gemini 分類 |
| 05 | `05_buildEvents.ts` | clips.gemini | events | ラベル正規化 |
| 06 | `06_computeStats.ts` | shots, clips, events, pass/carry/turnover Events | stats | 計算器実行 |
| 10 | `10_detectEvents.ts` | tracks, ballTrack, mappings | passEvents, carryEvents, etc. | 近接分析 |

| Calculator | 入力 | 出力 (Player-level) |
|-----------|------|-------------------|
| `passesV1` | passEvents | playerPassesAttempted, playerPassesCompleted, playerPassesSuccessRate |
| `carryV1` | carryEvents | playerCarryCount, playerCarryIndex, playerCarryProgressIndex |
| `possessionV1` | possessionSegments | playerPossessionTimeSec, playerPossessionCount |
| `turnoversV1` | turnoverEvents | playerTurnoversLost, playerTurnoversWon |
| `matchSummary` | events + pass/carry/turnover | matchEventsCountByLabel, matchTopMoments |

---

## 13. 今後の拡張ポイント

1. **Event Breakdown の信頼度スコア**
   - 現在: 全イベント種別で同じ信頼度
   - 改善案: イベント種別ごとに異なる信頼度

2. **プレイヤー特定の精度向上**
   - Step 08 (Classify Teams) と Step 10 (Detect Events) の協調
   - trackMappings の自動補完メカニズム

3. **リアルタイムStats更新**
   - 現在: パイプライン完了後一括更新
   - 改善案: イベント検出後の段階的更新

4. **クリップ品質スコア**
   - motionScore を活用した品質フィルタリング
   - ユーザーフィードバック ← Stats品質改善への反映
