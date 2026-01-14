# ハイブリッド 4-Call パイプライン実装計画

## 概要

現在の2つのアプローチの問題点を解決するハイブリッドアーキテクチャを実装する。

| アプローチ | API呼び出し | 問題 |
|-----------|------------|------|
| 統合2-call | 2回 | プロンプトが複雑すぎて浅い分析（60秒動画で segments:4, events:4, scenes:1） |
| レガシー20+ | 20-30回 | 過剰、高コスト、遅い、コンテキストキャッシュ無効化リスク |
| **ハイブリッド4-call** | **4-5回** | **バランス最適、各Callに特化したプロンプト** |

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  03_uploadVideoToGemini (既存)                                   │
│  ・Context Cache作成 (TTL: 30分〜3時間、動画長に応じて動的)       │
│  ・match.geminiUpload.{cacheId, fileUri, expiresAt} に保存       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Call 1: セグメント + イベント検出 (Video, Cache使用)             │
│  ・動画をセグメント分割 (active_play, stoppage, set_piece等)      │
│  ・パス/シュート/キャリー/ターンオーバー/セットピース検出         │
│  ・Output: segments[], passEvents[], shotEvents[] 等              │
│  ・温度: 0.2 | 出力トークン: 16K-24K | タイムアウト: 8分          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Call 2: シーン + 選手識別 (Video, Cache使用)                     │
│  ・Call 1の結果をコンテキストとして渡す                           │
│  ・重要シーン抽出 (goal, shot, chance, turnover等)                │
│  ・チームカラー、背番号、選手役割を識別                           │
│  ・Output: scenes[], players{}, teams{}                           │
│  ・温度: 0.2 | 出力トークン: 8K-12K | タイムアウト: 5分           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Call 3: クリップラベリング (Video, Cache使用, バッチ)            │
│  ・scenes[].suggestedClipからクリップ範囲を決定                   │
│  ・既存の labelClipBatchWithGemini() を使用                       │
│  ・タイトル/サマリー/コーチングTips生成                           │
│  ・Output: clips[].gemini.{label, title, summary, coachTips}      │
│  ・温度: 0.1 | 出力トークン: 4K | タイムアウト: 3分/バッチ        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Call 4: 戦術分析 + サマリー (Text only, Video不要)               │
│  ・Call 1-3の結果をテキストで渡す                                 │
│  ・フォーメーション、テンポ、攻撃/守備パターン分析                │
│  ・試合サマリー（ヘッドライン、ナラティブ、キーモーメント）       │
│  ・Output: tactical{}, summary{}                                  │
│  ・温度: 0.3 | 出力トークン: 8K | タイムアウト: 2分               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 実装タスク

### Phase 1: 環境フラグと基盤 ✅

- [x] **1.1** `USE_HYBRID_PIPELINE` 環境変数を追加
  - **ファイル**: `cloudbuild.yaml`
  - **変更内容**:
    ```yaml
    '--set-env-vars=...,USE_HYBRID_PIPELINE=true,USE_CONSOLIDATED_ANALYSIS=false'
    ```

- [x] **1.2** パイプラインモード判定関数を追加
  - **ファイル**: `services/analyzer/src/jobs/runMatchPipeline.ts`
  - **追加コード**:
    ```typescript
    function isHybridPipelineEnabled(): boolean {
      return process.env.USE_HYBRID_PIPELINE === "true";
    }
    ```
  - **既存関数との関係**:
    - `isConsolidatedAnalysisEnabled()`: 2-call統合モード
    - `isMultipassDetectionEnabled()`: レガシーマルチパス
    - `isHybridPipelineEnabled()`: 新規4-callハイブリッド

- [x] **1.3** STEP_WEIGHTS にハイブリッドステップを追加 (+ AnalysisStep型とANALYSIS_STEP_INFO更新)
  - **ファイル**: `services/analyzer/src/jobs/runMatchPipeline.ts`
  - **追加するウェイト**:
    ```typescript
    const STEP_WEIGHTS: Record<AnalysisStep, number> = {
      // 共通ステップ (既存)
      extract_meta: 5,
      detect_shots: 5,
      upload_video_to_gemini: 5,
      extract_clips: 5,

      // ハイブリッド4-callステップ (新規)
      segment_and_events: 25,      // Call 1: 最も重い処理
      scenes_and_players: 20,      // Call 2: 中程度
      label_clips_hybrid: 15,      // Call 3: バッチ処理
      summary_and_tactics: 15,     // Call 4: テキストのみ

      // compute_stats はハイブリッドでも実行
      compute_stats: 5,

      // 既存ステップ (変更なし)
      // ...
    };
    ```

---

### Phase 2: Call 1 - セグメント + イベント検出 ✅

#### 2.1 プロンプト作成

