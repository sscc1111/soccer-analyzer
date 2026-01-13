# 自動パス判定・個別スタッツ実装プラン

## 概要

ボール検出・選手追跡を基盤として、自動でパス成功/失敗を判定し、個別選手スタッツを算出するシステム。
全ての推定には`confidence`を付与し、低信頼時のみユーザー修正UIを提供する。

---

## 前提条件（settings-fix-plan.mdで完了済み）

以下の基盤機能は既に実装済み：

- [x] **マッチ作成時のデフォルト設定適用** - チーム色、フォーメーション、ロスターが自動適用
- [x] **チーム色設定** - `settings.teamColors.home/away` でユーザー指定可能
- [x] **ロスター（背番号リスト）** - `settings.formation.assignments` に jerseyNo + role
- [x] **カメラ設定** - `settings.camera.position` + `zoomHint` (near/mid/far)
- [x] **攻撃方向設定** - `settings.attackDirection` (LTR/RTL)
- [x] **バリデーション** - zod による設定値検証、背番号重複チェック
- [x] **Firestoreセキュリティ** - ownerUid によるアクセス制限

これらは本プランの以下の機能で活用される：

| 設定項目 | 活用箇所 |
|----------|----------|
| `teamColors` | Phase 1.2 チーム分類の初期値・補正 |
| `formation.assignments` | Phase 1.4 背番号OCRの照合リスト |
| `camera.zoomHint` | Phase 1.3 ボール検出閾値の調整 |
| `attackDirection` | Phase 2.3 キャリー進行方向の計算 |

---

## 試合設定の拡張

### 試合形式（gameFormat）

ユーザーが選択可能な試合形式：

| 形式 | 選手数 | フィールドサイズ | デフォルト試合時間 |
|------|--------|-----------------|------------------|
| `eleven` | 11 vs 11 | 105m x 68m | 45分 × 2ハーフ |
| `eight` | 8 vs 8 | 68m x 50m | 15分 × 2ハーフ |
| `five` | 5 vs 5 | 40m x 20m | 10分 × 2ハーフ |

- [x] `settings.gameFormat` フィールド追加 ✅ `packages/shared/src/domain/match.ts`
  ```typescript
  type GameFormat = 'eleven' | 'eight' | 'five';

  type MatchSettings = {
    // 既存フィールド...
    gameFormat?: GameFormat; // デフォルト: 'eleven'
    matchDuration?: {
      halfDuration: number; // 分単位
      numberOfHalves: number; // 通常2
      extraTime?: boolean;
    };
    fieldSize?: {
      length: number; // メートル
      width: number;  // メートル
    };
  };
  ```

### 試合形式による処理最適化

| 項目 | 11人制 | 8人制 | 5人制 |
|------|--------|-------|-------|
| 追跡対象人数 | 22+審判 | 16+審判 | 10+審判 |
| 人数制限フィルタ | 上位25人 | 上位20人 | 上位15人 |
| フレーム数（90分換算） | 27,000 | 12,000 | 6,000 |
| 推定処理時間（GPU） | 40-50分 | 15-20分 | 8-12分 |

### UI追加項目

- [x] 試合形式選択UI（apps/mobile/app/match/[id]/settings.tsx）✅
  - ピッカー: 11人制 / 8人制 / 5人制
  - 選択に応じてフィールドサイズ・試合時間を自動設定
- [x] 試合時間入力UI ✅
  - ハーフの長さ（分）
  - ハーフ数（通常2、延長時は4）
- [x] フィールドサイズ入力UI（オプション）✅
  - 自動（試合形式に基づく）/ カスタム
  - カスタム時は縦・横のメートル入力

### 活用箇所

| 設定項目 | 活用箇所 |
|----------|----------|
| `gameFormat` | Phase 1.2.5 人数制限フィルタの閾値 |
| `matchDuration` | 処理時間の見積もり表示、進捗計算 |
| `fieldSize` | Phase 1.5 ホモグラフィ（ピッチサイズ）|
| `numberOfHalves` | ハーフタイム検出、スタッツ区分 |

---

## Phase 1: 検出・追跡の土台

### 1.1 選手検出 + 追跡（トラッキング）

**ステップ実装:** `services/analyzer/src/jobs/steps/07_detectPlayers.ts` ✅ スケルトン完了
- 抽象化インターフェース: `PlayerDetector`, `Tracker` (`detection/types.ts`)
- プレースホルダー実装: `PlaceholderPlayerDetector`, `PlaceholderTracker` (`detection/placeholder.ts`)

- [ ] 選手検出モデルの選定・統合
  - YOLO v8 / v9 または類似の軽量モデル
  - 入力: 動画フレーム
  - 出力: バウンディングボックス + 検出confidence
- [ ] トラッキングアルゴリズム実装
  - ByteTrack / SORT / DeepSORT から選定
  - 出力: `trackId` (フレーム間で一貫)
- [x] トラッキング結果のデータ構造定義 ✅ `packages/shared/src/domain/tracking.ts`
  ```typescript
  type TrackFrame = {
    trackId: string;
    frameNumber: number;
    timestamp: number;
    bbox: { x: number; y: number; w: number; h: number };
    center: { x: number; y: number };
    confidence: number;
  };
  ```
- [x] Firestore スキーマ設計: `matches/{matchId}/tracks/{trackId}` ✅ TrackDoc型定義

### 1.2 チーム分類

**ステップ実装:** `services/analyzer/src/jobs/steps/08_classifyTeams.ts` ✅ **パイプライン実装完了**
- 抽象化インターフェース: `ColorExtractor` (`detection/types.ts`)
- プレースホルダー実装: `PlaceholderColorExtractor` (`detection/placeholder.ts`)
- **K-meansカラークラスタリング:** `services/analyzer/src/detection/colorClustering.ts` ✅ 実装完了

- [x] チーム分類ロジック実装 ✅ K-means + HSV距離
  - 方式A: ユニフォーム色クラスタリング（HSV空間）✅ `kMeansClustering()`, `classifyTeamsByColor()`
  - 方式B: ユーザー入力（チームA色 / チームB色）← **settings.teamColors を活用** ✅
- [x] トラックへのチームラベル付与 ✅ Step 08パイプラインで実装（TrackTeamMeta保存）
- [x] `match.settings.teamColors` から初期値を取得するロジック ✅ `classifyTeamsByColor()` の第2引数
- [x] チーム分類メタデータの型定義 ✅ `TrackTeamMeta` in tracking.ts
  ```typescript
  type TrackTeamMeta = {
    trackId: string;
    teamId: 'home' | 'away' | 'unknown';
    teamConfidence: number;
  };
  ```
- [x] 審判・その他の除外ロジック ✅ k=3クラスタリングで3チーム目を審判として分類
- [x] テスト ✅ `services/analyzer/src/detection/__tests__/colorClustering.test.ts`

### 1.2.5 非選手フィルタリング ✅ フィルタモジュール実装完了

**モジュール実装:** `services/analyzer/src/detection/filters.ts`

