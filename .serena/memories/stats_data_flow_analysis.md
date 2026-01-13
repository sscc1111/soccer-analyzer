# Stats データフロー徹底調査レポート

## 1. MetricKey 定義（packages/shared/src/metricKeys.ts）

### マッチスコープメトリクス
- `matchEventsCountByLabel`: "match.events.countByLabel" - イベント数の集計
- `matchTopMoments`: "match.events.topMoments" - トップモーメント

### チームメトリクス
- `teamPossessionPercent`: "team.possession.percent" - チーム別ポゼッション率

### プレイヤーメトリクス

#### 既存メトリクス（Phase 1-2）
- `playerInvolvementCount`: "player.involvement.count" - イベント関連数
- `playerPeakSpeedIndex`: "player.speed.peakIndex" - 最大スピードインデックス
- `playerSprintCount`: "player.speed.sprintCount" - スプリント回数
- `playerHeatmapZones`: "player.heatmap.zones" - ポジショナルヒートマップ
- `playerOnScreenTimeSec`: "player.time.onScreenSec" - 画面内時間（秒）
- `playerDistanceMeters`: "player.distance.meters" - 移動距離（メートル）

#### Phase 3.1: パス関連
- `playerPassesAttempted`: "player.passes.attempted"
- `playerPassesCompleted`: "player.passes.completed"
- `playerPassesIncomplete`: "player.passes.incomplete"
- `playerPassesSuccessRate`: "player.passes.successRate"
- `playerPassesIntercepted`: "player.passes.intercepted"

#### Phase 3.2: キャリー（ドリブル）関連
- `playerCarryCount`: "player.carry.count"
- `playerCarryIndex`: "player.carry.index"
- `playerCarryProgressIndex`: "player.carry.progressIndex"
- `playerCarryMeters`: "player.carry.meters"

#### Phase 3.3: ポゼッション関連
- `playerPossessionTimeSec`: "player.possession.timeSec"
- `playerPossessionCount`: "player.possession.count"

#### Phase 3.4: ターンオーバー関連
- `playerTurnoversLost`: "player.turnovers.lost"
- `playerTurnoversWon`: "player.turnovers.won"

#### 将来実装予定
- `playerShotsCount`: "player.shots.count"
- `playerShotsOnTarget`: "player.shots.onTarget"

## 2. Stats ドキュメント型定義（packages/shared/src/domain/stats.ts）

```typescript
export type StatsDoc = {
  statId: string;
  version: string;
  pipelineVersion?: string;
  scope: "match" | "player";
  playerId?: string | null;
  metrics: Partial<Record<MetricKey, unknown>>;
  confidence: Partial<Record<MetricKey, number>>;
  explanations?: Partial<Record<MetricKey, string>>;
  computedAt: string;
};
```

### 重要な仕様：
- `metrics`: MetricKeyをキーとする値オブジェクト（任意の型を許容）
- `confidence`: 各メトリクスの信頼度（0-1）
- `explanations`: 各メトリクスの説明テキスト
- `scope`: マッチレベルまたはプレイヤーレベル

---

## 3. 計算器レジストリと実装（services/analyzer/src/calculators/）

### StatsOutput型
```typescript
export type StatsOutput = {
  calculatorId: string;
  statId?: string;
  scope: "match" | "player";
  playerId?: string | null;
  metrics: Partial<Record<MetricKey, unknown>>;
  confidence: Partial<Record<MetricKey, number>>;
  explanations?: Partial<Record<MetricKey, string>>;
};
```

### 実装済み計算器

| 計算器 | スコープ | 生成メトリクス | データソース |
|--------|---------|--------------|------------|
| `matchSummary` | match | `matchEventsCountByLabel`, `matchTopMoments` | events (manual/Gemini) |
| `playerInvolvement` | player | `playerInvolvementCount` | events.involved.players |
| `proxySprintIndex` | player | `playerPeakSpeedIndex`, `playerSprintCount` | clips.motionScore |
| `heatmapV1` | player | `playerHeatmapZones` | match.settings.formation.assignments |
| `passesV1` | player | `playerPassesAttempted`, `playerPassesCompleted`, `playerPassesIncomplete`, `playerPassesIntercepted`, `playerPassesSuccessRate` | passEvents (Phase 2) |
| `carryV1` | player | `playerCarryCount`, `playerCarryIndex`, `playerCarryProgressIndex`, `playerCarryMeters` | carryEvents (Phase 2) |
| `possessionV1` | match+player | `playerPossessionTimeSec`, `playerPossessionCount`, `teamPossessionPercent` | possessionSegments (Phase 2) |
| `turnoversV1` | player | `playerTurnoversLost`, `playerTurnoversWon` | turnoverEvents (Phase 2) |