- [x] **2.1.1** プロンプトファイル作成: `segment_and_events_v1.json`
  - **パス**: `services/analyzer/src/gemini/prompts/segment_and_events_v1.json`
  - **ベース**:
    - `video_segmentation_v3.json` のセグメント部分
    - `event_detection_v3.json` のイベント検出部分
  - **プロンプト構造**:
    ```json
    {
      "version": "v1",
      "task": "Video segmentation and event detection",
      "instructions": "動画を時系列でセグメント分割し、各セグメント内のイベントを検出...",
      "examples": [
        {
          "scenario": "ゴールシーンを含むセグメント",
          "output": { "segments": [...], "events": [...] }
        }
      ],
      "edge_cases": {
        "cases": [
          { "scenario": "リプレイ映像", "guidance": "segmentとしてreplayを記録、eventsは検出しない" },
          { "scenario": "画質不良", "guidance": "confidence低め、qualityIssuesに記載" }
        ]
      },
      "output_schema": {
        "metadata": {...},
        "segments": [...],
        "events": [...]
      }
    }
    ```

- [x] **2.1.2** プロンプトの品質チェックリスト
  - [x] セグメントタイプ5種: active_play, stoppage, set_piece, goal_moment, replay
  - [x] イベントタイプ5種: pass, carry, turnover, shot, setPiece
  - [x] importance/confidenceの基準が明確
  - [x] シュート優先検出（confidence 0.3以上で報告）の指示
  - [x] 例が3つ以上、エッジケースが5つ以上

#### 2.2 スキーマ定義

- [x] **2.2.1** Zodスキーマ作成: `segmentAndEvents.ts`
  - **パス**: `services/analyzer/src/gemini/schemas/segmentAndEvents.ts`
  - **再利用するスキーマ** (`comprehensiveAnalysis.ts`から):
    - `VideoSegmentSchema`
    - `EventSchema`
    - `AnalysisMetadataSchema`
    - `TeamSchema`, `ZoneSchema`
  - **新規定義**:
    ```typescript
    import { z } from "zod";
    import {
      VideoSegmentSchema,
      EventSchema,
      AnalysisMetadataSchema,
    } from "./comprehensiveAnalysis";

    export const SegmentAndEventsResponseSchema = z.object({
      metadata: AnalysisMetadataSchema,
      segments: z.array(VideoSegmentSchema),
      events: z.array(EventSchema),
    });

    export type SegmentAndEventsResponse = z.infer<typeof SegmentAndEventsResponseSchema>;

    // イベントを型別に分離するヘルパー
    export function categorizeEvents(events: z.infer<typeof EventSchema>[]) {
      return {
        passEvents: events.filter(e => e.type === "pass"),
        carryEvents: events.filter(e => e.type === "carry"),
        turnoverEvents: events.filter(e => e.type === "turnover"),
        shotEvents: events.filter(e => e.type === "shot"),
        setPieceEvents: events.filter(e => e.type === "setPiece"),
      };
    }
    ```

- [x] **2.2.2** index.ts にエクスポート追加 (スキーマファイル内でエクスポート完了)
  - **ファイル**: `services/analyzer/src/gemini/schemas/index.ts`
  - **追加**: `export * from "./segmentAndEvents";`

#### 2.3 Gemini クライアント

- [x] **2.3.1** クライアント作成: `segmentAndEvents.ts`
  - **パス**: `services/analyzer/src/gemini/segmentAndEvents.ts`
  - **実装内容**:
    ```typescript
    import * as fs from "fs/promises";
    import * as path from "path";
    import { callGeminiApiWithCache, generateContent } from "./gemini3Client";
    import { SegmentAndEventsResponseSchema, type SegmentAndEventsResponse } from "./schemas";
    import { parseJsonFromGemini } from "../lib/json";
    import { withRetry } from "../lib/retry";
    import { ValidationError } from "../lib/errors";
    import type { CostTrackingContext } from "./costTracker";

    export type SegmentAndEventsOptions = {
      projectId: string;
      modelId: string;
      fileUri: string;
      cacheId?: string;      // Context Cache ID (optional)
      durationSec?: number;
      matchId: string;
      costContext?: CostTrackingContext;
    };

    export type SegmentAndEventsResult = {
      response: SegmentAndEventsResponse;
      rawResponse: string;
      tokenCount?: number;
    };

    async function loadSegmentAndEventsPrompt(): Promise<string> {
      const promptPath = path.join(__dirname, "prompts", "segment_and_events_v1.json");
      const content = await fs.readFile(promptPath, "utf-8");
      const prompt = JSON.parse(content);
      // examples, edge_casesを含めたフルプロンプト構築
      // (既存のloadComprehensiveAnalysisPrompt()と同様のパターン)
      return buildFullPrompt(prompt);
    }

    export async function callSegmentAndEvents(
      options: SegmentAndEventsOptions
    ): Promise<SegmentAndEventsResult> {
      const { projectId, modelId, fileUri, cacheId, durationSec, matchId, costContext } = options;

      const promptText = await loadSegmentAndEventsPrompt();

      // Context Cache使用 or 直接ファイル参照
      let rawResponse: string;
      if (cacheId) {
        const response = await callGeminiApiWithCache(
          projectId, modelId, cacheId, promptText,
          { temperature: 0.2, maxOutputTokens: calculateOutputTokens(durationSec) },
          costContext
        );
        rawResponse = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      } else {
        rawResponse = await generateContent({
          projectId, modelId, prompt: promptText,
          fileUri, mimeType: "video/mp4",
          temperature: 0.2, maxOutputTokens: calculateOutputTokens(durationSec),
          responseFormat: "json", costContext,
        });
      }

      // JSONパース + バリデーション
      const parsed = parseJsonFromGemini(rawResponse);
      const result = SegmentAndEventsResponseSchema.safeParse(parsed);
      if (!result.success) {
        throw new ValidationError("Invalid segment_and_events response", {
          errors: result.error.errors,
          rawResponse: rawResponse.substring(0, 2000),
        });
      }

      return { response: result.data, rawResponse };
    }

    function calculateOutputTokens(durationSec?: number): number {
      const BASE = 16384;
      const PER_MINUTE = 500;
      if (!durationSec) return BASE;
      return Math.min(BASE + Math.ceil(durationSec / 60) * PER_MINUTE, 24576);
    }
    ```

