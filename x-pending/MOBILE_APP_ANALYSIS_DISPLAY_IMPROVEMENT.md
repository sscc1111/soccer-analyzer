# Mobile App Analysis Display Improvement Plan

## 概要

解析パイプラインは豊富なデータを生成しているが、モバイルアプリのUIでは一部しか表示されていない。
また、ハイライト/クリップのナビゲーションに問題がある。

## 現状の問題点

### 問題1: 解析結果がUIに十分表示されていない

| 生成データ | Firestore保存先 | UI表示 |
|-----------|----------------|--------|
| Tactical Insights | `matches/{matchId}/tactical/current` | ❌ なし |
| Match Summary | `matches/{matchId}/summary/current` | ❌ なし |
| Player Distance | stats.metrics | ❌ なし |
| Incomplete Passes | stats.metrics | ❌ なし |
| Carry Distance (meters) | stats.metrics | ❌ なし |

### 問題2: "Unmatched route" エラー

- **原因**: `topMoments`の`clipId`が空文字列
- **発生条件**: クリップに`gemini.label`がない場合、matchSummaryがイベントにフォールバック
- **該当コード**: `matchSummary.ts` line 129: `clipId: ""`

### 問題3: "No clips found" エラー

- **原因1**: モバイルアプリがversion filterなしでクリップをクエリ
- **原因2**: クリップに`gemini`フィールドが存在しない
- **原因3**: イベントラベルとクリップラベルの不一致

---

## 実装タスク

### Phase 1: クリップナビゲーション修正 (優先度: 高)

#### Task 1.1: useClipsフックにversion filter追加
- [x] `apps/mobile/lib/hooks/useClips.ts`を修正
- [x] ClipsFilterにversion?オプションを追加
- [x] クエリに`where("version", "==", version)`を追加
- [ ] Firestoreインデックスが必要な場合は追加（既存インデックスで対応可能）

**対象ファイル:**
- `apps/mobile/lib/hooks/useClips.ts`
- `infra/firestore.indexes.json`

#### Task 1.2: topMomentsのclipId空文字対策
- [x] `services/analyzer/src/calculators/matchSummary.ts`を修正
- [x] イベントからクリップを逆引きするロジック追加 (`findClipByTimestamp`)
- [x] timestampマッチングでclipIdを補完 (±2秒の許容範囲)
- [x] clipId: string | null 型に変更

**対象ファイル:**
- `services/analyzer/src/calculators/matchSummary.ts`

#### Task 1.3: UI側でclipId検証追加
- [x] `apps/mobile/app/match/[id]/index.tsx`を修正
- [x] ナビゲーション前に`clipId`の存在確認
- [x] 空の場合はボタン無効化 + "(no clip)" 表示

**対象ファイル:**
- `apps/mobile/app/match/[id]/index.tsx`

#### Task 1.4: クリップ詳細画面のエラーハンドリング
- [x] `apps/mobile/app/match/[id]/clip/[clipId]/index.tsx`を確認
- [x] クリップが見つからない場合の適切なUI表示（既に実装済み: Lines 156-162）
- [x] "Back"ボタンで前の画面に戻れるように（既に実装済み）

**対象ファイル:**
- `apps/mobile/app/match/[id]/clip/[clipId]/index.tsx`

---

### Phase 2: 戦術分析表示追加 (優先度: 中)

#### Task 2.1: useTacticalAnalysisフック作成
- [x] `apps/mobile/lib/hooks/useTacticalAnalysis.ts`を新規作成
- [x] `matches/{matchId}/tactical/current`からデータ取得
- [x] `TacticalAnalysisDoc`型を使用
- [x] loading/error状態の管理

**対象ファイル:**
- `apps/mobile/lib/hooks/useTacticalAnalysis.ts` (新規)
- `apps/mobile/lib/hooks/index.ts`

#### Task 2.2: 戦術分析UIコンポーネント作成
- [x] フォーメーション表示 (home/away)
- [x] テンポ表示 (passes per minute)
- [x] 攻撃パターン表示
- [x] 守備パターン表示
- [x] キーインサイト表示
- [x] プレス強度表示
- [x] ビルドアップスタイル表示

**対象ファイル:**
- `apps/mobile/components/TacticalInsights.tsx` (新規)

