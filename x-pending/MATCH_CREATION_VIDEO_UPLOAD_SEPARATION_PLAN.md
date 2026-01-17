# マッチ作成と動画アップロード分離プラン

## 概要

現在、マッチ作成時に動画アップロードが必須となっている**UI フロー**を改善する：

1. **マッチ作成を動画アップロードから分離** - 動画なしでマッチを作成可能な UI に
2. **前半/後半/単体動画の個別アップロード対応** - 柔軟な動画管理
3. **設定の即時アクセス** - マッチ作成直後から設定可能な UI フローに

> **注意**: 技術的には既にマッチ Doc 作成 → 動画アップロードの順で処理されている。
> 本プランは主に**UI フローの改善**と**前後半分割対応**に焦点を当てる。

### 調査結果サマリー（2025-01-15）

| 項目                   | 現状                                     | 対応              |
| ---------------------- | ---------------------------------------- | ----------------- |
| 設定画面アクセス       | ✅ 常にアクセス可能                      | UI フローで明示化 |
| マッチ作成順序         | ✅ 動画前に Doc 作成済み                 | UI で分離表示     |
| Firestore ルール       | ✅ ワイルドカードで対応済み              | 変更不要          |
| アップロードキュー     | ⚠️ 部分実装済み                          | 統合必要          |
| 前後半フォーメーション | ✅ `analyzeFormationByHalf()` 存在       | 活用              |
| サマリー半分分割       | ✅ `narrative.firstHalf/secondHalf` 存在 | 活用              |

---

## Phase 1: スキーマ変更

### 1.1 MatchDoc スキーマ拡張

- [x] **1.1.1** `packages/shared/src/domain/match.ts` に `VideoDoc` 型を新規定義

  ```typescript
  export type VideoType = "firstHalf" | "secondHalf" | "single";

  export type VideoDoc = {
    videoId: string;
    matchId: string;
    type: VideoType;
    storagePath: string;
    durationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
    uploadedAt: string;
    analysis?: {
      status: "idle" | "queued" | "running" | "done" | "error";
      errorMessage?: string;
      lastRunAt?: string;
    };
  };
  ```

- [x] **1.1.2** `MatchDoc` の `video` フィールドを非推奨化し、`videos` フィールドを追加

  ```typescript
  export type MatchDoc = {
    // ... 既存フィールド

    /** @deprecated Use videos collection instead */
    video?: { ... };

    /** 動画サブコレクションの参照カウント（UI表示用） */
    videoCount?: number;
    videosUploaded?: {
      firstHalf?: boolean;
      secondHalf?: boolean;
      single?: boolean;
    };
  };
  ```

- [x] **1.1.3** `MatchSettings` に `videoConfiguration` を追加

  ```typescript
  export type MatchSettings = {
    // ... 既存フィールド

    /** 動画構成（前後半分割 or 単体） */
    videoConfiguration?: "split" | "single";
  };
  ```

### 1.2 Firestore コレクション設計

- [x] **1.2.1** サブコレクション構造を定義

  ```
  matches/{matchId}/
    └── videos/{videoId}  ← 新規サブコレクション
        ├── type: "firstHalf" | "secondHalf" | "single"
        ├── storagePath: string
        ├── analysis: { status, ... }
        └── ...
  ```

- [x] **1.2.2** ~~Firestore セキュリティルール更新~~ **不要**
  > 既存のワイルドカードルール `match /matches/{matchId}/{sub=**}` で対応済み
  > `infra/firebase.rules` Line 29-32

---

## Phase 2: バックエンド変更

### 2.1 Cloud Functions トリガー

- [x] **2.1.1** `functions/src/triggers/onVideoDocCreated.ts` を新規作成

  - サブコレクション `matches/{matchId}/videos/{videoId}` の作成を監視
  - 動画タイプに応じた解析ジョブを作成
  - 単体動画の場合は従来通りの解析
  - 前半/後半の場合は部分解析

- [x] **2.1.2** `functions/src/triggers/onVideoUploaded.ts` を後方互換性のために維持

  - 新しいフローへのマイグレーションロジックを追加
  - 旧形式の `video` フィールドがある場合は `videos` サブコレクションに変換

- [ ] **2.1.3** `functions/src/triggers/onMatchCreated.ts` を新規作成（オプション）
  - マッチ作成時の初期化処理
  - デフォルト設定の適用

### 2.2 ジョブタイプ拡張

- [x] **2.2.1** `functions/src/enqueue/createJob.ts` にジョブタイプを追加

  ```typescript
  export type JobType =
    | "analyze_match" // 従来の全体解析
    | "analyze_video" // 個別動画解析（新規）
    | "merge_half_analysis" // 前後半マージ（新規）
    | "recompute_stats"
    | "relabel_and_stats";
  ```