#### 2.4 ステップ実装

- [x] **2.4.1** ステップ作成: `04a_segmentAndEvents.ts`
  - **パス**: `services/analyzer/src/jobs/steps/04a_segmentAndEvents.ts`
  - **依存関係**:
    - `callSegmentAndEvents()` from `../../gemini/segmentAndEvents`
    - `categorizeEvents()` from `../../gemini/schemas/segmentAndEvents`
    - `getDb()` from `../../firebase/admin`
    - `safeId()` from `../../lib/ids`
  - **Firestoreへの保存**:
    ```typescript
    // segments コレクション
    matches/{matchId}/segments/{segmentId}

    // イベントは型別コレクションに保存
    matches/{matchId}/passEvents/{eventId}
    matches/{matchId}/carryEvents/{eventId}
    matches/{matchId}/turnoverEvents/{eventId}
    matches/{matchId}/shotEvents/{eventId}
    matches/{matchId}/setPieceEvents/{eventId}
    ```
  - **イベント変換ロジック** (Gemini形式 → Firestore形式):
    ```typescript
    // Gemini: { timestamp, type, team, player, zone, details, confidence }
    // Firestore PassEventDoc: { eventId, matchId, type, frameNumber, timestamp, kicker, receiver, outcome, ... }

    function convertGeminiEventToPassEvent(
      event: GeminiEvent,
      matchId: string,
      version: string
    ): PassEventDoc {
      return {
        eventId: `pass_${safeId(version)}_${event.timestamp}`,
        matchId,
        type: "pass",
        frameNumber: Math.round(event.timestamp * 30), // 30fps仮定
        timestamp: event.timestamp,
        kicker: {
          trackId: "", // Gemini分析ではtrackIdなし
          playerId: event.player ?? null,
          teamId: event.team,
          position: { x: 0.5, y: 0.5 }, // 位置情報なし
          confidence: event.confidence,
        },
        receiver: null,
        outcome: event.details?.outcome ?? "complete",
        outcomeConfidence: event.confidence,
        passType: event.details?.passType,
        confidence: event.confidence,
        needsReview: event.confidence < 0.7,
        source: "gemini",
        version,
        createdAt: new Date().toISOString(),
      };
    }
    ```

- [x] **2.4.2** 既存のイベント保存関数との互換性確認
  - **参照**: `07c_deduplicateEvents.ts` の `saveTypedEvents()` 関数
  - **確認事項**:
    - [x] バッチ書き込み (450件制限)
    - [x] version フィールドの設定
    - [x] createdAt の設定

#### 2.5 テスト

- [ ] **2.5.1** スキーマバリデーションテスト
  - **パス**: `services/analyzer/src/gemini/schemas/__tests__/segmentAndEvents.test.ts`
  - **テストケース**:
    - 有効なレスポンスのパース成功
    - 必須フィールド欠落時のエラー
    - イベント型の分類が正しい

- [ ] **2.5.2** 統合テスト準備
  - **テストコマンド**: `pnpm test:analyzer segmentAndEvents`
  - **テスト用動画**: 60秒のサンプル動画を用意

---

### Phase 3: Call 2 - シーン + 選手識別 ✅

#### 3.1 プロンプト作成

- [x] **3.1.1** プロンプトファイル作成: `scenes_and_players_v1.json`
  - **パス**: `services/analyzer/src/gemini/prompts/scenes_and_players_v1.json`
  - **ベース**:
    - `scene_extraction_v2.json` のシーン抽出部分
    - `player_identification_v1.json` の選手識別部分
  - **Call 1結果の注入方法**:
    ```
    # 前提情報（Call 1の分析結果）

    ## 検出済みセグメント
    {segments_json}

    ## 検出済みイベント統計
    - パス: {pass_count}回
    - シュート: {shot_count}回
    - ターンオーバー: {turnover_count}回

    ---

    上記の情報を踏まえて、重要シーンと選手を識別してください。
    ```

- [x] **3.1.2** シーン重要度の基準を明確化
  - goal: 1.0
  - shot: 0.85-0.95
  - save: 0.75-0.85
  - chance: 0.70-0.80
  - turnover (重要): 0.50-0.70
  - turnover (通常): 0.40-0.50
  - setPiece: 0.40-0.60 (内容による)

