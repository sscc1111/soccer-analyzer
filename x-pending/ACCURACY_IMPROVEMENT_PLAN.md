# 解析精度向上計画

サッカー解析パイプライン全体の精度向上のための包括的な実装計画です。

---

## 1. 位置情報の正確な取得（3つのオプション全て実装）

現状の問題: 全てのイベントの位置が `{x: 0, y: 0}` のダミー値として保存されている。

### Option 1: ゾーン→座標変換（即時対応） ✅ 完了

- [x] **1.1** `lib/zoneToCoordinate.ts` ユーティリティを作成
  - [x] ゾーン定義（defensive_third, middle_third, attacking_third）を座標範囲にマッピング
  - [x] ゾーン中心座標を返す関数 `getZoneCenterCoordinate(zone: Zone): Point2D`
  - [x] ゾーン内のランダム座標を返す関数 `getRandomPositionInZone(zone: Zone): Point2D`
  - [x] 単体テスト作成（24テスト全てパス）

- [x] **1.2** `RawEvent` インターフェースに `position` フィールドを追加
  - [x] `lib/deduplication.ts` の `RawEvent` 型を拡張（position, positionConfidence）
  - [x] `DeduplicatedEvent` 型にも反映（mergedPosition, positionSource, mergedPositionConfidence）

- [x] **1.3** `07c_deduplicateEvents.ts` でゾーン→座標変換を適用
  - [x] PassEventDoc の position フィールドを変換後の座標に設定
  - [x] CarryEventDoc の startPosition/endPosition を変換後の座標に設定
  - [x] TurnoverEventDoc の position フィールドを変換後の座標に設定
  - [x] 位置情報のソース（zone_conversion）をメタデータに記録

### Option 2: Geminiプロンプトで位置出力を追加 ✅ 完了

- [x] **2.1** `event_detection_v4.json` プロンプトを新規作成
  - [x] イベント出力スキーマに `position: {x: number, y: number, confidence: number}` を追加
  - [x] 位置推定のインストラクションを追加（ピッチを0-100座標系で表現）
  - [x] 位置精度向上のためのビジュアルキュー説明を追加

- [x] **2.2** `RawEvent` インターフェースに `position` フィールドを追加
  - [x] `lib/deduplication.ts` を更新（position, positionConfidence）
  - [x] `07b_detectEventsWindowed.ts` のRawEventも更新

- [x] **2.3** `07b_detectEventsWindowed.ts` でGemini出力からpositionを取得
  - [x] EventSchema, GEMINI_RESPONSE_SCHEMA にposition定義を追加
  - [x] レスポンスパース処理を更新（0-100から0-1に正規化）
  - [x] positionが欠落した場合はundefinedのまま（Option 1のゾーン変換でフォールバック）

- [x] **2.4** `lib/deduplication.ts` で位置情報のマージロジックを追加
  - [x] `mergeCluster` 関数で複数イベントの位置を加重平均
  - [x] 信頼度ベースの位置マージアルゴリズム実装

- [x] **2.5** `07c_deduplicateEvents.ts` でマージ後の位置を使用
  - [x] Gemini出力の位置（mergedPosition）を優先
  - [x] 欠落時はゾーン変換にフォールバック

### Option 3: ボール検出との統合 ✅ 完了

- [x] **3.1** ボール検出パイプラインの調査
  - [x] 既存のボール検出実装を確認（Step 09: stepDetectBall）
  - [x] ボール位置データのFirestore保存形式を確認（ballTrack/current）
  - [x] イベントタイムスタンプとボール位置のマッチング方法を設計

- [x] **3.2** `lib/ballPositionMatcher.ts` ユーティリティを作成
  - [x] イベントタイムスタンプから最も近いボール位置を取得する関数
  - [x] 時間補間によるボール位置推定（前後のフレームから）
  - [x] 信頼度スコアの計算（時間差に基づく）
  - [x] キャッシュ付きのボールトラックデータ取得

- [x] **3.3** イベント保存時にボール位置を統合
  - [x] `07c_deduplicateEvents.ts` でボール位置を取得（matchBallPositionsToEvents）
  - [x] 位置情報の優先順位: ボール検出 > Gemini出力 > ゾーン変換（selectBestPosition関数）
  - [x] 位置情報のソースをメタデータに記録