素人撮影で映り込む関係ない人物を除外するフィルタ：

- [x] フィルタ1: ピッチ内/外判定（ホモグラフィ活用）✅ `filterByPitchBoundary()`
  - 観客、ベンチの控え選手除外
  - Phase 1.5のホモグラフィ推定結果を活用
- [x] フィルタ2: ユニフォーム色フィルタ ✅ `matchesTeamColor()`, K-meansクラスタリング
  - `settings.teamColors` を活用して私服の人除外
  - HSV空間での色類似度判定
  - `services/analyzer/src/detection/colorClustering.ts` - K-means実装
- [x] フィルタ3: 人数制限（上位25人）✅ `filterTopN()`
  - 検出confidenceの高い上位25人のみ追跡
  - ノイズ除外
- [x] フィルタ4: 動きパターン分析 ✅ `filterByMotion()`, `MotionHistory`
  - 静止している人（観客、ベンチ）除外
  - 移動量の時系列分析
- [x] フィルタ5: ロスター照合 ✅ `filterByRoster()`
  - `settings.formation.assignments` と比較
  - 登録外の背番号を持つ選手（控え選手）除外
- [x] フィルタパイプライン ✅ `runFilterPipeline()`
  - 全フィルタを順序付けて実行
  - 統計情報の収集
- [x] テスト ✅ `services/analyzer/src/detection/__tests__/filters.test.ts`

### 1.3 ボール検出

**ステップ実装:** `services/analyzer/src/jobs/steps/09_detectBall.ts` ✅ **パイプライン実装完了**
- 抽象化インターフェース: `BallDetector` (`detection/types.ts`)
- プレースホルダー実装: `PlaceholderBallDetector` (`detection/placeholder.ts`)

- [ ] ボール検出モデルの選定・統合
  - 専用モデル or 汎用モデルの「sports ball」クラス
  - 小さい・速い・見えにくい対策
- [x] ボール検出結果の型定義 ✅ `BallDetection`, `BallTrackDoc` in tracking.ts
  ```typescript
  type BallDetection = {
    frameNumber: number;
    timestamp: number;
    position: { x: number; y: number };
    confidence: number;
    visible: boolean;
  };
  ```
- [x] ボール追跡の安定化 ✅ Step 09パイプラインで実装
  - 一時的な見失い補間（1秒以内）
  - カルマンフィルタによる軌道平滑化 (`KalmanFilter2D`)

### 1.4 背番号OCR（基礎）

- [ ] 背番号認識モデル/API選定
  - Gemini Vision / PaddleOCR / カスタムモデル
- [ ] 高信頼フレームの選択ロジック
  - 選手が正面向き・静止・拡大
- [ ] `match.settings.formation.assignments` から登録済み背番号リストを取得
  - OCR結果を既知の背番号と照合して信頼度を上げる
- [x] `trackId → playerId` マッピング構造 ✅ `TrackPlayerMapping` in tracking.ts
  ```typescript
  type TrackPlayerMapping = {
    trackId: string;
    playerId: string | null;
    jerseyNumber: number | null;
    ocrConfidence: number;
    source: 'ocr' | 'manual' | 'roster_match';
  };
  ```
- [x] Firestore: `matches/{matchId}/trackMappings/{trackId}` ✅ 型定義完了

### 1.5 ホモグラフィ推定（タクティカルビュー用）✅ 基盤完了

- [x] ピッチキーポイント検出 ✅ インターフェース `HomographyEstimator` 定義
  - コーナーフラッグ、ペナルティエリア、センターライン等の座標定数定義
  - `PITCH_KEYPOINTS` - 標準キーポイント座標
  - `PlaceholderHomographyEstimator.detectKeypoints()` - プレースホルダー
- [x] ホモグラフィ行列の計算 ✅ `services/analyzer/src/detection/homography.ts`
  - カメラ座標 → ピッチ座標への変換行列
  - `estimateHomographyDLT()` - DLTアルゴリズム
  - `PlaceholderHomographyEstimator.estimate()` - プレースホルダー
- [x] フレームごとのホモグラフィ更新 ✅ `interpolateHomography()` 実装
  - カメラが動く場合の補間
  - 線形補間による中間フレームの行列計算
- [x] 座標変換関数の実装 ✅
  - `screenToField(homography, screenPoint)` → フィールド座標
  - `fieldToScreen(homography, fieldPoint)` → スクリーン座標
  - `fieldDistance(p1, p2)` - フィールド上の距離計算(メートル)
  - `isOnPitch(point, fieldSize)` - ピッチ内外判定
  - `computeReprojectionError()` - 精度検証
- [x] ホモグラフィデータ構造定義 ✅ `packages/shared/src/domain/tracking.ts`
- [x] 標準フィールドサイズ定数 ✅ `FIELD_DIMENSIONS` (11v11, 8v8, 5v5)
- [ ] 参考実装の調査（将来：RANSAC、MLベースのキーポイント検出）

---

## Phase 2: イベント検出・スタッツ算出

**ステップ実装:** `services/analyzer/src/jobs/steps/10_detectEvents.ts` ✅ スケルトン完了
- パス、キャリー、ターンオーバー検出の骨格を実装
- ログ統合、エラーハンドリング統合済み
- TODO: 実際の検出ロジック実装

### 2.1 ボール保持判定 ✅ 実装完了

**モジュール実装:** `services/analyzer/src/detection/events.ts`

- [x] 保持判定ロジック実装 ✅ `detectFramePossessions()`, `findClosestPlayer()`
  - ボール位置と選手位置の近接度 ✅ `distance()` 関数
  - 近接閾値（画面座標ベース）✅ `possessionDistanceThreshold` 設定
  - 保持継続時間の最小閾値 ✅ `minPossessionFrames` 設定
- [x] 保持区間データ構造 ✅ `PossessionSegment` in passEvent.ts
- [x] 保持区間ビルダー ✅ `buildPossessionSegments()`
- [x] テスト ✅ `services/analyzer/src/detection/__tests__/events.test.ts`

### 2.2 パスイベント検出 ✅ 実装完了

- [x] パス検出ロジック実装 ✅ `detectPassEvents()`
  - 保持者Aからボール離脱
  - ボール移動
  - 保持者Bで安定（または失敗）
- [x] パスイベントデータ構造 ✅ `PassEventDoc` in passEvent.ts
- [x] パス成功/失敗判定 ✅ `determinePassOutcome()`
  - 同チーム受け → 成功 ✅
  - 相手チーム受け → インターセプト（失敗）✅
  - アウト/停止 → 失敗 ✅
- [x] Firestore: `matches/{matchId}/passEvents/{eventId}` ✅ 型定義完了

### 2.3 キャリーイベント検出 ✅ 実装完了

- [x] キャリー（ドリブル）検出ロジック ✅ `detectCarryEvents()`
  - 保持中の移動量 ✅ `calculateCarryMetrics()`
  - 画面座標での移動量積算 ✅ `carryIndex`