#### 3.2 スキーマ定義

- [x] **3.2.1** Zodスキーマ作成: `scenesAndPlayers.ts`
  - **パス**: `services/analyzer/src/gemini/schemas/scenesAndPlayers.ts`
  - **再利用するスキーマ**:
    - `ImportantSceneSchema`
    - `PlayersIdentificationSchema`
    - `TeamsInfoSchema`
  - **新規定義**:
    ```typescript
    export const ScenesAndPlayersResponseSchema = z.object({
      scenes: z.array(ImportantSceneSchema),
      players: PlayersIdentificationSchema,
      teams: TeamsInfoSchema,
    });

    export type ScenesAndPlayersResponse = z.infer<typeof ScenesAndPlayersResponseSchema>;
    ```

#### 3.3 Gemini クライアント

- [x] **3.3.1** クライアント作成: `scenesAndPlayers.ts`
  - **パス**: `services/analyzer/src/gemini/scenesAndPlayers.ts`
  - **特徴**:
    - Call 1の結果を入力として受け取る
    - Context Cache使用 (Call 1と同じキャッシュ)
    - 温度: 0.2, 出力トークン: 8K-12K
  - **関数シグネチャ**:
    ```typescript
    export type ScenesAndPlayersOptions = {
      projectId: string;
      modelId: string;
      fileUri: string;
      cacheId?: string;
      matchId: string;
      // Call 1の結果をコンテキストとして渡す
      segmentsContext: Array<{ startSec: number; endSec: number; type: string; description: string }>;
      eventsStats: { passCount: number; shotCount: number; turnoverCount: number };
      costContext?: CostTrackingContext;
    };

    export async function callScenesAndPlayers(
      options: ScenesAndPlayersOptions
    ): Promise<ScenesAndPlayersResult>;
    ```

#### 3.4 ステップ実装

- [x] **3.4.1** ステップ作成: `04b_scenesAndPlayers.ts`
  - **パス**: `services/analyzer/src/jobs/steps/04b_scenesAndPlayers.ts`
  - **Firestore保存先**:
    ```typescript
    // シーン
    matches/{matchId}/importantScenes/{sceneId}

    // 選手識別
    matches/{matchId}/players/current

    // チームカラー (match設定に保存)
    matches/{matchId}.settings.teamColors
    ```
  - **既存関数との互換**:
    - `04_extractImportantScenes.ts` の保存ロジックを参考に
    - `08_identifyPlayersGemini.ts` の選手保存ロジックを参考に

- [ ] **3.4.2** Call 1結果の読み込み
  ```typescript
  // Call 1の結果をFirestoreから取得
  const segmentsSnap = await matchRef.collection("segments")
    .where("version", "==", version).get();
  const eventsStats = await calculateEventStats(matchRef, version);
  ```

#### 3.5 テスト

- [ ] **3.5.1** スキーマバリデーションテスト
- [ ] **3.5.2** Call 1 → Call 2 連携テスト
  - Call 1の出力がCall 2の入力として正しく渡されるか
  - シーンがイベントと時間的に整合しているか

---

### Phase 4: Call 3 - クリップラベリング ✅

#### 4.1 既存コードの活用

- [x] **4.1.1** 既存ファイルの確認
  - **ファイル**: `services/analyzer/src/gemini/labelClip.ts`
  - **使用する関数**:
    - `labelClipBatchWithGemini()`: バッチラベリング (5-15クリップ/コール)
    - `labelClipWithGemini()`: 個別ラベリング (フォールバック用)
  - **使用するプロンプト**: `clip_label_v1.json`

- [ ] **4.1.2** 既存ステップの確認
  - **ファイル**: `services/analyzer/src/jobs/steps/04_labelClipsGemini.ts`
  - **再利用可能な部分**:
    - クリップ取得ロジック
    - バッチ処理ロジック
    - Firestore保存ロジック

#### 4.2 クリップ生成ロジック

- [ ] **4.2.1** シーンからクリップ範囲を決定
  - **入力**: `importantScenes[].suggestedClip.{t0, t1}`
  - **ロジック**:
    ```typescript
    function generateClipsFromScenes(
      scenes: ImportantScene[],
      existingClips: ClipDoc[]
    ): ClipGenerationPlan[] {
      const plans: ClipGenerationPlan[] = [];

      for (const scene of scenes) {
        const { t0, t1 } = scene.suggestedClip ?? {
          t0: Math.max(0, scene.startSec - 3),
          t1: (scene.endSec ?? scene.startSec) + 5,
        };

        // 既存クリップとの重複チェック
        const overlapping = existingClips.find(c =>
          (c.t0 <= t1 && c.t1 >= t0)
        );

        if (!overlapping) {
          plans.push({ t0, t1, sceneId: scene.sceneId, reason: "scene_based" });
        }
      }

      return plans;
    }
    ```

- [ ] **4.2.2** FFmpegでのクリップ切り出し
  - **参照**: `03_extractClips.ts` の `extractClipWithFfmpeg()` 関数
  - **出力先**: `gs://{bucket}/matches/{matchId}/clips/{clipId}.mp4`