- [x] **3.4** 位置情報の検証ロジック追加 ✅ 完了
  - [x] イベントタイプと位置の整合性チェック（validatePositionalConsistencyで実装）
  - [x] 連続イベント間の位置移動が妥当かチェック（maxMovementSpeed: 12 m/s）
  - [x] 異常値の警告ログ出力（07c_deduplicateEventsで統合）

---

## 2. パス・キャリー検出の精度向上 ✅ 部分完了

### 2.1 パス検出の改善 ✅ 完了

- [x] **2.1.1** プロンプト改善（event_detection → v4）
  - [x] パス開始・終了の視覚的キューを詳細化（event_detection_v4.jsonで実装）
  - [x] パス成功/失敗の判定基準を明確化
  - [x] ショートパス vs ロングパスの区別基準を追加

- [x] **2.1.2** パス連鎖の検出（lib/eventEnrichment.ts: detectPassChains）
  - [x] 連続するパスイベントの時間的整合性チェック
  - [x] 同一チーム内でのパス連鎖を検証（3+パスの連鎖を検出）
  - [x] 不自然に短い間隔のパスを警告（eventValidation.tsで実装）

- [x] **2.1.3** パス方向の検出追加（lib/eventEnrichment.ts: calculatePassDirection）
  - [x] `PassEventDoc` に `passDirection` フィールド追加（forward/backward/lateral）
  - [x] 位置情報からパス方向を自動計算（プロンプト不要）

### 2.2 キャリー検出の改善 ✅ 完了

- [ ] **2.2.1** キャリー継続時間の精度向上
  - [ ] 開始・終了タイムスタンプの精度向上（今後の改善項目）
  - [x] プロンプトでキャリー終了条件を明確化（event_detection_v4.jsonで実装）

- [x] **2.2.2** ドリブル vs 単純なキャリーの区別 ✅ 完了 (2026-01-15)
  - [x] `CarryEventDoc` に `isDribble`, `dribbleConfidence` フラグ追加
  - [x] `classifyCarryAsDribble()` 関数実装（4要因スコアリング）
  - [x] 距離（40%）、継続時間（30%）、攻撃進行（20%）、ゾーン変化（10%）の加重評価
  - [x] 28テストケースで検証済み
  - [x] 統計追跡とロギングに統合
  - [ ] 敵との対面状況をプロンプトで検出（将来の改善項目）

- [x] **2.2.3** キャリー距離の計算改善（lib/eventEnrichment.ts: calculateCarryDistance）
  - [x] 位置情報を使用した実距離計算（メートル単位）
  - [x] ゾーン移動による距離推定

---

## 3. ターンオーバー・セットピース検出の精度向上 ✅ 部分完了

### 3.1 ターンオーバー検出の改善 ✅ 部分完了

- [x] **3.1.1** ターンオーバータイプの詳細化
  - [x] tackle, interception, bad_touch, out_of_bounds の判定精度向上（event_detection_v4.json）
  - [x] プロンプトで各タイプの視覚的特徴を詳細化

- [x] **3.1.2** ターンオーバー直前のイベントとの連携（lib/eventValidation.ts: validateLogicalConsistency）
  - [x] パス失敗 → ターンオーバーの連鎖を検証
  - [x] インターセプト後の同チームイベントを警告

- [x] **3.1.3** ボール支配権移動の検証（lib/eventValidation.ts: validateLogicalConsistency）
  - [x] ターンオーバー前後でチームが変わることを検証
  - [x] 矛盾するイベントシーケンスを警告

### 3.2 セットピース検出の改善 ✅ 部分完了

- [x] **3.2.1** セットピースタイプの精度向上
  - [x] corner, free_kick, penalty, throw_in, goal_kick の区別（event_detection_v4.json）
  - [x] 視覚的キュー（選手の配置、ボール位置）を詳細化