- [x] `match.settings.attackDirection` を使って進行方向を計算 ✅ `calculateProgress()`
  - LTR: 右方向への移動がポジティブ ✅
  - RTL: 左方向への移動がポジティブ ✅
- [x] キャリーイベントデータ構造 ✅ `CarryEventDoc` in passEvent.ts
- [x] 最小キャリー距離閾値 ✅ `minCarryDistance` 設定

### 2.4 その他イベント検出（基礎）✅ ターンオーバー実装完了

- [x] ターンオーバー検出ロジック ✅ `detectTurnoverEvents()`
  - ロスト: 保持→相手保持 ✅ `turnoverType: "lost"`
  - 奪取: 相手保持→自分保持 ✅ `turnoverType: "won"`
- [x] ターンオーバー検出型定義 ✅ `TurnoverEventDoc` in passEvent.ts
- [ ] シュート検出（Gemini補完活用）（将来）
  - ゴール方向への強い蹴り出し
  - クリップ分類との連携
- [x] 要確認イベント型定義 ✅ `PendingReviewDoc` in passEvent.ts
- [x] 統合パイプライン ✅ `detectAllEvents()`

### 2.5 フレーム外選手の軌道予測 ✅ 基盤完了

- [x] カルマンフィルタの実装 ✅ `services/analyzer/src/detection/kalman.ts`
  - `KalmanFilter2D` クラス - 2D位置・速度追跡
  - 状態ベクトル [x, y, vx, vy]
  - `predict()` - 時間を進めて状態を予測
  - `update()` - 観測で状態を更新
- [x] 画面外に出た選手の位置推定 ✅
  - `TrackPredictor` クラス - 複数トラックの管理
  - `getPrediction()` - 特定トラックの予測位置取得
  - `getAllPredictions()` - 全有効トラックの予測取得
- [x] 信頼度の時間減衰 ✅
  - `getConfidence(currentTime)` - 指数減衰モデル
  - `DEFAULT_PREDICTION_CONFIG.confidenceDecayRate` - 減衰率設定
  - `isPredictionValid()` - 最大予測時間チェック
- [x] 再出現時のトラックID維持 ✅
  - `predictionDistance()` - 予測と観測の距離計算
  - `findBestMatch()` - 最適なトラックマッチング
  - [ ] 外観特徴（ReID）との組み合わせ（将来）
- [x] 予測データ構造定義 ✅ `packages/shared/src/domain/tracking.ts`
  ```typescript
  type PredictedPosition = {
    trackId: string;
    frameNumber: number;
    position: { x: number; y: number };
    velocity: { vx: number; vy: number };
    isPredicted: true;
    confidence: number; // 時間経過で減衰
    lastObservedFrame: number;
    fieldPosition?: { x: number; y: number }; // ホモグラフィ適用後
  };
  ```

---

## Phase 3: Calculator実装

### 3.1 passesV1 Calculator

- [x] `calculators/passesV1.ts` 作成 ✅
- [x] 入力定義
  - PassEventDoc[]
  - TrackPlayerMapping[]
- [x] 出力メトリクス
  - `player.passes.attempted`
  - `player.passes.completed`
  - `player.passes.incomplete`
  - `player.passes.successRate`
  - `player.passes.intercepted`
- [x] Confidence計算ロジック
  - イベントconfidenceの平均
- [x] テスト作成 ✅ `services/analyzer/src/calculators/__tests__/passesV1.test.ts`

### 3.2 carryV1 Calculator

- [x] `calculators/carryV1.ts` 作成 ✅
- [x] 入力定義
  - CarryEventDoc[]
  - TrackPlayerMapping[]
- [x] 出力メトリクス
  - `player.carry.count`
  - `player.carry.index` (相対指数合計)
  - `player.carry.progressIndex` (攻撃方向)
  - `player.carry.meters` (校正後のみ)
- [x] テスト作成 ✅ `services/analyzer/src/calculators/__tests__/carryV1.test.ts`

### 3.3 possessionV1 Calculator

- [x] `calculators/possessionV1.ts` 作成 ✅
- [x] 入力定義
  - PossessionSegment[]
  - TrackPlayerMapping[]
- [x] 出力メトリクス
  - `player.possession.timeSec`
  - `player.possession.count`
  - `team.possession.percent`
- [x] テスト作成 ✅ `services/analyzer/src/calculators/__tests__/possessionV1.test.ts`

### 3.4 turnoversV1 Calculator

- [x] `calculators/turnoversV1.ts` 作成 ✅
- [x] 出力メトリクス
  - `player.turnovers.lost`
  - `player.turnovers.won`
- [x] テスト作成 ✅ `services/analyzer/src/calculators/__tests__/turnoversV1.test.ts`

### 3.5 Calculator Registry更新

- [x] `registry.ts` に新calculatorを登録 ✅
- [x] MetricKey型の拡張（shared package）✅ `packages/shared/src/metricKeys.ts`

---

## Phase 4: バックエンド統合

### 4.1 処理パイプライン

- [x] 動画アップロード後の処理フロー設計 ✅ パイプラインステップ作成
  1. フレーム抽出
  2. 選手検出 + トラッキング → `07_detectPlayers.ts` (skeleton)
  3. チーム分類 → `08_classifyTeams.ts` (skeleton)
  4. ボール検出 → `09_detectBall.ts` (skeleton)
  5. イベント検出 → `10_detectEvents.ts` ✅ **統合完了**
  6. Calculator実行 → `06_computeStats.ts` (updated)
  7. スタッツ保存
- [x] `runMatchPipeline.ts` に Step 07-10 を統合 ✅ `services/analyzer/src/jobs/runMatchPipeline.ts`
- [x] Step 10 イベント検出統合 ✅ `detection/events.ts` モジュールと接続
  - `detectAllEvents()` 呼び出し、`extractPendingReviews()` で要確認イベント抽出
  - Firestore保存（possessionSegments, passEvents, carryEvents, turnoverEvents, pendingReviews）
- [ ] Cloud Functions / Cloud Run 構成
- [x] 処理ステータス管理 ✅ `TrackingProcessingStatus` in tracking.ts
  ```typescript
  type TrackingProcessingStatus = {
    matchId: string;
    stage: 'pending' | 'extracting_frames' | 'detecting_players' | 'tracking' | 'classifying_teams' | 'detecting_ball' | 'ocr_jerseys' | 'done' | 'error';
    progress: number;
    error?: string;
  };
  ```

### 4.2 低信頼イベントの抽出 ✅ 実装完了

- [x] 要確認イベントのフラグ付け ✅ `extractPendingReviews()` in events.ts
  - `confidence < 0.6` のイベントを検出 ✅ `needsReview` フラグで判定
  - キッカー/レシーバー候補の生成 ✅ `buildPassCandidates()`
  - テスト ✅ 3テスト追加（events.test.ts）
