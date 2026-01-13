# Stats計算とClip生成フロー - ビジュアルダイアグラム

## 1. Clip生成パイプライン（Step 03）

```
動画ファイル (video.storagePath)
│
├─ FFmpeg でモーション分析 (1 FPS)
│  └─ { t: 0, score: 0.15 }, { t: 1, score: 0.12 }, ..., { t: n, score: 0.95 }
│
├─ FFmpeg でオーディオ分析 (1 FPS)
│  └─ [0.05, 0.08, ..., 0.92, ...]
│
├─ ピーク検出（最大値の60%以上 + 局所最大値）
│  │
│  ├─ Motion Peaks:
│  │  └─ t=120s (score=0.95), t=240s (score=0.88), ...
│  │
│  └─ Audio Peaks:
│     └─ t=115s (score=0.92), t=245s (score=0.85), ...
│
├─ クリップウィンドウ生成（ピーク ± ウィンドウ）
│  │
│  ├─ Window 1: t=[112, 132] (ピーク120s ± 8/12s)
│  ├─ Window 2: t=[107, 127] (ピーク115s ± 8/12s)  ← オーバーラップ
│  ├─ Window 3: t=[232, 252]
│  ├─ Window 4: [237, 257]    ← オーバーラップ
│  └─ Window N: ...
│
├─ ウィンドウマージ（隙間 ≤ 1秒）
│  │
│  ├─ Merged Window A: t=[107, 132] (スコア=0.95)
│  ├─ Merged Window B: t=[232, 257] (スコア=0.88)
│  └─ Merged Window N: ...
│
├─ トップ60クリップ選択（スコア順）
│  └─ クリップ数 ≥ 60の場合、上位60個のみ使用
│
└─ 各クリップについて
   ├─ FFmpeg で動画抽出: matches/{matchId}/clips/{version}/{clipId}.mp4
   ├─ サムネイル抽出: matches/{matchId}/clips/{version}/{clipId}.jpg
   ├─ プロキシ生成: matches/{matchId}/proxies/{version}/proxy_240p.mp4
   │
   └─ Firestore に保存
      └─ documents/{matchId}/clips/{clipId}
         ├─ clipId: "clip_v1_1"
         ├─ shotId: "shot_v1_1"
         ├─ t0: 107, t1: 132
         ├─ reason: "motionPeak"
         ├─ motionScore: 0.95
         ├─ media: { clipPath, thumbPath }
         └─ version: "v1"
```

---

## 2. イベント生成パイプライン（Step 04-05）

```
clips collection
│
├─ clip_v1_1
│  ├─ t0, t1, motionScore
│  └─ gemini: (未設定 → Step 04で設定される)
│
├─ clip_v1_2
│  ├─ t0, t1, motionScore
│  └─ gemini:
│     ├─ label: (未設定)
│     ├─ confidence: (未設定)
│     ├─ title: (未設定)
│     └─ summary: (未設定)
│
└─ clip_v1_60
   └─ ...

        ↓ Step 04: Label Clips with Gemini

Gemini API 呼び出し （最大30回/実行）
│
├─ Clip 1 のサムネイル画像をGeminiに送信
│  ├─ プロンプト: 「これはサッカーの何のシーンですか？」
│  └─ 応答: { label: "shot", confidence: 0.85, title: "...", ... }
│
├─ Clip 2: { label: "chance", confidence: 0.78, ... }
├─ ...
└─ Clip 30: { label: "defense", confidence: 0.65, ... }

clips collection 更新 (merge: true)
│
└─ clip_v1_1
   └─ gemini:
      ├─ label: "shot"
      ├─ confidence: 0.85
      ├─ title: "Great Chance"
      ├─ summary: "Forward shoots from inside the box..."
      ├─ tags: ["shot", "chance", "dangerous"]
      └─ coachTips: ["Improve positioning", "...]

        ↓ Step 05: Build Events

events collection 作成
│
└─ event_v1_clip_v1_1
   ├─ eventId: "event_v1_clip_v1_1"
   ├─ clipId: "clip_v1_1"
   ├─ label: "shot"  ← gemini.label を正規化
   ├─ confidence: 0.85
   ├─ title: "Great Chance"
   ├─ summary: "..."
   ├─ source: "gemini"  ← 手動編集なし
   ├─ version: "v1"
   └─ createdAt: "2024-01-13T10:30:00Z"
```