### Contextデータフロー（06_computeStats.ts）

```
Firestore matches/{matchId}
├── shots (version 필터)
├── clips (version 필터)
├── events (version 필터)
├── passEvents (version 필터) ← Phase 2 추가됨
├── carryEvents (version 필터) ← Phase 2 추가됨
├── turnoverEvents (version 필터) ← Phase 2 추가됨
├── possessionSegments (version 필터) ← Phase 2 추가됨
└── trackMappings (unversioned)

    ↓ runCalculators()
    
StatsOutput[]
    ↓
    Firestore matches/{matchId}/stats/{statId}
    (merge: true로 저장)
```

---

## 4. モバイルアプリでのメトリクス表示（apps/mobile/app/match/[id]/stats.tsx）

### MATCH_METRICS配列
表示順序とマッピング：
1. `matchEventsCountByLabel` → "Events by Type"
2. `matchTopMoments` → "Top Moments" 
3. `teamPossessionPercent` → "Possession" (Home/Away分割)

### PLAYER_METRICS配列
表示順序とマッピング：

**Phase 3.1: パス**
1. `playerPassesAttempted` → "Passes Attempted"
2. `playerPassesCompleted` → "Passes Completed"
3. `playerPassesSuccessRate` → "Pass Success Rate" (%)

**Phase 3.2: キャリー**
4. `playerCarryCount` → "Carries"
5. `playerCarryIndex` → "Carry Index"
6. `playerCarryProgressIndex` → "Carry Progress"

**Phase 3.3: ポゼッション**
7. `playerPossessionTimeSec` → "Possession Time" (mm:ss形式)
8. `playerPossessionCount` → "Possessions"

**Phase 3.4: ターンオーバー**
9. `playerTurnoversLost` → "Turnovers Lost"
10. `playerTurnoversWon` → "Turnovers Won"

**既存メトリクス**
11. `playerInvolvementCount` → "Involvement" (events単位)
12. `playerPeakSpeedIndex` → "Peak Speed Index"
13. `playerSprintCount` → "Sprint Count"
14. `playerOnScreenTimeSec` → "On Screen Time" (mm:ss形式)

**特殊な可視化**
- `playerHeatmapZones` → 3x3グリッドヒートマップ

---

## 5. データ不整合とギャップ分析

### 致命的な不整合

#### 1. **実装されていないメトリクス**

| メトリクス | 定義済み | 計算器実装 | モバイル表示 | 状態 |
|-----------|---------|----------|-----------|------|
| `playerDistanceMeters` | ✅ | ❌ | ❌ | **未実装** |
| `playerOnScreenTimeSec` | ✅ | ❌ | ✅ | **計算器なし** |
| `playerShotsCount` | ✅ | ❌ | ❌ | 将来予定 |
| `playerShotsOnTarget` | ✅ | ❌ | ❌ | 将来予定 |

**影響**: 
- モバイルアプリが `playerOnScreenTimeSec` を表示しようとしているが、これを生成する計算器がない
- 値は常に表示されない（undefined）
- carryV1 で `playerCarryMeters` は optionalで、キャリブレーションがない場合は生成されない

#### 2. **Phase 2 イベントデータとの検索条件の不一致**

`06_computeStats.ts` ライン54-61:
```typescript
const [passEventsSnap, carryEventsSnap, turnoverEventsSnap, possessionSnap, trackMappingsSnap] =
  await Promise.all([
    matchRef.collection("passEvents").where("version", "==", version).get(),
    matchRef.collection("carryEvents").where("version", "==", version).get(),
    matchRef.collection("turnoverEvents").where("version", "==", version).get(),
    matchRef.collection("possessionSegments").where("version", "==", version).get(),
    matchRef.collection("trackMappings").get(), // trackMappings are not versioned
  ]);
```

**問題**: 
- Phase 2 イベントは version フィルタを期待する
- しかし、これらのコレクションをどこで生成するかコードに見当たらない
- 検索結果が常に空になる可能性が高い

#### 3. **プレイヤーID マッピングの不確実性**

passesV1, carryV1, possessionV1, turnoversV1 の実装パターン:
```typescript
const playerId = trackToPlayer.get(trackId);
return playerId ?? `track:${trackId}`;
```

**問題**:
- trackMappings が存在しない場合、playerId は null
- フォールバック: `track:{trackId}` という人工IDを生成
- これはモバイルアプリでプレイヤー表示に不具合をもたらす（"Player track:abc123"と表示）

#### 4. **信頼度の設定が恣意的**

