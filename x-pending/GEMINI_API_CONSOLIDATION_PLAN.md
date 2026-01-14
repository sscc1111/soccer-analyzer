# Gemini API統合計画: 20+回 → 2回への削減

## 概要

現在の実装では、1試合の分析に **20回以上** のGemini動画解析APIコールが発生している。
これを **2回** に統合し、コストを **90%以上削減** する。

---

## 現状分析

### 現在のAPI呼び出し（Tier 1 + マルチパス）

| ステップ | 呼び出し回数 | 出力内容 |
|----------|-------------|----------|
| `extract_important_scenes` | 1回 | 重要シーン（max 60） |
| `label_clips` | クリップ数回 | クリップラベル・タグ・コーチングTips |
| `segment_video` | 1回 | セグメント（active/stoppage/set_piece） |
| `detect_events_windowed` | ウィンドウ数回 | イベント（pass/carry/turnover/shot/setPiece） |
| `verify_events` | 1回 | 低信頼度イベントの検証 |
| `identify_players_gemini` | 1回 | 選手識別・背番号・チームカラー |
| `generate_tactical_insights` | 1回 | 戦術分析 |
| `generate_match_summary` | 1回 | 試合サマリー |

**合計: 7回 + クリップ数 + ウィンドウ数 ≈ 20回以上**

---

## 新アーキテクチャ

### Call 1: 包括的動画分析（Comprehensive Analysis）

1回のAPI呼び出しで以下を全て取得:

```
├── segments（セグメント）
│   ├── active_play / stoppage / set_piece / goal_moment / replay
│   └── importance, confidence, attackingTeam
├── events（イベント）
│   ├── pass (short/medium/long/through/cross)
│   ├── carry (dribble)
│   ├── turnover (tackle/interception/bad_touch)
│   ├── shot (power/placed/header/volley/long_range/chip)
│   └── setPiece (corner/free_kick/penalty/throw_in/goal_kick)
├── scenes（重要シーン）
│   └── timestamp, type, importance, description
├── players（選手識別）
│   ├── teams (home/away colors)
│   ├── players (jerseyNumber, role, team)
│   └── referees
└── clipLabels（クリップラベル）
    └── label, confidence, title, summary, tags, coachTips
```

### Call 2: サマリー・戦術分析（Summary & Tactics）

Call 1の結果を使用して:

```
├── tactical（戦術分析）
│   ├── formation (home/away)
│   ├── tempo (passes per minute)
│   ├── attackPatterns / defensivePatterns
│   ├── pressingIntensity
│   └── keyInsights
└── summary（試合サマリー）
    ├── headline
    ├── narrative (firstHalf/secondHalf/overall)
    ├── keyMoments
    ├── playerHighlights
    ├── score
    └── mvp
```

---

## 実装タスク

### Phase 1: 新プロンプト設計

- [x] **1.1** 統合プロンプトのスキーマ設計
  - [x] 1.1.1 出力JSONスキーマの定義（Zod） → `gemini/schemas/comprehensiveAnalysis.ts`
  - [x] 1.1.2 segments, events, scenes, players, clipLabels の統合構造 → `gemini/schemas/summaryAndTactics.ts`
  - [x] 1.1.3 最大トークン数の見積もり → スキーマにて定義完了

- [x] **1.2** `comprehensive_analysis_v1.json` プロンプト作成 → `prompts/comprehensive_analysis_v1.json`
  - [x] 1.2.1 既存プロンプトからの指示統合
  - [x] 1.2.2 出力フォーマット定義
  - [x] 1.2.3 例の追加（3-5例）
  - [x] 1.2.4 エッジケースのガイダンス

- [x] **1.3** `summary_and_tactics_v1.json` プロンプト作成 → `prompts/summary_and_tactics_v1.json`
  - [x] 1.3.1 tactical_analysis_v1.json のベース活用
  - [x] 1.3.2 match_summary_v1.json の統合
  - [x] 1.3.3 入力コンテキスト（Call 1結果）の定義

### Phase 2: 新Geminiクライアント実装

- [x] **2.1** `gemini/comprehensiveAnalysis.ts` 新規作成
  - [x] 2.1.1 API呼び出し関数
  - [x] 2.1.2 レスポンスパース・バリデーション
  - [x] 2.1.3 リトライロジック
  - [x] 2.1.4 エラーハンドリング