- [x] Firestore: `matches/{matchId}/pendingReviews/{eventId}` ✅ `PendingReviewDoc` in passEvent.ts
  ```typescript
  type PendingReviewDoc = {
    eventId: string;
    eventType: 'pass' | 'carry' | 'turnover';
    reason: 'low_confidence' | 'ambiguous_player' | 'multiple_candidates';
    candidates?: { trackId: string; playerId: string | null; confidence: number }[];
    resolved: boolean;
    resolution?: { selectedTrackId, correctedOutcome, resolvedBy, resolvedAt };
  };
  ```

### 4.3 処理モード（ユーザー選択可能）

ユーザーが処理速度と精度のトレードオフを選択可能：

| モード | フレームレート | 処理時間（90分動画） | 精度 | 用途 |
|--------|---------------|---------------------|------|------|
| **クイック** | 1 fps | 8-12分 | 70% | 試合直後の速報確認 |
| **標準** | 3 fps | 20-30分 | 85% | 通常の振り返り |
| **詳細** | 5 fps | 40-50分 | 95% | 詳細分析が必要な時 |

- [x] 処理モード選択UI ✅ 完了 (2025-01-09)
  ```typescript
  // packages/shared/src/domain/match.ts
  export const PROCESSING_MODE_INFO: Record<ProcessingMode, ProcessingModeInfo> = {
    quick: { label: "Quick", labelJa: "クイック", fps: 1, accuracy: "~70%", estimatedMultiplier: 0.1, gpuRequired: false },
    standard: { label: "Standard", labelJa: "標準", fps: 3, accuracy: "~85%", estimatedMultiplier: 0.3, gpuRequired: true },
    detailed: { label: "Detailed", labelJa: "詳細", fps: 5, accuracy: "~95%", estimatedMultiplier: 0.5, gpuRequired: true },
  };
  ```
- [x] 処理開始前の見積もり時間表示 ✅ 完了 (2025-01-09)
  - `estimateProcessingTime(durationSec, mode)` - 処理時間見積もり
  - `formatEstimatedTime(minutes, locale)` - 日英対応フォーマット
- [ ] 試合形式との組み合わせ最適化
  - 8人制 + クイック = 3-5分
  - 8人制 + 標準 = 8-12分

### 4.4 アーキテクチャ（Cloud Run + GPU）

Cloud Run 60分制限への対応：

```
┌─────────────────────────────────────────┐
│ Cloud Run (軽量処理) - 20分             │
│ - フレーム抽出                          │
│ - Geminiクリップ分類                    │
│ - イベント統合                          │
└─────────────────────────────────────────┘
           ↓ Cloud Tasks
┌─────────────────────────────────────────┐
│ Vertex AI / GCE (GPU推論) - 15-30分     │
│ - YOLO選手検出                          │
│ - YOLO/TrackNet ボール検出              │
│ - ByteTrack トラッキング                │
└─────────────────────────────────────────┘
           ↓ Pub/Sub
┌─────────────────────────────────────────┐
│ Cloud Run (統合処理) - 5分              │
│ - イベント検出                          │
│ - Calculator実行                        │
│ - Firestore保存                         │
└─────────────────────────────────────────┘
```

- [x] Cloud Run Dockerfile ✅ 完了 (2025-01-09)
  - `services/analyzer/Dockerfile` - マルチステージビルド、FFmpeg統合
  - `infra/cloud-run-service.yaml` - 4vCPU/16GB、3600秒タイムアウト
  - `infra/deploy-analyzer.sh` - デプロイスクリプト
  - `services/analyzer/server.js` - HTTPラッパー
- [ ] Cloud Tasks によるジョブ分割
- [ ] Vertex AI Custom Training Job 設定
- [ ] GPU Docker イメージ作成（CUDA + PyTorch + Ultralytics）
- [ ] Pub/Sub による完了通知
- [ ] 進捗状況のリアルタイム更新

---

## Phase 5: フロントエンド（修正UI）

### 5.1 スタッツ表示UI

- [x] 選手別スタッツ一覧画面 ✅ `apps/mobile/app/match/[id]/stats.tsx` に新メトリクス追加
  - パス統計（Attempted, Completed, Success Rate）
  - キャリー統計（Count, Index, Progress）
  - ポゼッション統計（Time, Count）
  - ターンオーバー統計（Lost, Won）
- [x] 各スタッツのconfidenceバー表示 ✅ 既存のMetricCardコンポーネントで対応
- [x] 低信頼スタッツの「要確認」ラベル ✅ 既存のconfidence indicator対応

### 5.2 背番号確定UI ✅ スケルトン完了

- [x] トラック一覧表示（サムネイル付き）✅ `apps/mobile/app/match/[id]/tracks.tsx`
- [x] 未確定トラックのハイライト ✅
- [x] 背番号選択/入力UI ✅
- [x] 確定後のスタッツ再計算トリガー ✅
- [x] `useTracks` Hook ✅ `apps/mobile/lib/hooks/useTracks.ts`

### 5.3 イベント修正UI（タップ）✅ スケルトン完了

- [x] 低信頼イベント一覧表示 ✅ `apps/mobile/app/match/[id]/review.tsx`
- [x] クリップ再生 + イベント情報オーバーレイ ✅
- [x] 「蹴った選手」タップ修正 ✅
  - トラック候補をハイライト表示
  - ワンタップで確定
- [x] 「受けた選手」タップ修正 ✅
- [x] 「パス成功/失敗」修正 ✅
- [x] 修正後のスタッツ再計算 ✅
- [x] `usePendingReviews` Hook ✅ `apps/mobile/lib/hooks/usePendingReviews.ts`

### 5.4 精度向上オプションUI

- [x] 「精度を上げる」オプション ✅ settings画面で既に実装済み
- [x] 校正情報入力（任意）✅ 既存UI活用
  - コートサイズ選択 → 未実装（将来）
  - 攻撃方向指定 ← **既存の settings.attackDirection UI を活用** ✅
  - チーム色指定 ← **既存の settings.teamColors UI を活用** ✅
  - カメラズームレベル ← **既存の settings.camera.zoomHint UI を活用** ✅

### 5.5 タクティカルビューUI ✅ 基盤完了

- [x] 2Dピッチビュー基本実装 ✅ `apps/mobile/components/TacticalView.tsx`
  - 11v11/8v8/5v5 対応のピッチを2D描画
  - ピッチマーキング（センターライン、ペナルティエリア、ゴールエリア等）
  - View-based 実装（SVGアップグレード可能）
- [x] 全22人 + ボールのリアルタイム表示 ✅
  - フィールド座標からスクリーン座標への変換
  - チーム色で選手を色分け（settings.teamColors活用）
  - ボールは白色で表示
- [x] 画面内/外の視覚的区別 ✅
  - 画面内選手: 実線・濃い色・不透明度100%
  - 画面外選手（予測）: 点線・薄い色・信頼度に応じた不透明度
- [x] 選手情報の表示 ✅
  - 背番号のラベル表示
  - タップで選手詳細カード表示
- [x] タクティカルビュー画面 ✅ `apps/mobile/app/match/[id]/tactical.tsx`
  - ライブ/リプレイモード切替
  - チーム別人数統計
  - 凡例表示