---

## 3. Pass/Carry/Turnover イベント検出パイプライン（Step 10）

```
tracks collection (Step 07出力)
│
├─ track_001: { frames: [...], avgConfidence: 0.92 }
├─ track_002: { frames: [...], avgConfidence: 0.88 }
└─ ...

trackTeamMetas collection (Step 08出力)
│
├─ track_001: { teamId: "home" }
└─ track_002: { teamId: "away" }

trackMappings collection (Step 08出力)
│
├─ track_001: { playerId: "player_001" }
└─ track_002: { playerId: null }

ballTrack/current (Step 09出力)
│
└─ { detections: [...], visibilityRate: 0.92 }

        ↓ Step 10: Detect Events (detectAllEvents function)

ボール-プレイヤー近接分析
│
├─ フレーム単位でボール位置と各プレイヤー位置を比較
│  └─ distance(ball, player) < POSSESSION_THRESHOLD
│
├─ Possession Segments 検出
│  ├─ possessionSegments[0]
│  │  ├─ trackId: "track_001"
│  │  ├─ playerId: "player_001"
│  │  ├─ teamId: "home"
│  │  ├─ startFrame: 100, endFrame: 120
│  │  ├─ startTime: 5.0, endTime: 6.0
│  │  ├─ endReason: "pass"
│  │  └─ confidence: 0.92
│  │
│  └─ possessionSegments[1]
│     ├─ trackId: "track_002"
│     ├─ teamId: "away"
│     ├─ startFrame: 121, endFrame: 140
│     └─ ...
│
├─ Pass Events 検出（ボール所持の移動）
│  ├─ passEvents[0]
│  │  ├─ eventId: "pass_001"
│  │  ├─ timestamp: 6.0
│  │  ├─ kicker:
│  │  │  ├─ trackId: "track_001"
│  │  │  ├─ playerId: "player_001"
│  │  │  ├─ teamId: "home"
│  │  │  └─ confidence: 0.92
│  │  ├─ receiver:
│  │  │  ├─ trackId: "track_003"
│  │  │  ├─ playerId: "player_003"
│  │  │  ├─ teamId: "home"
│  │  │  └─ confidence: 0.88
│  │  ├─ outcome: "complete"
│  │  └─ confidence: 0.90
│  │
│  └─ passEvents[1]
│     ├─ kicker: { trackId: "track_002", ... }
│     ├─ receiver: { trackId: null, ... }
│     ├─ outcome: "incomplete"
│     └─ ...
│
├─ Carry Events 検出（同一チーム内のボール移動）
│  ├─ carryEvents[0]
│  │  ├─ eventId: "carry_001"
│  │  ├─ trackId: "track_001"
│  │  ├─ playerId: "player_001"
│  │  ├─ startFrame: 100, endFrame: 120
│  │  ├─ carryIndex: 0.35  ← スクリーン距離を正規化
│  │  ├─ progressIndex: 0.12  ← 前進度（攻撃方向を考慮）
│  │  └─ confidence: 0.88
│  │
│  └─ carryEvents[1]: ...
│
└─ Turnover Events 検出（ボール奪取）
   ├─ turnoverEvents[0]
   │  ├─ eventId: "turnover_001"
   │  ├─ timestamp: 15.5
   │  ├─ player:
   │  │  ├─ trackId: "track_002"
   │  │  ├─ playerId: "player_002"
   │  │  ├─ teamId: "away"
   │  │  └─ turnoverType: "won"
   │  ├─ otherPlayer:
   │  │  ├─ trackId: "track_001"
   │  │  └─ ...
   │  └─ context: "interception"
   │
   └─ turnoverEvents[1]: ...

        ↓ Firestore に保存

passEvents collection ← バッチ保存（400文書/バッチ）
carryEvents collection
turnoverEvents collection
possessionSegments collection
pendingReviews collection (confidence < threshold のイベント)
```

