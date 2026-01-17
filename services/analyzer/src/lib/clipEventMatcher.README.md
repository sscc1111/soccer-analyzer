# Clip-Event Matcher

クリップとイベントのマッチング、重要度スコアリングを行うモジュール。

## 概要

サッカー試合動画の解析において、抽出されたクリップ（動画セグメント）と検出されたイベント（ゴール、シュート、タックルなど）を紐付け、各クリップの重要度を計算します。

## 主な機能

### 1. クリップ-イベントマッチング

クリップの時間帯とイベントのタイムスタンプを比較し、関連性を判定します。

**マッチタイプ:**
- **exact (完全一致)**: イベントがクリップ内に完全に含まれる
- **overlap (部分一致)**: イベントがクリップに部分的に重なる
- **proximity (近接)**: イベントがクリップに近接（デフォルト: 2秒以内）

### 2. 重要度スコアリング

複数の要素を考慮して、クリップの重要度を0-1のスコアで算出します。

**スコアの構成要素:**
- **Base Importance**: イベントタイプの基本重要度
- **Event Type Boost**: 複数イベントによる追加ブースト
- **Context Boost**: 試合状況（時間帯、スコア差）による調整
- **Rarity Boost**: イベントの希少性による追加スコア

### 3. ランキング機能

すべてのクリップを重要度順にソートし、上位Nクリップの抽出や閾値フィルタリングが可能です。

## イベントタイプ別重要度ウェイト

| イベントタイプ | 重要度 | 説明 |
|--------------|--------|------|
| goal | 1.0 | 最高重要度 |
| penalty | 0.95 | PK（ゴール前） |
| red_card | 0.9 | 退場 |
| own_goal | 0.85 | オウンゴール |
| save | 0.75 | ゴールキーパーのセーブ |
| shot | 0.7 | シュート（詳細で調整） |
| chance | 0.65 | チャンス |
| key_pass | 0.6 | 決定的なパス |
| foul | 0.55 | ファウル |
| yellow_card | 0.55 | イエローカード |
| setPiece | 0.5 | セットプレー |
| tackle | 0.5 | タックル（詳細で調整） |
| turnover | 0.45 | ターンオーバー |
| pass | 0.3 | パス |
| carry | 0.25 | ドリブル |

### イベント詳細による調整

- **Shot**:
  - `shotResult === "goal"` → ゴールとして扱う (1.0)
  - `isOnTarget === true` → 1.2倍ブースト
  - `shotType === "long_range"` → 1.1倍ブースト

- **Tackle**:
  - `wonTackle === true` → 1.3倍ブースト

- **Turnover**:
  - `turnoverType === "interception"` → 1.2倍ブースト

## コンテキストブースト

### 試合時間による調整

試合の80%以降のイベントには最大15%のブーストが適用されます。

```
時間ブースト = 0.15 × (試合進行率 - 0.8) / 0.2
```

### スコア差による調整

- **同点または1点差**: +10%
- **ビハインド時のゴール**: +15%

## 希少性ブースト

発生頻度が低いイベントには追加の重要度ブーストが適用されます。

| イベントタイプ | 希少性ウェイト |
|--------------|---------------|
| own_goal | 0.9 |
| red_card | 0.85 |
| penalty | 0.8 |
| goal | 0.7 |
| save | 0.6 |
| yellow_card | 0.4 |

## 使用例

### 基本的なマッチング

```typescript
import { matchClipToEvents } from './clipEventMatcher';

const clip = {
  id: 'clip_001',
  startTime: 45.2,
  endTime: 52.8,
};

const events = [
  {
    id: 'event_001',
    timestamp: 48.5,
    type: 'shot',
    details: { isOnTarget: true },
  },
];

const matches = matchClipToEvents(clip, events);
// matches[0].matchType === 'exact'
// matches[0].confidence === 0.9 (例)
```

### 重要度計算

```typescript
import { calculateClipImportance } from './clipEventMatcher';

const matches = matchClipToEvents(clip, events);

const context = {
  matchMinute: 85,
  totalMatchMinutes: 90,
  scoreDifferential: -1, // 1点ビハインド
};

const importance = calculateClipImportance(clip, matches, context);
console.log(importance.finalImportance); // 0.92 (例)
```

### クリップのランキング

```typescript
import { rankClipsByImportance } from './clipEventMatcher';

const ranked = rankClipsByImportance(clips, events, context);

ranked.forEach(rc => {
  console.log(`Rank ${rc.rank}: ${rc.clip.id}`);
  console.log(`  Importance: ${rc.importance.finalImportance}`);
});
```

### トップN取得

```typescript
import { getTopClips } from './clipEventMatcher';

const top5 = getTopClips(clips, events, 5);
// 重要度上位5つのクリップを取得
```

### 閾値フィルタリング

```typescript
import { filterClipsByImportance } from './clipEventMatcher';

const important = filterClipsByImportance(clips, events, 0.7);
// 重要度0.7以上のクリップのみ取得
```

## API リファレンス

### Types

#### `Clip`
```typescript
interface Clip {
  id: string;
  startTime: number;  // 秒
  endTime: number;    // 秒
}
```

#### `Event`
```typescript
interface Event {
  id: string;
  timestamp: number;  // 秒
  type: EventType;
  details?: EventDetails;
}
```

#### `ClipEventMatch`
```typescript
interface ClipEventMatch {
  clipId: string;
  eventId: string;
  matchType: 'exact' | 'overlap' | 'proximity';
  confidence: number;        // 0-1
  temporalOffset: number;    // 秒
  importanceBoost: number;   // 0-1
}
```