- [x] `useLivePositions` Hook ✅ `apps/mobile/lib/hooks/useLivePositions.ts`
  - Firestoreからリアルタイム位置取得
  - ボール位置取得
- [ ] 交代選手の入退場検出（将来）
- [ ] 再生コントロール（シークバー、スロー再生）（将来）

---

## Phase 6: 精度向上（将来）

### 6.1 カメラ動き補正

- [ ] グローバルモーション推定
- [ ] 座標のグローバル化

### 6.2 ボール追跡安定化

- [ ] 時系列フィルタ（カルマン等）
- [ ] 見失い区間の補間精度向上

### 6.3 距離校正（メートル換算）

- [ ] 4点キャリブレーションUI
- [ ] ホモグラフィ変換実装
- [ ] `carryIndex → meters` 変換

### 6.4 ReID（外観特徴）

- [ ] 選手外観特徴抽出
- [ ] クロスカメラ / 再登場時のID維持

---

## 共通型定義（shared package）

```typescript
// packages/shared/src/types/stats.ts に追加

export type MetricKey =
  // 既存
  | 'match.summary.totalShots'
  // ...

  // パス関連
  | 'player.passes.attempted'
  | 'player.passes.completed'
  | 'player.passes.incomplete'
  | 'player.passes.successRate'
  | 'player.passes.intercepted'

  // キャリー関連
  | 'player.carry.count'
  | 'player.carry.index'
  | 'player.carry.progress.index'
  | 'player.carry.meters'

  // ポゼッション関連
  | 'player.possession.timeSec'
  | 'player.possession.count'
  | 'team.possession.percent'

  // ターンオーバー関連
  | 'player.turnovers.lost'
  | 'player.turnovers.won'

  // シュート関連
  | 'player.shots.count'
  | 'player.shots.onTarget';
```

---

## Firestore スキーマまとめ（チャンク化対応）

**ドキュメントサイズ制限（1MB）への対応:**

```
matches/{matchId}/
  ├── tracks/{trackId}                    # メタデータのみ（軽量）
  │   └── chunks/{chunkIndex}             # 30秒ごとのフレームデータ
  ├── ballTrack/
  │   ├── meta                            # ボールトラックメタデータ
  │   └── chunks/{chunkIndex}             # 30秒ごとの検出データ
  ├── trackMappings/{trackId}             # trackId → playerId マッピング
  ├── trackTeamMetas/{trackId}            # チーム分類結果
  ├── homography/
  │   ├── active                          # 現在有効な変換行列
  │   └── history/{sequenceId}            # カメラ移動時の履歴
  ├── livePositions/{trackId}             # リアルタイム表示用（1fps間引き）
  ├── events/{eventId}                    # 全イベント統合
  ├── pendingReviews/{eventId}            # 要確認イベント
  ├── stats/{statId}                      # Calculator出力
  └── processingStatus                    # 処理進捗
```

**チャンク化の詳細:**
- TrackDoc: 30秒/チャンク（900フレーム）→ 約162KB/chunk ✅
- BallTrackDoc: 30秒/チャンク → 約90KB/chunk ✅
- 90分試合 = 180チャンク/選手

**新規追加コレクション:**
- `predictedPositions/{trackId}`: カルマンフィルタによる画面外選手の予測位置
- `homography/{frameNumber}`: カメラ座標→ピッチ座標変換行列（タクティカルビュー用）

---

## 依存関係・実装順序

```
Phase 1.1 選手検出+追跡 (YOLO + ByteTrack)
    ↓
Phase 1.2 チーム分類
    ↓
Phase 1.2.5 非選手フィルタリング  ←  Phase 1.5 ホモグラフィ推定
    ↓                                       ↓
Phase 1.3 ボール検出 (YOLO/TrackNet)        ↓
    ↓                                       ↓
Phase 1.4 背番号OCR                         ↓
    ↓                                       ↓
Phase 2.1 保持判定  ←───────────────────────┘
    ↓
Phase 2.2 パスイベント
Phase 2.3 キャリーイベント
Phase 2.4 その他イベント
    ↓
Phase 2.5 フレーム外選手の軌道予測
    ↓
Phase 3.x Calculator群
    ↓
Phase 4 バックエンド統合
    ↓
Phase 5.1-5.4 スタッツ表示・修正UI
    ↓
Phase 5.5 タクティカルビューUI (Phase 1.5 + 2.5 活用)
    ↓
Phase 6 精度向上（継続的）
```

**新規追加Phaseの依存関係:**
- Phase 1.5 (ホモグラフィ) → Phase 1.2.5 (非選手フィルタ), Phase 2.1 (保持判定), Phase 5.5 (タクティカルビュー)
- Phase 1.2.5 (非選手フィルタ) → Phase 1.3以降の全処理（ノイズ除去により精度向上）
- Phase 2.5 (軌道予測) → Phase 5.5 (タクティカルビュー)

**試合設定の拡張による依存関係:**
- `settings.gameFormat` → Phase 1.2.5（人数制限フィルタの閾値）
- `settings.fieldSize` → Phase 1.5（ホモグラフィ推定のピッチサイズ）
- `settings.matchDuration` → Phase 4（処理時間最適化、進捗計算）
- `settings.matchDuration.numberOfHalves` → Phase 4（ハーフタイム検出、スタッツ区分）

---

## 完了チェックリスト

各タスクの `[ ]` を `[x]` に変更することで完了を記録できます。

---

## メモ・補足

- ボール検出がボトルネックになりやすい
  - 取れない区間はGeminiクリップ分類で補完
  - YOLO/TrackNetとカルマンフィルタで高速・高精度な追跡を実現
- 最初は「自動推定 + confidence」で必ず値を出す
- 低信頼時のみユーザー修正を促す
- 距離(m)は校正後の機能として後回しでOK

### 新規追加機能のポイント

**Phase 1.5 ホモグラフィ推定:**
- タクティカルビュー実現の基盤技術
- カメラ座標→ピッチ座標変換により、正確な位置・距離計算が可能
- FootyVision、SoccerNet等の先行実装を参考にする

**Phase 1.2.5 非選手フィルタリング:**
- 素人撮影で課題となる「観客・ベンチ・私服の人」の映り込みを除外
- 5段階のフィルタを組み合わせることで高精度な除外が可能
- ホモグラフィ（ピッチ内外判定）と settings（色・ロスター）を活用

**Phase 2.5 軌道予測:**
- カメラの画角外に出た選手を追跡し続ける
- カルマンフィルタで位置を予測、信頼度を時間経過で減衰
- タクティカルビューで「全選手の位置」を表示するために必須

**Phase 5.5 タクティカルビューUI:**
- プロ仕様のような2Dピッチビュー
- 画面内/外の選手を区別表示（実線/点線、濃淡）
- 交代選手の自動検出・アラート機能

### settings-fix-plan.md との連携

settings-fix-plan.md で実装した以下の機能を本プランで活用：

