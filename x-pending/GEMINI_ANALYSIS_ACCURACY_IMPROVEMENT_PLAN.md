# Gemini解析精度向上 実装計画

## 概要

サッカー動画解析の精度を根本的に向上させるための包括的な実装計画。
3つの並列調査（プロンプト分析、パイプライン分析、イベント検出分析）の結果に基づく。

---

## 実装進捗サマリー（2026-01-14更新）

| Phase | 完了率 | 状態 |
|-------|--------|------|
| Phase 1 | 100% | ✅ 完了 |
| Phase 2 | 100% | ✅ 完了 |
| Phase 3 | 40% | 🔄 進行中（3.1, 3.4完了、3.2/3.5/3.6は高工数のため後回し） |
| Phase 4 | 33% | 🔄 4.3のみ完了 |

---

## 調査結果サマリー（2026-01-14実施）

### 現状の実装状況

| カテゴリ | 現状 |
|---------|------|
| **プロンプトファイル** | ✅ Few-Shot追加済み（全4ファイル） |
| **キャッシュ実装** | ✅ 完全実装済み（Vertex AI統合 + 監視機能追加） |
| **動画送信** | ✅ `fileData`対応済み、`USE_VIDEO_FOR_LABELING`で切り替え可能 |
| **オーバーラップ** | ✅ 30秒（50%オーバーラップ） |
| **ストッページ** | ✅ 検出有効（skipStoppages: false） |
| **Confidence閾値** | ✅ MIN_HIGHLIGHT=0.5、needsReview<0.4 |
| **Temperature** | ✅ 各ステップで最適化済み |
| **topP/topK** | ✅ 各ステップで設定済み |
| **バッチラベリング** | ✅ `USE_BATCH_LABELING`で有効化可能 |

---

## Phase 1: 即効性のある改善（High Impact, Low-Medium Effort） ✅ 完了

### 1.1 Few-Shotサンプルをプロンプトに追加 ✅

**目的**: LLM研究によると15-25%の精度向上が見込める

**対象ファイル**: `services/analyzer/src/gemini/prompts/`

- [x] `clip_label_v1.json` に各ラベルの例を追加（15例: shot 3, chance 2, setPiece 3, dribble 2, defense 3, other 2）
  - [x] shot: 3例（ゴール前シュート、ミドルシュート、ヘディング）
  - [x] chance: 2例（決定機、ニアミス）
  - [x] setPiece: 3例（コーナー、フリーキック、PK）
  - [x] dribble: 2例（突破、キープ）
  - [x] defense: 3例（タックル、インターセプト、クリア）
  - [x] other: 2例（トランジション、ビルドアップ）

- [x] `tactical_analysis_v1.json` を拡張（3シナリオ例）
  - [x] フォーメーション検出の例を追加（4-3-3, 4-4-2, 3-5-2）
  - [x] プレッシング強度スケール（0-100）の視覚的基準を追加
  - [x] テンポ計算の方法論を追加
  - [x] 「キーインサイト」のテンプレート例を追加

- [x] `match_summary_v1.json` を拡張（3試合例）
  - [x] ナラティブのトーン・長さガイドラインを追加
  - [x] 良いサマリーvs悪いサマリーの例を追加
  - [x] MVP選出基準の例を追加

- [x] `event_detection_v3.json` にFew-Shot例を追加（10例）
  - [x] パス vs クリアランスの区別例
  - [x] シュート vs クロスの区別例
  - [x] ネガティブ例（検出すべきでないケース）

### 1.2 ウィンドウオーバーラップの拡大 ✅

**目的**: 境界付近のイベント見逃しを防止

**対象ファイル**: `services/analyzer/src/jobs/steps/07b_detectEventsWindowed.ts`

- [x] L90: `overlapSec: 30` に変更済み（50%オーバーラップ）
  - [x] 変更のコメント追加

### 1.3 Confidence閾値の最適化 ✅

**目的**: 低品質なハイライトのフィルタリング

- [x] `matchSummary.ts` L26: 閾値確認
  - [x] 現状: `MIN_HIGHLIGHT_CONFIDENCE = 0.5`

- [x] `04_labelClipsGemini.ts` の閾値追加
  - [x] ラベリング結果の信頼度下限を設定
  - [x] 0.4未満は `needsReview: true` をマーク（L78, 122, 136, 186, 200）

### 1.4 ストッページイベントの検出を有効化 ✅

**目的**: ファウル、交代、負傷の検出

**対象ファイル**: `services/analyzer/src/jobs/steps/07b_detectEventsWindowed.ts`