- [x] **2.2.2** `functions/src/enqueue/createJob.ts` を拡張
  - `videoId` パラメータを追加
  - 動画タイプに応じたジョブキュー設定

### 2.3 解析パイプライン拡張

- [x] **2.3.1** `services/analyzer/src/jobs/runVideoPipeline.ts` を新規作成

  - 個別動画の解析パイプライン
  - `runMatchPipeline.ts` のロジックを再利用

- [x] **2.3.2** `services/analyzer/src/lib/halfMerger.ts` を新規作成（マージロジック）

  - 前半・後半の解析結果をマージ
  - タイムスタンプの調整（後半は +45 分）
  - イベント・統計の統合

- [x] **2.3.3** `services/analyzer/src/jobs/steps/` に新ステップを追加（runVideoPipeline に統合）
  - `00_validateVideoDoc.ts` - 動画ドキュメントの検証
  - `99_mergeHalfResults.ts` - 前後半結果のマージ

### 2.4 データマージロジック

- [x] **2.4.1** `services/analyzer/src/lib/halfMerger.ts` を新規作成

  - イベントのタイムスタンプ調整
  - 統計の集計
  - クリップの統合

- [x] **2.4.2** マージ対象データの定義
  ```typescript
  // マージ対象:
  // - EventsDoc: タイムスタンプ調整して連結
  // - ClipsDoc: 後半クリップは +halfDuration
  // - StatsDoc: 前後半の数値を合算/平均
  // - TacticalAnalysisDoc: formationByHalf に分離保存
  ```

### 2.5 既存ハーフロジックの活用

> **注意**: 以下の既存実装を活用・拡張する

- [x] **2.5.1** フォーメーション分析の活用

  - 既存: `formationTracking.ts` の `analyzeFormationByHalf()`
  - 拡張: 前半/後半を別動画から取得するモード追加
  - 型: `FormationHalfComparison` は既に定義済み

- [x] **2.5.2** サマリーの前後半分割活用

  - 既存: `MatchSummaryDoc.narrative.firstHalf/secondHalf`
  - 拡張: 各動画解析時に該当ハーフのみ生成
  - マージ時に統合

- [x] **2.5.3** 45 分境界ロジックの汎用化
  - 現在: `formationTracking.ts` Line 89 でハードコード
  - 変更: `MatchSettings.matchDuration.halfDuration` から取得

---

## Phase 3: モバイルアプリ UI 変更

### 3.1 マッチ作成画面の分離

- [x] **3.1.1** `apps/mobile/app/create-match.tsx` を新規作成

  - 動画なしでマッチを作成
  - 入力項目: タイトル、日付、動画構成（split/single）、基本設定
  - チームデフォルト設定の適用

- [x] **3.1.2** `apps/mobile/app/upload.tsx` を修正
  - 既存マッチへの動画追加モードを追加
  - 新規マッチ作成 + 動画アップロードの従来フローも維持

### 3.2 マッチ詳細画面の拡張

- [x] **3.2.1** `apps/mobile/app/match/[id]/index.tsx` を修正

  - 動画未アップロード状態の表示
  - 前半/後半それぞれの解析ステータス表示
  - 動画追加ボタンの配置

- [x] **3.2.2** 動画ステータスコンポーネント作成（index.tsx 内に統合）
  ```
  apps/mobile/components/VideoStatusCard.tsx
  - 動画タイプ（前半/後半/単体）表示
  - アップロード/解析ステータス
  - 再アップロード/削除ボタン
  ```

### 3.3 動画アップロード画面の拡張

- [x] **3.3.1** `apps/mobile/app/match/[id]/upload-video.tsx` を新規作成

  - 既存マッチへの動画追加専用画面
  - 動画タイプ選択（前半/後半/単体）
  - 設定済みの `videoConfiguration` に応じた UI 制御

- [x] **3.3.2** 動画タイプセレクターコンポーネント（upload-video.tsx 内に統合）
  ```
  apps/mobile/components/VideoTypeSelector.tsx
  - split 構成: 前半 / 後半 の選択
  - single 構成: 単体のみ
  - アップロード済みタイプはグレーアウト
  ```

### 3.4 設定画面の UX 改善

> **注意**: 設定画面自体は既に常時アクセス可能（`app/match/[id]/settings.tsx`）
> UI フローの改善と追加機能のみ対応

- [x] **3.4.1** ~~設定画面の常時アクセス~~ **既に実装済み**

  > `settings.tsx` は動画・解析の有無に関わらずアクセス可能

- [x] **3.4.2** 動画未アップロード時の UI 表示改善

  - 「動画をアップロードすると解析が開始されます」メッセージ
  - 設定変更時の注記（解析前に設定を確定推奨）

- [x] **3.4.3** 設定プリセット機能（create-match.tsx で defaultSettings 使用）
  - チームデフォルト設定のロード（既存の `useDefaultSettings` を活用）
  - 過去のマッチ設定のコピー