```
設定機能（実装済み）          →  自動スタッツ（本プラン）
─────────────────────────────────────────────────────────
settings.teamColors           →  チーム分類の初期値
settings.formation.assignments →  背番号OCRの照合リスト
settings.camera.zoomHint      →  ボール検出閾値の調整
settings.attackDirection      →  キャリー進行方向の計算
validateMatchSettings()       →  イベントデータの検証にも応用可能
```

関連ファイル:
- `packages/shared/src/validation/settings.ts` - バリデーション関数
- `packages/shared/src/domain/settings.ts` - DefaultSettings型
- `apps/mobile/app/match/[id]/settings.tsx` - 試合設定UI

---

## コスト見積もり

### 処理コスト（1試合あたり）

| 項目 | 標準モード | 備考 |
|------|-----------|------|
| Cloud Run (CPU) | $0.05 | 20分 × 4 vCPU |
| Vertex AI (GPU T4) | $0.18 | 30分 × T4 |
| Vertex AI (Spot GPU) | $0.06 | 70%割引 |
| Gemini API | $0.15-0.45 | 30クリップ |
| Cloud Storage | $0.05 | egress + storage |
| **合計（通常）** | **$0.43-0.73** | |
| **合計（Spot GPU）** | **$0.31-0.61** | 推奨 |

### Firestoreコスト（1試合あたり）

| 項目 | 数量 | コスト |
|------|------|--------|
| 書き込み（チャンク） | ~5,000 | $0.90 |
| 書き込み（イベント） | ~1,000 | $0.18 |
| 読み取り（視聴1回） | ~1,500 | $0.09 |
| **合計** | | **$1.17** |

### 月間コスト見積もり

| 規模 | 試合数/月 | 処理コスト | Firestoreコスト | 合計 |
|------|----------|-----------|----------------|------|
| 個人利用 | 10 | $3-6 | $12 | **$15-18** |
| チーム利用 | 50 | $15-30 | $60 | **$75-90** |
| クラブ利用 | 200 | $60-120 | $240 | **$300-360** |

### コスト最適化オプション

- [ ] Spot/Preemptible GPU の活用（70%削減）
- [ ] 処理モード選択による最適化（クイックモードはGPU不要）
- [ ] フレームレート調整（5fps → 3fps で40%削減）
- [ ] 8人制サッカーの自動最適化（処理量50%削減）

---

## 追加要件（精査により発見）

### ~~未実装の型定義~~ ✅ 完了

以下の型定義を追加済み：

- [x] `HomographyData`, `HomographyKeypoint` → `packages/shared/src/domain/tracking.ts`
- [x] `PredictedPosition`, `Velocity2D`, `PredictionConfig` → `packages/shared/src/domain/tracking.ts`
- [x] `GameFormat`, `MatchDuration`, `FieldSize` → `packages/shared/src/domain/match.ts`
- [x] `ProcessingMode`, `ProcessingConfig`, `PROCESSING_CONFIGS` → `packages/shared/src/domain/match.ts`
- [x] `DEFAULT_FIELD_SIZES`, `DEFAULT_MATCH_DURATIONS` → `packages/shared/src/domain/match.ts`

### ~~パイプライン統合（重要）~~ ✅ 完了

- [x] Step 07-10 を `runMatchPipeline.ts` にインポート・実行追加 ✅
- [x] 処理順序の確定 ✅
  ```
  01_extractMeta (0.05) → 02_detectShots (0.10) → 03_extractClips (0.20) → 04_labelClipsGemini (0.30)
      ↓
  05_buildEvents (0.40) → 07_detectPlayers (0.50) → 08_classifyTeams (0.60)
      ↓
  09_detectBall (0.70) → 10_detectEvents (0.80) → 06_computeStats (0.95)
  ```
- [x] 各ステップの進捗率の再計算 ✅

### 信頼性・エラーハンドリング

#### ~~Gemini API リトライ戦略~~ ✅ 完了

- [x] タイムアウト設定（120秒）✅ `services/analyzer/src/lib/retry.ts`
- [x] 指数バックオフリトライ（最大3回）✅
- [x] Rate Limit (429) 対応 ✅
- [x] 5xx サーバーエラー対応 ✅
- [x] ネットワークエラー（ETIMEDOUT, ECONNRESET）対応 ✅
- [ ] 部分失敗時の継続処理（60クリップ中10個失敗→残り50個は処理続行）

実装済みファイル:
- `services/analyzer/src/lib/retry.ts` - 汎用リトライユーティリティ
- `services/analyzer/src/gemini/labelClip.ts` - Gemini API 呼び出しにリトライ統合

#### ~~エラー分類~~ ✅ 完了

- [x] エラー種別の定義 → `services/analyzer/src/lib/errors.ts`
  - ValidationError, MissingFieldError (never retry)
  - ExternalServiceError, RateLimitError (retryable)
  - StorageError, FfmpegError, DetectionError
  - TimeoutError (retryable)
- [x] リトライ可能/不可能の判定ロジック → `isRetryableError()`
- [ ] ユーザー向けエラーメッセージの統一（UI側対応待ち）

### ~~ログ・モニタリング~~ ✅ 部分完了

- [x] 構造化ログの拡張 → `services/analyzer/src/lib/logger.ts`
  - Logger クラス（ILogger インターフェース）
  - 実行時間計測（withTiming ユーティリティ）
  - ステップ進捗ロガー（createStepLogger）
- [x] トレーシングID対応 → `generateTraceId()`, `extractTraceId()`
- [ ] Cloud Monitoring ダッシュボード設計
- [ ] アラート設定（エラー率、処理時間超過）
- [ ] メモリ使用量監視
- [ ] API呼び出しコスト追跡

実装済み機能:
```typescript
// Logger 使用例
const logger = createPipelineLogger({ matchId, jobId, version });
logger.info("step_start", { step: "detect_players" });
logger.error("step_failed", error, { durationMs: 1234 });

// 子ロガーでコンテキスト追加
const stepLogger = logger.child({ step: "detect_ball" });

// タイミング計測
await withTiming(logger, "ffmpeg_extract", () => extractFrames(...));
```

### UX改善

#### 処理進捗の詳細表示 ✅ 完了

- [x] `matches/{matchId}/analysis` に詳細進捗フィールド追加 ✅
  - `AnalysisStep` 型定義（10ステップ）
  - `AnalysisProgress` 型（currentStep, overallProgress, stepProgress, estimatedSecondsRemaining）
  - `ANALYSIS_STEP_INFO` 定数（日本語/英語ラベル）
- [x] パイプラインでの詳細進捗追跡 ✅ `runMatchPipeline.ts`
  - `startStep()`, `completeStep()`, `updateProgress()` ヘルパー関数
  - ステップ重み付けによる正確な進捗計算
  - 残り時間推定アルゴリズム
- [x] モバイルアプリで詳細進捗UI実装 ✅ `apps/mobile/components/AnalysisProgress.tsx`
  - ステップ別進捗インジケーター
  - 残り時間表示
  - ステップ完了状態の可視化