---

## 4. Stats計算パイプライン（Step 06）

```
Firestore からデータ取得
│
├─ shots: version フィルター適用 ✓
├─ clips: version フィルター適用 ✓
├─ events: version フィルター適用 ✓ (clips-based)
├─ passEvents: version フィルター適用 ✓
├─ carryEvents: version フィルター適用 ✓
├─ turnoverEvents: version フィルター適用 ✓
├─ possessionSegments: version フィルター適用 ✓
└─ trackMappings: unversioned

        ↓ runCalculators(context)

並列実行（8つの計算器）
│
├─ calcMatchSummary()
│  │
│  ├─ Input:
│  │  ├─ events[] (clips-based)
│  │  ├─ passEvents[]
│  │  ├─ carryEvents[]
│  │  └─ turnoverEvents[]
│  │
│  ├─ 全イベントを type でカウント
│  │  ├─ "shot": 5
│  │  ├─ "chance": 12
│  │  ├─ "pass": 156
│  │  ├─ "carry": 98
│  │  ├─ "turnover": 42
│  │  └─ ...
│  │
│  └─ Output: StatsOutput
│     ├─ scope: "match"
│     ├─ metrics: {
│     │    matchEventsCountByLabel: { shot: 5, chance: 12, pass: 156, ... }
│     │    matchTopMoments: [
│     │      { eventId: "...", label: "shot", confidence: 0.95, title: "..." },
│     │      ...
│     │    ]
│     │  }
│     └─ confidence: {
│          matchEventsCountByLabel: 0.85,
│          matchTopMoments: 0.85
│        }
│
├─ calcPlayerInvolvement()
│  │
│  ├─ Input: events[] (clips)
│  │
│  ├─ 各イベントの involved.players をカウント
│  │  ├─ player_001: 45 events
│  │  ├─ player_002: 38 events
│  │  └─ ...
│  │
│  └─ Output: StatsOutput[] (player-level)
│     ├─ { scope: "player", playerId: "player_001", metrics: { playerInvolvementCount: 45 }, ... }
│     └─ ...
│
├─ calcProxySprintIndex()
│  │
│  ├─ Input: clips[] (motionScore)
│  │
│  ├─ High motion clips を検出して スプリント指数を計算
│  │
│  └─ Output: StatsOutput[] (player-level)
│
├─ calcHeatmapV1()
│  │
│  ├─ Input: settings.formation.assignments
│  │
│  ├─ フィールドを 3x3 グリッドに分割してポジション分析
│  │
│  └─ Output: StatsOutput[] (player-level)
│
├─ calcPassesV1()  ← Phase 3.1
│  │
│  ├─ Input:
│  │  ├─ passEvents[]
│  │  └─ trackMappings[]
│  │
│  ├─ プレイヤー別にパス統計集計
│  │  └─ player_001:
│  │     ├─ attempted: 28
│  │     ├─ completed: 24
│  │     ├─ incomplete: 2
│  │     ├─ intercepted: 2
│  │     └─ successRate: 86%
│  │
│  └─ Output: StatsOutput[] (player-level)
│     └─ {
│         scope: "player",
│         playerId: "player_001",
│         metrics: {
│           playerPassesAttempted: 28,
│           playerPassesCompleted: 24,
│           playerPassesIncomplete: 2,
│           playerPassesIntercepted: 2,
│           playerPassesSuccessRate: 86
│         },
│         confidence: { ... }
│       }
│
├─ calcCarryV1()  ← Phase 3.2
│  │
│  ├─ Input: carryEvents[]
│  │
│  ├─ プレイヤー別に キャリー統計集計
│  │
│  └─ Output: StatsOutput[] (player-level)
│
├─ calcPossessionV1()  ← Phase 3.3
│  │
│  ├─ Input: possessionSegments[]
│  │
│  ├─ プレイヤー・チーム別にポゼッション時間と回数を集計
│  │
│  └─ Output: StatsOutput[] (both match and player-level)
│
└─ calcTurnoversV1()  ← Phase 3.4
   │
   ├─ Input: turnoverEvents[]
   │
   ├─ プレイヤー別に ターンオーバー統計集計
   │
   └─ Output: StatsOutput[] (player-level)

        ↓ StatsOutput[] 配列を Firestore に保存

stats collection
│
├─ stat_v1_matchSummary_match
│  ├─ statId: "stat_v1_matchSummary_match"
│  ├─ scope: "match"
│  ├─ metrics: {
│  │  matchEventsCountByLabel: { shot: 5, chance: 12, pass: 156, ... },
│  │  matchTopMoments: [...]
│  │}
│  ├─ confidence: { ... }
│  ├─ version: "v1"
│  └─ computedAt: "2024-01-13T10:35:00Z"
│
├─ stat_v1_playerInvolvement_player_001
│  ├─ scope: "player"
│  ├─ playerId: "player_001"
│  ├─ metrics: { playerInvolvementCount: 45 }
│  └─ ...
│
├─ stat_v1_passesV1_player_001
│  ├─ scope: "player"
│  ├─ playerId: "player_001"
│  ├─ metrics: {
│  │  playerPassesAttempted: 28,
│  │  playerPassesCompleted: 24,
│  │  playerPassesSuccessRate: 86
│  │}
│  └─ ...
│
├─ stat_v1_passesV1_player_002
│  ├─ metrics: {
│  │  playerPassesAttempted: 22,
│  │  playerPassesCompleted: 19,
│  │  playerPassesSuccessRate: 86
│  │}
│  └─ ...
│
├─ stat_v1_carryV1_player_001
│  ├─ metrics: {
│  │  playerCarryCount: 12,
│  │  playerCarryIndex: 0.45,
│  │  playerCarryProgressIndex: 0.12
│  │}
│  └─ ...
│
├─ stat_v1_possessionV1_match
│  ├─ scope: "match"
│  ├─ metrics: {
│  │  teamPossessionPercent: { home: 55, away: 45 }
│  │}
│  └─ ...
│
├─ stat_v1_possessionV1_player_001
│  ├─ metrics: {
│  │  playerPossessionTimeSec: 285,
│  │  playerPossessionCount: 18
│  │}
│  └─ ...
│
└─ ... (その他のプレイヤー・メトリクス)
```