---

## Phase 4: フック・状態管理

### 4.1 マッチフックの拡張

- [x] **4.1.1** `apps/mobile/lib/hooks/useMatches.ts` を拡張

  ```typescript
  // 新規関数
  createMatchWithoutVideo(data: CreateMatchData): Promise<string>
  addVideoToMatch(matchId: string, videoUri: string, type: VideoType): Promise<void>
  getMatchVideos(matchId: string): Promise<VideoDoc[]>
  ```

  > **注意**: 既存の `createMatch()` は既に動画なしで呼び出し可能
  > deviceId は自動付与される（`useMatches.ts` Line 45-47）

- [x] **4.1.2** `apps/mobile/lib/hooks/useMatchVideos.ts` を新規作成
  - サブコレクション `videos` のリアルタイム購読
  - 各動画の解析ステータス監視

### 4.2 アップロード処理の拡張

- [x] **4.2.1** `apps/mobile/lib/firebase/storage.ts` を拡張

  ```typescript
  // 新規関数
  uploadVideoToMatch(
    matchId: string,
    videoId: string,
    fileUri: string,
    type: VideoType,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult>
  ```

  - ストレージパス: `matches/{matchId}/videos/{type}.mp4`

- [x] **4.2.2** 動画メタデータ抽出の改善
  - FFmpeg/expo-av での動画情報取得
  - サムネイル生成

### 4.3 アップロードキュー統合

> **注意**: `apps/mobile/lib/upload/queue.ts` に既存のキューシステムあり

- [x] **4.3.1** 既存キューシステムとの統合

  - `QueuedUpload` 型に `videoType: VideoType` を追加
  - `useUploadQueue` フックの拡張
  - Firebase `uploadVideo` との接続（現在プレースホルダー）

- [x] **4.3.2** オフライン対応（QueuedUpload 型に videoType 追加済み）
  - 前半/後半それぞれのキュー管理
  - ネットワーク復帰時の自動再開

### 4.4 部分結果表示

- [x] **4.4.1** 前半のみ解析完了時の UI（index.tsx に実装）

  - 前半の統計・イベントを表示
  - 「後半待ち」バナー表示
  - formationByHalf.firstHalf のみ表示

- [x] **4.4.2** 結果マージ後の UI 更新
  - マージ完了通知
  - 統合結果への自動切り替え

---

## Phase 5: Web アプリ対応（オプション）

### 5.1 Web UI の更新

- [ ] **5.1.1** `apps/web/` に該当する画面があれば同様の変更を適用
- [ ] **5.1.2** ダッシュボードでの動画ステータス表示
  > **スキップ**

---

## Phase 6: マイグレーション

> **スキップ**: 既存データを削除するためマイグレーション不要。
> 後方互換トリガー（`onVideoUploaded.ts`）で旧クライアントからのアップロードは自動変換される。

### 6.1 既存データの移行

- [x] **6.1.1** ~~マイグレーションスクリプト作成~~ **スキップ**（既存データ削除のため）

  ```
  scripts/migrate-video-to-subcollection.ts
  - 既存の match.video → matches/{matchId}/videos/{videoId}
  - type: "single" として移行
  - analysis status の引き継ぎ
  - videosUploaded: { single: true } を親Docに追加
  ```

- [x] **6.1.2** ~~マイグレーション実行計画~~ **スキップ**

- [x] **6.1.3** ~~マイグレーション検証~~ **スキップ**

### 6.2 後方互換性の維持

- [x] **6.2.1** 読み取り互換性

  - `match.video` フィールドの読み取りは継続サポート
  - 新しいクライアントは `videos` サブコレクションを優先
  - フォールバックロジック: videos なければ video を参照

- [x] **6.2.2** 書き込み互換性（`onVideoUploaded.ts` で実装済み）
  - 旧クライアントが `match.video` に書き込んだ場合
  - `onVideoUploaded` トリガーで自動的に `videos` に変換
  - 重複防止ロジック

### 6.3 ストレージパス移行

- [x] **6.3.1** 新ストレージパス設計（`storage.ts` で実装済み）

  ```
  旧: matches/{matchId}/video.mp4
  新: matches/{matchId}/videos/{firstHalf|secondHalf|single}.mp4
  ```

- [x] **6.3.2** 既存ストレージの取り扱い **スキップ**（既存データ削除のため）

---

## Phase 7: テスト

### 7.1 ユニットテスト

- [x] **7.1.1** スキーマバリデーションテスト（`halfMerger.test.ts`）
- [x] **7.1.2** マージロジックテスト（`halfMerger.test.ts`）
- [x] **7.1.3** タイムスタンプ調整テスト（`halfMerger.test.ts`）

### 7.2 統合テスト

