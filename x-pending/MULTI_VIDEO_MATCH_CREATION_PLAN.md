# マッチ作成・複数動画アップロード機能実装プラン

## 概要

動画アップロードなしでマッチを作成可能にし、前半・後半・単体動画を個別にアップロードできるようにする。
設定は解析完了を待たずにマッチ作成直後から利用可能にする。

---

## Phase 1: MatchDoc スキーマ拡張

### 1.1 VideoDoc 型定義の追加
- [ ] `packages/shared/src/domain/video.ts` を新規作成
  - [ ] `VideoDoc` 型を定義:
    ```typescript
    export type VideoDoc = {
      videoId: string;
      matchId: string;
      half: "first" | "second" | "single"; // 前半/後半/単体
      storagePath: string;
      durationSec?: number;
      width?: number;
      height?: number;
      fps?: number;
      uploadedAt?: string;
      metaVersion?: string;
      geminiUpload?: {
        version?: string;
        cacheId?: string;
        fileUri?: string;
        modelId?: string;
        expiresAt?: string;
        createdAt?: string;
      };
      analysis?: {
        status: "idle" | "queued" | "running" | "done" | "error";
        lastRunAt?: string;
        errorMessage?: string;
      };
    };
    ```
  - [ ] `HalfType` 型をエクスポート: `"first" | "second" | "single"`

### 1.2 MatchDoc 型の更新
- [ ] `packages/shared/src/domain/match.ts` を更新
  - [ ] `videos?: VideoDoc[]` フィールドを追加（既存の `video?` は後方互換のため残す）
  - [ ] `videoMode?: "single" | "split"` フィールドを追加
    - `single`: 従来の単一動画モード
    - `split`: 前半・後半分割モード
  - [ ] `analysis.status` に `"partial_done"` を追加（片方だけ完了時）

### 1.3 ClipDoc 型の更新
- [ ] `packages/shared/src/domain/clip.ts` を更新
  - [ ] `videoId?: string` フィールドを追加（どの動画から生成されたか）
  - [ ] `half?: HalfType` フィールドを追加

### 1.4 EventDoc 関連型の更新
- [ ] 各イベント型に `videoId?: string` と `half?: HalfType` を追加
  - [ ] `passEvent.ts`
  - [ ] `carryEvent.ts`
  - [ ] `shotEvent.ts`
  - [ ] `turnoverEvent.ts`
  - [ ] `setPieceEvent.ts`
  - [ ] `otherEvent.ts`

### 1.5 SegmentDoc の更新
- [ ] `packages/shared/src/domain/segment.ts` を更新
  - [ ] `videoId?: string` フィールドを追加
  - [ ] `half?: HalfType` フィールドを追加

---

## Phase 2: Firestore 構造の変更

### 2.1 Videos サブコレクション設計
- [ ] サブコレクションパス: `matches/{matchId}/videos/{videoId}`
- [ ] Firestore ルール更新 (`firestore.rules`)
  - [ ] `videos` サブコレクションへの読み書きルールを追加
  - [ ] 認証ユーザー (ownerUid/deviceId) のみアクセス可能に

### 2.2 マイグレーション計画
- [ ] 既存マッチの `video` フィールドを `videos[0]` に変換するスクリプト作成
  - [ ] `scripts/migrate_video_to_videos.ts` を新規作成
  - [ ] `half: "single"` をデフォルト設定
  - [ ] Dry-run モードで事前確認

---

## Phase 3: Firebase Functions 更新

### 3.1 onVideoUploaded トリガーの更新
- [ ] `functions/src/triggers/onVideoUploaded.ts` を更新
  - [ ] 新しい `videos` サブコレクションの変更を監視
  - [ ] `half` に応じて適切なジョブタイプを作成
    - `"first"` → `analyze_first_half`
    - `"second"` → `analyze_second_half`
    - `"single"` → `analyze_match`（既存）

### 3.2 新しいジョブタイプの追加
- [ ] `functions/src/enqueue/createJob.ts` を更新
  - [ ] `JobType` に追加:
    - `"analyze_first_half"`
    - `"analyze_second_half"`
    - `"merge_halves"` （両方完了後に統合）
  - [ ] `videoId` パラメータを受け取れるように拡張

### 3.3 onAllVideosAnalyzed トリガー新規作成
- [ ] `functions/src/triggers/onAllVideosAnalyzed.ts` を新規作成
  - [ ] 両方の動画解析完了時に自動で統合ジョブを発火
  - [ ] 前半と後半の結果をマージ

---

## Phase 4: Analyzer Service の更新

### 4.1 パイプラインの複数動画対応
- [ ] `services/analyzer/src/jobs/runMatchPipeline.ts` を更新
  - [ ] `videoId` パラメータを受け取り、特定の動画のみ処理
  - [ ] 出力データに `videoId` と `half` を付与