#### 通知 ✅ 完了

- [x] Push通知（expo-notifications）✅
  - 処理完了時
  - エラー発生時
  - レビュー必要時
- [x] 通知設定UI（オン/オフ切替）✅ `apps/mobile/app/(tabs)/settings.tsx`

**追加実装済み (通知):**
- `apps/mobile/lib/notifications/index.ts` - 通知設定・登録ユーティリティ
- `apps/mobile/lib/hooks/useNotifications.ts` - 通知管理Hook
- `apps/mobile/app.config.ts` - expo-notifications プラグイン設定
- `apps/mobile/app/_layout.tsx` - アプリ起動時の通知初期化

**注意:** `expo-notifications` パッケージのインストールが必要:
```bash
cd apps/mobile && pnpm add expo-notifications
```

#### オフライン対応 ✅ 完了

- [x] ネットワーク状態監視Hook ✅ `apps/mobile/lib/hooks/useNetworkState.ts`
  - `useNetworkState()` - 詳細なネットワーク状態
  - `useIsOnline()` - シンプルなオンライン状態
- [x] オフライン時のUI表示 ✅ `apps/mobile/components/OfflineBanner.tsx`
  - `OfflineBanner` コンポーネント
  - `useOfflineState()` フック
- [x] アップロードキューイング ✅ 完了 (2025-01-09)
  - `apps/mobile/lib/upload/queue.ts` - AsyncStorageベースのキュー管理
  - `apps/mobile/lib/hooks/useUploadQueue.ts` - Reactフック
  - 自動リトライ（指数バックオフ、最大3回）
  - オンライン復帰時の自動キュー処理

### テスト戦略

#### ユニットテスト ✅ 部分完了

- [x] テストフレームワーク導入（Vitest）✅ `services/analyzer/package.json`
- [ ] Zod バリデーションテスト
- [x] Calculator ロジックテスト ✅ 71テスト作成 (passesV1, carryV1, possessionV1, turnoversV1)
- [x] Firebase Rules テスト ✅ 完了 (2025-01-09)
  - `infra/__tests__/firebase.rules.test.ts` - 37テストケース
  - matches, tracks, passEvents, pendingReviews, stats, jobs, users コレクション
  - オーナーベースアクセス制御の検証

```bash
# services/analyzer/package.json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

#### E2Eテスト

- [ ] Detox（React Native E2E）導入
- [ ] 主要フローのテストケース
  - アップロード→分析→表示
  - 設定変更→再計算
  - エラーハンドリング

#### ML精度評価

- [ ] ベンチマークデータセット作成
- [ ] 精度指標の定義（Precision, Recall, F1）
- [ ] バージョン間比較レポート
- [ ] ユーザーフィードバック機構（結果の正誤報告）

### Cloud Run 設定の具体化

```yaml
# infra/cloud-run-service.yaml（新規作成）
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: soccer-analyzer
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/cpu-throttling: "false"
        run.googleapis.com/execution-environment: gen2
    spec:
      containerConcurrency: 1
      timeoutSeconds: 3600  # 60分
      containers:
      - image: gcr.io/PROJECT_ID/soccer-analyzer
        resources:
          limits:
            cpu: "4"
            memory: "16Gi"
        env:
        - name: GEMINI_API_KEY
          valueFrom:
            secretKeyRef:
              name: gemini-api-key
              key: latest
