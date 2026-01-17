# 分析精度復旧プラン (オプションC)

## 概要

8人制動画の分析精度が大幅に低下した問題を修正するプラン。
83b1d72 (HEAD) の「シンプルなプロンプト → Gemini観察力を活用」というアプローチを活かしつつ、
プロンプトの矛盾と8人制対応の欠落を修正する。

---

## 根本原因（調査結果）

### 1. V3プロンプトの閾値矛盾
| 箇所 | 記述 | 問題 |
|------|------|------|
| Line 52 | 0.3以上で報告 | ↓矛盾 |
| Line 188-189 | 0.5未満は報告しない | ↓矛盾 |
| Line 199 | 0.3-1.0 for shots | ↓矛盾 |
| Line 249 | 0.3以上で報告 | - |

### 2. プロンプト例による「プライミング」
- 詳細な11v11の例がGeminiを11人制に誘導
- 83b1d72のシンプルなプロンプトでは動画観察で判断していた

### 3. 8v8フォーメーション未定義
- ドメイン層: FORMATIONS_BY_FORMAT["eight"] は定義済み
- プロンプト: 8v8_common が存在しない（7v7_common はある）

### 4. サマリー生成のgameFormat未対応
- 11_generateMatchSummary.ts: gameFormatを参照していない

---

## 修正タスク一覧

### Phase 1: プロンプト修正（最優先）

#### Task 1.1: V3プロンプト閾値統一
- [x] **ファイル**: `services/analyzer/src/gemini/prompts/event_detection_v3.json`
- [x] **修正内容**:
  - Line 52: 「0.3以上で報告」→「0.5以上で報告」に変更
  - Line 199: `"0.3-1.0 for shots"` → `"0.5-1.0 for all events"` に変更
  - Line 249: 「0.3以上で報告」→「0.5以上で報告」に変更
- [x] **確認**: 閾値が0.5で統一されていること ✅ 完了

#### Task 1.2: V4プロンプト閾値統一
- [x] **ファイル**: `services/analyzer/src/gemini/prompts/event_detection_v4.json`
- [x] **修正内容**: V3と同様の閾値統一
- [x] **確認**: 閾値が0.5で統一されていること ✅ 完了

#### Task 1.3: V3プロンプトの例を簡略化
- [x] **ファイル**: `services/analyzer/src/gemini/prompts/event_detection_v3.json`
- [x] **修正内容**:
  - examples セクションの11v11詳細例を簡略化
  - 「キーパーが横っ飛び」などの具体的すぎる記述を削除
  - 以下の観察優先指示を追加:
    ```
    **重要**: 動画から実際のピッチ上の選手数を観察し、
    5人制/7人制/8人制/11人制を判断してください。
    例として示したフォーマットに縛られないでください。
    ```
- [x] **確認**: 例が簡潔になっていること ✅ 完了

#### Task 1.4: 戦術分析プロンプトに8v8追加
- [x] **ファイル**: `services/analyzer/src/gemini/prompts/tactical_analysis_v1.json`
- [x] **修正内容**:
  - `guidelines.formation_detection` に `8v8_common` を追加:
    ```json
    "8v8_common": ["3-3-1", "2-3-2", "2-4-1", "3-2-2", "2-2-3", "1-3-3", "1-4-2"]
    ```
  - `tempo_interpretation` に8人制を追加:
    ```json
    "8v8": {
      "low": "9未満 - 遅いテンポ",
      "medium": "9-14 - 標準的なテンポ",
      "high": "14以上 - 速いテンポ"
    }
    ```
  - 8人制の例を1つ追加
- [x] **確認**: 8v8が定義されていること ✅ 完了

#### Task 1.5: サマリープロンプトにgameFormat対応追加
- [x] **ファイル**: `services/analyzer/src/gemini/prompts/match_summary_v1.json`
- [x] **修正内容**:
  - 8人制の例を追加
  - 試合時間のガイドライン追加（8人制は15分ハーフが一般的）
  - 観察優先指示を追加
- [x] **確認**: 8人制対応が含まれていること ✅ 完了

#### Task 1.6: 選手識別プロンプトの確認
- [x] **ファイル**: `services/analyzer/src/gemini/prompts/player_identification_v2.json`
- [x] **修正内容**:
  - 選手数の期待値を動的にするため、プロンプトに観察優先指示を追加
  - 「背番号は1-99の範囲で、試合形式により選手数は異なる」を明記
- [x] **確認**: 選手数が固定されていないこと ✅ 完了

---

### Phase 2: パイプラインコード修正