- `matchSummary`: `Math.min(0.9, avgConfidence + 0.1)`
- `playerInvolvement`: `Math.min(0.8, avg + 0.1)` 
- `proxySprintIndex`: 固定 0.2
- `heatmapV1`: 固定 0.2
- Phase 3 計算器: イベントの平均信頼度を使用

**問題**: 統一性がなく、メトリクス信頼度の解釈が困難

#### 5. **Format 関数でのタイプミスマッチ**

`stats.tsx` ライン28-34の `matchEventsCountByLabel`:
```typescript
format: (v) => {
  if (!v || typeof v !== "object") return "N/A";
  const counts = v as Record<string, number>;
  return Object.entries(counts)
    .map(([k, c]) => `${k}: ${c}`)
    .join(", ");
}
```

`matchSummary.ts` ライン13-16:
```typescript
const counts: Record<string, number> = {};
for (const event of events) {
  counts[event.label] = (counts[event.label] ?? 0) + 1;
}
```

**確認**: これは正しく、matchSummary で `Record<string, number>` を返す

#### 6. **possessionSegments の起点不明確**

- possessionV1 が possessionSegments を期待
- しかし、この型で何のフェーズで生成されるのか不明
- トラッキングデータをボール検出と組み合わせてセグメント化する必要がある

---

## 6. Firestore スキーマと書き込み箇所

### 書き込み箇所：06_computeStats.ts

```typescript
const statsRef = matchRef.collection("stats");
const batch = db.batch();
const safeVersion = safeId(version);
const now = new Date().toISOString();

for (const output of outputs) {
  const statId = output.statId ?? `stat_${safeVersion}_${output.calculatorId}_${output.playerId ?? "match"}`;
  batch.set(
    statsRef.doc(statId),
    {
      ...output,
      statId,
      version,
      pipelineVersion: version,
      computedAt: now,
    },
    { merge: true }
  );
}
```

### Firestore パス
- `matches/{matchId}/stats/{statId}`
- statId フォーマット: `stat_{safeVersion}_{calculatorId}_{playerId_or_match}`

---

## 7. モバイルアプリのデータフェッチ（useStats.ts）

```typescript
const statsRef = collection(db, "matches", matchId, "stats");
const q = query(statsRef, orderBy("computedAt", "desc"));

const unsubscribe = onSnapshot(q, (snapshot) => {
  const docs = snapshot.docs.map((d) => ({
    statId: d.id,
    ...d.data(),
  })) as StatsDoc[];
  setStats(docs);
  ...
});

// フィルタリング
const matchStats = stats.find((s) => s.scope === "match") ?? null;
const playerStats = stats.filter((s) => s.scope === "player");
```

---

## 8. 推奨修正項目

### 高優先度

1. **playerOnScreenTimeSec の実装**
   - トラッキングデータから play時間を計算
   - 計算器: `calcOnScreenTimeV1`

2. **Phase 2 イベント生成パイプラインの実装**
   - passEvents, carryEvents, turnoverEvents, possessionSegments 生成ステップを追加
   - JSON フォーマット確認

3. **プレイヤーマッピング失敗時の処理改善**
   - trackMappings が空の場合のフォールバック
   - ユーザーへの通知メカニズム

### 中優先度

4. **信頼度スコアリングの統一化**
   - イベント検出のいずれかに基づく一貫性のある計算
   
5. **playerDistanceMeters の実装**
   - フィールドキャリブレーション依存
   - キャリブレーション検出がない場合は計算をスキップ

6. **メトリクス表示の順序と分類**
   - カテゴリーごとにセクション化（パス/キャリー/ポゼッション/ターンオーバー）

### 低優先度

7. **説明テキストの翻語化**
   - 日本語説明の追加

8. **ショットメトリクスの実装**
   - shotEvents が実装されたら実装

---

## まとめ

### 現在のデータフロー状態
- ✅ メトリクスキーは完全に定義されている（36個）
- ✅ stats.ts 型定義は堅牢
- ⚠️ Phase 2 計算器（パス/キャリー/ポゼッション/ターンオーバー）は実装済みだが、
  **入力データ（passEvents等）の生成経路が不明確**
- ❌ playerOnScreenTimeSec は表示されているが、生成器がない
- ❌ playerDistanceMeters も実装されていない
- ⚠️ プレイヤーマッピングが失敗した場合、フォールバック ID が UI に露出する

### 最大の課題
**Phase 2 イベント（passEvents, carryEvents, turnoverEvents, possessionSegments）がパイプラインのどこで生成されているのかが不明確**
- 推測：別の分析パイプラインステップで生成される予定
- 検証が必要