---

## 5. Event Breakdown - データソースと集計

```
モバイルアプリで表示される「Events by Type」

┌────────────────────────────────────────────────────────────┐
│ Events by Type:                                            │
│  - shot: 5                                                 │
│  - chance: 12                                              │
│  - setPiece: 8                                             │
│  - dribble: 24                                             │
│  - defense: 31                                             │
│  - pass: 156                                               │
│  - carry: 98                                               │
│  - turnover: 42                                            │
│  - other: 12                                               │
└────────────────────────────────────────────────────────────┘

↑
│
└─ matchSummary Calculator で計算
   │
   ├─ Source 1: events collection (clips-based)
   │  │
   │  ├─ event_v1_clip_v1_1: label = "shot"
   │  ├─ event_v1_clip_v1_2: label = "chance"
   │  ├─ event_v1_clip_v1_3: label = "setPiece"
   │  ├─ event_v1_clip_v1_4: label = "dribble"
   │  ├─ event_v1_clip_v1_5: label = "defense"
   │  └─ ...
   │
   ├─ Source 2: passEvents (Gemini-detected)
   │  │
   │  ├─ pass_001: type = "pass"
   │  ├─ pass_002: type = "pass"
   │  └─ ... (156個)
   │
   ├─ Source 3: carryEvents (tracking-based)
   │  │
   │  ├─ carry_001: type = "carry"
   │  └─ ... (98個)
   │
   └─ Source 4: turnoverEvents (tracking-based)
      │
      ├─ turnover_001: type = "turnover"
      └─ ... (42個)

計算処理:
│
├─ 全イベントを集計
│  ├─ { type: "shot", ... } → counts["shot"]++
│  ├─ { type: "chance", ... } → counts["chance"]++
│  ├─ { type: "pass", ... } → counts["pass"]++
│  └─ ...
│
└─ 結果を metrics に格納
   └─ matchEventsCountByLabel = {
        shot: 5,
        chance: 12,
        pass: 156,
        carry: 98,
        turnover: 42,
        ...
      }

モバイルアプリでの表示:
│
├─ useStats hook で matches/{matchId}/stats を subscribe
│
├─ matchStats = stats.find(s => s.scope === "match")
│
└─ format 関数で表示
   └─ Object.entries(countByLabel)
      .map(([k, c]) => `${k}: ${c}`)
      .join(", ")
```

