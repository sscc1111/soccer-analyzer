# フェーズ別フォーメーション分析実装

**実装日**: 2026-01-15
**対象**: ACCURACY_IMPROVEMENT_PLAN.md Section 6.1.2

## 実装概要

攻撃時・守備時・トランジション時のフォーメーション変化を分析し、Geminiの戦術分析プロンプトに統合しました。

## 実装内容

### 1. `lib/formationTracking.ts` の拡張

#### 新規型定義

```typescript
export interface FormationByPhase {
  attacking: FormationTimeline;      // 攻撃時のフォーメーション
  defending: FormationTimeline;      // 守備時のフォーメーション
  transition: FormationTimeline;     // トランジション時のフォーメーション
  setPiece: FormationTimeline;       // セットプレイ時のフォーメーション
  comparison: {
    hasPhaseVariation: boolean;      // 攻守でフォーメーションが変化するか
    attackingDominant: string;       // 攻撃時の支配的フォーメーション
    defendingDominant: string;       // 守備時の支配的フォーメーション
    transitionDominant: string;      // トランジション時の支配的フォーメーション
    phaseAdaptability: number;       // フェーズ変化の柔軟性 (0-1)
  };
}
```

#### 新規関数: `analyzeFormationByPhase()`

```typescript
export function analyzeFormationByPhase(
  events: MatchEvent[],
  playerPositions?: PlayerPosition[][],
  interval: number = 300
): FormationByPhase
```

**機能**:
- 試合を4つのフェーズ（attacking/defending/transition/set_piece）に分類
- 各フェーズでのフォーメーション追跡を実行
- フェーズ間の比較と柔軟性スコアの計算

**アルゴリズム**:
1. `trackFormationChanges()` で全体のフォーメーションタイムラインを作成
2. 各状態の `phase` フィールドを使ってイベントと状態を分類
3. フェーズごとに独立したフォーメーション追跡を実行
4. 攻守の変化を検出（`hasPhaseVariation`）
5. フェーズ適応力を計算（ユニークなフォーメーション数 × 50% + 平均変動性 × 50%）

### 2. `10_generateTacticalInsights.ts` への統合

#### フェーズ別分析の実行

```typescript
formationByPhase = analyzeFormationByPhase(allEvents, undefined, 300);
```

ロギング情報:
- `attackingDominant` / `defendingDominant` / `transitionDominant`
- `hasPhaseVariation`: 攻守でフォーメーションが変化するか
- `phaseAdaptability`: フェーズ適応力スコア (0-1)
- 各フェーズの状態数

#### Geminiプロンプトへのコンテキスト注入

**追加コンテキスト**:
```markdown
## フェーズ別フォーメーション分析（攻守の配置）

### 攻撃時のフォーメーション
- 支配的フォーメーション: {attackingDominant}
- 攻撃時の状態数: {N}
- フォーメーション変更: {N}回
- 変動性スコア: {0.XX}

### 守備時のフォーメーション
- 支配的フォーメーション: {defendingDominant}
- 守備時の状態数: {N}
- フォーメーション変更: {N}回
- 変動性スコア: {0.XX}

### トランジション時のフォーメーション
- 支配的フォーメーション: {transitionDominant}
- トランジション時の状態数: {N}
- フォーメーション変更: {N}回
- 変動性スコア: {0.XX}

### 攻守の切り替え分析
- 攻守でフォーメーションが変化: あり/なし
  → 攻撃時 {formation} / 守備時 {formation}
- フェーズ適応力スコア: {0.XX} (0=固定的, 1=高い柔軟性)

### 戦術的特徴の解釈
- (攻守別フォーメーション使用時) このチームは攻撃時と守備時で明確にフォーメーションを変化させる柔軟な戦術を採用しています
- (一貫したフォーメーション使用時) このチームは攻守ともに一貫したフォーメーションを維持する安定した戦術を採用しています
- (phaseAdaptability > 0.6) 高いフェーズ適応力を示しており、試合状況に応じて柔軟に配置を変更しています
- (0.3 < phaseAdaptability <= 0.6) 中程度のフェーズ適応力を示しており、基本的な戦術を維持しつつ部分的に調整しています
- (phaseAdaptability <= 0.3) 低いフェーズ適応力を示しており、一貫した配置を維持する堅実な戦術です

注: この攻守別の配置分析を keyInsights に反映してください。特に攻守でフォーメーションが変化する場合は、その戦術的意図（例: 攻撃時のワイド展開、守備時のコンパクト化）を具体的に記述してください。
```

