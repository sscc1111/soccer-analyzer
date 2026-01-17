# 精度向上実装サマリー

## 実装完了日: 2025-01-15

## 新規作成ファイル

### `/services/analyzer/src/lib/`

| ファイル | 目的 | テスト数 |
|---------|------|---------|
| `zoneToCoordinate.ts` | ゾーン表現から正規化座標への変換 | 24 |
| `eventValidation.ts` | イベントのクロスバリデーション | 20 |
| `eventEnrichment.ts` | xG計算、パス方向、キャリー距離等 | 33 |
| `playerConfidenceCalculator.ts` | 選手識別信頼度の計算 | 100 |
| `formationTracking.ts` | フォーメーション変更追跡 | 39 |
| `clipEventMatcher.ts` | クリップ-イベントマッチング | 34 |
| `ballPositionMatcher.ts` | ボール位置マッチング | - |
| `deduplication.ts` | イベント重複排除 | - |

**合計テスト: 281件（全パス）**

## 各セクションの実装詳細

### Section 1-4: 位置情報の精度向上

- **zoneToCoordinate.ts**: ゾーン表現（"defensive_third"等）から正規化座標(0-1)への変換
- **ballPositionMatcher.ts**: ボール検出データとイベントタイムスタンプの紐付け
- **windowUtils.ts**: ウィンドウ間座標変換

### Section 5: 選手識別の精度向上

- **playerConfidenceCalculator.ts**:
  - OCR信頼度 (50%)、チームマッチング (25%)、トラッキング一貫性 (25%) の重み付け
  - イベント実行者識別の信頼度計算（ベイズ的ブースト）
  - 複数候補からの最適選手選択
  - 選手-イベント紐付けの妥当性検証
  - 識別統計の算出

### Section 6: 戦術分析の精度向上

- **formationTracking.ts**:
  - 時系列フォーメーション状態追跡
  - フォーメーション変更検出（substitution/game_state/opponent_pressure/tactical_switch）
  - フェーズ判定（attacking/defending/transition/set_piece）
  - フォーメーション変動性スコア算出
  - 支配的フォーメーション特定

### Section 7: シーン・クリップ抽出の改善

- **clipEventMatcher.ts**:
  - 3種類のマッチタイプ: exact/overlap/proximity
  - イベントタイプ別重要度ウェイト（goal: 1.0 〜 pass: 0.3）
  - コンテキストブースト（終盤ゴール、同点弾等）
  - 希少性ブースト（レッドカード、オウンゴール等）
  - クリップランキング機能

### Section 8: クロスバリデーション

- **eventValidation.ts**:
  - 時間的整合性チェック
  - 論理的整合性チェック（ゴールにはシュートが先行等）
  - 空間的整合性チェック（ゾーン連続性）
  - 信頼度調整とバリデーション統計

### Section 9.1: 単体テスト

- 7つのテストファイル、281件のテストケース
- 境界値テスト、エッジケース、正常系すべてカバー

## パイプライン統合

`07c_deduplicateEvents.ts` で以下を呼び出し:
1. `deduplicateEvents()` - イベント重複排除
2. `validateEvents()` - クロスバリデーション
3. `enrichEvents()` - イベント強化

## 閾値定数

```typescript
// 信頼度閾値
CONFIDENCE_THRESHOLDS = { high: 0.8, medium: 0.6, low: 0.4 }

// 信頼度の重み
CONFIDENCE_WEIGHTS = { ocr: 0.5, teamMatching: 0.25, tracking: 0.25 }

// イベント重要度
EVENT_TYPE_WEIGHTS = { goal: 1.0, penalty: 0.95, red_card: 0.9, ... }
```

## パイプライン統合完了 (2025-01-15)

### Section 5: 08_identifyPlayersGemini.ts
- `calculatePlayerConfidence()`を使用して重み付き信頼度を計算
- OCR/チームマッチング/トラッキングの重み付き信頼度

### Section 6: 10_generateTacticalInsights.ts
- `trackFormationChanges()`でフォーメーション時系列追跡
- tacticalDocにformationTimelineを追加

### Section 7: 07e_supplementClipsForUncoveredEvents.ts
- `matchClipToEvents()`でクリップ-イベントマッチング
- `calculateClipImportance()`で重要度ベースの優先順位付け

## テスト結果: 全281テスト合格 ✅