---

## 6. Player Stats の階層構造

```
stats collection でのプレイヤー統計構成
│
├─ stat_v1_matchSummary_match (scope: "match")
│  └─ metrics: {
│     matchEventsCountByLabel: {...},
│     matchTopMoments: [...]
│   }
│
├─ stat_v1_playerInvolvement_player_001 (scope: "player")
│  └─ metrics: { playerInvolvementCount: 45 }
│
├─ stat_v1_passesV1_player_001 (scope: "player")
│  └─ metrics: {
│     playerPassesAttempted: 28,
│     playerPassesCompleted: 24,
│     playerPassesSuccessRate: 86
│   }
│
├─ stat_v1_carryV1_player_001 (scope: "player")
│  └─ metrics: {
│     playerCarryCount: 12,
│     playerCarryIndex: 0.45,
│     playerCarryProgressIndex: 0.12,
│     playerCarryMeters: 187  (キャリブレーション有時)
│   }
│
├─ stat_v1_possessionV1_player_001 (scope: "player")
│  └─ metrics: {
│     playerPossessionTimeSec: 285,
│     playerPossessionCount: 18
│   }
│
├─ stat_v1_possessionV1_match (scope: "match")
│  └─ metrics: {
│     teamPossessionPercent: { home: 55, away: 45 }
│   }
│
├─ stat_v1_turnoversV1_player_001 (scope: "player")
│  └─ metrics: {
│     playerTurnoversLost: 8,
│     playerTurnoversWon: 12
│   }
│
├─ stat_v1_heatmapV1_player_001 (scope: "player")
│  └─ metrics: {
│     playerHeatmapZones: {
│       "0_0": 5, "0_1": 3, "0_2": 1,
│       "1_0": 12, "1_1": 28, "1_2": 8,
│       "2_0": 6, "2_1": 14, "2_2": 2
│     }
│   }
│
└─ stat_v1_proxySprintIndex_player_001 (scope: "player")
   └─ metrics: {
      playerPeakSpeedIndex: 0.92,
      playerSprintCount: 18
    }

モバイルアプリでの統合:
│
├─ useStats hook で全stats を取得
│
├─ matchStats = stats.find(s => s.scope === "match")
│  └─ "Events by Type", "Possession", "Top Moments" を表示
│
└─ playerStats = stats.filter(s => s.scope === "player")
   └─ プレイヤーごとに複数の計算器からのメトリクスを統合
      ├─ player_001:
      │  ├─ Involvement: 45
      │  ├─ Passes Attempted: 28
      │  ├─ Passes Completed: 24
      │  ├─ Pass Success Rate: 86%
      │  ├─ Carries: 12
      │  ├─ Carry Index: 0.45
      │  ├─ Possession Time: 4:45 (mm:ss)
      │  ├─ Possessions: 18
      │  ├─ Turnovers Lost: 8
      │  ├─ Turnovers Won: 12
      │  ├─ Peak Speed Index: 0.92
      │  ├─ Sprint Count: 18
      │  └─ Heatmap: [3x3 grid visualization]
      │
      └─ player_002: ...
```