## テストカバレッジ

**新規テスト**: 29テストケース追加（`formationTracking.test.ts`）

### テストカテゴリ

1. **Edge Cases** (1テスト)
   - 空配列の処理

2. **Phase Classification** (4テスト)
   - 攻撃イベントの分類
   - 守備イベントの分類
   - セットプレイイベントの分類
   - 複数フェーズにまたがるイベント

3. **Phase Variation Detection** (2テスト)
   - 攻守でフォーメーションが変化する場合
   - 一貫したフォーメーションの場合

4. **Phase Adaptability Calculation** (3テスト)
   - 低い適応力（一貫したフォーメーション）
   - 高い適応力（変動するフォーメーション）
   - 適応力スコアの境界値（0-1）

5. **Dominant Formation by Phase** (1テスト)
   - 各フェーズでの支配的フォーメーション識別

6. **Interval Parameter** (1テスト)
   - カスタム分析間隔の適用

**合計テスト**: 68テスト全てパス

## 戦術分析への影響

### Geminiが受け取る情報の改善

**Before**:
- 全体のフォーメーション
- ハーフごとのフォーメーション変化

**After**:
- 全体のフォーメーション
- ハーフごとのフォーメーション変化
- **攻撃時のフォーメーション（新規）**
- **守備時のフォーメーション（新規）**
- **トランジション時のフォーメーション（新規）**
- **セットプレイ時のフォーメーション（新規）**
- **攻守の切り替え分析（新規）**
- **フェーズ適応力スコア（新規）**

### 期待される分析品質の向上

1. **攻守の戦術的違いを明示**
   - 例: 「攻撃時は4-3-3でワイドに展開、守備時は4-5-1でコンパクトに」

2. **柔軟性の定量化**
   - `phaseAdaptability` スコアで戦術の柔軟性を数値化（0-1）

3. **トランジション戦術の可視化**
   - 攻守の切り替え時のフォーメーション変化を追跡

4. **戦術的意図の推測**
   - フェーズごとの配置から戦術的意図を推測
   - 例: 「守備時にコンパクト化 → カウンター重視」

## 技術的詳細

### フェーズ判定ロジ��（既存）

`determinePhase()` 関数で自動判定:

```typescript
- set_piece: free_kick, corner_kick, throw_in, penalty
- attacking: shot, pass, dribble, cross が多い
- defending: tackle, interception, clearance, block が多い
- transition: 上記以外（または攻守が拮抗）
```

### フェーズ適応力の計算式

```typescript
phaseAdaptability = (uniqueFormations - 1) * 0.5 + avgVariability * 0.5
```

- `uniqueFormations`: 攻撃・守備・トランジションで使用されるユニークなフォーメーション数
- `avgVariability`: 3つのフェーズでの平均変動性スコア
- 範囲: 0（固定的） ～ 1（高い柔軟性）

## 完了した項目

- [x] `analyzeFormationByPhase()` 関数の実装
- [x] `FormationByPhase` 型定義
- [x] `10_generateTacticalInsights.ts` への統合
- [x] Geminiプロンプトへのコンテキスト注入
- [x] フェーズ別分析のロギング
- [x] 29テストケースの追加（全てパス）
- [x] ACCURACY_IMPROVEMENT_PLAN.md の更新

## 関連ファイル

- `/services/analyzer/src/lib/formationTracking.ts` - 新規関数追加
- `/services/analyzer/src/jobs/steps/10_generateTacticalInsights.ts` - Geminiプロンプト統合
- `/services/analyzer/src/lib/__tests__/formationTracking.test.ts` - テスト追加
- `/x-pending/ACCURACY_IMPROVEMENT_PLAN.md` - 進捗更新
