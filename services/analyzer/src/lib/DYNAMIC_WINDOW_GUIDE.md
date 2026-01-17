# Dynamic Window System - 使用ガイド

## 概要

動的ウィンドウシステムは、イベントタイプと試合コンテキストに基づいて、クリップの前後の時間範囲を自動的に調整する機能です。

固定ウィンドウ（例: 全イベント前5秒・後3秒）ではなく、各イベントの性質に合わせた最適なウィンドウを計算します。

## 主な機能

### 1. イベントタイプ別のデフォルトウィンドウ

各イベントタイプには最適なデフォルトウィンドウが設定されています:

| イベントタイプ | 前(秒) | 後(秒) | 理由 |
|--------------|--------|--------|------|
| goal | 10 | 5 | ビルドアップから得点後の喜びまで |
| shot | 7 | 3 | シュートまでの展開 |
| penalty | 5 | 5 | 反則からPK実施まで |
| setPiece | 3 | 5 | セットから展開まで（結果含む） |
| turnover | 2 | 3 | ターンオーバーとカウンター |
| pass | 2 | 1 | パスの前後 |

### 2. コンテキストによる自動調整

#### カウンターアタック検出
- ターンオーバー後10秒以内のゴール → 前方ウィンドウを15秒に拡張
- カウンターの起点からゴールまでの流れを含める

```typescript
// ターンオーバー後のゴール → before: 15s
const turnover = { id: "t1", timestamp: 90, type: "turnover" };
const goal = { id: "g1", timestamp: 95, type: "goal" };
const window = calculateDynamicWindow(goal, [turnover, goal]);
// window.before = 15, window.reason = "カウンター攻撃からのゴール"
```

#### シュートの詳細による調整
- **枠内シュート**: 後方ウィンドウ +1秒（セーブまで）
- **ロングレンジシュート**: 前方ウィンドウ -3秒（ビルドアップ短め）

```typescript
const onTargetShot = {
  id: "s1",
  timestamp: 100,
  type: "shot",
  details: { isOnTarget: true }
};
const window = calculateDynamicWindow(onTargetShot, []);
// window.after = 4 (デフォルト3から拡張)
```

#### セットピースタイプによる調整
- **コーナーキック**: before=2s, after=7s（準備短め、展開長め）
- **フリーキック**: before=3s, after=6s

#### インターセプト後のカウンター
- インターセプト後のパス・キャリー・シュートを含める
- 後方ウィンドウを5秒に拡張

### 3. 試合状況による調整

#### 試合終盤のブースト
- 試合の80%以降の重要イベント（ゴール、シュート、チャンス）
- 前後のウィンドウを1.2-1.3倍に拡張

```typescript
const lateGoal = { id: "g1", timestamp: 100, type: "goal" };
const context = { matchMinute: 88, totalMatchMinutes: 90 };
const window = calculateDynamicWindow(lateGoal, [], context);
// window.before > 10, window.after > 5
// window.reason = "ゴールまでのビルドアップと祝福 (試合終盤)"
```

#### 接戦時のブースト
- スコア差が1点以内のゴール
- 前後のウィンドウを1.1-1.2倍に拡張

```typescript
const context = { scoreDifferential: 0 }; // 同点
const window = calculateDynamicWindow(goalEvent, [], context);
// window.reason = "... (接戦)"
```

### 4. イベント密度による自動拡張

#### 前方密集
- ウィンドウ内に4個以上のイベント → 前方ウィンドウを1.3倍に拡張
- パス連鎖やビルドアップを含める

```typescript
const denseEvents = [
  { id: "p1", timestamp: 92, type: "pass" },
  { id: "p2", timestamp: 94, type: "pass" },
  { id: "p3", timestamp: 96, type: "pass" },
  { id: "p4", timestamp: 98, type: "pass" },
  { id: "g1", timestamp: 100, type: "goal" },
];
const window = calculateDynamicWindow(denseEvents[4], denseEvents);
// window.before > 10, window.reason = "... (前方密集)"
```

#### 後方密集
- ウィンドウ内に4個以上のイベント → 後方ウィンドウを1.3倍に拡張
- セットピース後の展開を含める

### 5. コンテキストイベントの検出

動的ウィンドウは、関連する前後のイベントも検出します:

- **ゴール**: 前方のキーパス、チャンス、パス
- **シュート**: 前方のパス、キャリー
- **セットピース**: 後方のシュート、ゴール、ターンオーバー
- **ペナルティ**: 前方のファール

```typescript
const keyPass = { id: "kp1", timestamp: 95, type: "key_pass" };
const goal = { id: "g1", timestamp: 100, type: "goal" };
const window = calculateDynamicWindow(goal, [keyPass, goal]);

// window.contextBefore に keyPass が含まれる
console.log(window.contextBefore); // [{ id: "kp1", ... }]
```