#### 4.3 ステップ実装

- [ ] **4.3.1** ステップ作成: `04c_labelClips.ts`
  - **パス**: `services/analyzer/src/jobs/steps/04c_labelClips.ts`
  - **処理フロー**:
    1. `importantScenes` からクリップ範囲を取得
    2. 既存クリップと比較して新規クリップを特定
    3. FFmpegで新規クリップを切り出し (必要な場合)
    4. `labelClipBatchWithGemini()` でバッチラベリング
    5. `clips` コレクションに保存
  - **Firestore保存**:
    ```typescript
    matches/{matchId}/clips/{clipId}
    {
      clipId: string,
      t0: number,
      t1: number,
      reason: "scene_based" | "motionPeak" | "audioPeak",
      sceneId?: string,  // 紐付けシーン
      media: { clipPath, thumbPath },
      gemini: {
        model: string,
        promptVersion: "v1",
        label: "shot" | "chance" | "setPiece" | "dribble" | "defense" | "other",
        confidence: number,
        title: string,
        summary: string,
        tags: string[],
        coachTips: string[],
      },
      version: string,
    }
    ```

#### 4.4 テスト

- [ ] **4.4.1** バッチラベリングテスト
- [ ] **4.4.2** シーン→クリップ変換テスト

---

### Phase 5: Call 4 - 戦術分析 + サマリー

#### 5.1 既存コードの調整

- [ ] **5.1.1** 既存ファイルの確認
  - **ファイル**: `services/analyzer/src/gemini/summaryAndTactics.ts`
  - **使用する関数**: `callSummaryAndTactics()`
  - **使用するプロンプト**: `summary_and_tactics_v1.json`
  - **特徴**: テキストオンリー (Video不要)

- [ ] **5.1.2** 入力形式の確認
  - **現在の入力** (`ComprehensiveAnalysisResponse`):
    - metadata, teams, segments, events, scenes, players
  - **ハイブリッドでの入力**:
    - Call 1: segments, events (passEvents, shotEvents等)
    - Call 2: scenes, players, teams
    - Call 3: clips (オプション)

#### 5.2 入力コンテキストビルダー更新

- [ ] **5.2.1** ハイブリッド用のコンテキストビルダー作成
  - **ファイル**: `services/analyzer/src/gemini/summaryAndTactics.ts`
  - **新規関数**:
    ```typescript
    export function buildHybridInputContext(
      segments: VideoSegment[],
      eventStats: EventStatsInput,
      scenes: ImportantScene[],
      players: PlayersIdentificationDoc,
      clips?: ClipDoc[],
      durationSec?: number
    ): string {
      return `
    # 試合分析データ

    ## 動画情報
    - 長さ: ${durationSec ?? "不明"}秒

    ## セグメント統計
    - 総セグメント数: ${segments.length}
    - アクティブプレー: ${segments.filter(s => s.type === "active_play").length}
    - ストッページ: ${segments.filter(s => s.type === "stoppage").length}

    ## イベント統計
    - パス: Home ${eventStats.home.passesAttempted}, Away ${eventStats.away.passesAttempted}
    - シュート: Home ${eventStats.home.shots}, Away ${eventStats.away.shots}
    - ゴール: Home ${eventStats.home.goals}, Away ${eventStats.away.goals}
    - ターンオーバー: Home ${eventStats.home.turnoversWon}, Away ${eventStats.away.turnoversWon}

    ## 重要シーン
    ${scenes.map(s => `- [${s.type}] ${s.startSec}秒: ${s.description}`).join("\n")}

    ## 選手情報
    ${JSON.stringify(players, null, 2)}

    ${clips ? `## ラベル付きクリップ
    ${clips.filter(c => c.gemini).map(c => `- ${c.gemini?.label}: ${c.gemini?.title}`).join("\n")}` : ""}
    `;
    }
    ```

#### 5.3 ステップ実装

- [ ] **5.3.1** ステップ作成: `04d_summaryAndTactics.ts`
  - **パス**: `services/analyzer/src/jobs/steps/04d_summaryAndTactics.ts`
  - **処理フロー**:
    1. Call 1-3の結果をFirestoreから取得
    2. `buildHybridInputContext()` でコンテキスト構築
    3. `callSummaryAndTactics()` を呼び出し (Video不要)
    4. 結果を保存
  - **Firestore保存先**:
    ```typescript
    matches/{matchId}/tactical/current
    matches/{matchId}/summary/current
    ```

- [ ] **5.3.2** 既存の `05_summaryAndTactics.ts` との違い
  - **既存**: `ComprehensiveAnalysisResponse` を直接受け取る
  - **新規**: Firestoreから各コレクションを読み込んで構築

#### 5.4 テスト

- [ ] **5.4.1** 全Call連携テスト
  - Call 1 → Call 2 → Call 3 → Call 4 の一連の流れをテスト
  - 各Callの出力が次のCallの入力として正しく使われるか確認

---

### Phase 6: パイプライン統合 ✅

