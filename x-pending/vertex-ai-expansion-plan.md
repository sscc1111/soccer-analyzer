# Vertex AI 活用拡張プラン (v2: Gemini-first アーキテクチャ)

## 概要

従来の YOLO + K-means + ルールベースのアプローチから **Gemini-first アーキテクチャ** に移行。
フル動画を Gemini に渡し、Context Caching を活用することで、精度向上と 90% コスト削減を同時に実現。

**使用モデル: Gemini 3 Flash** (`gemini-3-flash`)
- 1M 入力トークン、64K 出力トークン
- Gemini 2.5 Flash 比で 15% 精度向上
- Video-MMMU スコア: 87.6%（業界トップクラス）
- Context Caching で 90% コスト削減

---

## アーキテクチャ概要

### Tier 1: Gemini-only（基本機能）

```
┌─────────────────────────────────────────────────────────────────┐
│                     フル動画アップロード                          │
│                    (Gemini File API)                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Context Caching                              │
│                   (TTL: 1時間, 90%コスト削減)                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ シーン抽出     │   │ イベント検出   │   │ チーム分類     │
│ (重要シーン)   │   │ (パス/キャリー)│   │ (ユニフォーム) │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ クリップ生成   │   │ 背番号OCR      │   │ 審判/GK識別   │
│ (FFmpeg)      │   │ (Gemini)      │   │ (Gemini)      │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      統計計算 & サマリー生成                      │
│                         (Gemini)                                │
└─────────────────────────────────────────────────────────────────┘

コスト: ~$0.10/試合 | 処理時間: ~5分 | GPU: 不要
```

### Tier 2: YOLO + トラッキング（高度な機能）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tier 1 の結果 + フレーム抽出                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ YOLO検出       │   │ トラッキング   │   │ ボール検出     │
│ (プレイヤー)   │   │ (ByteTrack)   │   │ (YOLO)        │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              リアルタイム戦術ビュー / ヒートマップ                 │
│                 走行距離 / スプリント分析                         │
└─────────────────────────────────────────────────────────────────┘

追加コスト: ~$0.20/試合 | 追加時間: ~30分 | GPU: 必要
```

---

## Gemini-first の利点

| 項目 | 従来アプローチ | Gemini-first |
|------|--------------|--------------|
| **精度** | ~65% | ~85%+ |
| **コスト** | ~$0.30/試合 | ~$0.10/試合 |
| **処理時間** | ~45分 | ~5分 |
| **GPU依存** | 必須 | 不要 |
| **メンテナンス** | 複雑 | シンプル |
| **機能拡張** | 困難 | プロンプト変更のみ |

---

## Context Caching 戦略

### 動画トークン計算

```
動画トークン = 258 tokens/秒 × 1 FPS × 動画秒数
90分試合 = 258 × 5400秒 = 1,393,200 tokens (約1.4M)

※ 重要部分のみアップロードする場合:
  - 前半: 45分の重要シーン (20分) = 309,600 tokens
  - 後半: 45分の重要シーン (20分) = 309,600 tokens
  - 合計: ~620,000 tokens