### 4.2 Step 01: メタデータ抽出の更新
- [ ] `services/analyzer/src/jobs/steps/01_extractMeta.ts` を更新
  - [ ] `videoId` を受け取り、特定の動画メタデータを抽出
  - [ ] 結果を `videos/{videoId}` に保存

### 4.3 Step 03: Gemini アップロードの更新
- [ ] `services/analyzer/src/jobs/steps/03_uploadVideoToGemini.ts` を更新
  - [ ] `videoId` を受け取り、特定の動画をアップロード
  - [ ] Context Cache の ID を動画ごとに管理

### 4.4 Step 03: クリップ抽出の更新
- [ ] `services/analyzer/src/jobs/steps/03_extractClips.ts` を更新
  - [ ] クリップに `videoId` と `half` を付与
  - [ ] ストレージパス: `matches/{matchId}/clips/{videoId}/{clipId}.mp4`

### 4.5 新規 Step: 結果統合
- [ ] `services/analyzer/src/jobs/steps/11_mergeHalves.ts` を新規作成
  - [ ] 前半・後半のイベントをタイムスタンプ調整してマージ
    - 後半イベントのタイムスタンプ = 前半終了時刻 + 後半内タイムスタンプ
  - [ ] セグメントの連結
  - [ ] 統計の統合
  - [ ] サマリーの統合（firstHalf + secondHalf narrative）

### 4.6 タイムスタンプ調整ロジック
- [ ] `services/analyzer/src/lib/timestampAdjuster.ts` を新規作成
  - [ ] 後半イベントのタイムスタンプを試合全体の時間軸に変換
  - [ ] ハーフタイム（休憩時間）の考慮オプション
  - [ ] `matchDuration.halfDuration` に基づく調整

---

## Phase 5: Mobile アプリ UI 更新

### 5.1 マッチ作成フローの分離
- [ ] `apps/mobile/app/create-match.tsx` を新規作成
  - [ ] 動画なしでマッチを作成
  - [ ] 入力フィールド:
    - タイトル（任意）
    - 日付（任意）
    - 動画モード選択: 「単一動画」/「前半・後半別」
  - [ ] 作成後は設定画面またはダッシュボードへ遷移

### 5.2 動画アップロード画面の更新
- [ ] `apps/mobile/app/upload.tsx` を更新
  - [ ] マッチ選択機能を追加（既存マッチへの追加アップロード）
  - [ ] または `apps/mobile/app/match/[id]/upload-video.tsx` を新規作成
  - [ ] 動画モードに応じた UI 表示:
    - `single`: 「動画をアップロード」ボタン
    - `split`: 「前半をアップロード」「後半をアップロード」2つのボタン
  - [ ] アップロード状態の表示（前半完了/後半未完了など）

### 5.3 設定画面の即座利用可能化
- [ ] `apps/mobile/app/match/[id]/settings.tsx` を更新
  - [ ] 解析完了を待たずにアクセス可能に
  - [ ] 動画未アップロード状態でも設定変更可能
  - [ ] 設定保存時の処理:
    - 動画なし → Firestore 保存のみ
    - 動画あり & 解析前 → Firestore 保存（解析開始時に設定を使用）
    - 動画あり & 解析後 → Firestore 保存 + relabel/recompute トリガー

### 5.4 マッチダッシュボードの更新
- [ ] `apps/mobile/app/match/[id]/index.tsx` を更新
  - [ ] 動画状態の表示:
    - 未アップロード: 「動画をアップロードしてください」
    - 前半のみ: 「前半: 完了, 後半: 未アップロード」
    - 両方完了: 「解析完了」
  - [ ] 設定ボタンを常に表示（解析状態に関わらず）

### 5.5 マッチ一覧画面の更新
- [ ] `apps/mobile/app/index.tsx` を更新
  - [ ] 動画なしマッチも表示
  - [ ] 状態表示バッジ:
    - 「動画なし」
    - 「前半のみ」
    - 「解析中」
    - 「完了」

---

## Phase 6: ナビゲーションフローの再設計

### 6.1 新しいフロー図
```
[ホーム画面]
    ↓
[+ 新規マッチ作成] ← 動画不要で作成
    ↓
[マッチダッシュボード]
    ├── [設定] ← 即座に利用可能
    ├── [動画をアップロード]
    │       ├── (単一モード) → 1ファイル選択
    │       └── (分割モード) → 前半/後半 選択
    └── [解析結果] ← 動画アップ後に表示
```

### 6.2 Expo Router 設定更新
- [ ] `apps/mobile/app/_layout.tsx` を更新（必要に応じて）
- [ ] 新しい画面の追加:
  - [ ] `/create-match` - マッチ作成
  - [ ] `/match/[id]/upload-video` - 動画アップロード

---