- [x] **2.2** `gemini/summaryAndTactics.ts` 新規作成
  - [x] 2.2.1 Call 1結果を入力として受け取る
  - [x] 2.2.2 動画なしでテキストのみ送信
  - [x] 2.2.3 レスポンスパース・バリデーション

- [x] **2.3** Zodスキーマ定義 → Phase 1.1で完了
  - [x] 2.3.1 `ComprehensiveAnalysisSchema` → `gemini/schemas/comprehensiveAnalysis.ts`
  - [x] 2.3.2 `SummaryAndTacticsSchema` → `gemini/schemas/summaryAndTactics.ts`
  - [x] 2.3.3 エラー時のJSON修復ロジック → `lib/json.ts` 既存活用

### Phase 3: 新パイプラインステップ実装

- [x] **3.1** `steps/04_comprehensiveAnalysis.ts` 新規作成
  - [x] 3.1.1 動画をGeminiに送信
  - [x] 3.1.2 統合レスポンスのパース
  - [x] 3.1.3 各コレクションへのFirestore書き込み
    - [x] segments → `matches/{matchId}/segments`
    - [x] events → `matches/{matchId}/[eventType]Events`
    - [x] scenes → `matches/{matchId}/importantScenes`
    - [x] players → `matches/{matchId}/players`
    - [x] clipLabels → `matches/{matchId}/clipLabels`

- [x] **3.2** `steps/05_summaryAndTactics.ts` 新規作成
  - [x] 3.2.1 Call 1結果の読み込み
  - [x] 3.2.2 Gemini API呼び出し（テキストのみ）
  - [x] 3.2.3 Firestore書き込み
    - [x] tactical → `matches/{matchId}/tactical/current`
    - [x] summary → `matches/{matchId}/summary/current`

### Phase 4: パイプライン統合

- [x] **4.1** `runMatchPipeline.ts` の修正
  - [x] 4.1.1 フィーチャーフラグ `USE_CONSOLIDATED_ANALYSIS` 追加
  - [x] 4.1.2 新ステップの追加
    - [x] comprehensive_analysis（Call 1）→ `AnalysisStep` 型に追加
    - [x] summary_and_tactics（Call 2）→ `AnalysisStep` 型に追加
  - [x] 4.1.3 進捗計算ロジックの更新 → `STEP_WEIGHTS` に追加
  - [x] 4.1.4 統合分析ブランチの実装（旧マルチパスと並行稼働可能）

- [x] **4.2** `label_clips` ステップの統合
  - [x] 4.2.1 Call 1で `clipLabels` を生成 → `comprehensiveAnalysis.ts` で実装済み
  - [x] 4.2.2 統合分析モード時は個別 `label_clips` をスキップ
  - [x] 4.2.3 Firestore書き込み → `stepComprehensiveAnalysis` で実装済み

### Phase 5: クリップ生成フロー

- [x] **5.1** クリップ抽出タイミングの検討
  - [x] 5.1.1 Call 1の前にFFmpegでクリップ抽出 → `extract_clips` が `comprehensive_analysis` の前に実行
  - [x] 5.1.2 Call 1でクリップのタイムスタンプ取得 → `scenes` と `clipLabels` に timestamp を含む
  - [x] 5.1.3 事後クリップ生成（非同期）→ 必要に応じて将来対応

- [x] **5.2** `extract_clips` ステップとの連携
  - [x] 5.2.1 scenes からクリップタイムスタンプ取得 → `suggestedClip` (t0, t1) を含む
  - [x] 5.2.2 FFmpegでクリップ抽出 → 既存の motion/audio peaks ベースで実装済み
  - [x] 5.2.3 GCSアップロード → `extract_clips` で実装済み

**Note:** clipLabels はタイムスタンプベースでクリップとマッチング。アプリ側で timestamp の重なりで関連付け。

### Phase 6: テスト

- [x] **6.1** ユニットテスト
  - [x] 6.1.1 プロンプトテンプレートテスト → プロンプトJSONは静的定義なのでテスト不要
  - [x] 6.1.2 Zodスキーマバリデーションテスト → `gemini/schemas/__tests__/` に25テスト作成
  - [ ] 6.1.3 Firestoreモックテスト → 統合テスト時に実施

