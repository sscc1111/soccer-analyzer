# Stats再計算機能 テストシナリオ

## 前提条件

- Firebase Emulator または本番環境がセットアップ済み
- モバイルアプリがビルド・起動可能
- Cloud Functions がデプロイ済み
- 試合動画がアップロード済みで、初回分析が完了している
- PendingReview が存在する（confidence < 60% のイベント）

## テストケース

### 1. 基本フロー

**目的**: 正常なフローで再計算がトリガーされることを確認

**手順**:
1. モバイルアプリで試合詳細画面を開く
2. "Event Review" タブに移動
3. 未解決のレビューが表示されることを確認
4. レビューをタップして詳細を開く
5. "Correct Kicker" を選択し、正しいプレイヤーを選択
6. 保存されることを確認（トースト表示）
7. すべてのレビューを解決
8. "Recalculate Stats" ボタンが表示されることを確認
9. ボタンをタップ
10. 成功トーストが表示されることを確認
11. Firestoreで `matches/{matchId}` の `analysis.needsRecalculation` が `false` になることを確認
12. `jobs` コレクションに新しいジョブが作成されることを確認
13. ジョブが実行され、スタッツが更新されることを確認

**期待結果**:
- ✅ レビュー修正が保存される
- ✅ 再計算ボタンが表示される
- ✅ 再計算がトリガーされる
- ✅ Cloud Function がジョブを作成する
- ✅ パイプラインが `compute_stats` を実行
- ✅ スタッツが更新される

### 2. 既に処理中の場合

**目的**: 既に分析が実行中の場合、再計算がトリガーされないことを確認

**手順**:
1. Firestoreで `matches/{matchId}` の `analysis.status` を `"running"` に設定
2. モバイルアプリで「Recalculate Stats」をタップ
3. `analysis.needsRecalculation` が `true` になるが、ジョブが作成されないことを確認

**期待結果**:
- ✅ フラグは設定される
- ✅ ジョブは作成されない（既に実行中）
- ✅ エラーが発生しない

### 3. 動画未アップロードの場合

**目的**: 動画がアップロードされていない場合、再計算がトリガーされないことを確認

**手順**:
1. Firestoreで `matches/{matchId}` の `video.storagePath` を削除
2. モバイルアプリで「Recalculate Stats」をタップ
3. ジョブが作成されないことを確認

**期待結果**:
- ✅ フラグは設定される
- ✅ ジョブは作成されない（動画なし）
- ✅ エラーが発生しない

### 4. 複数のレビュー修正

**目的**: 複数のレビューを修正した後、一度に再計算できることを確認

**手順**:
1. 複数のPendingReviewが存在する状態を準備
2. すべてのレビューを順番に修正
3. 最後に「Recalculate Stats」をタップ
4. すべての修正がスタッツに反映されることを確認

**期待結果**:
- ✅ すべての修正が保存される
- ✅ 再計算が一度だけ実行される
- ✅ スタッツにすべての修正が反映される

### 5. パーミッションチェック

**目的**: 他のユーザーの試合に対して再計算をトリガーできないことを確認

**手順**:
1. ユーザーAで試合を作成
2. ユーザーBでログイン
3. Firestoreで直接 `analysis.needsRecalculation` を設定しようとする

**期待結果**:
- ✅ Firestoreルールでブロックされる（permission denied）

## デバッグ方法

### Firestoreデータの確認

```javascript
// Cloud Functions のログ
firebase functions:log --only onRecalculationRequested

// Firestoreのデータ確認
// matches/{matchId}
{
  analysis: {
    needsRecalculation: false,  // トリガー後はfalse
    recalculationRequestedAt: "2026-01-09T...",
    status: "queued" または "running"
  }
}

// jobs/{jobId}
{
  matchId: "...",
  type: "recompute_stats",
  status: "queued" または "running",
  step: "compute_stats",
  createdAt: "2026-01-09T...",
  updatedAt: "2026-01-09T..."
}
```

### エラーハンドリング

**トリガーがエラーの場合**:
```bash
# Cloud Functions のエラーログを確認
firebase functions:log --only onRecalculationRequested | grep ERROR
```

**ジョブ実行がエラーの場合**:
```bash
# jobsコレクションで status: "error" を確認
firebase firestore:get jobs/{jobId}
```

## パフォーマンス指標

- **トリガー応答時間**: < 1秒
- **ジョブ作成時間**: < 2秒
- **stats再計算時間**: 試合時間とイベント数に依存（通常 10-30秒）

## ロールバック手順

問題が発生した場合のロールバック：

1. Cloud Functions をデプロイ解除
   ```bash
   firebase functions:delete onRecalculationRequested
   ```

2. モバイルアプリで「Recalculate Stats」ボタンを無効化
   ```typescript
   // review.tsx
   const FEATURE_FLAG_RECALCULATION = false;
   ```

3. Firestoreでフラグをクリア
   ```javascript
   batch.update(matchRef, {
     "analysis.needsRecalculation": false,
     "analysis.recalculationRequestedAt": null
   });
   ```

## 今後の改善

- [ ] 再計算進捗のリアルタイム表示
- [ ] 再計算履歴の記録
- [ ] ロールバック機能（前回のスタッツに戻す）
- [ ] バッチ再計算（複数試合を一度に）
- [ ] スタッツプレビュー（再計算前に差分を確認）