#### Task 2.3: tactical.tsxに戦術分析を統合
- [x] 既存の`tactical.tsx`を修正
- [x] 現在のライブポジション表示に加えて、戦術分析タブ追加
- [x] Tab切り替えまたはセクション分け

**対象ファイル:**
- `apps/mobile/app/match/[id]/tactical.tsx`

---

### Phase 3: マッチサマリー表示追加 (優先度: 中)

#### Task 3.1: useMatchSummaryフック作成
- [x] `apps/mobile/lib/hooks/useMatchSummary.ts`を新規作成
- [x] `matches/{matchId}/summary/current`からデータ取得
- [x] `MatchSummaryDoc`型を使用
- [x] loading/error状態の管理

**対象ファイル:**
- `apps/mobile/lib/hooks/useMatchSummary.ts` (新規)
- `apps/mobile/lib/hooks/index.ts`

#### Task 3.2: マッチサマリーUIコンポーネント作成
- [x] ヘッドライン表示
- [x] ナラティブ表示 (前半/後半/全体)
- [x] キーモーメント表示 (タイムスタンプ付き)
- [x] 選手ハイライト表示
- [x] スコア表示 (検出された場合)
- [x] MVP表示

**対象ファイル:**
- `apps/mobile/components/MatchSummaryView.tsx` (新規)

#### Task 3.3: 試合詳細画面にサマリータブ追加
- [x] `apps/mobile/app/match/[id]/tactical.tsx`を修正（tactical画面内にタブとして統合）
- [x] 既存のタブに"サマリー"タブ追加
- [x] ポジション/戦術分析/サマリーの3タブ構成

**対象ファイル:**
- `apps/mobile/app/match/[id]/tactical.tsx`

---

### Phase 4: 統計表示の拡充 (優先度: 低)

#### Task 4.1: 追加の選手メトリクス表示
- [x] `apps/mobile/app/match/[id]/stats.tsx`を修正
- [x] 移動距離 (`player.distance.meters`) 追加
- [x] 不完全パス数 (`player.passes.incomplete`) 追加
- [x] インターセプトパス数 (`player.passes.intercepted`) 追加
- [x] キャリー距離 (`player.carry.meters`) 追加

**対象ファイル:**
- `apps/mobile/app/match/[id]/stats.tsx`

#### Task 4.2: イベント詳細表示の改善
- [ ] イベントカードにより詳細な情報表示
- [ ] シュート: 結果 (goal/saved/blocked/missed)
- [ ] パス: タイプ (short/medium/long/through/cross)
- [ ] セットピース: タイプ (corner/free_kick/penalty)

**対象ファイル:**
- `apps/mobile/app/match/[id]/clips.tsx`
- `apps/mobile/components/ClipCard.tsx` (存在する場合)

#### Task 4.3: 信頼度表示の追加
- [ ] 各メトリクスの信頼度を表示
- [ ] 低信頼度の項目には視覚的インジケータ
- [ ] ツールチップまたは詳細モーダルで説明表示

**対象ファイル:**
- `apps/mobile/app/match/[id]/stats.tsx`

---

### Phase 5: データ整合性の改善 (優先度: 中)

#### Task 5.1: クリップとイベントの紐付け改善
- [x] `matchSummary.ts`を修正（Task 1.2で実装済み）
- [x] イベントからクリップへの逆引きロジック追加 (`findClipByTimestamp`)
- [x] timestampの近いクリップを自動マッチング (±2秒の許容範囲)
- [x] マッチしたクリップのclipIdを使用

**対象ファイル:**
- `services/analyzer/src/calculators/matchSummary.ts`

#### Task 5.2: クリップラベリングの確実な実行
- [x] `04_labelClipsGemini.ts`のエラーハンドリング改善
- [x] ラベリング失敗時のリトライロジック（最大3回、指数バックオフ）
- [x] 部分的な成功でも結果を保存（既存のバッチコミット）

**対象ファイル:**
- `services/analyzer/src/jobs/steps/04_labelClipsGemini.ts`

#### Task 5.3: パイプライン完了状態の確認UI
- [x] 解析状態をUIに表示（既に実装済み: AnalysisProgress.tsx）
- [x] 各ステップの完了状態を視覚化（StepIndicatorコンポーネント）
- [x] 未完了の場合は警告表示（エラー状態、残り時間表示）