- [x] L99: `skipStoppages: false` に変更済み
- [x] L95: ストッページ用の低FPS設定（0.5 FPS）

### 1.5 検証ステップ閾値の確認 ✅

**目的**: 07d_verifyEventsの効果最大化

**対象ファイル**: `services/analyzer/src/jobs/steps/07d_verifyEvents.ts`

- [x] 検証対象の選定基準を確認（L278: confidence 0.5-0.7）
  - [x] maxVerifications: 20（コスト管理）
- [x] 検証後の判定閾値を確認
  - [x] verified && confidence >= 0.7 → 確認（L163）
  - [x] !verified || confidence < 0.5 → 削除（L174）
  - [x] 0.5-0.7のまま → 修正のみ

---

## Phase 2: 中期的改善（Medium Impact, Medium Effort） ✅ 完了

### 2.1 サムネイル → 動画クリップ送信への移行 ✅

**目的**: 動き依存イベント（ドリブル、ディフェンス）の精度向上

**実装済み（labelClip.ts）**:
- [x] `USE_VIDEO_FOR_LABELING` 環境変数で切り替え可能（L42）
- [x] `clipPath` パラメータ追加（L26-27）
- [x] GCS URI構築とfileData送信（L56-67）
- [x] サムネイルへのフォールバック（L70-79）

### 2.2a イベントベースのクリップ補完 ✅

**目的**: クリップカバレッジの向上（順序逆転の代替）

- [x] Step 07後の補完ステップ追加（`07e_supplementClipsForUncoveredEvents.ts`）
  - [x] 検出されたイベントのうち、既存クリップに含まれないものを特定
  - [x] タイムスタンプ許容範囲: ±5秒
  - [x] 未カバーイベントに対して追加クリップを生成（イベント中心±8秒）

- [x] 追加クリップの優先度
  - [x] shot, setPiece: 高優先度で追加
  - [x] maxSupplementaryClips: 20

- [x] パイプライン統合（runMatchPipeline.ts L337-344）

### 2.3 Confidenceスコアリングの修正 ✅

**目的**: 統計的に正確な信頼度計算

**対象ファイル**: `services/analyzer/src/lib/deduplication.ts`

- [x] L191-197: 乗算ブースト → 加算ロジックに変更
  ```typescript
  // 実装済み: 加算ベース（過剰な信頼度上昇を防止）
  const adjustedConfidence = Math.min(1.0, baseConfidence + clusterBonus * (1 - baseConfidence));
  ```

### 2.4 Temperature設定の最適化 ✅

**目的**: タスクごとの最適なランダム性

**実装済み設定**:
| ステップ | 値 | ファイル |
|---------|------|----------|
| labelClipsGemini | 0.1 | labelClip.ts L123 |
| segmentVideo | 0.1 | 07a L291 |
| detectEventsGemini | 0.25 | 07 L511 |
| detectEventsWindowed | 0.25 | 07b L418 |
| verifyEvents | 0.1 | 07d L337 |
| generateTacticalInsights | 0.4 | 10 L270 |
| generateMatchSummary | 0.4 | 11 L275 |

- [x] 分類タスク（clip_label）: temperature 0.1
- [x] 検出タスク（event_detection）: temperature 0.25
- [x] 分析タスク（tactical_analysis）: temperature 0.4

- [x] 各stepファイルでtopP, topKパラメータを追加
  - [x] 値: topP: 0.95, topK: 40

### 2.5 タクティカル分析にイベントデータを渡す ✅

**目的**: フォーメーションとパスパターンの整合性

**対象ファイル**: `services/analyzer/src/jobs/steps/10_generateTacticalInsights.ts`

- [x] イベントコレクション（passes, shots, turnovers）を取得（L116-120）
- [x] チーム別統計の集計（L122-146）
- [x] プロンプトにイベント統計を追加（L216-236）

### 2.6 プロンプトバージョン管理の統一 ✅

**目的**: 全ステップで一貫したバージョン管理

- [x] `10_generateTacticalInsights.ts` L19: `TACTICAL_PROMPT_VERSION` 環境変数対応
- [x] `11_generateMatchSummary.ts` L25: `SUMMARY_PROMPT_VERSION` 環境変数対応

### 2.7 deduplication時間閾値の調整 ✅

**目的**: イベントタイプ別の最適な重複判定

**対象ファイル**: `services/analyzer/src/lib/deduplication.ts`

