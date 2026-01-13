# Step 07-10 Integration Tests

このディレクトリには、選手検出からイベント検出までの完全なパイプライン統合テストが含まれています。

## テスト対象

### Step 07: detectPlayers (選手検出・トラッキング)
- **ファイル**: `07_detectPlayers.test.ts`
- **テスト内容**:
  - PlaceholderDetector/Trackerを使った選手検出
  - トラック作成とFirestore保存
  - エラーハンドリング (video.storagePathが無い場合)
  - 進捗コールバックの呼び出し確認

### Step 08: classifyTeams (チーム分類)
- **ファイル**: `08_classifyTeams.test.ts`
- **テスト内容**:
  - K-meansクラスタリングによるチーム分類
  - チームカラーヒントの使用
  - 色抽出エラーの処理
  - TrackTeamMetaのFirestore保存

### Step 09: detectBall (ボール検出)
- **ファイル**: `09_detectBall.test.ts`
- **テスト内容**:
  - ボール検出とKalmanフィルタ適用
  - 欠損フレームの補間処理
  - カメラズームヒントに基づく信頼度閾値調整
  - BallTrackDocのFirestore保存

### Step 10: detectEvents (イベント検出)
- **ファイル**: `10_detectEvents.test.ts`
- **テスト内容**:
  - ポゼッション、パス、キャリー、ターンオーバーの検出
  - 複数チームでのターンオーバー検出
  - レビュー必要イベントの抽出
  - 攻撃方向設定の使用

## 実行方法

```bash
# 全てのStepテストを実行
pnpm test src/jobs/steps/__tests__/

# 特定のStepのみ実行
pnpm test src/jobs/steps/__tests__/07_detectPlayers.test.ts
pnpm test src/jobs/steps/__tests__/08_classifyTeams.test.ts
pnpm test src/jobs/steps/__tests__/09_detectBall.test.ts
pnpm test src/jobs/steps/__tests__/10_detectEvents.test.ts

# ウォッチモード
pnpm test src/jobs/steps/__tests__/ --watch
```

## テスト戦略

### モック構成
- **Firebase Admin**: Firestoreの読み書きをモック
- **Storage**: ビデオダウンロードをモック
- **FFmpeg**: フレーム抽出とプローブをモック
- **Detection Modules**: PlaceholderDetector/Trackerを使用

### テストデータ
- `services/analyzer/src/lib/testHelpers.ts`のヘルパー関数を活用
- `createTrackDoc()`, `createBallTrackDoc()`などでモックデータ生成

### テスト範囲
- **正常系**: 各Stepが正しくデータを処理・保存
- **異常系**: 必須データが欠落している場合のエラー
- **進捗**: ステータス更新と進捗コールバック
- **統合**: 前Stepの出力が次Stepの入力として使用可能

## 注意事項

1. **Firestore Mocking**: Firestore SDKのチェーンメソッドを正しくモックする必要がある
2. **非同期処理**: 全てのFirestore操作はPromiseを返す
3. **バッチ処理**: 大量データ保存時のバッチコミットを検証
4. **FFmpegバッファ**: フレーム抽出ではRGBバッファ形式を想定

## 今後の改善

- [ ] 実際のビデオファイルを使った E2E テスト
- [ ] エラーリトライロジックのテスト
- [ ] パフォーマンステスト（大量フレーム処理）
- [ ] カバレッジ 80% 以上を目標