- [x] **3.2.2** セットピース後の展開検出 ✅ 完了 (2026-01-15)
  - [x] `lib/setPieceOutcomeAnalysis.ts` 新規作成
  - [x] `analyzeSetPieceOutcomes()` 関数（15秒ウィンドウ内のアウトカム検出）
  - [x] セットピース → シュート/クリアの連鎖（優先順位: goal > shot > turnover > cleared）
  - [x] セットピースからの得点機会の追跡（scoringChance フラグ）
  - [x] `SetPieceEventDoc.outcomeDetails` フィールド追加
  - [x] `07c_deduplicateEvents.ts` への統合
  - [x] 20+ テストケースで検証済み

---

## 4. シュート・ゴール検出の精度向上 ✅ 完了

### 4.1 シュート検出の改善 ✅ 完了

- [x] **4.1.1** シュート結果の精度向上
  - [x] goal, saved, blocked, missed, post の区別（event_detection_v4.jsonで実装）
  - [x] ゴールキーパーの動きを検出キューに追加（プロンプトで実装）

- [x] **4.1.2** シュート位置の検出（lib/eventEnrichment.ts）
  - [x] ペナルティエリア内外の区別（isInPenaltyArea関数）
  - [x] シュート角度・距離の推定（calculateAngleToGoal, calculateDistanceToGoal）

- [x] **4.1.3** ゴール検出の特別処理（Phase 2.8で実装済み）
  - [x] ゴール検出の信頼度閾値を確認（0.3以上で保持）
  - [x] ゴールイベントの重複排除ロジックを確認（mergeClusterでゴール優先）

### 4.2 期待得点(xG)の改善 ✅ 完了

- [x] **4.2.1** シュート位置に基づくxG計算（lib/eventEnrichment.ts: calculateXG）
  - [x] 位置情報を使用したxG計算（距離・角度ベース）
  - [x] シュートタイプ（ヘディング、ボレー、PK等）による補正
  - [x] ShotEventDocにxG, xGFactorsフィールド追加

---

## 5. 選手識別の精度向上 ✅ 完了

> **実装状況**: `lib/playerConfidenceCalculator.ts` は完全実装済み（100テスト）。`08_identifyPlayersGemini.ts` との統合完了（v2プロンプト + trackMatcher統合）。

### 5.1 背番号認識の改善 ✅ 完了

- [x] **5.1.1** 背番号認識プロンプトの改善 ✅ 完了 (2026-01-15)
  - [x] 視認性が低い場合のフォールバック戦略（体型、髪色、プレーポジション）
  - [x] チームカラーと背番号の組み合わせ検出（numberColor フィールド追加）
  - [x] `player_identification_v2.json` プロンプト作成
  - [x] 信頼度スコアリング戦略の明確化（0.8-1.0: 明瞭、0.4-0.7: 部分的、0.1-0.3: 代替手段）

- [x] **5.1.2** 選手追跡との連携 ✅ 完了 (2026-01-15)
  - [x] trackId → playerId マッピングの精度向上（`lib/playerTrackMatcher.ts` 実装）
  - [x] 同一選手の複数検出をマージ（`mergePlayerDetections` 関数）
  - [x] 背番号 + チームカラーの組み合わせで同一選手判定
  - [x] trackingIdによる時間的連続性確認
  - [x] フォールバック識別子による同一人物判定（2つ以上の特徴一致）
  - [x] 信頼度再計算（複数検出、背番号有無、期待選手数とのギャップ）
  - [x] 背番号一貫性検証（`validateJerseyNumberConsistency` 関数）
  - [x] `08_identifyPlayersGemini.ts` に統合（v2プロンプト、マージロジック）
  - [x] 22 テストケースで検証済み

### 5.2 選手-イベント紐付けの改善

- [x] **5.2.1** イベント実行者の特定精度向上 ✅ 完了 (2026-01-15)
  - [x] `calculatePerformerIdentificationConfidence()` 関数実装済み
  - [x] `07c_deduplicateEvents.ts` にパイプライン統合完了
  - [x] 各イベントタイプ（pass/carry/shot/setPiece/turnover）に performer confidence 適用
  - [x] `calculatePositionProximity()` でボール/イベント位置との近接度計算
  - [x] 低信頼度識別の `needsReview` フラグ自動設定
  - [x] performer confidence 統計のロギング（high/medium/low 分布）
  - [ ] 動作（キック、ヘディング等）の検出（将来の改善項目）