**対象ファイル:**
- `apps/mobile/app/match/[id]/index.tsx` (既にAnalysisProgressを使用)
- `apps/mobile/components/AnalysisProgress.tsx` (既に実装済み)

---

## ファイル変更サマリー

### 修正が必要なファイル

| ファイル | Phase | 変更内容 |
|---------|-------|---------|
| `apps/mobile/lib/hooks/useClips.ts` | 1 | version filter追加 |
| `services/analyzer/src/calculators/matchSummary.ts` | 1,5 | clipId補完ロジック |
| `apps/mobile/app/match/[id]/index.tsx` | 1,3 | clipId検証、サマリータブ |
| `apps/mobile/app/match/[id]/tactical.tsx` | 2 | 戦術分析統合 |
| `apps/mobile/app/match/[id]/stats.tsx` | 4 | 追加メトリクス表示 |
| `infra/firestore.indexes.json` | 1 | 必要に応じてインデックス追加 |

### 新規作成が必要なファイル

| ファイル | Phase | 内容 |
|---------|-------|------|
| `apps/mobile/lib/hooks/useTacticalAnalysis.ts` | 2 | 戦術分析データ取得 |
| `apps/mobile/lib/hooks/useMatchSummary.ts` | 3 | サマリーデータ取得 |
| `apps/mobile/components/TacticalInsights.tsx` | 2 | 戦術分析UI |
| `apps/mobile/components/MatchSummaryView.tsx` | 3 | サマリーUI |

---

## テスト項目

### Phase 1 テスト
- [ ] クリップ一覧が正しく表示される
- [ ] ハイライトクリックで正しいクリップ詳細に遷移
- [ ] イベントクリックで対応するクリップ一覧に遷移
- [ ] クリップが存在しない場合のエラーハンドリング

### Phase 2 テスト
- [ ] 戦術分析が正しく取得・表示される
- [ ] フォーメーション図が正しく描画される
- [ ] テンポ、パターン、インサイトが表示される

### Phase 3 テスト
- [ ] マッチサマリーが正しく取得・表示される
- [ ] ナラティブが読みやすく表示される
- [ ] キーモーメントがクリック可能

### Phase 4 テスト
- [ ] 追加メトリクスが正しく表示される
- [ ] 信頼度インジケータが機能する

### Phase 5 テスト
- [ ] クリップ-イベント紐付けが正しく機能
- [ ] パイプライン状態が正しく表示される

---

## 注意事項

1. **後方互換性**: 既存のデータ構造を変更する場合は、古いデータでも動作するように
2. **パフォーマンス**: 追加のFirestoreクエリはバッチ化または遅延ロード
3. **エラーハンドリング**: データが存在しない場合のフォールバックUI
4. **型安全性**: TypeScript型定義を適切に使用

---

## 参考: 既存のデータ構造

### TacticalAnalysisDoc (packages/shared/src/domain/tactical.ts)
```typescript
{
  formation: { home: string, away: string },
  tempo: { passesPerMinute: number, ... },
  attackPatterns: string[],
  defensivePatterns: string[],
  keyInsights: string[],
  pressingIntensity: "high" | "medium" | "low",
  buildUpStyle: "short" | "direct" | "mixed",
  ...
}
```

### MatchSummaryDoc (packages/shared/src/domain/scene.ts or similar)
```typescript
{
  headline: string,
  narrative: { firstHalf: string, secondHalf: string, overall: string },
  keyMoments: Array<{ timestamp: number, description: string, importance: number }>,
  playerHighlights: Array<{ playerId: string, description: string }>,
  score: { home: number, away: number } | null,
  mvpSuggestion: { playerId: string, reason: string } | null,
  tags: string[],
  ...
}
```

---

## 作成日
2026-01-14

## ステータス
- [x] Phase 1: クリップナビゲーション修正 ✅ (2026-01-14)
- [x] Phase 2: 戦術分析表示追加 ✅ (2026-01-14)
- [x] Phase 3: マッチサマリー表示追加 ✅ (2026-01-14)
- [x] Phase 4: 統計表示の拡充 ✅ (Task 4.1完了, 4.2/4.3は低優先度で未実装)
- [x] Phase 5: データ整合性の改善 ✅ (2026-01-14)