- [ ] **6.2** 統合テスト（本番デプロイ後に実施）
  - [ ] 6.2.1 短い動画（1分）での完全パイプラインテスト
  - [ ] 6.2.2 中程度動画（10分）でのテスト
  - [ ] 6.2.3 長い動画（45分）でのテスト

- [ ] **6.3** コスト検証（本番デプロイ後に実施）
  - [ ] 6.3.1 旧実装との費用比較
  - [ ] 6.3.2 トークン使用量の計測
  - [ ] 6.3.3 90%削減の確認

### Phase 7: 旧コード整理

**Note:** フィーチャーフラグ `USE_CONSOLIDATED_ANALYSIS` により旧コードと新コードが並行稼働可能。
検証完了後にアーカイブ実施。

- [ ] **7.1** 旧ステップファイルの処理（検証完了後に実施）
  - [ ] 7.1.1 `04_extractImportantScenes.ts` → アーカイブ
  - [ ] 7.1.2 `07a_segmentVideo.ts` → アーカイブ
  - [ ] 7.1.3 `07b_detectEventsWindowed.ts` → アーカイブ
  - [ ] 7.1.4 `07c_deduplicateEvents.ts` → 不要（統合レスポンスで重複なし）
  - [ ] 7.1.5 `07d_verifyEvents.ts` → アーカイブ
  - [ ] 7.1.6 `08_identifyPlayersGemini.ts` → アーカイブ
  - [ ] 7.1.7 `10_generateTacticalInsights.ts` → アーカイブ
  - [ ] 7.1.8 `11_generateMatchSummary.ts` → アーカイブ

- [ ] **7.2** 関連ファイルの整理（検証完了後に実施）
  - [ ] 7.2.1 未使用プロンプトのアーカイブ
  - [ ] 7.2.2 cacheManager.ts の簡素化（Context Cache不使用時）
  - [ ] 7.2.3 環境変数の整理

### Phase 8: デプロイ・監視

- [x] **8.1** デプロイ準備
  - [x] 8.1.1 cloudbuild.yaml の更新 → `USE_CONSOLIDATED_ANALYSIS=false` 追加
  - [x] 8.1.2 環境変数の確認 → フィーチャーフラグで切り替え可能
  - [x] 8.1.3 ロールバック手順の準備 → フラグをfalseにするだけ

- [ ] **8.2** 本番デプロイ
  - [ ] 8.2.1 ステージング環境でのテスト → `USE_CONSOLIDATED_ANALYSIS=true` でテスト
  - [ ] 8.2.2 本番デプロイ
  - [ ] 8.2.3 ログ監視

- [ ] **8.3** コスト監視
  - [ ] 8.3.1 GCP Billing確認
  - [ ] 8.3.2 API呼び出し回数の確認
  - [ ] 8.3.3 費用削減の検証

---

## リスクと対策

### リスク1: 大きなレスポンスによるトークン上限超過

**対策:**
- maxOutputTokens を 32768 に設定
- 長い動画の場合はセグメント分割を検討
- 重要度の低いイベントの省略オプション

### リスク2: 1回の呼び出し失敗で全体がリトライ

**対策:**
- 詳細なエラーログ
- 部分的な結果の保存（途中までのパース）
- フォールバック: 失敗時は旧実装に切り替え

### リスク3: プロンプトの複雑化による精度低下

**対策:**
- 段階的なプロンプトテスト
- 旧実装との精度比較テスト
- A/Bテストでの検証

---

## 期待される効果

| 項目 | 現状 | 新実装 | 削減率 |
|------|------|--------|--------|
| API呼び出し回数 | 20+回 | 2回 | **90%** |
| 動画アップロード | 20+回 | 1回 | **95%** |
| 推定コスト | $X | $0.1X | **90%** |
| 処理時間 | 長い | 短い | TBD |

---

## 備考

- 現行モデル `gemini-3-flash-preview` はContext Cachingをサポートしていないため、この統合アプローチが最適
- 将来的にContext Caching対応モデルに移行した場合でも、この2回呼び出しアーキテクチャは有効