## Phase 7: デフォルト設定の統合

### 7.1 マッチ作成時のデフォルト設定適用
- [ ] `apps/mobile/lib/hooks/useDefaultSettings.ts` を更新
  - [ ] マッチ作成時にデフォルト設定を自動適用
  - [ ] `createMatchWithDefaults()` 関数を追加

### 7.2 設定継承の明確化
- [ ] 設定画面で「デフォルト設定を適用」ボタンを追加
- [ ] マッチ固有設定とデフォルト設定の区別を UI で表示

---

## Phase 8: テスト実装

### 8.1 スキーマテスト
- [ ] `packages/shared/src/domain/__tests__/video.test.ts` を新規作成
- [ ] `VideoDoc` のバリデーションテスト
- [ ] `HalfType` の型チェックテスト

### 8.2 Analyzer テスト
- [ ] `services/analyzer/src/jobs/steps/__tests__/11_mergeHalves.test.ts` を新規作成
- [ ] タイムスタンプ調整ロジックのテスト
- [ ] イベント・セグメントのマージテスト

### 8.3 Functions テスト
- [ ] `functions/src/triggers/__tests__/onVideoUploaded.test.ts` を更新
- [ ] 複数動画トリガーのテスト

### 8.4 E2E テスト
- [ ] 前半のみアップロード → 解析 → 後半アップロード → マージのフローテスト

---

## Phase 9: 後方互換性対応

### 9.1 既存マッチの対応
- [ ] `videos` フィールドがないマッチは従来の `video` フィールドを参照
- [ ] 読み込みロジックで両方をチェック:
  ```typescript
  const videos = match.videos ??
    (match.video ? [{ ...match.video, half: "single", videoId: "default" }] : []);
  ```

### 9.2 段階的移行
- [ ] 新規マッチは `videos[]` を使用
- [ ] 既存マッチは再アップロード時に自動移行

---

## Phase 10: ドキュメント更新

### 10.1 API ドキュメント
- [ ] 新しいスキーマのドキュメント作成
- [ ] マイグレーションガイド

### 10.2 ユーザーガイド
- [ ] 前半・後半分割アップロードの使い方

---

## 依存関係マップ

```
Phase 1 (スキーマ)
    ↓
Phase 2 (Firestore)
    ↓
Phase 3 (Functions) ← Phase 4 (Analyzer) ← 並行可能
    ↓
Phase 5 (Mobile UI)
    ↓
Phase 6 (ナビゲーション)
    ↓
Phase 7 (デフォルト設定)
    ↓
Phase 8 (テスト)
    ↓
Phase 9 (後方互換)
    ↓
Phase 10 (ドキュメント)
```

---

## 優先度と推奨実装順序

### 高優先度（コア機能）
1. Phase 1.1-1.2: VideoDoc と MatchDoc のスキーマ定義
2. Phase 5.1: 動画なしマッチ作成 UI
3. Phase 5.3: 設定画面の即座利用可能化
4. Phase 5.4: ダッシュボード更新

### 中優先度（分割アップロード機能）
5. Phase 2.1: Videos サブコレクション
6. Phase 3.1-3.2: Firebase トリガー更新
7. Phase 4.1-4.4: Analyzer パイプライン更新
8. Phase 5.2: 動画アップロード画面更新

### 低優先度（統合・仕上げ）
9. Phase 4.5-4.6: 結果統合機能
10. Phase 3.3: 自動統合トリガー
11. Phase 8: テスト
12. Phase 9-10: 後方互換・ドキュメント

---

## 技術的な注意点

1. **タイムスタンプの整合性**: 後半動画のタイムスタンプは0からスタートするため、マージ時に前半終了時刻を加算する必要がある

2. **Gemini Context Cache**: 動画ごとに別々のキャッシュIDを管理。両方の動画を同時にキャッシュするとコストが増加する可能性

3. **ストレージパス**: `matches/{matchId}/videos/{videoId}/video.mp4` に変更して複数動画対応

4. **解析の独立性**: 前半と後半の解析は完全に独立して実行可能。どちらか一方だけでも解析結果を表示可能

5. **UI 状態管理**: 動画ごとの解析状態を個別に管理し、ダッシュボードで適切に表示

---

## 完了チェックリスト

このプランの全フェーズ完了後に確認:

- [ ] 動画なしでマッチ作成が可能
- [ ] マッチ作成直後に設定画面にアクセス可能
- [ ] 前半・後半を別々にアップロード可能
- [ ] 単一動画モードも引き続き動作
- [ ] 既存マッチが正常に動作（後方互換）
- [ ] 前半のみ・後半のみでも解析結果が表示される
- [ ] 両方の動画がアップロードされると自動で統合される
- [ ] クリップにどの動画からのものか情報が含まれる
- [ ] イベントのタイムスタンプが試合全体で一貫している
