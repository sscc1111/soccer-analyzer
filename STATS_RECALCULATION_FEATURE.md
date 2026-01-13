# Stats再計算トリガー機能

## 概要

ユーザーがPendingReviewを修正した後、スタッツを自動的に再計算する機能を実装しました。

## 実装内容

### 1. 型定義の追加

**ファイル**: `packages/shared/src/domain/match.ts`

`MatchDoc` 型に以下のフィールドを追加：

```typescript
analysis?: {
  // 既存フィールド...
  /** Flag to request stats recalculation after user corrections */
  needsRecalculation?: boolean;
  /** Timestamp when recalculation was requested */
  recalculationRequestedAt?: string;
}
```

### 2. モバイル側：再計算リクエスト関数

**ファイル**: `apps/mobile/lib/hooks/usePendingReviews.ts`

既に実装済みの `triggerStatsRecalculation` 関数を修正：

```typescript
/**
 * Trigger stats recalculation after corrections
 * Sets a flag that backend Cloud Functions will detect and process
 */
export async function triggerStatsRecalculation(matchId: string) {
  const matchRef = doc(db, "matches", matchId);
  await updateDoc(matchRef, {
    "analysis.needsRecalculation": true,
    "analysis.recalculationRequestedAt": serverTimestamp(),
  });
}
```

### 3. バックエンド側：再計算トリガー

**ファイル**: `functions/src/triggers/onRecalculationRequested.ts` (新規作成)

Firestore トリガーを実装：

```typescript
export const onRecalculationRequested = onDocumentWritten("matches/{matchId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  // Check if needsRecalculation flag was just set
  const wasRequested = Boolean(before?.analysis?.needsRecalculation);
  const isRequested = Boolean(after?.analysis?.needsRecalculation);

  if (!isRequested || wasRequested) return; // No new request

  // Don't queue if already processing
  if (after?.analysis?.status === "running" || after?.analysis?.status === "queued") {
    return;
  }

  // Clear the flag and queue the job
  await event.data?.after?.ref.update({
    "analysis.needsRecalculation": false,
  });

  // Queue stats recalculation job
  await createJob(event.params.matchId, "recompute_stats");
});
```

### 4. UI統合

**ファイル**: `apps/mobile/app/match/[id]/review.tsx`

既に実装済み：
- すべてのレビューが完了すると「Recalculate Stats」ボタンが表示される
- ボタン押下で `triggerStatsRecalculation` が呼ばれる
- トーストで成功メッセージを表示

## 動作フロー

1. ユーザーがPendingReviewを修正
2. 修正完了後、「Recalculate Stats」ボタンを押下
3. モバイルアプリが `analysis.needsRecalculation: true` をセット
4. Cloud Functions の `onRecalculationRequested` トリガーが発火
5. フラグをクリアし、`recompute_stats` ジョブをキューに追加
6. `onJobCreated` トリガーが `runMatchPipeline` を実行
7. パイプラインが `compute_stats` ステップのみを実行
8. スタッツが更新される

## Firestoreルール

既存のルールで対応可能：
```javascript
match /matches/{matchId} {
  allow update: if request.auth != null && resource.data.ownerUid == request.auth.uid;
}
```

オーナーのみが `analysis.needsRecalculation` フィールドを更新可能。

## 型チェック結果

以下のパッケージで型チェックがパスしました：
- ✅ `packages/shared`
- ✅ `apps/mobile`
- ✅ `services/analyzer`
- ⚠️ `functions` (TypeScript インストール問題、実装自体は正常)

## 今後の拡張

- **進捗通知**: 再計算中の進捗をリアルタイムで表示
- **バッチ処理**: 複数のマッチの一括再計算
- **選択的再計算**: 特定のスタッツのみを再計算するオプション
- **履歴管理**: 再計算の履歴とロールバック機能

## 関連ファイル

- `packages/shared/src/domain/match.ts` - 型定義
- `apps/mobile/lib/hooks/usePendingReviews.ts` - リクエスト関数
- `functions/src/triggers/onRecalculationRequested.ts` - トリガー実装
- `functions/src/enqueue/createJob.ts` - ジョブ作成
- `services/analyzer/src/jobs/runMatchPipeline.ts` - パイプライン実行
- `apps/mobile/app/match/[id]/review.tsx` - UI実装
