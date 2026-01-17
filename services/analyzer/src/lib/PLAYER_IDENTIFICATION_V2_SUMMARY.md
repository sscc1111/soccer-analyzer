# Player Identification v2 - Implementation Summary

Section 5.1の実装完了（2026-01-15）

## 概要

選手識別の精度を向上させるため、以下の2つの主要な改善を実装：

1. **プロンプト改善**: 背番号が見えにくい場合のフォールバック戦略
2. **trackId → playerId マッピング**: 同一選手の複数検出をマージ

---

## 1. プロンプト改善 (Section 5.1.1)

### 新プロンプト: `player_identification_v2.json`

#### 主要な改善点

**1.1 フォールバック戦略（優先度順）**

| 優先度 | 識別方法 | 信頼度範囲 |
|--------|---------|-----------|
| 1 | 明瞭な背番号 | 0.8-1.0 |
| 2 | 部分的な背番号 | 0.4-0.7 |
| 3 | フォールバック識別子 | 0.1-0.3 |

**1.2 フォールバック識別子**

背番号が不明瞭な場合、以下の情報で選手を識別：

```typescript
fallbackIdentifiers: {
  bodyType: "tall" | "average" | "short" | null;
  hairColor: string (hex color) | null;
  dominantPosition: "defender" | "midfielder" | "forward" | "goalkeeper" | null;
}
```

**1.3 チームカラーと背番号の組み合わせ**

```typescript
teams: {
  home: {
    primaryColor: string;      // ユニフォームの主色
    secondaryColor?: string;   // 副色
    goalkeeperColor: string;   // GKユニフォーム
    numberColor: string;       // 背番号の色（NEW in v2）
  }
}
```

**1.4 複数検出の防止**

プロンプト内で明示的に指示：
- 同じ背番号 + チームカラーは1人の選手
- trackingIdで時間的連続性を確認
- 最も信頼度の高い情報を採用

---

## 2. 選手追跡との連携 (Section 5.1.2)

### 新ユーティリティ: `lib/playerTrackMatcher.ts`

#### 主要機能

**2.1 同一選手の判定ロジック**

```typescript
function isSamePlayer(p1, p2): boolean
```

判定基準（優先順）：
1. **チーム一致**: 異なるチームは別人
2. **背番号一致**: 両方とも背番号があれば比較
3. **trackingId一致**: 時間的連続性で判定
4. **フォールバック識別子**: 2つ以上の特徴が一致

**2.2 複数検出のマージ**

```typescript
function mergePlayerDetections(
  detections: RawPlayerDetection[],
  matchId: string
): PlayerMatchingResult
```

処理フロー：
```
1. 各検出を既存の選手と比較
   ├─ 一致する選手が存在
   │  ├─ trackIdsに追加
   │  ├─ detectionCountを増加
   │  └─ より高い信頼度で情報を更新
   └─ 新しい選手として追加

2. TrackPlayerMappingを生成
   ├─ 各trackIdに対してマッピング作成
   └─ 信頼度を計算（OCR + team matching）

3. 統計を計算
   ├─ totalDetections
   ├─ uniquePlayers
   ├─ mergedDetections
   └─ avgConfidence
```

**2.3 信頼度の再計算**

```typescript
function recalculatePlayerConfidence(
  player: MergedPlayerInfo,
  additionalContext?: {
    expectedPlayerCount?: number;
    detectedPlayerCount?: number;
  }
): number
```

信頼度調整：
- **複数検出ブースト**: +0.1 × (detectionCount - 1)、最大+0.3
- **背番号ブースト**: +0.1（背番号がある場合）
- **選手数ギャップペナルティ**: -0.2（期待数と実際の差が3以上）

**2.4 背番号一貫性検証**

```typescript
function validateJerseyNumberConsistency(
  mappings: TrackPlayerMapping[]
): { valid: boolean; issues: Array<...> }
```

同じtrackIdが複数の背番号に関連付けられている場合に警告。

---

## 3. Step 08への統合

### 変更点

**3.1 プロンプトバージョン更新**

```typescript
const PLAYER_ID_VERSION = "v2";
```

**3.2 Geminiレスポンススキーマ拡張**

```typescript
const TeamColorsSchema = z.object({
  primaryColor: z.string(),
  secondaryColor: z.string().optional(),
  goalkeeperColor: z.string().optional(),
  numberColor: z.string().optional(), // NEW
});

const FallbackIdentifiersSchema = z.object({
  bodyType: z.enum(["tall", "average", "short"]).nullable().optional(),
  hairColor: z.string().nullable().optional(),
  dominantPosition: z.enum(["defender", "midfielder", "forward", "goalkeeper"]).nullable().optional(),
}).optional(); // NEW

const PlayerSchema = z.object({
  team: z.enum(["home", "away"]),
  jerseyNumber: z.number().nullable(),
  role: z.enum(["player", "goalkeeper"]),
  confidence: z.number().min(0).max(1),
  fallbackIdentifiers: FallbackIdentifiersSchema, // NEW
  trackingId: z.string().nullable().optional(), // NEW
});
```

**3.3 マージ処理の追加**

```typescript
// 1. Gemini出力をRawPlayerDetection形式に変換
const rawDetections: RawPlayerDetection[] = result.players.map(...);

// 2. 複数検出をマージ
const matchingResult = mergePlayerDetections(rawDetections, matchId);

// 3. 一貫性検証
const consistencyCheck = validateJerseyNumberConsistency(matchingResult.trackMappings);

// 4. 信頼度再計算
for (const player of matchingResult.mergedPlayers) {
  const updatedConfidence = recalculatePlayerConfidence(player, {
    expectedPlayerCount: expectedPlayersPerTeam * 2,
    detectedPlayerCount: matchingResult.stats.uniquePlayers,
  });
  player.confidence = updatedConfidence;
}
```