```

### コスト比較

| アプローチ | 入力トークン | キャッシュ | コスト |
|-----------|------------|-----------|-------|
| 毎回フルアップロード | 1.4M | なし | $0.70/試合 |
| Context Caching | 1.4M | あり | **$0.07/試合** |
| 重要シーンのみ + Cache | 0.6M | あり | **$0.03/試合** |

### キャッシュ設定

```bash
# 環境変数
GEMINI_CONTEXT_CACHE_ENABLED=true
GEMINI_CONTEXT_CACHE_TTL=3600   # 1時間 (試合分析に十分)
GEMINI_VIDEO_UPLOAD_FULL=true   # フル動画アップロード
```

---

## パイプライン構成（Gemini-first版）

### 新パイプライン

```
Step 01: extractAudioPeaks     [維持]
Step 02: prepareClipCandidates [維持] (シーン候補抽出、Gemini前処理)
Step 03: uploadVideoToGemini   [新規] フル動画アップロード + Context Cache
Step 04: extractImportantScenes[新規] Geminiでシーン選択 (200→60本)
Step 05: generateClips         [維持] FFmpegでクリップ生成 ※アプリ表示用
Step 06: labelClipsWithContext [更新] キャッシュ済み動画でラベリング
Step 07: detectEventsGemini    [新規] Geminiでイベント検出
Step 08: identifyPlayersGemini [新規] 背番号OCR + チーム分類
Step 09: computeStatsFromEvents[更新] Geminiイベントから統計計算
Step 10: generateTacticalInsights [新規] タクティカル分析
Step 11: generateMatchSummary  [新規] 試合サマリー生成
```

### 重要な補足

#### FFmpegの役割（Step 05）
- **分析には使用しない**: Geminiがフル動画から直接分析
- **アプリ表示用に維持**: ユーザーがクリップを閲覧するために必要
- **処理フロー**: Step 04でGeminiが選択したタイムスタンプを元にクリップ生成

#### 統計計算の入力変更（Step 09）
```typescript
// Before: ルールベースイベントから計算
const stats = computeStats(ruleBasedEvents);

// After: Geminiイベント配列から直接集計
function computeStatsFromGeminiEvents(events: GeminiEvent[]): MatchStats {
  const stats = { home: { passes: 0, shots: 0 }, away: { passes: 0, shots: 0 } };
  for (const event of events) {
    const team = event.player?.startsWith("home") ? "home" : "away";
    if (event.type === "pass") stats[team].passes++;
    if (event.type === "shot") stats[team].shots++;
  }
  return stats;
}
```

### 既存ステップとの対応表（検証済み）

| 現在のStep | 現在の処理 | 新Step | 新処理 | 変更内容 |
|-----------|-----------|--------|--------|---------|
| Step 01 | extractMeta (FFprobe) | Step 01 | 同じ | 維持 |
| Step 02 | detectShots (シーン検出) | Step 02 | 同じ | 維持 |
| - | - | Step 02.5 | uploadVideoToGemini | **新規挿入** |
| Step 03 | extractClips (FFmpeg) | Step 03 | extractImportantScenes | **Geminiで置換** |
| - | - | Step 03.5 | generateClips (FFmpeg) | **アプリ表示用に維持** |
| Step 04 | labelClipsGemini | Step 04 | labelClipsWithContext | **Cache利用に更新** |
| Step 05 | buildEvents | - | - | **削除** (Gemini直接出力) |
| Step 06 | computeStats | Step 09 | computeStatsFromEvents | **後ろに移動** |
| Step 07 | detectPlayers (YOLO) | Step 07 | detectEventsGemini | **Geminiで置換** (YOLO→Tier2) |
| Step 08 | classifyTeams (K-means) | Step 08 | identifyPlayersGemini | **Geminiで置換** (K-means→Tier2) |
| Step 09 | detectBall (YOLO) | T2-03 | detectBall | **Tier 2専用へ移動** |
| Step 10 | detectEvents (ルールベース) | - | - | **削除** (Geminiで代替) |
| - | - | Step 10 | generateTacticalInsights | **新規** |
| - | - | Step 11 | generateMatchSummary | **新規** |

### Tier 2 へ移動するステップ（オプション機能）

以下のステップはTier 2（高度機能）としてオプションで利用可能:

```
[Tier 2 専用]
Step T2-01: detectPlayers      (YOLO選手検出)
Step T2-02: classifyTeams      (K-means色分類 - フォールバック)
Step T2-03: detectBall         (YOLOボール検出)
Step T2-04: trackPositions     (ByteTrack位置追跡)
Step T2-05: generateHeatmaps   (ヒートマップ生成)
Step T2-06: calculateDistances (走行距離計算)
```

### ステップ詳細

#### Step 03: uploadVideoToGemini (新規)

```typescript
// services/analyzer/src/jobs/steps/03_uploadVideoToGemini.ts
export async function stepUploadVideoToGemini({
  matchId,
  videoPath,
}: StepOptions) {
  const fileManager = new GoogleAIFileManager(apiKey);

  // フル動画をアップロード
  const uploadResult = await fileManager.uploadFile(videoPath, {
    mimeType: "video/mp4",
    displayName: `match_${matchId}`,
  });

  // Context Caching を設定
  const cacheManager = new GoogleAICacheManager(apiKey);
  const cache = await cacheManager.create({
    model: "models/gemini-3-flash",
    displayName: `match_${matchId}_cache`,
    contents: [{
      role: "user",
      parts: [{ fileData: { fileUri: uploadResult.uri, mimeType: "video/mp4" } }],
    }],
    ttlSeconds: 3600, // 1時間
  });

  // キャッシュIDを保存
  await saveCache(matchId, cache.name, uploadResult.uri);

  return { cacheId: cache.name, fileUri: uploadResult.uri };
}
```

#### Step 04: extractImportantScenes (新規)

```typescript
// services/analyzer/src/jobs/steps/04_extractImportantScenes.ts
const prompt = `
あなたはサッカー分析の専門家です。この試合動画を分析し、重要なシーンを抽出してください。

## 抽出対象
- ゴールチャンス（シュート、決定機）
- セットピース（コーナー、フリーキック、PK）
- 危険なドリブル突破
- 重要なディフェンス（タックル、インターセプト）
- ターンオーバー（ボール奪取、パスカット）

## 出力形式 (JSON)
{
  "scenes": [
    {
      "startSec": 123.5,
      "endSec": 128.5,
      "type": "shot",
      "importance": 0.95,
      "description": "ペナルティエリア内からの強烈なシュート"
    },
    ...
  ]
}

最大60シーンまで抽出してください。
`;