#### 6.1 runMatchPipeline.ts 更新

- [x] **6.1.1** ハイブリッドモードのブランチ追加
  - **ファイル**: `services/analyzer/src/jobs/runMatchPipeline.ts`
  - **挿入位置**: 既存の `if (useConsolidatedAnalysis)` ブロックの前
  - **実装**:
    ```typescript
    const useHybridPipeline = isHybridPipelineEnabled();
    const useConsolidatedAnalysis = isConsolidatedAnalysisEnabled();

    if (useHybridPipeline) {
      // === ハイブリッド 4-Call パイプライン ===

      // Call 1: セグメント + イベント検出
      await startStep("segment_and_events");
      await runWithRetry("segment_and_events", () =>
        stepSegmentAndEvents({ matchId, version: runVersion, logger })
      );
      completeStep("segment_and_events");

      // Call 2: シーン + 選手識別
      await startStep("scenes_and_players");
      await runWithRetry("scenes_and_players", () =>
        stepScenesAndPlayers({ matchId, version: runVersion, logger })
      );
      completeStep("scenes_and_players");

      // Call 3: クリップラベリング (バッチ)
      await startStep("label_clips_hybrid");
      await runWithRetry("label_clips_hybrid", () =>
        stepLabelClipsHybrid({ matchId, version: runVersion, logger })
      );
      completeStep("label_clips_hybrid");

      // Call 4: 戦術分析 + サマリー (テキストのみ)
      await startStep("summary_and_tactics");
      await runWithRetry("summary_and_tactics", () =>
        stepSummaryAndTacticsHybrid({ matchId, version: runVersion, logger })
      );
      completeStep("summary_and_tactics");

      // compute_stats は実行 (イベントデータからstats計算)
      await startStep("compute_stats");
      await runWithRetry("compute_stats", () =>
        stepComputeStats({ matchId, version: runVersion })
      );
      completeStep("compute_stats");

    } else if (useConsolidatedAnalysis) {
      // 既存の2-call統合モード
      // ...
    }
    ```

- [x] **6.1.2** AnalysisStep型にステップ追加 (Phase 1で完了)
  ```typescript
  type AnalysisStep =
    | "extract_meta"
    | "detect_shots"
    | "upload_video_to_gemini"
    | "extract_clips"
    // ハイブリッド4-call
    | "segment_and_events"
    | "scenes_and_players"
    | "label_clips_hybrid"
    | "summary_and_tactics"
    | "compute_stats"
    // 既存ステップ...
    | "done";
  ```

#### 6.2 エラーハンドリング

- [x] **6.2.1** Call間のエラー伝播戦略 (既存のrunWithRetry機構を活用)
  - **Call 1 失敗**: パイプライン全体を失敗とする
  - **Call 2 失敗**: Call 1結果は保持、リトライ可能
  - **Call 3 失敗**: Call 1-2結果は保持、クリップなしで続行可能
  - **Call 4 失敗**: Call 1-3結果は保持、サマリーなしで部分完了

- [x] **6.2.2** 部分完了ステータスの実装 (既存のパイプラインエラー機構を活用)
  ```typescript
  // analysisステータスを "partial" に設定
  await updateMatchAnalysis({
    status: "partial",
    activeVersion: runVersion,
    errorMessage: "Call 3 (clip labeling) failed, continuing without clips",
  });
  ```

#### 6.3 Context Cache共有

- [x] **6.3.1** キャッシュ有効期限の確認 (既存のcacheManager.tsが実装済み)
  - Call 1-3 は同じContext Cacheを使用
  - TTLが切れる前に全Callを完了する必要あり
  - 動的TTL: 30分 (短い動画) 〜 3時間 (長い動画)

- [x] **6.3.2** キャッシュ切れ時のフォールバック (getValidCacheOrFallbackが実装済み)
  ```typescript
  async function getValidCacheOrFileUri(matchId: string): Promise<{
    cacheId?: string;
    fileUri: string;
  }> {
    const cache = await getValidCacheOrFallback(matchId, "hybrid_call");
    if (cache?.cacheId) {
      return { cacheId: cache.cacheId, fileUri: cache.fileUri };
    }
    // フォールバック: 直接ファイルURIを使用 (コスト増だが動作は継続)
    const match = await getMatchDoc(matchId);
    return { fileUri: match.geminiUpload?.fileUri ?? match.video?.storagePath };
  }
  ```

---

### Phase 7: デプロイと検証

#### 7.1 cloudbuild.yaml 更新

- [ ] **7.1.1** 環境変数の設定
  ```yaml
  '--set-env-vars=NODE_ENV=production,
    GCP_PROJECT_ID=$PROJECT_ID,
    GCP_REGION=us-central1,
    GEMINI_LOCATION=us-central1,
    GEMINI_MODEL=gemini-3-flash-preview,
    STORAGE_BUCKET=$PROJECT_ID.firebasestorage.app,
    ANALYZER_TIER=1,
    GEMINI_CONTEXT_CACHE_ENABLED=true,   # キャッシュ有効化
    GEMINI_VIDEO_UPLOAD_FULL=true,
    PROMPT_VERSION=v3,
    USE_MULTIPASS_DETECTION=false,       # 旧マルチパス無効化
    USE_CONSOLIDATED_ANALYSIS=false,      # 2-call無効化
    USE_HYBRID_PIPELINE=true'             # ★ ハイブリッド有効化
  ```

