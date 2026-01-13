# Gemini イベント検出精度向上 実装計画

## 概要

サッカー動画解析におけるイベント検出（パス、キャリー、ターンオーバー、シュート）の精度を向上させるための実装計画。

---

## Phase 1: プロンプト強化

### 1.1 イベント検出プロンプトの改善

- [x] `services/analyzer/src/gemini/prompts/event_detection_v1.json` をバックアップ
- [x] `event_detection_v2.json` を新規作成

#### 視覚的手がかり（Visual Indicators）

- [x] パス検出の視覚的指標を定義
  - 選手の足がボールを蹴る動作
  - ボールが空中または地面を移動
  - 別の選手がボールに接触
- [x] キャリー検出の視覚的指標を定義
  - 選手がボールを足元に置いて移動
  - ボールが選手から2m以内を維持
  - 複数回のタッチまたは連続的な接触
- [x] ターンオーバー検出の視覚的指標を定義
  - ボール所持が明確に変わる瞬間
  - タックル: 守備選手の足がボールに接触
  - インターセプト: パスが相手選手に渡る
- [x] シュート検出の視覚的指標を定義
  - ゴール方向への強いボール移動
  - 選手の体がゴールに向いている
  - ゴールキーパーの反応

#### 信頼度ガイドライン

- [x] 信頼度の基準を明確化
  - 0.9+: 蹴り手、軌道、受け手すべてが明確に見える
  - 0.7-0.9: 一部遮蔽あるがボール軌道は明確
  - 0.5-0.7: 選手位置とボール出現から推測
  - 0.5未満: 報告しない（プロンプトで明記）

#### パス距離の定義

- [x] 距離カテゴリを明確化
  - short: 10m未満（近くの味方へ）
  - medium: 10-25m（中距離）
  - long: 25m以上（ロングボール）
  - through: 守備ラインの裏へ
  - cross: サイドからペナルティエリアへ

#### ネガティブ例（検出しないもの）

- [x] 誤検出を防ぐためのネガティブ例を追加
  - クリアランス（危険回避の蹴り出し）はパスではない
  - ゴールキック待ち、スローイン待ちは停止区間
  - リプレイ映像は検出対象外
  - ハーフタイム、試合終了後の映像は対象外
  - ウォームアップ、練習シーンは対象外

#### フィールドゾーン

- [x] ゾーン情報を出力スキーマに追加
  - zone: `defensive_third` | `middle_third` | `attacking_third`
  - フィールドを3分割して位置を記録

#### 時間的制約

- [x] イベント間の制約を明記
  - 同じ選手の連続パス: 最低1秒以上の間隔
  - キャリーの最小時間: 1秒以上、最小距離: 5m以上
  - 連続イベントの最小間隔: 0.5秒

#### 出力スキーマの拡張

- [x] `visualEvidence` フィールドを追加（検出根拠の説明）
- [x] `zone` フィールドを追加（フィールド位置）
- [x] `videoQuality` メタ情報を追加
  - quality: `good` | `fair` | `poor`
  - issues: `["occlusion", "camera_shake", "low_resolution", "replay"]`

### 1.2 シーン抽出プロンプトの改善

- [x] `scene_extraction_v1.json` をバックアップ
- [x] `scene_extraction_v2.json` を新規作成
- [x] アクティブプレイ vs 停止の明確な定義を追加
- [x] チームの攻撃方向の識別を追加

### 1.3 プロンプトバージョン管理

- [x] `07_detectEventsGemini.ts` でプロンプトバージョンを設定可能にする
- [x] 環境変数 `PROMPT_VERSION` で切り替え可能にする
- [x] v1 と v2 の A/B テスト用フラグを追加

---

## Phase 2: マルチパス分析の実装

### 2.1 Pass 1: 粗いセグメンテーション

- [x] `services/analyzer/src/jobs/steps/07a_segmentVideo.ts` を新規作成
- [x] セグメンテーション用プロンプト `video_segmentation_v1.json` を作成
  - [x] アクティブプレイ区間の検出
  - [x] 停止区間の検出
  - [x] セットピース区間の検出
  - [x] ゴールシーン区間の検出
- [x] セグメント結果の型定義 `VideoSegment` を追加
  ```typescript
  interface VideoSegment {
    startSec: number;
    endSec: number;
    type: 'active_play' | 'stoppage' | 'set_piece' | 'goal_moment';
    subtype?: string;
    description: string;
    homeTeamAttacking?: boolean;
  }
  ```
- [x] Firestore に `matches/{matchId}/segments` コレクションを追加
- [x] セグメント情報をパイプラインコンテキストに追加

### 2.2 Pass 2: ウィンドウ処理