export async function stepExtractImportantScenes({
  matchId,
  cacheId,
}: StepOptions) {
  const model = genAI.getGenerativeModelFromCachedContent(cacheId);

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const scenes = parseScenes(result.response.text());
  await saveScenes(matchId, scenes);

  return { sceneCount: scenes.length };
}
```

#### Step 07: detectEventsGemini (新規)

```typescript
// services/analyzer/src/jobs/steps/07_detectEventsGemini.ts
const prompt = `
この試合動画から、以下のイベントを検出してください。

## 検出対象
1. パス: ボールが選手間で移動
   - passType: short | medium | long | through | cross
   - outcome: complete | incomplete | intercepted

2. キャリー: 選手がボールを持って移動
   - distance: 移動距離（推定メートル）

3. ターンオーバー: チーム間でボール所持が変わる
   - type: tackle | interception | bad_touch | out_of_play

4. シュート: ゴールへの攻撃
   - result: goal | saved | blocked | missed

5. セットピース
   - type: corner | free_kick | penalty | throw_in

## 出力形式 (JSON)
{
  "events": [
    {
      "timestamp": 123.5,
      "type": "pass",
      "team": "home",
      "player": "#10",
      "details": {
        "passType": "through",
        "outcome": "complete",
        "targetPlayer": "#9"
      },
      "confidence": 0.92
    },
    ...
  ]
}
`;