## 使用方法

### 基本的な使い方

```typescript
import { calculateDynamicWindow, type Event } from "@soccer/analyzer/lib";

const event: Event = {
  id: "g1",
  timestamp: 100,
  type: "goal"
};

const allEvents: Event[] = [/* 全イベント */];

const window = calculateDynamicWindow(event, allEvents);

console.log(window);
// {
//   before: 10,
//   after: 5,
//   reason: "ゴールまでのビルドアップと祝福",
//   contextBefore: [...],
//   contextAfter: [...]
// }
```

### 試合コンテキストを含める

```typescript
import { calculateDynamicWindow, type MatchContext } from "@soccer/analyzer/lib";

const matchContext: MatchContext = {
  matchMinute: 88,
  totalMatchMinutes: 90,
  scoreDifferential: 0,
};

const window = calculateDynamicWindow(event, allEvents, matchContext);
// 試合終盤 & 接戦の場合、ウィンドウが拡張される
```

### クリップ生成への適用

```typescript
import { calculateDynamicWindow } from "@soccer/analyzer/lib";

function generateClip(event: Event, allEvents: Event[], videoDuration: number) {
  const window = calculateDynamicWindow(event, allEvents);

  const t0 = Math.max(0, event.timestamp - window.before);
  const t1 = Math.min(videoDuration, event.timestamp + window.after);

  return {
    clipId: `clip_${event.id}`,
    t0,
    t1,
    windowReason: window.reason,
    contextEvents: [
      ...(window.contextBefore || []),
      ...(window.contextAfter || [])
    ]
  };
}
```

## パイプライン統合

### 07e_supplementClipsForUncoveredEvents.ts

動的ウィンドウは `07e_supplementClipsForUncoveredEvents.ts` に統合されています:

```typescript
const SUPPLEMENT_CONFIG = {
  // 動的ウィンドウを有効化
  useDynamicWindow: true,

  // フォールバックのデフォルト値
  defaultWindowBefore: 5,
  defaultWindowAfter: 3,
};
```

無効化する場合は `useDynamicWindow: false` に設定してください。

## テスト

動的ウィンドウ機能は `clipEventMatcher.test.ts` で包括的にテストされています（58テスト全てパス）:

```bash
npm test -- clipEventMatcher.test.ts
```

### テストカテゴリ

1. デフォルトウィンドウ設定（各イベントタイプ）
2. カウンターアタック検出
3. シュート詳細による調整
4. セットピースタイプ調整
5. ターンオーバー調整
6. 試合コンテキスト調整（終盤、接戦）
7. イベント密度による拡張
8. コンテキストイベント検出
9. エッジケース（未知のタイプ、空配列など）

## 設計の背景

### なぜ動的ウィンドウが必要か？

固定ウィンドウの問題点:
- **ゴール**: 5秒ではビルドアップが途切れる
- **セットピース**: 結果（シュートやクリア）が含まれない
- **カウンターアタック**: 起点が含まれない
- **試合終盤のゴール**: ドラマティックな状況が切れる

動的ウィンドウの利点:
- イベントの性質に合わせた最適な範囲
- コンテキスト（前後の関連イベント）の自動検出
- 試合の重要な局面を逃さない
- 視聴体験の向上

## パフォーマンス

- 計算時間: O(n) - nはイベント数
- メモリ: O(1) - 追加のメモリ使用は最小限
- キャッシュ不要: 各イベントごとに高速計算

## 今後の拡張

以下の機能追加を検討中:

1. **ボールトラッキング統合**: ボールの移動範囲からウィンドウを動的計算
2. **選手トラッキング統合**: 関与選手の動きからウィンドウを調整
3. **機械学習モデル**: 過去のクリップ評価からウィンドウを最適化
4. **カスタムルール**: チーム/リーグごとの好みに応じた調整

## トラブルシューティング

### ウィンドウが予想より長い/短い

- `calculateDynamicWindow` の戻り値を確認
- `window.reason` でどの調整が適用されたかを確認
- コンテキストイベント（`contextBefore`, `contextAfter`）を確認

### パフォーマンス問題

- イベント数が非常に多い場合（>10000）、イベント密度計算が遅くなる可能性
- 必要に応じて `allEvents` をフィルタリング（時間範囲を制限）

### デバッグ

```typescript
const window = calculateDynamicWindow(event, allEvents, context);
console.log({
  before: window.before,
  after: window.after,
  reason: window.reason,
  contextBefore: window.contextBefore?.map(e => e.type),
  contextAfter: window.contextAfter?.map(e => e.type),
});
```

## 参考資料

- `lib/clipEventMatcher.ts`: 実装コード
- `lib/__tests__/clipEventMatcher.test.ts`: テストケース
- `ACCURACY_IMPROVEMENT_PLAN.md`: Section 7.1.2