---

## 7. バージョン管理戦略

```
各ステップで「version」フィールドを保持
│
├─ Step 03 (Extract Clips): clips.version = "v1"
├─ Step 04 (Label Clips): clips.gemini.promptVersion = "v1_prompt"
├─ Step 05 (Build Events): events.version = "v1"
├─ Step 07 (Detect Players): tracks.version (implicit)
├─ Step 08 (Classify Teams): trackTeamMetas.version (implicit)
├─ Step 09 (Detect Ball): ballTrack.version (implicit)
├─ Step 10 (Detect Events):
│  ├─ passEvents.version = "v1"
│  ├─ carryEvents.version = "v1"
│  ├─ turnoverEvents.version = "v1"
│  └─ possessionSegments.version = "v1"
│
└─ Step 06 (Compute Stats):
   ├─ where("version", "==", "v1") で同じバージョンの
   │  データのみを取得
   │
   └─ stats.version = "v1" で保存

メリット:
├─ 異なるバージョンの分析結果を並行管理可能
├─ A/Bテスト（異なるプロンプト版など）が可能
├─ ロールバック時に古いバージョンを参照可能
└─ パイプラインの段階的改善が可能
```

---

## 8. エラーハンドリングとフォールバック

```
Step 03 - Extract Clips
├─ Proxy video generation 失敗
│  └─ Continue（非ブロッキング）- optional
└─ Thumbnail extraction 失敗
   └─ Continue（非ブロッキング）- optional

Step 04 - Label Clips
├─ Gemini API error
│  ├─ Retry: 3回、exponential backoff (2s → 30s)
│  └─ Timeout: 2分
└─ Clip skip（エラー時）

Step 05 - Build Events
└─ 既存の manual edits を保持（source: "hybrid"）

Step 10 - Detect Events
├─ Insufficient tracking data
│  └─ Return empty collections（非ブロッキング）
└─ Low-confidence events
   └─ pendingReviews collection に格納（ユーザー確認待ち）

Step 06 - Compute Stats
├─ 空のコレクション
│  └─ 計算器が空の出力を返す（非ブロッキング）
└─ バージョンフィルター結果が空
   └─ 新しいデータが生成されていない可能性
```

---

## 9. パフォーマンス最適化ポイント

```
Step 03 - Extract Clips:
├─ FFmpeg モーション/オーディオ分析: Heavy
└─ Proxy video 生成: Heavy（並列実行で高速化可能）

Step 04 - Label Clips:
├─ 制限: MAX_CLIPS_PER_RUN = 30（API costs管理）
└─ Gemini API call: 1回 = ~2秒

Step 10 - Detect Events:
├─ Track proximity analysis: Light (O(n²) frame comparison)
├─ Batch writes: 400 documents/batch（Firestore 500制限以下）
└─ In-memory data structures: O(n) space

Step 06 - Compute Stats:
├─ データ取得: version filter で不要なデータを除外
├─ 並列計算: 8つの計算器を Promise.all() で実行
└─ Batch writes: merge: true で既存データと統合

推奨最適化:
├─ Step 03: FFmpeg 処理をワーカープール化
├─ Step 04: Context caching（90%コスト削減可能）
├─ Step 10: 段階的イベント検出（大規模試合向け）
└─ Step 06: キャッシュレイヤー（同じ version で複数回実行時）
```