export async function stepDetectEventsGemini({
  matchId,
  cacheId,
}: StepOptions) {
  const model = genAI.getGenerativeModelFromCachedContent(cacheId);

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const events = parseEvents(result.response.text());

  // イベントを分類して保存
  const passEvents = events.filter(e => e.type === "pass");
  const carryEvents = events.filter(e => e.type === "carry");
  const turnoverEvents = events.filter(e => e.type === "turnover");
  const shotEvents = events.filter(e => e.type === "shot");

  await Promise.all([
    savePassEvents(matchId, passEvents),
    saveCarryEvents(matchId, carryEvents),
    saveTurnoverEvents(matchId, turnoverEvents),
    saveShotEvents(matchId, shotEvents),
  ]);

  return {
    passCount: passEvents.length,
    carryCount: carryEvents.length,
    turnoverCount: turnoverEvents.length,
    shotCount: shotEvents.length,
  };
}
```

#### Step 08: identifyPlayersGemini (新規)

```typescript
// services/analyzer/src/jobs/steps/08_identifyPlayersGemini.ts
const prompt = `
この試合動画から、選手情報を識別してください。

## 識別対象
1. チーム分類
   - home: ホームチーム（ユニフォームの色を記録）
   - away: アウェイチーム

2. 役割識別
   - player: フィールドプレイヤー
   - goalkeeper: ゴールキーパー（異なるユニフォーム色）
   - referee: 審判（通常黒/黄色）

3. 背番号OCR
   - 可能な限り背番号を読み取り

## 出力形式 (JSON)
{
  "teams": {
    "home": {
      "primaryColor": "#FF0000",
      "secondaryColor": "#FFFFFF",
      "goalkeeperColor": "#00FF00"
    },
    "away": {
      "primaryColor": "#0000FF",
      "secondaryColor": "#FFFFFF",
      "goalkeeperColor": "#FFFF00"
    }
  },
  "players": [
    {
      "team": "home",
      "jerseyNumber": 10,
      "role": "player",
      "confidence": 0.95
    },
    ...
  ],
  "referees": [
    { "role": "main_referee" },
    { "role": "linesman" }
  ]
}
`;
```

---

## Tier 1 で対応可能な機能一覧

| 機能 | auto-stats-detection-plan.md | Gemini-first |
|------|------------------------------|--------------|
| 重要シーン抽出 | FFmpegモーション | ✅ Gemini分析 |
| クリップラベリング | Gemini (既存) | ✅ 維持 |
| イベント検出 | ルールベース | ✅ Gemini分析 |
| パス検出 | 幾何学的計算 | ✅ Gemini分析 |
| キャリー検出 | 幾何学的計算 | ✅ Gemini分析 |
| ターンオーバー検出 | 幾何学的計算 | ✅ Gemini分析 |
| シュート検出 | 将来機能 | ✅ Gemini分析 |
| チーム分類 | K-means | ✅ Gemini分析 |
| 背番号OCR | 将来機能 | ✅ Gemini OCR |
| 審判/GK識別 | 未実装 | ✅ Gemini分析 |
| ポゼッション計算 | ルールベース | ✅ Gemini分析 |
| タクティカル分析 | 未実装 | ✅ Gemini分析 |
| 試合サマリー | 未実装 | ✅ Gemini生成 |

---

## 環境変数設定

```bash
# === Gemini 基本設定 ===
GCP_PROJECT_ID=soccer-analyzer-483917
GCP_REGION=us-central1
GEMINI_MODEL=gemini-3-flash
GEMINI_API_KEY=xxx

# === Context Caching ===
GEMINI_CONTEXT_CACHE_ENABLED=true
GEMINI_CONTEXT_CACHE_TTL=3600

# === 動画入力設定 ===
GEMINI_VIDEO_UPLOAD_FULL=true
GEMINI_VIDEO_IMPORTANT_ONLY=false  # trueで重要シーンのみ

# === Tier設定 ===
ANALYZER_TIER=1  # 1: Gemini-only, 2: Gemini + YOLO

# === 機能フラグ ===
ENABLE_GEMINI_SCENE_EXTRACTION=true
ENABLE_GEMINI_EVENT_DETECTION=true
ENABLE_GEMINI_PLAYER_IDENTIFICATION=true
ENABLE_GEMINI_TACTICAL_ANALYSIS=true
ENABLE_GEMINI_MATCH_SUMMARY=true