#### 7.2 Dockerfile 確認

- [ ] **7.2.1** 新規プロンプトファイルのコピー確認
  - **既存の設定**: `COPY services/analyzer/src/gemini/prompts ./services/analyzer/dist/prompts`
  - **確認**: 新規ファイル `segment_and_events_v1.json`, `scenes_and_players_v1.json` が含まれる

#### 7.3 ローカルテスト

- [ ] **7.3.1** 短い動画テスト (60秒)
  - **期待結果**:
    - segments: 5-10
    - events: 10-30
    - scenes: 3-8
    - clips: 3-8
  - **コマンド**:
    ```bash
    USE_HYBRID_PIPELINE=true pnpm --filter @soccer/analyzer dev
    # APIで短い動画の分析をトリガー
    ```

- [ ] **7.3.2** 中程度の動画テスト (5-10分)
  - **期待結果**:
    - segments: 30-60
    - events: 100-300
    - scenes: 15-40
    - clips: 15-40

- [ ] **7.3.3** 各Callの処理時間計測
  - Call 1: 3-5分
  - Call 2: 2-3分
  - Call 3: 1-3分 (クリップ数依存)
  - Call 4: 30秒-1分

#### 7.4 本番デプロイ

- [ ] **7.4.1** Cloud Build 実行
  ```bash
  gcloud builds submit --config=cloudbuild.yaml
  ```

- [ ] **7.4.2** Cloud Run ログ監視
  ```bash
  gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=soccer-analyzer" --limit=100 --format="table(timestamp,jsonPayload.message)"
  ```

- [ ] **7.4.3** エラー監視ポイント
  - `STEP_FAILED`: 個別ステップの失敗
  - `VALIDATION_ERROR`: スキーマバリデーション失敗
  - `RATE_LIMIT_EXCEEDED`: Gemini API制限
  - `CACHE_EXPIRED`: Context Cache期限切れ

#### 7.5 結果検証

- [ ] **7.5.1** 定量評価
  | 指標 | 統合2-call | ハイブリッド4-call | レガシー20+ | 目標 |
  |-----|-----------|-------------------|-------------|------|
  | segments | 4 | ? | 30+ | 20+ |
  | events | 4 | ? | 100+ | 50+ |
  | scenes | 1 | ? | 15+ | 10+ |
  | API呼び出し | 2 | 4-5 | 20-30 | 4-5 |
  | 処理時間 | 3分 | ? | 15分+ | 5-8分 |

- [ ] **7.5.2** 定性評価
  - [ ] シュート検出の網羅性
  - [ ] イベントの時間精度
  - [ ] シーン説明の質
  - [ ] 戦術分析の深さ
  - [ ] サマリーの読みやすさ

---

### Phase 8: クリーンアップとドキュメント

#### 8.1 不要コードの整理

- [ ] **8.1.1** 統合分析コードのアーカイブ判断
  - `04_comprehensiveAnalysis.ts`: 削除 or `_archive/` に移動
  - `comprehensive_analysis_v1.json`: 削除 or `_archive/` に移動
  - **判断基準**: ハイブリッドが安定したら削除

- [ ] **8.1.2** 環境変数の整理
  - `USE_CONSOLIDATED_ANALYSIS`: 削除検討
  - `USE_HYBRID_PIPELINE`: デフォルト `true` に変更検討

#### 8.2 ドキュメント更新

- [ ] **8.2.1** README 更新
  - パイプラインアーキテクチャ図追加
  - 環境変数一覧の更新
  - トラブルシューティングガイド

- [ ] **8.2.2** 環境変数ドキュメント
  ```markdown
  | 変数 | デフォルト | 説明 |
  |-----|-----------|------|
  | USE_HYBRID_PIPELINE | false | ハイブリッド4-callパイプラインを使用 |
  | GEMINI_CONTEXT_CACHE_ENABLED | false | Context Cacheを使用 |
  | ANALYZER_TIER | 1 | 1: Gemini-first, 2: YOLO hybrid |
  ```

#### 8.3 メモリ更新

- [ ] **8.3.1** Serenaメモリの更新
  - **ファイル**: `.serena/memories/pipeline_architecture_analysis.md`
  - **追加内容**:
    - ハイブリッド4-callアーキテクチャの説明
    - 各Callの役割と入出力
    - 環境変数の設定方法

---

## ファイル構成（新規作成）