- [x] **7.2.1** 動画なしマッチ作成フロー（`videoPipeline.integration.test.ts`）
- [x] **7.2.2** 前半のみアップロード → 解析 → 後半追加 → マージ（`videoPipeline.integration.test.ts`）
- [x] **7.2.3** 単体動画アップロード（従来フロー）（`videoPipeline.integration.test.ts`）
- [x] **7.2.4** 設定変更 → 再解析トリガー（既存テストでカバー）

### 7.3 E2E テスト

- [x] **7.3.1** ~~モバイルアプリでの完全フロー~~ 手動テストで確認
- [x] **7.3.2** ~~異常系（アップロード中断、解析エラー等）~~ 統合テストでカバー

---

## Phase 8: ドキュメント

- [x] **8.1** API ドキュメント更新（`VIDEO_SPLIT_UPLOAD.md`）
- [x] **8.2** ユーザーガイド作成（`VIDEO_SPLIT_UPLOAD.md`）
- [x] **8.3** ~~マイグレーションガイド~~ **スキップ**（既存データ削除のため）

---

## 技術的考慮事項

### パフォーマンス

- サブコレクションクエリのインデックス設定
- 動画アップロードの並列処理対応
- 解析結果のキャッシュ戦略
- Context Caching の動画別管理

### コスト

- Gemini API 呼び出しは動画ごとに発生
- 前後半分割の場合、2 回の解析
- Context Caching の適用で軽減可能

### エラーハンドリング

- 前半のみ解析完了時の部分結果表示
- 後半アップロード失敗時のリカバリー
- マージ処理失敗時のフォールバック
- 動画タイプ重複アップロード防止

### エッジケース対応

| ケース                            | 対応                                    |
| --------------------------------- | --------------------------------------- |
| 前半のみアップロード → 長期間放置 | 前半結果のみ表示、マージ不要            |
| 後半を先にアップロード            | 許可（UI 警告表示）                     |
| 単体 → 分割に変更                 | 単体を削除 → 分割アップロード           |
| 分割 → 単体に変更                 | 前後半を削除 → 単体アップロード         |
| 解析中に動画削除                  | ジョブキャンセル、ステータスを error に |
| 同じタイプを再アップロード        | 上書き確認ダイアログ                    |

---

## 依存関係

```
Phase 1 (スキーマ)
    ↓
Phase 2 (バックエンド) ← Phase 6.2 (後方互換性)
    ↓
Phase 3 (モバイル UI) + Phase 4 (フック)
    ↓
Phase 6.1 (マイグレーション)
    ↓
Phase 7 (テスト)
    ↓
Phase 8 (ドキュメント)
```

---

## 完了条件チェックリスト

### 基本機能

- [x] 動画なしでマッチを作成できる（`create-match.tsx`）
- [x] マッチ作成直後に設定画面にアクセスできる（既存実装）
- [x] 前半動画を個別にアップロードできる（`upload-video.tsx`）
- [x] 後半動画を個別にアップロードできる（`upload-video.tsx`）
- [x] 単体動画をアップロードできる（従来フロー互換）（`upload-video.tsx` + 後方互換性トリガー）

### 解析・表示

- [x] 前半・後半それぞれの解析ステータスが表示される（`index.tsx` VideoStatusCard）
- [x] 前半のみ解析完了時に部分結果が表示される（`index.tsx` 後半待ちバナー）
- [x] 両方の解析完了後に統合結果が表示される（`onVideoAnalysisCompleted.ts` → マージジョブ）
- [x] formationByHalf に前後半のフォーメーションが保存される（`halfMerger.ts`）
- [x] 設定変更で再解析がトリガーされる（既存 `onSettingsChanged.ts`）

### 後方互換性

- [x] 既存のマッチデータが正常に動作する（`onVideoUploaded.ts` 後方互換性）
- [x] 旧クライアントからのアップロードが動作する（`onVideoUploaded.ts` マイグレーションロジック）
- [x] ~~マイグレーション済みデータが正常表示される~~ **スキップ**（既存データ削除のため）

### UX

- [x] オフライン時にキューに追加される（`useUploadQueue.ts`）
- [x] アップロード進捗が表示される（`upload-video.tsx`）

---

## 参考: 既存実装の活用ポイント

| ファイル                | 活用ポイント                                          |
| ----------------------- | ----------------------------------------------------- |
| `formationTracking.ts`  | `analyzeFormationByHalf()`, `FormationHalfComparison` |
| `tactical.ts`           | `formationByHalf` フィールド定義                      |
| `match.ts`              | `MatchSettings.matchDuration.halfDuration`            |
| `queue.ts`              | `QueuedUpload` キューシステム                         |
| `useDefaultSettings.ts` | チームデフォルト設定                                  |
| `onVideoUploaded.ts`    | トリガーパターン                                      |
| `createJob.ts`          | ジョブ作成パターン                                    |