- [x] **5.2.2** 選手識別の信頼度スコアリング ✅ 完了 (2026-01-15)
  - [x] `calculatePlayerConfidence()` で加重信頼度計算（OCR 50%, team 25%, tracking 25%）
  - [x] `needsReview` フラグと `reviewReasons` で低信頼度識別を警告
  - [x] `selectBestPlayerCandidate()` 関数で複数候補から最適選択
  - [x] トラッキングデータとの連携 ✅ 完了 (2026-01-15)
    - [x] `calculateTrackingConsistency()` 関数実装（フレーム連続性40% + 信頼度安定性30% + 位置滑らかさ30%）
    - [x] `08_identifyPlayersGemini.ts` でFirestoreからTrackDoc取得
    - [x] 各trackIdに対してtrackingConsistencyを動的計算
    - [x] `mergePlayerDetections()` に trackingConsistencyMap パラメータ追加
    - [x] TrackDocがない場合はデフォルト0.5にフォールバック
    - [x] 16テストケース追加（合計116テスト）

---

## 6. 戦術分析の精度向上 ✅ 完了

> **実装状況**: `lib/formationTracking.ts` は完全実装済み（68テスト）。`10_generateTacticalInsights.ts` との統合完了（フェーズ別分析含む）。

### 6.1 フォーメーション検出の改善

- [x] **6.1.1** 時間経過に伴うフォーメーション変化の検出 ✅ 完了 (2026-01-15)
  - [x] `trackFormationChanges()` で5分間隔の状態追跡
  - [x] `FormationTimeline.changes` でフォーメーション変更イベント検出
  - [x] ハーフごとのフォーメーション分析 (`analyzeFormationByHalf()` 関数追加)
    - [x] 前半/後半を独立して分析
    - [x] `FormationHalfComparison` 型で比較結果を提供
    - [x] カスタムハーフ時間対応（5人制:25分, 7人制:30分, 11人制:45分）
    - [x] variabilityChange で戦術的柔軟性の変化を数値化
  - [x] 選手交代後のフォーメーション変化（substitution トリガー検出）
  - [x] `10_generateTacticalInsights.ts` 統合済み（Geminiプロンプトにコンテキスト注入）
  - [x] 17 テストケースで検証済み

- [x] **6.1.2** 攻守でのフォーメーション変化 ✅ 完了 (2026-01-15)
  - [x] `determinePhase()` でゲームフェーズ判定（attacking/defending/transition/set_piece）
  - [x] `FormationState.phase` に記録
  - [x] 攻撃時と守備時のフォーメーション区別（Geminiプロンプトに統合）
  - [x] トランジション時の配置分析（`analyzeFormationByPhase()` 関数実装）
  - [x] `FormationByPhase` 型で4フェーズ別分析（attacking/defending/transition/set_piece）
  - [x] `phaseAdaptability` スコアで攻守の柔軟性を定量化（0-1）
  - [x] `10_generateTacticalInsights.ts` でGeminiプロンプトに詳細コンテキスト注入
  - [x] 29テストケース追加（合計68テスト全てパス）

### 6.2 戦術パターンの検出 ✅ 完了

- [x] **6.2.1** 攻撃パターンの検出精度向上
  - [x] イベント統計をプロンプトに注入（パス、シュート、ターンオーバー）
  - [x] プロンプトに「サイド攻撃 vs 中央突破」「カウンター攻撃」の指示あり
  - [x] 位置情報ベースのパターン検出（`lib/tacticalPatterns.ts` 実装済み）
  - [x] ゾーン分布計算（left/center/right）
  - [x] カウンター攻撃の自動検出（turnover → shot within 10s）
  - [x] ビルドアップ速度の分類（fast/moderate/slow）
  - [x] パス完成率の計算

- [x] **6.2.2** 守備パターンの検出精度向上
  - [x] `pressingIntensity` (0-100) の出力（Gemini + コードベース）
  - [x] プロンプトに「ハイプレス vs リトリート」の指示あり
  - [x] プレスの高さを位置データから自動判定（high/mid/low）
  - [x] ターンオーバー位置の統計分析
  - [x] リカバリーゾーンの特定（attacking_third/middle_third/defensive_third）
  - [x] プレス強度の定量化（ターンオーバー頻度 + 位置ベース）
  - [x] 日本語での戦術サマリー生成