- [x] `services/analyzer/src/jobs/steps/07b_detectEventsWindowed.ts` を新規作成
- [x] ウィンドウ設定の型定義
  ```typescript
  interface AnalysisWindow {
    windowId: string;
    absoluteStart: number;
    absoluteEnd: number;
    overlap: { before: number; after: number };
    targetFps: number;
    segmentContext: VideoSegment;
  }
  ```
- [x] セグメントタイプに応じたFPS決定ロジック
  - [x] アクティブプレイ: 3 FPS
  - [x] セットピース: 2 FPS
  - [x] ゴールシーン: 5 FPS
  - [x] 停止: 1 FPS（スキップも検討）
- [x] ウィンドウ生成ロジック
  - [x] デフォルト: 60秒ウィンドウ、15秒オーバーラップ
  - [x] セグメント境界でのウィンドウ分割
- [x] 並列処理の実装（最大5並列）
- [x] ウィンドウごとのイベント検出
- [x] 相対タイムスタンプ → 絶対タイムスタンプ変換

### 2.3 重複排除アルゴリズム

- [x] `services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts` を新規作成
- [x] イベントクラスタリングロジック
  - [x] 2秒以内の同タイプ・同チームイベントをグループ化
  - [x] 最高信頼度イベントをベースに選択
  - [x] タイムスタンプは信頼度加重平均
- [x] マージされたイベントの追跡
  ```typescript
  interface DeduplicatedEvent {
    // ... event fields
    mergedFromWindows: string[];
    adjustedConfidence: number;
  }
  ```
- [x] 重複排除前後のイベント数をログ出力

### 2.4 パイプライン統合

- [x] `runMatchPipeline.ts` にマルチパスステップを追加
- [x] 既存の `07_detectEventsGemini.ts` をフォールバックとして維持
- [x] 環境変数 `USE_MULTIPASS_DETECTION` で切り替え可能にする
- [x] ステップ間のデータ受け渡しを確認

---

## Phase 3: コンテキストキャッシュ実装

### 3.1 Vertex AI キャッシュの実装

- [x] `services/analyzer/src/gemini/cacheManager.ts` を更新
- [x] 実際の Vertex AI `cachedContents` API を呼び出す
  ```typescript
  async function createActualCache(options: CreateCacheOptions): Promise<string>
  ```
- [x] キャッシュ作成エンドポイント実装
  - [x] REST API: `POST /v1/projects/{project}/locations/{location}/cachedContents`
  - [x] 認証: GoogleAuth でアクセストークン取得
  - [x] TTL: 2時間（7200秒）
- [x] キャッシュ参照を使ったリクエスト実装
  ```typescript
  async function callGeminiApiWithCache(cacheResourceName: string, prompt: string)
  ```
- [x] キャッシュの有効期限管理
- [x] キャッシュ削除/更新ロジック (`deleteActualCache`, `updateCacheTtl`)

### 3.2 キャッシュ活用フロー

- [x] Pass 1 実行時にキャッシュ作成 (`getOrCreateCache`)
- [x] Pass 2 でキャッシュを参照 (`callGeminiApiWithCache`)
- [x] Pass 3（検証）でキャッシュを参照
- [x] パイプライン完了後にキャッシュ削除 (`deleteCache`)

### 3.3 コスト追跡

- [x] キャッシュ使用時のトークン使用量を記録 (`costTracker.ts`)
- [x] キャッシュなし vs ありのコスト比較をログ出力 (`MatchCostSummary`)
- [x] Firestore に `matches/{matchId}/costTracking` を追加 (`costRecords`, `costTracking/summary`)

---

## Phase 4: 検証パス（オプション）

### 4.1 低信頼度イベントの再検証

- [x] `services/analyzer/src/jobs/steps/07d_verifyEvents.ts` を新規作成
- [x] 検証用プロンプト `event_verification_v1.json` を作成
  - [x] 特定タイムスタンプのイベントを確認
  - [x] Yes/No + 修正された詳細を返す
- [x] 検証対象の選定ロジック
  - [x] 信頼度 0.5-0.7 のイベント
  - [x] 重複排除でマージされたイベント（needsReview フラグ）
- [x] キャッシュを使った効率的なクエリ (`callGeminiApiWithCache`)

---

## Phase 5: 型定義・共通コードの整備

### 5.1 型定義の追加

- [x] `packages/shared/src/domain/segment.ts` を新規作成
  - [x] `VideoSegment` 型
  - [x] `AnalysisWindow` 型
  - [x] `WindowConfig` 型
  - [x] `DEFAULT_WINDOW_CONFIG` 定数
- [x] `packages/shared/src/domain/event.ts` を更新
  - [x] `RawEvent` 型（重複排除前）
  - [x] `DeduplicatedEvent` 型
  - [x] `EventZone` 型
  - [x] `EventVerificationInfo` 型