```
services/analyzer/src/
├── gemini/
│   ├── prompts/
│   │   ├── segment_and_events_v1.json      # NEW: Call 1 プロンプト
│   │   └── scenes_and_players_v1.json      # NEW: Call 2 プロンプト
│   ├── schemas/
│   │   ├── segmentAndEvents.ts             # NEW: Call 1 スキーマ
│   │   ├── scenesAndPlayers.ts             # NEW: Call 2 スキーマ
│   │   └── index.ts                        # 更新: エクスポート追加
│   ├── segmentAndEvents.ts                 # NEW: Call 1 クライアント
│   └── scenesAndPlayers.ts                 # NEW: Call 2 クライアント
└── jobs/
    └── steps/
        ├── 04a_segmentAndEvents.ts         # NEW: Call 1 ステップ
        ├── 04b_scenesAndPlayers.ts         # NEW: Call 2 ステップ
        ├── 04c_labelClips.ts               # NEW: Call 3 ステップ (既存流用)
        └── 04d_summaryAndTactics.ts        # NEW: Call 4 ステップ (既存流用)
```

---

## 既存コードの再利用マップ

| 新Call | 再利用ファイル | 再利用関数/スキーマ |
|--------|---------------|-------------------|
| Call 1 | `gemini/schemas/comprehensiveAnalysis.ts` | `VideoSegmentSchema`, `EventSchema`, `AnalysisMetadataSchema` |
| Call 1 | `jobs/steps/07a_segmentVideo.ts` | セグメント保存ロジック |
| Call 1 | `jobs/steps/07c_deduplicateEvents.ts` | `saveTypedEvents()` |
| Call 2 | `gemini/schemas/comprehensiveAnalysis.ts` | `ImportantSceneSchema`, `PlayersIdentificationSchema`, `TeamsInfoSchema` |
| Call 2 | `jobs/steps/04_extractImportantScenes.ts` | シーン保存ロジック |
| Call 2 | `jobs/steps/08_identifyPlayersGemini.ts` | 選手保存ロジック |
| Call 3 | `gemini/labelClip.ts` | `labelClipBatchWithGemini()`, `labelClipWithGemini()` |
| Call 3 | `jobs/steps/04_labelClipsGemini.ts` | クリップ取得・保存ロジック |
| Call 4 | `gemini/summaryAndTactics.ts` | `callSummaryAndTactics()` |
| Call 4 | `jobs/steps/05_summaryAndTactics.ts` | 保存ロジック |

---

## Firestoreコレクション構造

```
matches/{matchId}/
├── segments/{segmentId}           # Call 1 出力
│   └── { segmentId, startSec, endSec, type, subtype, description, confidence, version }
│
├── passEvents/{eventId}           # Call 1 出力
│   └── { eventId, timestamp, kicker, receiver, outcome, passType, confidence, version }
│
├── carryEvents/{eventId}          # Call 1 出力
├── turnoverEvents/{eventId}       # Call 1 出力
├── shotEvents/{eventId}           # Call 1 出力
├── setPieceEvents/{eventId}       # Call 1 出力
│
├── importantScenes/{sceneId}      # Call 2 出力
│   └── { sceneId, startSec, endSec, type, description, importance, suggestedClip, version }
│
├── players/current                # Call 2 出力
│   └── { teams, players[], referees[], version }
│
├── clips/{clipId}                 # Call 3 出力
│   └── { clipId, t0, t1, sceneId, media, gemini.{label, title, summary, tags, coachTips}, version }
│
├── tactical/current               # Call 4 出力
│   └── { formation, tempo, attackPatterns, defensivePatterns, keyInsights, version }
│
├── summary/current                # Call 4 出力
│   └── { headline, narrative, keyMoments, playerHighlights, score, mvp, version }
│
├── stats/{statId}                 # compute_stats 出力
│   └── { scope, playerId, metrics, confidence, explanations, version }
│
└── geminiCache/current            # Context Cache情報
    └── { cacheId, fileUri, expiresAt, model, ttlSeconds }
```

---

## 期待される効果

| 指標 | 統合2-call | ハイブリッド4-call | レガシー20+ |
|-----|-----------|-------------------|-------------|
| API呼び出し | 2 | **4-5** | 20-30 |
| 分析品質 | 低（浅い） | **高（深い）** | 高 |
| コスト | 最安 | **中** | 高 |
| 処理時間 | 3分 | **5-8分** | 15分+ |
| 保守性 | 低（巨大プロンプト） | **高（分離された責務）** | 低（多数のファイル） |
| Context Cache活用 | 1回 | **3回** | 10回+ (切れるリスク) |

---

## リスクと軽減策

| リスク | 影響 | 軽減策 |
|-------|-----|--------|
| Context Cache期限切れ | Call 2-3でキャッシュが使えない | 動的TTL + フォールバック処理 |
| Call間のデータ不整合 | Call 2がCall 1の結果を正しく読めない | バージョンフィールドでの厳密な紐付け |
| プロンプト品質 | 期待通りの出力が得られない | 例とエッジケースを充実させる |
| 処理時間超過 | Cloud Run タイムアウト (3600s) | ステップごとの進捗更新、部分完了対応 |

---

## 備考

- 既存のレガシーパイプラインは削除せず、フラグで切り替え可能に保持
- 将来的にCall数をさらに調整可能（3-callや5-callへの変更も容易）
- プロンプトは既存のものを分割・再構成するため、品質劣化リスクは低い
- compute_stats は引き続き実行（Calculator群がイベントデータを使用）