# === Tier 2 専用 (ANALYZER_TIER=2 の場合) ===
ML_INFERENCE_URL=https://ml-inference-xxx.run.app
ENABLE_YOLO_DETECTION=true
ENABLE_BALL_TRACKING=true
ENABLE_HEATMAP_GENERATION=true
```

---

## 実装フェーズ

### Phase A: 基盤構築（1-2日）

- [x] **A.1** Gemini File API / Cache Manager 統合 ✅
  - ファイル: `services/analyzer/src/gemini/fileManager.ts`
  - ファイル: `services/analyzer/src/gemini/cacheManager.ts`

- [x] **A.2** Step 03 (uploadVideoToGemini) 実装 ✅
  - ファイル: `services/analyzer/src/jobs/steps/03_uploadVideoToGemini.ts`

- [x] **A.3** runMatchPipeline 更新 ✅
  - 新ステップ順序に変更
  - Tier 分岐ロジック追加

### Phase B: シーン抽出（1日）

- [x] **B.1** シーン抽出プロンプト作成 ✅
  - ファイル: `services/analyzer/src/gemini/prompts/scene_extraction_v1.json`

- [x] **B.2** Step 04 (extractImportantScenes) 実装 ✅
  - ファイル: `services/analyzer/src/jobs/steps/04_extractImportantScenes.ts`

### Phase C: イベント検出（1-2日）

- [x] **C.1** イベント検出プロンプト作成 ✅
  - ファイル: `services/analyzer/src/gemini/prompts/event_detection_v1.json`

- [x] **C.2** Step 07 (detectEventsGemini) 実装 ✅
  - ファイル: `services/analyzer/src/jobs/steps/07_detectEventsGemini.ts`

- [x] **C.3** PassEventDoc / CarryEventDoc / TurnoverEventDoc 型拡張 ✅
  - ファイル: `packages/shared/src/domain/passEvent.ts`

### Phase D: プレイヤー識別（1日）

- [x] **D.1** プレイヤー識別プロンプト作成 ✅
  - ファイル: `services/analyzer/src/gemini/prompts/player_identification_v1.json`

- [x] **D.2** Step 08 (identifyPlayersGemini) 実装 ✅
  - ファイル: `services/analyzer/src/jobs/steps/08_identifyPlayersGemini.ts`

- [x] **D.3** TrackTeamMeta / TrackPlayerMapping 型拡張 ✅
  - ファイル: `packages/shared/src/domain/tracking.ts`

### Phase E: タクティカル分析 & サマリー（1-2日）

- [x] **E.1** タクティカル分析プロンプト作成 ✅
  - ファイル: `services/analyzer/src/gemini/prompts/tactical_analysis_v1.json`

- [x] **E.2** Step 10 (generateTacticalInsights) 実装 ✅
  - ファイル: `services/analyzer/src/jobs/steps/10_generateTacticalInsights.ts`

- [x] **E.3** サマリー生成プロンプト作成 ✅
  - ファイル: `services/analyzer/src/gemini/prompts/match_summary_v1.json`

- [x] **E.4** Step 11 (generateMatchSummary) 実装 ✅
  - ファイル: `services/analyzer/src/jobs/steps/11_generateMatchSummary.ts`

- [x] **E.5** TacticalAnalysis / MatchSummary 型定義 ✅
  - ファイル: `packages/shared/src/domain/tactical.ts`

### Phase F: 統合 & 最適化（1日）

- [ ] **F.1** 旧ステップの削除/無効化
  - Step 07 (detectPlayers) → YOLO → Tier 2 専用
  - Step 08 (classifyTeams) → K-means → Tier 2 フォールバック
  - Step 09 (detectBall) → Tier 2 専用
  - Step 10 (detectEvents) → ルールベース → 削除

- [ ] **F.2** E2E テスト
  - Tier 1 フルパイプライン
  - Context Caching 動作確認
  - コスト検証

- [ ] **F.3** モバイルアプリ更新
  - タクティカル分析表示
  - 試合サマリー表示

---

## A/B テスト計画

### テスト対象

| 項目 | 従来 (Tier 2相当) | Gemini-first (Tier 1) |
|------|------------------|----------------------|
| シーン選択 | FFmpeg モーション | Gemini 分析 |
| イベント検出 | ルールベース | Gemini 分析 |
| チーム分類 | K-means | Gemini 分析 |

### 評価指標

| 指標 | 目標 |
|------|------|
| イベント検出精度 | > 85% |
| チーム分類精度 | > 95% |
| 処理時間 | < 10分/試合 |
| コスト | < $0.15/試合 |
| ユーザー満足度 | > 4.0/5.0 |

### テストスケジュール

| 週 | 試合数 | 内容 |
|----|--------|------|
| Week 1 | 5試合 | Tier 1 基本動作確認 |
| Week 2 | 10試合 | 精度評価 + チューニング |
| Week 3 | 10試合 | Tier 2 との比較 |
| Week 4 | 20試合 | 本番運用準備 |

---

## コスト試算（更新版）

### Tier 1: Gemini-only

| 項目 | トークン | コスト |
|------|---------|-------|
| 動画アップロード | 1.4M | $0.07 (cached) |
| シーン抽出クエリ | 2K | $0.001 |
| イベント検出クエリ | 5K | $0.003 |
| プレイヤー識別クエリ | 3K | $0.002 |
| タクティカル分析クエリ | 3K | $0.002 |
| サマリー生成クエリ | 2K | $0.001 |
| **合計** | - | **~$0.08/試合** |

### Tier 2: Gemini + YOLO

| 項目 | コスト |
|------|-------|
| Tier 1 | $0.08 |
| YOLO 推論 (Cloud Run GPU) | $0.15 |
| トラッキング処理 | $0.05 |
| **合計** | **~$0.28/試合** |

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| Gemini 応答の不安定性 | リトライ + フォールバック (Tier 2) |
| 動画アップロード失敗 | 分割アップロード + 再試行 |
| キャッシュ期限切れ | TTL 監視 + 自動再キャッシュ |
| API レート制限 | バッチ処理 + キュー管理 |
| 精度が期待以下 | プロンプトチューニング + Tier 2 補完 |

---

## 検証結果と追加要件

### 現在の実装との正確な対応

**現在の実装（実際のファイル）:**
```
Step 01: extractMeta          → FFprobeでメタデータ抽出
Step 02: detectShots          → シーンカット検出 + モーションスコア
Step 03: extractClips         → FFmpegでクリップ抽出 (最大60本)
Step 04: labelClipsGemini     → Geminiラベリング (既存)
Step 05: buildEvents          → eventドキュメント化
Step 06: computeStats         → Calculator群で統計計算
Step 07: detectPlayers        → YOLO + ByteTrack (実装済み)
Step 08: classifyTeams        → K-means色分類 (実装済み)
Step 09: detectBall           → YOLO + Kalmanフィルタ (実装済み)
Step 10: detectEvents         → ルールベースイベント検出 (実装済み)
```

**Gemini-first 移行時の対応:**
```
[維持]     Step 01-02: メタデータ・シーン検出は維持
[挿入]     Step 02.5: uploadVideoToGemini (新規追加)
[置換]     Step 03: extractClips → extractImportantScenes (Gemini)
[維持]     Step 03.5: generateClips (FFmpegでクリップ生成、アプリ表示用)
[更新]     Step 04: labelClipsGemini → labelClipsWithContext (Cache利用)
[削除]     Step 05: buildEvents → Geminiが直接イベント出力
[移動]     Step 06: computeStats → Step 09に移動
[置換]     Step 07: detectPlayers → detectEventsGemini (Gemini)
[置換]     Step 08: classifyTeams → identifyPlayersGemini (Gemini)
[Tier2]    Step 09: detectBall → Tier 2専用
[削除]     Step 10: detectEvents → Geminiで代替
[新規]     Step 10: generateTacticalInsights (新規)
[新規]     Step 11: generateMatchSummary (新規)
```

### 必要な新規型定義

**packages/shared/src/domain/ に追加が必要:**

```typescript
// 1. scene.ts (新規)
export type ImportantSceneDoc = {
  sceneId: string;
  matchId: string;
  startSec: number;
  endSec: number;
  type: "shot" | "chance" | "setPiece" | "dribble" | "defense" | "turnover" | "other";
  importance: number;      // 0-1
  description: string;
  version: string;
  createdAt: string;
};