- [x] `packages/shared/src/index.ts` でエクスポート

### 5.2 ユーティリティ関数

- [x] `services/analyzer/src/lib/windowUtils.ts` を新規作成
  - [x] `generateWindows(segments, config)` 関数
  - [x] `getFpsForSegment(segment)` 関数
  - [x] `absoluteToRelativeTime(absolute, windowStart)` 関数
  - [x] `relativeToAbsoluteTime()`, `isInCoreWindow()`, `batchWindows()` など追加
- [x] `services/analyzer/src/lib/deduplication.ts` を新規作成 (Phase 2で作成済み)
  - [x] `clusterEvents(events, timeThreshold)` 関数
  - [x] `mergeCluster(cluster)` 関数

---

## Phase 6: テストと検証

### 6.1 ユニットテスト

- [ ] `deduplication.test.ts` を作成
  - [ ] クラスタリングロジックのテスト
  - [ ] マージロジックのテスト
  - [ ] エッジケース（空配列、単一イベント等）
- [ ] `windowUtils.test.ts` を作成
  - [ ] ウィンドウ生成のテスト
  - [ ] FPS決定ロジックのテスト

### 6.2 統合テスト

- [ ] テスト用の短い動画（5分程度）を用意
- [ ] 手動アノテーション（Ground Truth）を作成
- [ ] 精度測定スクリプトを作成
  - [ ] Precision, Recall, F1 スコア
  - [ ] タイムスタンプ誤差（MAE）

### 6.3 A/Bテスト

- [ ] v1 プロンプトと v2 プロンプトの比較
- [ ] シングルパス vs マルチパスの比較
- [ ] 結果をスプレッドシートに記録

---

## Phase 7: デプロイと監視

### 7.1 段階的ロールアウト

- [ ] ステージング環境でテスト
- [ ] 本番環境に環境変数で無効化した状態でデプロイ
- [ ] 特定ユーザー/マッチでのみ有効化
- [ ] 全ユーザーに展開

### 7.2 監視

- [ ] Cloud Logging でイベント検出数を監視
- [ ] 信頼度分布のダッシュボードを作成
- [ ] API コストのアラート設定

---

## 設定パラメータ一覧

| パラメータ | デフォルト値 | 説明 |
|-----------|-------------|------|
| `USE_MULTIPASS_DETECTION` | `false` | マルチパス検出を有効化 |
| `PROMPT_VERSION` | `v1` | 使用するプロンプトバージョン |
| `WINDOW_DURATION_SEC` | `60` | ウィンドウの長さ（秒） |
| `WINDOW_OVERLAP_SEC` | `15` | オーバーラップの長さ（秒） |
| `MAX_PARALLEL_WINDOWS` | `5` | 並列処理する最大ウィンドウ数 |
| `CACHE_TTL_SEC` | `7200` | キャッシュの有効期限（秒） |
| `VERIFICATION_CONFIDENCE_THRESHOLD` | `0.7` | 検証対象となる信頼度閾値 |

---

## ファイル構成（最終形）

```
services/analyzer/src/
├── gemini/
│   ├── prompts/
│   │   ├── event_detection_v1.json      # 既存（バックアップ）
│   │   ├── event_detection_v2.json      # 新規
│   │   ├── scene_extraction_v2.json     # 新規
│   │   ├── video_segmentation_v1.json   # 新規
│   │   └── event_verification_v1.json   # 新規
│   ├── cacheManager.ts                  # 更新（実際のキャッシュ実装）
│   └── gemini3Client.ts                 # 既存
├── jobs/
│   └── steps/
│       ├── 07_detectEventsGemini.ts     # 既存（フォールバック）
│       ├── 07a_segmentVideo.ts          # 新規
│       ├── 07b_detectEventsWindowed.ts  # 新規
│       ├── 07c_deduplicateEvents.ts     # 新規
│       └── 07d_verifyEvents.ts          # 新規
└── lib/
    ├── windowUtils.ts                   # 新規
    └── deduplication.ts                 # 新規

packages/shared/src/
└── domain/
    ├── segment.ts                       # 新規
    └── event.ts                         # 更新
```

---

## 注意事項

1. **後方互換性**: 既存のv1プロンプトは維持し、環境変数で切り替え可能にする
2. **フォールバック**: マルチパスが失敗した場合はシングルパスにフォールバック
3. **コスト監視**: キャッシュ実装前後でコストを比較し、効果を確認
4. **段階的導入**: 各Phaseを独立してデプロイ可能にする

---

## 参考リンク

- [Gemini API Video Understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini Prompting Strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