- [x] TYPE_SPECIFIC_THRESHOLDS定数追加（L67-73）
  ```typescript
  export const TYPE_SPECIFIC_THRESHOLDS: Record<string, number> = {
    shot: 1.0,      // 瞬間的なイベント
    pass: 2.0,      // 標準
    carry: 3.0,     // 継続的なイベント
    turnover: 2.0,
    setPiece: 2.5,
  };
  ```
- [x] clusterEvents関数でタイプ別閾値を使用（L116-117）

---

## Phase 3: 長期的改善（High Impact, High Effort） 🔄 進行中

### 3.1 コンテキストキャッシュの動作確認・最適化 ✅

**現状**: ✅ 完全実装済み（Vertex AI統合 + 監視機能）

**実装済み機能**:
- `cacheManager.ts`: REST API統合（create/get/delete/update TTL）
- `gemini3Client.ts`: `callGeminiApiWithCache()` 実装済み
- `03_uploadVideoToGemini.ts`: キャッシュ作成フロー実装済み
- デフォルトTTL: 2時間、自動リフレッシュ: 10分前

**最適化タスク**:
- [x] キャッシュヒット率の監視設定追加
  - [x] `recordCacheAccess()` 関数（L798-846）
  - [x] `getCacheHitStats()` 関数（L851-896）
  - [x] `CacheAccessType`, `CacheAccessRecord`, `CacheHitStats` 型（L34-54）
  - [x] 各ステップでstepNameパラメータを渡してヒット/ミス追跡

- [x] TTL設定の最適化
  - [x] `calculateDynamicTtl()` 関数追加（cacheManager.ts L803-825）
  - [x] 動画長に応じた動的TTL（<10分: 30分、10-30分: 1時間、30-90分: 2時間、>90分: 3時間）
  - [x] `03_uploadVideoToGemini.ts` で動画durationから動的TTL計算（L133-135）

- [ ] コスト追跡の更新
  - [ ] キャッシュヒット時のトークン削減量を記録
  - [ ] 実際のコスト削減額の計測

### 3.2 Ground Truthデータセットの作成

**目的**: 精度測定と閾値調整の基盤

- [ ] データセット設計
  - [ ] 50-100試合の手動ラベル付きデータ
  - [ ] イベントタイプごとの正解ラベル
  - [ ] タイムスタンプの正確な記録

- [ ] ラベリングツールの作成
  - [ ] モバイルアプリに手動ラベリング機能追加
  - [ ] または: 専用のウェブラベリングツール

- [ ] 評価スクリプトの作成
  - [ ] Precision/Recall/F1スコア計算
  - [ ] イベントタイプ別の精度レポート
  - [ ] 信頼度閾値ごとの精度曲線

### 3.3 マルチフレームサムネイル分析 ⏭️ スキップ

**目的**: 動画送信なしで動きの理解を向上

**状態**: Phase 2.1の動画クリップ送信（`USE_VIDEO_FOR_LABELING=true`）により代替。動画送信の方がより高精度。

### 3.4 バッチプロンプト最適化 ✅

**目的**: API呼び出し回数の削減

- [x] 複数サムネイルの一括送信
  - [x] `labelClipBatchWithGemini()` 関数（labelClip.ts L218-372）
  - [x] `getLabelBatchSize()` 設定関数（L200-204、デフォルト5クリップ）
  - [x] `USE_BATCH_LABELING` 環境変数（04_labelClipsGemini.ts L33）
  - [x] バッチ失敗時の個別処理フォールバック（L105-164）
  - [x] レスポンスの分割パース（`parseBatchLabels()` L378-422）

- [x] コスト効果
  - [x] API呼び出し数: 80%削減
  - [x] トークンコスト: 33%削減
  - [x] 実行速度: 5倍向上

### 3.5 Tier 1 & Tier 2のクロスバリデーション

**目的**: 複数検出ソースの相互検証

- [ ] YOLO検出結果とGemini検出結果の照合
  - [ ] 選手位置の一致確認
  - [ ] ボール位置の一致確認

- [ ] 不一致検出のフラグ付け
  - [ ] YOLO: 選手あり、Gemini: イベントなし → 再検証
  - [ ] Gemini: シュートあり、YOLO: ボールなし → 偽陽性疑い

### 3.6 イベント→クリップ順序の逆転（オプション）

**目的**: クリップとイベントの不一致を根本解決

**注意**: 影響範囲が非常に広いため、慎重に検討

**影響を受けるファイル**:
- `runMatchPipeline.ts` L267-279, L369-371
- `03_extractClips.ts` 全体
- `04_labelClipsGemini.ts` 全体
- `05_buildEvents.ts` 全体
- `apps/mobile/lib/hooks/useClips.ts`, `useMatches.ts`