> **実装**: `lib/tacticalPatterns.ts` (50+ tests), `10_generateTacticalInsights.ts` 統合済み

---

## 7. シーン・クリップ抽出の精度向上 ✅ 完了

> **実装状況**: `lib/clipEventMatcher.ts` は完全実装済み（58テスト）。`07e_supplementClipsForUncoveredEvents.ts` と `04_extractImportantScenes.ts` の両方に統合済み。
> シーン検出（7.1）、シーン境界調整（7.1.2動的ウィンドウ）、クリップ-イベント連携（7.2）は全て完了。

### 7.1 重要シーン検出の改善 ✅ 完了

- [x] **7.1.1** シーン重要度スコアリングの改善（全ステップで使用）
  - [x] ゴール/シュートシーンの最優先（EVENT_TYPE_WEIGHTS: goal=1.0, shot=0.7）
  - [x] 決定機の検出精度向上（penalty=0.95, red_card=0.9, shotResult調整）
  - [x] `calculateClipImportance()` で補助クリップ優先順位付け（07e統合済み）
  - [x] `04_extractImportantScenes.ts` との統合（初期シーン抽出で使用、2026-01-15実装完了）
    - [x] イベントとのマッチング機能追加（5種類のイベントタイプ対応）
    - [x] Gemini重要度とイベントベース重要度のブレンド（60%:40%）
    - [x] 重要度統計ロギング（mean/median/min/max/eventMatches）

- [x] **7.1.2** シーン境界の精度向上 ✅ 完了 (2026-01-15)
  - [x] シーン開始・終了タイミングの調整（windowBefore: 5s, windowAfter: 3s）
  - [x] コンテキスト（前後の展開）を含める（動的ウィンドウ実装完了）
    - [x] `calculateDynamicWindow()` 関数実装（イベントタイプ別）
    - [x] カウンターアタック検出（ターンオーバー後10秒以内のゴール）
    - [x] イベント詳細による調整（枠内シュート、ロングレンジ、セットピースタイプ等）
    - [x] 試合状況による調整（終盤、接戦時のブースト）
    - [x] イベント密度による自動拡張（前後の密集検出）
    - [x] コンテキストイベント検出（前後の関連イベント）
    - [x] 24+ テストケースで検証済み（clipEventMatcher.test.ts）
    - [x] `07e_supplementClipsForUncoveredEvents.ts` への統合完了
    - [x] 使用ガイド・例文作成（DYNAMIC_WINDOW_GUIDE.md, dynamicWindow.example.ts）

### 7.2 クリップ-イベント連携 ✅ 完了

- [x] **7.2.1** クリップ内のイベント紐付け
  - [x] `matchClipToEvents()` で3段階マッチング（exact/overlap/proximity）
  - [x] 信頼度スコアリング（0.2-1.0）で精度を数値化
  - [x] `findUncoveredEvents()` で未カバーイベント特定

- [x] **7.2.2** クリップラベリングの改善
  - [x] `EVENT_TYPE_WEIGHTS` で14種類のイベントタイプに基本重要度
  - [x] イベント詳細による動的調整（shotResult, isOnTarget, shotType等）
  - [x] `calculateContextBoost()` で試合状況（時間、スコア差）を考慮

---

## 8. クロスバリデーション・整合性検証 ✅ 完了

### 8.1 イベント間の整合性検証 ✅ 完了

- [x] **8.1.1** 時間的整合性チェック（lib/eventValidation.ts: validateTemporalConsistency）
  - [x] 連続イベントの時間順序検証
  - [x] 物理的に不可能な時間間隔の検出（minEventInterval: 0.5秒）

- [x] **8.1.2** 論理的整合性チェック（lib/eventValidation.ts: validateLogicalConsistency）
  - [x] チームの連続性検証（パス後に同チームのイベント）
  - [x] ボール支配権の連続性検証（ターンオーバー、インターセプト）

### 8.2 シーン-クリップ-イベント間の整合性 ✅ 完了