// 2. cache.ts (新規)
export type GeminiCacheDoc = {
  matchId: string;
  cacheId: string;         // Gemini Cache Manager ID
  fileUri: string;         // Gemini File API URI
  ttlSeconds: number;
  expiresAt: string;
  createdAt: string;
};

// 3. tactical.ts (新規)
export type TacticalAnalysisDoc = {
  matchId: string;
  version: string;
  formation: {
    home: string;          // "4-3-3"
    away: string;
  };
  tempo: {
    home: number;          // パス/分
    away: number;
  };
  attackPatterns: string[];
  defensivePatterns: string[];
  keyInsights: string[];
  createdAt: string;
};

// 4. summary.ts (新規)
export type MatchSummaryDoc = {
  matchId: string;
  version: string;
  headline: string;
  narrative: {
    firstHalf: string;
    secondHalf: string;
  };
  keyMoments: Array<{
    timestamp: number;
    description: string;
    importance: number;
  }>;
  playerHighlights: Array<{
    player: string;
    achievement: string;
  }>;
  createdAt: string;
};

// 5. passEvent.ts に追加
export type ShotEventDoc = {
  eventId: string;
  matchId: string;
  timestamp: number;
  team: TeamId;
  player?: string;         // "#10"
  result: "goal" | "saved" | "blocked" | "missed";
  position?: { x: number; y: number };
  confidence: number;
  source: "gemini" | "manual";
  version: string;
  createdAt: string;
};