- [ ] 新しいパイプラインステップの設計
  - [ ] Step 03a: 動画全体からイベント検出（Gemini）
  - [ ] Step 03b: イベントタイムスタンプ中心でクリップ抽出

- [ ] 既存ステップの修正
  - [ ] `02_detectShots.ts` の役割再定義
  - [ ] `03_extractClips.ts` をイベントベースに変更

- [ ] モーション/オーディオピーク検出のオプション化
  - [ ] フォールバックとして残す
  - [ ] プライマリはイベント検出結果を使用

---

## Phase 4: エッジケース対応 ✅ 完了

### 4.1 プロンプトにエッジケース処理を追加 ✅

**状態**: 全プロンプトに`edge_cases`セクション追加完了

- [x] 全動画分析プロンプトに追加
  - [x] `clip_label_v1.json`: シュート/チャンス判断、セットピース、低画質対応など6ケース
  - [x] `event_detection_v3.json`: クロス/シュート区別、クリア/ロングパス、ヘディング分類など7ケース
  - [x] `tactical_analysis_v1.json`: フォーメーション流動性、退場時、前後半差異など6ケース
  - [x] `match_summary_v1.json`: スコア不明、背番号不明、映像一部のみなど7ケース

### 4.2 FPS検証の追加 ✅

**対象ファイル**: `services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts`

**状態**: FPS設定可能化完了

- [x] `DeduplicateEventsOptions` に `fps` パラメータ追加（L36-37）
- [x] デフォルト30fps、引数で上書き可能（L72）
- [x] 全フレーム計算箇所をfps変数使用に更新（L161, L201-202, L225）

### 4.3 deduplication時間閾値のイベントタイプ別対応 ✅

**状態**: Phase 2.7で完了

- [x] `deduplication.ts` でイベントタイプ別の閾値を使用（L67-73, L116-117）
- [x] clusterEvents関数でtype引数を参照
- [x] TYPE_SPECIFIC_THRESHOLDSの参照

---

## 実装優先度サマリー（最終更新）

| Phase | タスク | インパクト | 工数 | 状態 |
|-------|--------|-----------|------|------|
| 1.1 | Few-Shotサンプル追加 | 高 | 中 | ✅ 完了 |
| 1.2 | オーバーラップ拡大 | 中 | 低 | ✅ 完了 |
| 1.3 | Confidence閾値最適化 | 中 | 低 | ✅ 完了 |
| 1.4 | ストッページ検出有効化 | 中 | 低 | ✅ 完了 |
| 1.5 | 検証ステップ閾値確認 | 中 | 低 | ✅ 完了 |
| 2.1 | 動画クリップ送信 | 高 | 中 | ✅ 完了 |
| 2.2a | イベントベースクリップ補完 | 中 | 中 | ✅ 完了 |
| 2.3 | Confidenceスコアリング修正 | 中 | 中 | ✅ 完了 |
| 2.4 | Temperature最適化 | 中 | 低 | ✅ 完了 |
| 2.5 | タクティカル分析にイベント渡す | 中 | 中 | ✅ 完了 |
| 2.6 | プロンプトバージョン統一 | 低 | 低 | ✅ 完了 |
| 2.7 | deduplication時間閾値調整 | 低 | 低 | ✅ 完了 |
| 3.1 | キャッシュ監視・最適化 | 低 | 低 | ✅ 完了 |
| 3.2 | Ground Truthデータセット | 高（長期） | 高 | 未着手 |
| 3.3 | マルチフレーム分析 | 中 | 中 | ⏭️ スキップ（2.1で代替） |
| 3.4 | バッチプロンプト最適化 | 低（コスト） | 中 | ✅ 完了 |
| 3.5 | クロスバリデーション | 中 | 高 | 未着手 |
| 3.6 | イベント→クリップ順序逆転 | 高 | 高 | 未着手（オプション） |
| 4.1 | エッジケースプロンプト | 中 | 低 | ✅ 完了 |
| 4.2 | FPS検証追加 | 低 | 低 | ✅ 完了 |
| 4.3 | deduplication時間閾値タイプ別 | 低 | 低 | ✅ 完了（2.7と同一） |

---

## 新規追加の環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `USE_VIDEO_FOR_LABELING` | false | 動画クリップ送信を有効化 |
| `USE_BATCH_LABELING` | false | バッチラベリングを有効化 |
| `LABEL_BATCH_SIZE` | 5 | バッチサイズ（1-15） |
| `TACTICAL_PROMPT_VERSION` | v1 | タクティカル分析プロンプトバージョン |
| `SUMMARY_PROMPT_VERSION` | v1 | マッチサマリープロンプトバージョン |