- [x] **8.2.1** タイムスタンプアライメント
  - [x] 3つのデータソース間のタイムスタンプ整合性（validateTemporalConsistencyで検証）
  - [x] 不一致の警告・自動修正（warningログで報告）

- [x] **8.2.2** アンサンブル信頼度スコアリング（lib/eventValidation.ts: calculateEnsembleConfidence）
  - [x] 複数ソースからの検出で信頼度ブースト（ソースごとに5%ブースト）
  - [x] 単一ソースのみの検出は信頼度ダウン

### 8.3 重複検出の精度向上 ✅ 完了

- [x] **8.3.1** イベントタイプ別の重複閾値調整（Phase 2.7で実装済み）
  - [x] 現在の閾値を確認・検証（lib/deduplication.ts: TYPE_SPECIFIC_THRESHOLDS）
  - [x] shot: 1.0s, pass: 2.0s, carry: 3.0s, turnover: 2.0s, setPiece: 2.5s

- [x] **8.3.2** 位置情報を使用した重複判定
  - [x] 同一位置での同一イベントをより正確にマージ（mergeCluster内で加重平均）
  - [x] 異なる位置での類似イベントは別イベントとして保持

---

## 9. 検証・テスト

### 9.1 単体テスト ✅ 完了

- [x] **9.1.1** ゾーン→座標変換のテスト（lib/__tests__/zoneToCoordinate.test.ts: 24テスト）
- [x] **9.1.2** 位置マージロジックのテスト（zoneToCoordinate.test.ts: mergePositions）
- [x] **9.1.3** 整合性チェックロジックのテスト（lib/__tests__/eventValidation.test.ts: 20テスト）
- [x] **9.1.4** 選手識別信頼度計算のテスト（lib/__tests__/playerConfidenceCalculator.test.ts: 116テスト）
- [x] **9.1.5** フォーメーション追跡のテスト（lib/__tests__/formationTracking.test.ts: 68テスト）
- [x] **9.1.6** クリップ-イベントマッチングのテスト（lib/__tests__/clipEventMatcher.test.ts: 58テスト）
- [x] **9.1.7** イベント enrichment のテスト（lib/__tests__/eventEnrichment.test.ts: 33テスト）
- [x] **9.1.8** テストヘルパーのテスト（lib/__tests__/testHelpers.test.ts: 31テスト）
- [x] **9.1.9** パイプラインステップのテスト（07b_detectEventsWindowed.test.ts: 17テスト）
- [x] **9.1.10** 戦術パターン分析のテスト（lib/__tests__/tacticalPatterns.test.ts: 50+テスト）
- [x] **9.1.11** 選手追跡マッチングのテスト（lib/__tests__/playerTrackMatcher.test.ts: 22テスト）
- [x] **9.1.12** キャリー/ドリブル分類のテスト（lib/__tests__/carryDribbleClassification.test.ts: 28テスト）
- [x] **9.1.13** セットピースアウトカムのテスト（lib/__tests__/setPieceOutcomeAnalysis.test.ts: 20+テスト）

> **合計: 662 テスト全てパス** (2026-01-15 検証済み)

### 9.2 統合テスト

- [ ] **9.2.1** 既存の試合データで精度検証
- [ ] **9.2.2** 新しい試合データでの検証
- [ ] **9.2.3** 精度メトリクスの計測・記録

### 9.3 回帰テスト

- [x] **9.3.1** 既存機能が壊れていないことを確認（全テストパス）
- [ ] **9.3.2** パフォーマンス（処理時間）の確認

---

## 実装優先順位（推奨）

1. **位置情報 Option 1（ゾーン変換）** - 即時対応可能、他の改善の基盤
2. **位置情報 Option 2（Geminiプロンプト）** - 精度向上の核心
3. **クロスバリデーション** - 全体的な品質向上
4. **位置情報 Option 3（ボール検出統合）** - 最も精度が高いが依存関係あり
5. **各イベントタイプ別の改善** - 個別対応

---

## 備考

- 各タスクのチェックボックスは完了時にチェックを入れる
- 実装中に発見した追加タスクはこのファイルに追記する
- 問題が発生した場合は該当タスクにメモを追記する