#### `ClipImportanceFactors`
```typescript
interface ClipImportanceFactors {
  baseImportance: number;    // 0-1
  eventTypeBoost: number;    // 0-1
  contextBoost: number;      // 0-1
  rarityBoost: number;       // 0-1
  finalImportance: number;   // 0-1
}
```

#### `MatchContext`
```typescript
interface MatchContext {
  matchMinute?: number;
  scoreDifferential?: number;
  isHomeTeam?: boolean;
  totalMatchMinutes?: number;
}
```

#### `RankedClip`
```typescript
interface RankedClip {
  clip: Clip;
  matches: ClipEventMatch[];
  importance: ClipImportanceFactors;
  rank: number;
}
```

### Functions

#### `matchClipToEvents(clip, events, tolerance?)`

クリップとイベントをマッチング。

**Parameters:**
- `clip: Clip` - マッチング対象のクリップ
- `events: Event[]` - すべてのイベント
- `tolerance?: number` - 近接判定の許容時間（秒）デフォルト: 2.0

**Returns:** `ClipEventMatch[]` - マッチング結果（信頼度降順）

#### `calculateClipImportance(clip, matchedEvents, matchContext?)`

クリップの重要度を計算。

**Parameters:**
- `clip: Clip` - クリップ
- `matchedEvents: ClipEventMatch[]` - マッチしたイベント
- `matchContext?: MatchContext` - 試合コンテキスト

**Returns:** `ClipImportanceFactors` - 重要度計算の内訳

#### `rankClipsByImportance(clips, allEvents, matchContext?, tolerance?)`

すべてのクリップを重要度順にランク付け。

**Parameters:**
- `clips: Clip[]` - すべてのクリップ
- `allEvents: Event[]` - すべてのイベント
- `matchContext?: MatchContext` - 試合コンテキスト
- `tolerance?: number` - マッチング許容時間

**Returns:** `RankedClip[]` - 重要度順にソートされたクリップ

#### `getTopClips(clips, allEvents, topN, matchContext?)`

トップN個の最重要クリップを取得。

**Parameters:**
- `clips: Clip[]` - すべてのクリップ
- `allEvents: Event[]` - すべてのイベント
- `topN: number` - 取得する上位N個
- `matchContext?: MatchContext` - 試合コンテキスト

**Returns:** `RankedClip[]` - 上位N個のクリップ

#### `filterClipsByImportance(clips, allEvents, threshold, matchContext?)`

重要度の閾値以上のクリップをフィルタリング。

**Parameters:**
- `clips: Clip[]` - すべてのクリップ
- `allEvents: Event[]` - すべてのイベント
- `threshold: number` - 重要度の閾値 (0-1)
- `matchContext?: MatchContext` - 試合コンテキスト

**Returns:** `RankedClip[]` - 閾値以上のクリップ

### Utility Functions

#### `getMatchTypeLabel(matchType)`

マッチタイプを日本語で取得。

**Returns:** `string` - "完全一致" | "部分一致" | "近接"

#### `getImportanceSummary(importance)`

クリップの重要度サマリーを文字列で取得。

**Returns:** `string` - 重要度の内訳テキスト

## アルゴリズム詳細

### マッチング信頼度の計算

#### 完全一致 (Exact Match)
```
confidence = max(0.7, 1.0 - normalizedOffset * 0.3)
where normalizedOffset = |event.timestamp - clipCenter| / (clipDuration / 2)
```

#### 部分一致 (Overlap Match)
```
confidence = max(0.4, 0.7 - normalizedOffset * 0.3)
where normalizedOffset = |event.timestamp - clipCenter| / (clipDuration / 2)
```

#### 近接 (Proximity Match)
```
confidence = max(0.2, 0.4 - normalizedOffset * 0.2)
where normalizedOffset = temporalOffset / tolerance
```

### 最終重要度の計算

```
finalImportance = min(1.0, baseImportance + eventTypeBoost + contextBoost + rarityBoost)
```

各要素は独立して計算され、最終的に合算されます。

## テスト

```bash
npm test clipEventMatcher.test.ts
```

テストケース:
- 基本的なマッチング
- 重要度計算
- ランキング機能
- エッジケース（空配列、境界値など）
- イベント詳細による調整
- コンテキストブースト
- 希少性ブースト

## 使用例の実行

```typescript
import { runAllExamples } from './clipEventMatcher.example';

runAllExamples();
```

8つの実用的な例を実行して、モジュールの動作を確認できます。

## パフォーマンス

- **時間計算量**: O(n × m) where n = クリップ数, m = イベント数
- **空間計算量**: O(n × k) where k = 平均マッチ数

大規模データセット（1000+ クリップ、5000+ イベント）でも高速に動作します。

## 今後の拡張予定

- [ ] 機械学習による重要度予測の統合
- [ ] クリップの視覚的特徴（カメラの動き、音声など）の考慮
- [ ] チーム/選手固有の重要度カスタマイズ
- [ ] リアルタイムストリーミング対応
- [ ] キャッシング機構の追加

## ライセンス

This module is part of the soccer-analyzer project.

## 作者

soccer-analyzer team

## 変更履歴

### v1.0.0 (2026-01-15)
- 初回リリース
- 基本的なマッチング機能
- 重要度スコアリング
- ランキング機能
- コンテキストブースト
- 希少性ブースト