#### Task 2.1: サマリー生成にgameFormat追加
- [x] **ファイル**: `services/analyzer/src/jobs/steps/11_generateMatchSummary.ts`
- [x] **修正内容**:
  - matchDataからgameFormatを取得
  - formatContextを生成してGeminiコンテキストに追加
  - 参考実装: `10_generateTacticalInsights.ts` の384-394行
- [x] **確認**: Geminiコンテキストにフォーマット情報が含まれること ✅ 完了

#### Task 2.2: イベント検出にgameFormat追加（オプション）
- [ ] **ファイル**: `services/analyzer/src/jobs/steps/07b_detectEventsWindowed.ts`
- [ ] **修正内容**:
  - gameFormatをプロンプトコンテキストに追加
  - 選手数の期待値を動的に設定
- [ ] **優先度**: 中（Task 1の修正で改善されない場合に実施）

#### Task 2.3: シーン抽出にgameFormat追加（オプション）
- [ ] **ファイル**: `services/analyzer/src/jobs/steps/04_extractImportantScenes.ts`
- [ ] **修正内容**:
  - gameFormatをプロンプトコンテキストに追加
- [ ] **優先度**: 低（Task 1-2の修正で改善されない場合に実施）

---

### Phase 3: 観察優先指示の追加

#### Task 3.1: 全プロンプトに観察優先指示を追加
- [x] **対象ファイル**:
  - `event_detection_v3.json` ✅
  - `event_detection_v4.json` ✅
  - `tactical_analysis_v1.json` ✅
  - `match_summary_v1.json` ✅
  - `player_identification_v2.json` ✅
  - `comprehensive_analysis_v1.json` (未対応 - オプション)
  - `segment_and_events_v1.json` (未対応 - オプション)
- [x] **追加する指示**:
  ```
  ## 重要: 動画観察優先

  以下の情報は動画から直接観察して判断してください：
  - ピッチ上の選手数（5人/7人/8人/11人制を判断）
  - フォーメーション（選手数に適したものを選択）
  - 試合のテンポ（形式によりパス/分の基準が異なる）

  プロンプトの例は参考程度とし、実際の動画内容を優先してください。
  ```
- [x] **確認**: 主要プロンプトに指示が含まれていること ✅ 完了

---

### Phase 4: テストと検証

#### Task 4.1: 8人制動画でテスト
- [x] 修正後のコードをデプロイ ✅ 完了 (2026-01-17)
- [ ] 8人制動画をアップロードして分析
- [ ] 確認項目:
  - フォーメーションが8人制として認識されるか
  - シュート以外のイベントが正しく検出されるか
  - サマリーが8人制として生成されるか
  - 選手スタッツが正しく計算されるか

#### Task 4.2: 11人制動画でリグレッションテスト
- [ ] 11人制動画をアップロードして分析
- [ ] 確認項目:
  - 既存の11人制分析が劣化していないか
  - フォーメーション認識が正確か

#### Task 4.3: 5人制（フットサル）動画でテスト（オプション）
- [ ] 5人制動画があればテスト
- [ ] 確認項目:
  - フットサルとして認識されるか

---

## 修正ファイル一覧

| 優先度 | ファイル | 修正内容 |
|--------|---------|---------|
| P0 | event_detection_v3.json | 閾値統一(0.5)、例の簡略化、観察優先指示 |
| P0 | event_detection_v4.json | 閾値統一(0.5)、観察優先指示 |
| P0 | tactical_analysis_v1.json | 8v8_common追加、観察優先指示 |
| P0 | match_summary_v1.json | 8人制例追加、観察優先指示 |
| P1 | 11_generateMatchSummary.ts | gameFormatをコンテキストに追加 |
| P1 | player_identification_v2.json | 選手数の動的対応、観察優先指示 |
| P2 | 07b_detectEventsWindowed.ts | gameFormatをコンテキストに追加（オプション） |
| P2 | 04_extractImportantScenes.ts | gameFormatをコンテキストに追加（オプション） |

---

## 期待される効果

1. **イベント検出精度向上**: 閾値統一により不安定な検出を解消
2. **8人制対応復旧**: プロンプトに8v8が定義され、正しく認識
3. **プライミング解消**: 簡略化された例により、Geminiが動画を素直に観察
4. **カスケード効果の解消**: イベント検出が正確になれば、下流の全機能が改善

---

## ロールバック計画

修正後に問題が発生した場合:
1. git revert で修正をロールバック
2. 83b1d72 のプロンプトファイルを参照して、さらにシンプル化を検討

---

## 注記

- 日数・スケジュールは記載しない（ユーザー指示）
- 各タスクの完了後はチェックボックスにマークする
- Phase 1 を完了してからテストし、必要に応じて Phase 2-3 を実施