```

### ~~バリデーション追加~~ ✅ 完了

`packages/shared/src/validation/settings.ts` に以下を追加済み：

- [x] `gameFormatSchema` - z.enum(['eleven', 'eight', 'five'])
- [x] `matchDurationSchema` - halfDuration, numberOfHalves, extraTime
- [x] `fieldSizeSchema` - length, width with min/max constraints
- [x] `processingModeSchema` - z.enum(['quick', 'standard', 'detailed'])
- [x] `matchSettingsSchema` にこれらの新フィールドを統合

---

## 実装優先順位（更新版）

### P0: ブロッカー（Calculator が動作しない原因）

1. ~~**runMatchPipeline.ts に Step 07-10 を統合**~~ ✅ 完了
2. **Step 10 (detectEvents) の実装** → Calculator への入力供給 (skeleton実装済み、ML統合待ち)
3. ~~**Gemini API リトライロジック**~~ ✅ 完了 → 本番安定性

### P1: 基盤整備

4. ~~未実装型定義の追加（HomographyData, GameFormat等）~~ ✅ 完了
5. ~~試合設定拡張（gameFormat, matchDuration, fieldSize）~~ ✅ 完了
6. ~~バリデーションスキーマ追加~~ ✅ 完了
7. ~~エラーハンドリング統一~~ ✅ 完了 → `services/analyzer/src/lib/errors.ts`
8. ~~ログ・モニタリング基盤~~ ✅ 完了 → `services/analyzer/src/lib/logger.ts`

### P2: ML/AI統合

9. ~~Step 07 (detectPlayers)~~ ✅ 完了 - ログ統合・検出抽象化レイヤー連携
10. ~~Step 08 (classifyTeams)~~ ✅ 完了 - ログ統合・色抽出抽象化レイヤー連携
11. ~~Step 09 (detectBall)~~ ✅ 完了 - ログ統合・ボール検出抽象化レイヤー連携
12. ~~Step 10 (detectEvents)~~ ✅ 完了 - ログ統合・エラーハンドリング統合
13. ~~ffmpegフレーム抽出ユーティリティ~~ ✅ 完了
14. ~~パイプラインへのlogger引き渡し~~ ✅ 完了

**追加実装済み:**
- `services/analyzer/src/detection/types.ts` - PlayerDetector, BallDetector, ColorExtractor, Tracker インターフェース
- `services/analyzer/src/detection/placeholder.ts` - プレースホルダー実装
- `services/analyzer/src/lib/ffmpeg.ts` - extractFrames, extractFrameBuffer, extractFrameBuffers 追加
- `services/analyzer/src/jobs/steps/07_detectPlayers.ts` - logger, playerDetector, tracker パラメータ追加
- `services/analyzer/src/jobs/steps/08_classifyTeams.ts` - logger, colorExtractor パラメータ追加
- `services/analyzer/src/jobs/steps/09_detectBall.ts` - logger, ballDetector パラメータ追加
- `services/analyzer/src/jobs/steps/10_detectEvents.ts` - logger, エラーハンドリング追加
- `services/analyzer/src/jobs/runMatchPipeline.ts` - logger をStep 07-10に引き渡し

### P3: UX強化

13. ~~処理進捗詳細表示~~ ✅ 完了
14. ~~Push通知~~ ✅ 完了 (expo-notifications統合)
    - `apps/mobile/lib/notifications/index.ts` - 通知設定・登録ユーティリティ
    - `apps/mobile/lib/hooks/useNotifications.ts` - 通知管理Hook
    - `apps/mobile/app.config.ts` - expo-notificationsプラグイン設定
15. ~~オフライン対応~~ ✅ 完了
16. ~~Phase 5 UI（背番号確定、イベント修正）~~ ✅ スケルトン完了
    - `apps/mobile/app/match/[id]/tracks.tsx` - 背番号確定UI
    - `apps/mobile/app/match/[id]/review.tsx` - イベント修正UI
    - `apps/mobile/lib/hooks/useTracks.ts` - トラックHook
    - `apps/mobile/lib/hooks/usePendingReviews.ts` - レビューHook

**追加実装済み (P3):**
- `packages/shared/src/domain/match.ts` - AnalysisStep, AnalysisProgress型, ANALYSIS_STEP_INFO追加
- `services/analyzer/src/jobs/runMatchPipeline.ts` - 詳細進捗追跡 (startStep, completeStep, updateProgress)
- `apps/mobile/components/AnalysisProgress.tsx` - ステップ別進捗表示コンポーネント
- `apps/mobile/lib/hooks/useNetworkState.ts` - ネットワーク状態監視Hook
- `apps/mobile/components/OfflineBanner.tsx` - オフライン表示バナー・ユーティリティ

### P4: 高度機能

17. ~~Phase 1.5 (ホモグラフィ)~~ ✅ 基盤完了
    - `services/analyzer/src/detection/homography.ts` - 座標変換ユーティリティ
    - `HomographyEstimator` インターフェース
    - `PlaceholderHomographyEstimator` プレースホルダー実装
18. ~~Phase 2.5 (軌道予測)~~ ✅ 基盤完了
    - `services/analyzer/src/detection/kalman.ts` - カルマンフィルタ
    - `KalmanFilter2D` クラス - 2D位置・速度追跡
    - `TrackPredictor` クラス - 複数トラック管理
19. ~~Phase 5.5 (タクティカルビュー)~~ ✅ 基盤完了
    - `apps/mobile/components/TacticalView.tsx` - 2Dピッチビューコンポーネント
    - `apps/mobile/app/match/[id]/tactical.tsx` - タクティカルビュー画面
    - `apps/mobile/lib/hooks/useLivePositions.ts` - リアルタイム位置取得Hook
20. ~~Phase 1.2.5 (非選手フィルタリング)~~ ✅ 実装完了
    - `services/analyzer/src/detection/filters.ts` - フィルタパイプライン
    - `filterByConfidence()`, `filterByPitchBoundary()`, `filterTopN()`
    - `filterByMotion()`, `filterByRoster()`
    - `runFilterPipeline()` - 統合フィルタ実行
21. ~~Phase 1.2 (チーム分類 K-means)~~ ✅ 実装完了
    - `services/analyzer/src/detection/colorClustering.ts` - K-meansカラークラスタリング
    - `kMeansClustering()` - K-means++初期化
    - `classifyTeamsByColor()` - チーム分類
    - HSV/RGB距離計算、ユーザー指定色との照合
22. テスト基盤構築 - ✅ モックデータジェネレーター完了
    - Calculator テスト (71テスト)
    - 検出モジュールテスト (71テスト)：filters, colorClustering, events
    - **テストヘルパー (31テスト)**: `services/analyzer/src/lib/testHelpers.ts`
      - 型ビルダー: `createPoint2D`, `createBoundingBox`, `createTrackFrame`
      - ドキュメントビルダー: `createTrackDoc`, `createBallTrackDoc`, `createTrackPlayerMapping`, `createTrackTeamMeta`
      - イベントビルダー: `createPassEvent`, `createCarryEvent`, `createTurnoverEvent`, `createPossessionSegment`
      - 検出データビルダー: `createTrackData`, `createBallData`
      - **シナリオジェネレーター**: `createMatchScenario()` - 完全なテスト試合データを生成（決定論的seed対応）

---

## 実装進捗トラッキング

### 推奨タスク（ML非依存・即実装可能）

| # | タスク | 状態 | 完了日 | 詳細 |
|---|--------|------|--------|------|
| 1 | Step 10 イベント検出統合 | ✅ 完了 | 2025-01-09 | `10_detectEvents.ts` に `detection/events.ts` モジュールを統合。全173テストパス |
| 2 | モックデータジェネレーター追加 | ✅ 完了 | 2025-01-09 | `testHelpers.ts` - 31テスト追加、`createMatchScenario()` でパイプラインテスト可能 |
| 3 | Step 07 フレーム抽出実装 | ✅ 完了 | 2025-01-09 | FFmpeg統合、ProcessingMode対応(1/3/5fps)、バッチ処理、進捗コールバック |
| 4 | Step 08 チーム分類パイプライン | ✅ 完了 | 2025-01-09 | K-meansカラークラスタリング統合、複数フレーム色サンプリング、settings.teamColors活用、TrackTeamMeta保存 |
| 5 | Step 09 ボール検出パイプライン | ✅ 完了 | 2025-01-09 | Kalmanフィルタによる軌道平滑化、camera.zoomHintによる信頼度閾値調整、補間処理、BallTrackDoc保存 |
| 6 | Step 07-10 統合テスト | ✅ 完了 | 2025-01-09 | 13テスト追加（合計186テスト）、Firestore/Storage/FFmpegモック、正常系・異常系カバー |
| 7 | PendingReviews自動保存 | ✅ 完了 | 2025-01-09 | carryEvents追加、confidence < 0.6で自動抽出、Firestoreバッチ保存 |
| 8 | Tactical View UIデータ接続 | ✅ 完了 | 2025-01-09 | useLivePositions完成、リアルタイム選手・ボール位置表示、チーム別統計 |
| 9 | Stats再計算トリガー | ✅ 完了 | 2025-01-09 | Cloud Function実装、needsRecalculationフラグ、モバイルUI連携 |
| 10 | 処理モード選択UI + 見積もり時間表示 | ✅ 完了 | 2025-01-09 | PROCESSING_MODE_INFO、estimateProcessingTime()、formatEstimatedTime() |
| 11 | Firebase Rules テスト | ✅ 完了 | 2025-01-09 | 37テストケース、オーナーベースアクセス制御 |
| 12 | オフラインアップロードキュー | ✅ 完了 | 2025-01-09 | useUploadQueue Hook、AsyncStorage永続化、自動リトライ |
| 13 | Cloud Run + Dockerfile | ✅ 完了 | 2025-01-09 | マルチステージビルド、FFmpeg、cloud-run-service.yaml |

### 次のステップ

- [x] ~~Step 08-09 のプレースホルダー実装を実データ処理に置き換え~~ ✅ 完了 (2025-01-09)
- [x] ~~パイプライン統合テスト~~ ✅ 完了 (2025-01-09) - 13テスト追加
- [x] ~~PendingReviews自動保存~~ ✅ 完了 (2025-01-09)
- [x] ~~Tactical View UIデータ接続~~ ✅ 完了 (2025-01-09)
- [x] ~~Stats再計算トリガー~~ ✅ 完了 (2025-01-09)
- [ ] Vertex AI / GCE GPU 推論環境のセットアップ
- [ ] YOLO/ByteTrack モデル統合（PlayerDetector/Tracker実装）