**3.4 ログ出力の充実**

```typescript
stepLogger.info("Player detection merging complete", {
  totalDetections: matchingResult.stats.totalDetections,
  uniquePlayers: matchingResult.stats.uniquePlayers,
  mergedDetections: matchingResult.stats.mergedDetections,
  withJerseyNumber: matchingResult.stats.withJerseyNumber,
  withoutJerseyNumber: matchingResult.stats.withoutJerseyNumber,
  avgConfidence: matchingResult.stats.avgConfidence,
});

if (!consistencyCheck.valid) {
  stepLogger.warn("Jersey number consistency issues detected", {
    issueCount: consistencyCheck.issues.length,
    issues: consistencyCheck.issues,
  });
}
```

---

## 4. テストカバレッジ

### `lib/__tests__/playerTrackMatcher.test.ts`

**22 テストケース全てパス** ✅

#### テストカテゴリ

**4.1 mergePlayerDetections (10 tests)**
- 同じ背番号の選手をマージ
- 異なるチームの選手は分離
- 異なる背番号の選手は分離
- フォールバック識別子でマージ
- 不十分な特徴では分離
- trackingIdでマージ
- 統計計算の正確性
- TrackPlayerMapping生成
- source属性の正確性（roster_match / ocr）

**4.2 recalculatePlayerConfidence (5 tests)**
- 複数検出での信頼度ブースト
- 背番号ありでの信頼度ブースト
- 信頼度の上限（1.0）
- 選手数ギャップでペナルティ
- 選手数が近い場合はペナルティなし

**4.3 deduplicatePlayers (3 tests)**
- 同じ背番号+チームで重複排除
- null背番号は重複排除しない
- 異なるチームは重複排除しない

**4.4 validateJerseyNumberConsistency (4 tests)**
- 一貫した背番号を検証
- 不一致を検出
- null背番号を無視
- 複数trackIdで検証

---

## 5. 使用例

### 基本的な使い方

```typescript
import { mergePlayerDetections, type RawPlayerDetection } from "@soccer/analyzer";

// Gemini APIレスポンスから取得した生データ
const detections: RawPlayerDetection[] = [
  {
    team: "home",
    jerseyNumber: 10,
    role: "player",
    confidence: 0.8,
    trackingId: "track-1",
  },
  {
    team: "home",
    jerseyNumber: 10,
    role: "player",
    confidence: 0.9,
    trackingId: "track-2", // 同じ選手の別検出
  },
];

// マージ処理
const result = mergePlayerDetections(detections, "match-123");

console.log(result.stats);
// {
//   totalDetections: 2,
//   uniquePlayers: 1,
//   mergedDetections: 1,
//   withJerseyNumber: 1,
//   withoutJerseyNumber: 0,
//   avgConfidence: 0.9
// }

console.log(result.mergedPlayers[0]);
// {
//   team: "home",
//   jerseyNumber: 10,
//   role: "player",
//   confidence: 0.9,
//   trackIds: ["track-1", "track-2"],
//   primaryTrackId: "track-2",
//   detectionCount: 2
// }
```

---

## 6. 期待される効果

### 精度向上

1. **重複検出の排除**
   - 同じ選手が複数回検出されてもマージされる
   - 選手数の過剰カウントを防止

2. **背番号が見えない場合の対応**
   - フォールバック識別子で選手を追跡
   - 完全に背番号が見えなくても選手を識別可能

3. **信頼度の向上**
   - 複数検出によって信頼度がブースト
   - 期待選手数とのギャップで異常検出

4. **データ品質の可視化**
   - 一貫性チェックで問題を早期発見
   - needsReviewフラグで手動確認が必要な選手を特定

### パフォーマンス

- **追加処理時間**: 最小限（O(n²)だが選手数は少ない）
- **メモリ使用量**: 増加なし（既存データの再編成のみ）

---

## 7. 今後の改善

### 短期（Phase 3）

- [ ] 実際の試合データでの精度検証
- [ ] フォールバック識別子の精度測定
- [ ] マージ閾値の調整（現在は2/3の特徴一致）

### 長期（Phase 4+）

- [ ] 機械学習による選手識別（顔認識、歩行パターン）
- [ ] rosterデータとの自動マッチング
- [ ] 選手交代の自動検出とtrackId再割り当て
- [ ] 審判とプレイヤーの誤認識防止

---

## 8. 関連ファイル

### 新規作成

- `/services/analyzer/src/gemini/prompts/player_identification_v2.json`
- `/services/analyzer/src/lib/playerTrackMatcher.ts`
- `/services/analyzer/src/lib/__tests__/playerTrackMatcher.test.ts`
- `/services/analyzer/src/lib/PLAYER_IDENTIFICATION_V2_SUMMARY.md` (this file)

### 変更

- `/services/analyzer/src/jobs/steps/08_identifyPlayersGemini.ts`
  - PLAYER_ID_VERSION: v1 → v2
  - レスポンススキーマ拡張
  - マージ処理追加
  - 一貫性検証追加
  - ログ出力強化

- `/services/analyzer/src/lib/index.ts`
  - playerTrackMatcher の export 追加

- `/x-pending/ACCURACY_IMPROVEMENT_PLAN.md`
  - Section 5.1.1, 5.1.2 を完了にマーク

---

## 9. まとめ

Section 5.1の実装により、以下が達成されました：

✅ **背番号が見えにくい場合でも選手を識別可能**
✅ **同一選手の複数検出を自動的にマージ**
✅ **trackIdとplayerIdの精度の高いマッピング**
✅ **データ品質の可視化と検証**
✅ **22個のテストで動作を保証**

次のステップは、実際の試合データでの精度検証と、必要に応じた閾値調整です。
