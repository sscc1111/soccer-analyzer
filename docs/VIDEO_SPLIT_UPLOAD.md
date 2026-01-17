# 動画分割アップロード機能

## 概要

マッチ作成と動画アップロードを分離し、前半・後半の動画を個別にアップロードできる機能です。

## 機能一覧

### 1. マッチ作成（動画なし）

動画をアップロードせずにマッチを作成できます。

```typescript
// create-match.tsx
const match = await createMatch({
  title: "練習試合 vs チームB",
  date: "2025-01-15",
  settings: {
    gameFormat: "eight",
    videoConfiguration: "split", // "split" または "single"
  },
});
```

### 2. 動画構成タイプ

| 構成 | 説明 | 必要な動画 |
|------|------|-----------|
| `split` | 前後半分割 | `firstHalf` + `secondHalf` |
| `single` | 単体動画 | `single` |

### 3. 動画アップロード

既存のマッチに動画を追加します：

```typescript
// upload-video.tsx
await uploadVideoToMatch(matchId, fileUri, "firstHalf");
// または
await uploadVideoToMatch(matchId, fileUri, "secondHalf");
// または
await uploadVideoToMatch(matchId, fileUri, "single");
```

## データ構造

### Firestore コレクション

```
matches/{matchId}
  ├── videoCount: number
  ├── videosUploaded: { firstHalf?: boolean, secondHalf?: boolean, single?: boolean }
  ├── settings: { videoConfiguration: "split" | "single", ... }
  └── videos/{videoId}  ← サブコレクション
        ├── videoId: string
        ├── matchId: string
        ├── type: "firstHalf" | "secondHalf" | "single"
        ├── storagePath: string
        ├── durationSec?: number
        ├── width?: number
        ├── height?: number
        ├── fps?: number
        ├── uploadedAt: string
        └── analysis: { status, errorMessage?, lastRunAt?, progress? }
```

### Storage パス

```
matches/{matchId}/videos/firstHalf.mp4
matches/{matchId}/videos/secondHalf.mp4
matches/{matchId}/videos/single.mp4
```

## 解析フロー

### 分割動画の場合

```
1. 前半動画アップロード
   └── onVideoDocCreated トリガー → analyze_video ジョブ作成
   └── 前半解析実行 → video.analysis.status = "done"

2. 後半動画アップロード
   └── onVideoDocCreated トリガー → analyze_video ジョブ作成
   └── 後半解析実行 → video.analysis.status = "done"

3. 両方完了時
   └── onVideoAnalysisCompleted トリガー
   └── merge_half_analysis ジョブ作成
   └── 前後半結果をマージ
       - タイムスタンプ調整（後半 + halfDuration）
       - イベント統合
       - 統計集計
       - formationByHalf 作成
```

### 単体動画の場合

```
1. 単体動画アップロード
   └── onVideoDocCreated トリガー → analyze_video ジョブ作成
   └── 解析実行 → video.analysis.status = "done"
   └── match.analysis.status = "done"（マージ不要）
```

## API リファレンス

### ジョブタイプ

| タイプ | 説明 |
|--------|------|
| `analyze_match` | 従来のマッチレベル解析（後方互換性用） |
| `analyze_video` | 動画レベル解析（新規） |
| `merge_half_analysis` | 前後半マージ（新規） |

### Cloud Functions トリガー

| トリガー | パス | 説明 |
|----------|------|------|
| `onVideoDocCreated` | `matches/{matchId}/videos/{videoId}` | 動画追加時 |
| `onVideoAnalysisCompleted` | `matches/{matchId}/videos/{videoId}` | 解析完了時 |
| `onVideoUploaded` | `matches/{matchId}` | 後方互換性用（レガシー） |

### フック

```typescript
// 動画サブコレクション購読
const { videos, loading, error } = useMatchVideos(matchId);

// アップロードキュー
const { queue, addUpload, cancelUpload } = useUploadQueue();
await addUpload(matchId, videoUri, mode, "firstHalf");
```

## タイムスタンプ調整

後半動画の解析結果は、マージ時に `halfDuration` 分のオフセットが加算されます：

```typescript
// デフォルト: 45分 = 2700秒
// 8人制20分ハーフ: 1200秒
// 設定: matchDuration.halfDuration

// 調整例
secondHalfEvent.timestamp += halfDuration;
secondHalfClip.t0 += halfDuration;
secondHalfClip.t1 += halfDuration;
```

## UI 状態表示

### マッチ詳細画面

| 状態 | 表示 |
|------|------|
| 動画未アップロード | 「動画をアップロードして解析を開始」 |
| 前半のみ完了 | 「後半動画を追加して完全な解析結果を取得」 |
| 両方完了（マージ中） | 「解析結果を統合中...」 |
| 解析完了 | 通常の結果表示 |
| エラー | エラーメッセージ + 再試行ボタン |

## 後方互換性

### レガシーアップロード対応

旧クライアントが `match.video` フィールドに書き込んだ場合：

1. `onVideoUploaded` トリガーが検知
2. `videos/single` サブコレクションドキュメントを作成
3. `onVideoDocCreated` トリガーで通常のフローに移行

### 既存データの扱い

- 既存の `match.video` フィールドは読み取り専用で残存
- 新規アップロードはすべてサブコレクション経由
- マイグレーション不要（既存データ削除のため）

## テスト

```bash
# ユニットテスト
pnpm test -- halfMerger

# 統合テスト
pnpm test -- videoPipeline
```

## トラブルシューティング

### Q: 前半のみアップロードした場合の解析結果は？

A: 前半のみでも完全な解析結果が得られます。統計、イベント、フォーメーションなど全ての項目が含まれます。後半を追加すると、結果がマージされて試合全体の分析になります。

### Q: 後半を先にアップロードできる？

A: 可能です。ただし、マージは両方の解析が完了してから実行されます。

### Q: 動画タイプを変更したい場合は？

A: 既存の動画を削除してから、新しいタイプでアップロードしてください。