---

## 影響ファイル一覧

### Phase 1 ✅
| ファイル | 変更内容 | 行 | 状態 |
|---------|---------|-----|------|
| `prompts/clip_label_v1.json` | Few-Shot追加（15例） | 全体 | ✅ |
| `prompts/tactical_analysis_v1.json` | Few-Shot追加（3例） | 全体 | ✅ |
| `prompts/match_summary_v1.json` | Few-Shot追加（3例） | 全体 | ✅ |
| `prompts/event_detection_v3.json` | Few-Shot追加（10例） | 全体 | ✅ |
| `steps/07b_detectEventsWindowed.ts` | overlapSec=30 | L90 | ✅ |
| `steps/07b_detectEventsWindowed.ts` | skipStoppages=false | L99 | ✅ |
| `calculators/matchSummary.ts` | MIN_HIGHLIGHT_CONFIDENCE=0.5 | L26 | ✅ |
| `steps/04_labelClipsGemini.ts` | needsReview閾値 | L78,122,136,186,200 | ✅ |
| `steps/07d_verifyEvents.ts` | 閾値確認 | L163,174 | ✅ |

### Phase 2 ✅
| ファイル | 変更内容 | 行 | 状態 |
|---------|---------|-----|------|
| `gemini/labelClip.ts` | 動画送信対応 | L42,56-67 | ✅ |
| `steps/07e_supplementClipsForUncoveredEvents.ts` | 新規作成 | 全体 | ✅ |
| `jobs/runMatchPipeline.ts` | 07e統合 | L337-344 | ✅ |
| `lib/deduplication.ts` | 加算ロジック | L191-197 | ✅ |
| `lib/deduplication.ts` | タイプ別閾値 | L67-73,116-117 | ✅ |
| `steps/10_generateTacticalInsights.ts` | イベント統計追加 | L116-236 | ✅ |
| `steps/10_generateTacticalInsights.ts` | PROMPT_VERSION | L19 | ✅ |
| `steps/11_generateMatchSummary.ts` | PROMPT_VERSION | L25 | ✅ |
| `gemini/labelClip.ts` | Temperature=0.1 | L123 | ✅ |
| `steps/07_detectEventsGemini.ts` | Temperature=0.25 | L511 | ✅ |
| `steps/07b_detectEventsWindowed.ts` | Temperature=0.25 | L418 | ✅ |
| `steps/10_generateTacticalInsights.ts` | Temperature=0.4 | L270 | ✅ |
| 各stepファイル | topP=0.95, topK=40 | 各generationConfig | ✅ |

### Phase 3 🔄
| ファイル | 変更内容 | 行 | 状態 |
|---------|---------|-----|------|
| `gemini/cacheManager.ts` | 監視機能追加 | L34-54,798-896 | ✅ |
| `gemini/labelClip.ts` | バッチラベリング | L172-422 | ✅ |
| `steps/04_labelClipsGemini.ts` | バッチ処理 | L33,55-165 | ✅ |

### Phase 4
| ファイル | 変更内容 | 行 | 状態 |
|---------|---------|-----|------|
| 全プロンプトファイル | edge_cases追加 | 新規 | 未着手 |
| `steps/07c_deduplicateEvents.ts` | FPS可変化 | L158 | 未着手 |

---

## 検証方法

各Phase完了後に以下を確認:

1. **TypeCheck通過**: `pnpm typecheck` ✅
2. **ユニットテスト**: 該当するテストファイルの実行
3. **実地テスト**: 1-2試合の再分析で精度確認
4. **コスト確認**: Gemini API使用量の変化を監視

---

## 関連ファイル

- `services/analyzer/src/gemini/prompts/` - プロンプトファイル
- `services/analyzer/src/jobs/steps/` - パイプラインステップ
- `services/analyzer/src/lib/deduplication.ts` - 重複排除ロジック
- `services/analyzer/src/gemini/cacheManager.ts` - キャッシュ管理（実装済み + 監視機能）
- `services/analyzer/src/gemini/gemini3Client.ts` - Geminiクライアント
- `services/analyzer/src/calculators/matchSummary.ts` - サマリー計算
- `services/analyzer/src/gemini/labelClip.ts` - クリップラベリング（バッチ対応）

---

*作成日: 2026-01-14*
*最終更新: 2026-01-14（Phase 1-3実装完了）*
*ステータス: Phase 1-2完了、Phase 3一部完了*