export type SetPieceEventDoc = {
  eventId: string;
  matchId: string;
  timestamp: number;
  team: TeamId;
  type: "corner" | "free_kick" | "penalty" | "throw_in";
  position?: { x: number; y: number };
  outcome?: "goal" | "chance" | "cleared" | "other";
  confidence: number;
  source: "gemini" | "manual";
  version: string;
  createdAt: string;
};
```

### 新規 Firestore コレクション

```
matches/{matchId}/
├─ importantScenes/     [新規] シーン抽出結果
├─ geminiCache/current  [新規] キャッシュメタデータ
├─ shotEvents/          [新規] シュートイベント
├─ setPieceEvents/      [新規] セットピースイベント
├─ tactical/current     [新規] タクティカル分析
└─ summary/current      [新規] 試合サマリー
```

### auto-stats-detection-plan.md との統合

**既に実装済みで Tier 1 に統合可能:**
- ✅ K-means チーム分類 → Gemini に置換
- ✅ ホモグラフィ変換 → Tier 2 で継続利用
- ✅ Kalman フィルタ → Tier 2 で継続利用
- ✅ Calculator群 → Gemini イベントを入力として継続利用

**auto-stats で未実装だが Gemini-first でカバー:**
- ✅ 背番号OCR (Phase 1.4) → Gemini で対応
- ✅ シュート検出 (Phase 2.4) → Gemini で対応
- ✅ 審判/GK識別 → Gemini で対応 (auto-stats になかった機能)

**Tier 2 専用として維持:**
- YOLO 選手検出
- YOLO ボール検出
- ByteTrack トラッキング
- ヒートマップ生成
- 走行距離計算

### 追加リスク

| リスク | 対策 |
|--------|------|
| Step 番号の衝突 | 移行期間中は新旧ステップを並行稼働、環境変数で切替 |
| Phase 3 データとの互換性 | 既存の passEvents/carryEvents は Gemini 出力で上書き可能に設計 |
| Calculator の入力変更 | GeminiEvent → 既存イベント型への変換レイヤー追加 |

---

## 完了条件

### Phase A-F 共通

- [x] Phase A-E 全タスクの実装完了 ✅
- [x] TypeScript コンパイルエラーなし ✅
- [ ] ユニットテスト追加・パス
- [ ] E2E テストで動作確認

### 全体完了

- [ ] Tier 1 で 85%+ の精度達成
- [ ] $0.15/試合 以下のコスト達成
- [ ] 10分以内の処理時間達成
- [ ] モバイルアプリでの表示確認
- [ ] ドキュメント更新
