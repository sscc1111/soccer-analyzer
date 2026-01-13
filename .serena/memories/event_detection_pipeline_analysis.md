# Event Detection Pipeline - Complete Implementation Analysis

## Overview
The soccer analyzer uses a **Gemini-first architecture** for event detection with multiple pipeline steps that leverage Gemini vision API for video analysis. The pipeline combines both Gemini-based vision analysis and rule-based tracking algorithms.

---

## Architecture Layers

### Layer 1: Gemini Infrastructure
- **REST API Client** (`gemini3Client.ts`): Direct REST API calls to Gemini
- **Cache Management** (`cacheManager.ts`): Metadata tracking for context caching (NOT fully implemented)
- **File Management** (`fileManager.ts`): GCS file URI preparation and validation

### Layer 2: Gemini-Based Event Detection Steps
1. **Step 03**: Upload video to Gemini (cache preparation)
2. **Step 04**: Extract important scenes from video
3. **Step 07**: Detect tactical events (pass, carry, turnover, shot, set piece)
4. **Step 08**: Identify players (jersey numbers, team colors, roles)

### Layer 3: Traditional Tracking-Based Detection
- **Step 10**: Detect events from tracking data (passes, carries, turnovers from player/ball proximity)

---

## Detailed Step Analysis

### Step 03: Upload Video to Gemini
**File**: `services/analyzer/src/jobs/steps/03_uploadVideoToGemini.ts`

**Purpose**: Prepare video for Gemini analysis by creating context cache metadata

**Key Functions**:
- Video validation (size, format)
- GCS URI preparation
- Context cache creation/retrieval
- System instruction building

**System Instruction** (sent to Gemini):
```
あなたはサッカー分析の専門家です。

## 分析の観点
1. プレイヤーの動き（ポジショニング、ランニング、プレッシング）
2. ボールの動き（パス、ドリブル、シュート）
3. チームの戦術（フォーメーション、攻撃パターン、守備組織）
4. 重要なイベント（ゴール、チャンス、セットピース、ターンオーバー）

## チーム識別
- ユニフォームの色でホーム/アウェイを区別
- ゴールキーパーは異なる色のユニフォーム
- 審判は通常黒または蛍光色

## 出力形式
- すべての応答は JSON 形式で返してください
- タイムスタンプは秒単位（小数点以下1桁）で記録
- 信頼度は 0.0 〜 1.0 の範囲で評価

## 重要
- 不確実な情報には低い信頼度を設定
- 見えない/不明確な情報は推測せず "unknown" と記録
```

**Important**: Context caching is **NOT fully implemented** - only metadata tracking exists. True Vertex AI cachedContents API is not called.

---

### Step 04: Extract Important Scenes
**File**: `services/analyzer/src/jobs/steps/04_extractImportantScenes.ts`

**Purpose**: Use Gemini to identify important match scenes

**Prompt File**: `clip_label_v1.json` (for clip labeling)

**Prompt Content** (Scene Extraction v1):
```json
{
  "version": "scene_extraction_v1",
  "task": "サッカー試合動画から重要なシーンを抽出し、JSONで返す",
  "extraction_criteria": [
    "ゴールチャンス（シュート、決定機）",
    "セットピース（コーナー、フリーキック、PK）",
    "危険なドリブル突破",
    "重要なディフェンス（タックル、インターセプト）",
    "ターンオーバー（ボール奪取、パスカット）",
    "ゴールシーン",
    "キーパーのセーブ"
  ],
  "output_schema": {
    "scenes": {
      "type": "array",
      "items": {
        "startSec": "number",
        "endSec": "number",
        "type": "shot|chance|setPiece|dribble|defense|turnover|goal|save|other",
        "importance": "number (0.0-1.0)",
        "description": "string",
        "team": "home|away|unknown",
        "confidence": "number (0.0-1.0)"
      },
      "maxItems": 60
    }
  },
  "constraints": {
    "max_scenes": 60,
    "min_scene_duration_sec": 3,
    "max_scene_duration_sec": 30
  }
}
```

**Processing**:
- Calls Gemini with full video + prompt
- Temperature: 0.3, maxOutputTokens: 8192
- Validates response against ScenesResponseSchema (Zod)
- Saves to `matches/{matchId}/importantScenes` collection
- Retry logic: 3 retries, 2s-30s backoff, 5min timeout

---

### Step 07: Detect Events with Gemini
**File**: `services/analyzer/src/jobs/steps/07_detectEventsGemini.ts`

**Purpose**: Use Gemini vision to detect tactical events (passes, carries, turnovers, shots, set pieces)

**Prompt File**: `event_detection_v1.json`

**Complete Prompt Content**:
```json
{
  "version": "v1",
  "task": "Detect tactical events from a soccer match video including passes, carries, turnovers, shots, and set pieces.",
  "instructions": "この試合動画から、以下のイベントを検出してください。

## 検出対象
1. パス: ボールが選手間で移動
   - passType: short | medium | long | through | cross
   - outcome: complete | incomplete | intercepted

2. キャリー: 選手がボールを持って移動
   - distance: 移動距離（推定メートル）

3. ターンオーバー: チーム間でボール所持が変わる
   - type: tackle | interception | bad_touch | out_of_bounds | other

4. シュート: ゴールへの攻撃
   - result: goal | saved | blocked | missed

5. セットピース
   - type: corner | free_kick | penalty | throw_in

## 注意事項
- タイムスタンプは秒単位（小数点以下1桁）
- team は home または away で識別
- player は背番号 (#10 など) または位置で識別
- confidence は 0.0〜1.0 の範囲",
  "output_schema": {
    "events": [
      {
        "timestamp": "number (seconds)",
        "type": "pass | carry | turnover | shot | setPiece",
        "team": "home | away",
        "player": "string (jersey number or description)",
        "details": {
          "passType": "short | medium | long | through | cross (for pass)",
          "outcome": "complete | incomplete | intercepted (for pass)",
          "targetPlayer": "string (for pass)",
          "distance": "number (meters, for carry)",
          "turnoverType": "tackle | interception | bad_touch | out_of_bounds | other (for turnover)",
          "shotResult": "goal | saved | blocked | missed (for shot)",
          "setPieceType": "corner | free_kick | penalty | throw_in (for setPiece)"
        },
        "confidence": "number (0.0-1.0)"
      }
    ]
  }
}
```

**Processing**:
- Sends full video file + JSON prompt to Gemini
- Temperature: 0.2, responseMimeType: "application/json"
- Response schema validation: EventsResponseSchema (Zod)
- Event type mapping:
  - Pass → PassEventDoc (with kicker, receiver, outcome)
  - Carry → CarryEventDoc (with position, distance)
  - Turnover → TurnoverEventDoc (with context type)
  - Shot → ShotEventDoc (with result)
  - SetPiece → SetPieceEventDoc (with type)
- Batch writes to Firestore (max 450 ops per batch to stay under 500 limit)
- Retry: 3 retries, 2s-30s backoff, 10min timeout
- Cache update: increments usage counter if using actual cache

---

### Step 08: Identify Players with Gemini
**File**: `services/analyzer/src/jobs/steps/08_identifyPlayersGemini.ts`

**Purpose**: Use Gemini to identify players, teams, and roles from video

**Prompt File**: `player_identification_v1.json`

**Complete Prompt Content**:
```json
{
  "version": "v1",
  "task": "Identify players, teams, and roles from the soccer match video including jersey numbers, team colors, and player positions.",
  "instructions": "この試合動画から、選手情報を識別してください。

## 識別対象
1. チーム分類
   - home: ホームチーム（ユニフォームの色を記録）
   - away: アウェイチーム

2. 役割識別
   - player: フィールドプレイヤー
   - goalkeeper: ゴールキーパー（異なるユニフォーム色）
   - referee: 審判（通常黒/黄色）

3. 背番号OCR
   - 可能な限り背番号を読み取り
   - 読み取れない場合は null

## 注意事項
- ユニフォームの色は hex カラーコード (#RRGGBB)
- confidence は 0.0〜1.0 の範囲
- 同じ選手が複数回検出される場合は、最も信頼度の高いものを採用",
  "output_schema": {
    "teams": {
      "home": {
        "primaryColor": "string (hex color)",
        "secondaryColor": "string (hex color, optional)",
        "goalkeeperColor": "string (hex color)"
      },
      "away": {
        "primaryColor": "string (hex color)",
        "secondaryColor": "string (hex color, optional)",
        "goalkeeperColor": "string (hex color)"
      }
    },
    "players": [
      {
        "team": "home | away",
        "jerseyNumber": "number | null",
        "role": "player | goalkeeper",
        "confidence": "number (0.0-1.0)"
      }
    ],
    "referees": [
      {
        "role": "main_referee | linesman | fourth_official",
        "uniformColor": "string (hex color)"
      }
    ]
  }
}
```

**Processing**:
- Sends full video + prompt with game format context
- Game format context example:
  ```
  ## 試合フォーマット: 11人制
  - 各チームの選手数: 11人（GK含む）
  - フィールドプレイヤー: 10人
  - 重要: 各チームから最大11人の選手のみを識別してください
  - 同じ選手を複数回カウントしないでください
  ```
- Saves team colors to match settings
- Creates synthetic track IDs for identified players
- Stores in `trackTeamMetas` and `trackMappings` collections
- Retry: 3 retries, 2s-30s backoff, 5min timeout
- Cache update: increments usage counter

---

### Step 10: Detect Events (Tracking-Based)
**File**: `services/analyzer/src/jobs/steps/10_detectEvents.ts`

**Purpose**: Traditional rule-based event detection from tracking data

**Data Sources**:
- Track data (player positions over time)
- Ball track data (ball positions)
- Team meta (which team each player belongs to)
- Track mappings (which player each track represents)

**Algorithm**:
1. Convert tracking data to detection format
2. Analyze ball-player proximity
3. Detect possession segments (continuous ball control)
4. Extract pass events (ball transfer between teams)
5. Extract carry events (ball movement in possession)
6. Extract turnover events (possession change)
7. Flag low-confidence events for review

**Event Types Detected**:
- PassEventDoc: Ball transfer between players
- CarryEventDoc: Ball movement while in possession
- TurnoverEventDoc: Possession loss
- PendingReviewDoc: Events needing manual validation

---

## Prompt Files Summary

### 1. event_detection_v1.json
- **Task**: Detect passes, carries, turnovers, shots, set pieces
- **Input**: Full video file
- **Output**: Array of events with timestamp, type, team, player, details, confidence
- **Event Types**: pass, carry, turnover, shot, setPiece
- **Temperature**: 0.2
- **Max Tokens**: 8192

### 2. player_identification_v1.json
- **Task**: Identify players, teams, roles, jersey numbers
- **Input**: Full video file + game format context
- **Output**: Team colors, player list with jersey numbers, referees
- **Temperature**: 0.2
- **Max Tokens**: Not specified (uses default)
- **Special**: Game format context added dynamically (e.g., "identify exactly 11 players per team")

### 3. scene_extraction_v1.json
- **Task**: Extract important scenes (goals, chances, set pieces, etc.)
- **Input**: Full video file
- **Output**: Scenes with start/end times, type, importance, description, team
- **Max Scenes**: 60
- **Duration Constraints**: 3-30 seconds per scene
- **Temperature**: 0.3
- **Max Tokens**: 8192

### 4. clip_label_v1.json (for Step 04 - Label Clips)
- **Task**: Classify a soccer clip into event label
- **Input**: Clip thumbnail image (JPEG) + prompt
- **Output**: label, confidence, title, summary, tags, coachTips
- **Labels**: shot, chance, setPiece, dribble, defense, other
- **Temperature**: 0.2
- **Max Tokens**: Not specified

### Additional Prompts (Not Yet Implemented):
- **tactical_analysis_v1.json**: Formation analysis, tempo, attack/defense patterns
- **match_summary_v1.json**: Headline, narrative, key moments, player highlights, MVP
- **scene_extraction_v1.json**: Scene identification from video

---

## Data Flow

### Event Detection Data Flow:
```
Video File (GCS)
    ↓
Step 03: Upload Video to Gemini
    ├─ Validate video
    ├─ Create cache metadata
    └─ Store fileUri in match doc
    ↓
Step 04: Extract Important Scenes
    ├─ Call Gemini with full video + scene_extraction prompt
    └─ Save to importantScenes collection
    ↓
Step 07: Detect Events (Gemini)
    ├─ Call Gemini with full video + event_detection prompt
    ├─ Parse JSON response
    └─ Save to passEvents, carryEvents, turnoverEvents, shotEvents, setPieceEvents
    ↓
Step 08: Identify Players (Gemini)
    ├─ Call Gemini with full video + player_identification prompt
    ├─ Extract team colors from response
    ├─ Create trackTeamMetas for identified players
    └─ Store player mappings in trackMappings collection
    ↓
Step 10: Detect Events (Tracking-Based)
    ├─ Read existing tracks and ball data
    ├─ Apply proximity analysis
    └─ Generate additional pass/carry/turnover events
```

---

## API Integration Details

### Gemini API Client
**File**: `gemini3Client.ts`

**Key Functions**:
```typescript
callGeminiApi(
  projectId: string,
  modelId: string,
  request: Gemini3Request
): Promise<Gemini3Response>

generateContent(options: {
  projectId: string;
  modelId: string;
  prompt: string;
  fileUri?: string;
  mimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: "json" | "text";
}): Promise<string>
```

**Request Format**:
```typescript
{
  contents: [
    {
      role: "user",
      parts: [
        {
          fileData: {
            fileUri: "gs://bucket/path/to/video.mp4",
            mimeType: "video/mp4"
          }
        },
        { text: "Prompt text..." }
      ]
    }
  ],
  generationConfig: {
    temperature: 0.2,
    responseMimeType: "application/json",
    maxOutputTokens: 8192
  }
}
```

**Response Handling**:
- Checks for HTML error pages
- Parses JSON response
- Extracts text from candidates
- Handles safety filter blocks
- Token usage tracking

---

## Error Handling & Reliability

### Retry Strategy:
- **Max Retries**: 3 attempts
- **Initial Delay**: 2 seconds
- **Max Delay**: 30 seconds
- **Backoff**: Exponential
- **Timeout**: 
  - Event detection: 10 minutes
  - Scene extraction: 5 minutes
  - Player identification: 5 minutes
  - Clip labeling: 2 minutes

### Validation:
- Zod schema validation for all Gemini responses
- Repair attempts for invalid JSON (retry with repair prompt)
- Low-confidence event flagging (<0.7) for manual review

### Batch Operations:
- Firestore batch size: 400-450 documents per batch (to stay under 500 limit)
- Automatic batching for large event sets

---

## Cost & Performance Metrics

### Token Estimation:
- Gemini processes video at ~258 tokens/second (at 1 FPS)
- Minimum cache size: 32,768 tokens
- Video must be ~127 seconds (~2 min) to justify context caching

### Context Caching:
- **Status**: Metadata tracking only, NOT actually implemented
- **Potential Benefit**: 90% cost reduction if implemented
- **TTL**: 1 hour to 7 days
- **Implementation Needed**: Call cachedContents.create API

### Cost Tracking:
- Cost per clip labeling: Configurable (env: GEMINI_COST_PER_CLIP_USD)
- Stored in `match.analysis.cost` field
- Tracked with geminiCalls count and timestamp

---

## Environment Variables

Required:
- `GCP_PROJECT_ID`: Google Cloud project ID
- `GEMINI_MODEL`: Model ID (default: "gemini-3-flash-preview")
- `STORAGE_BUCKET`: GCS bucket for video storage

Optional:
- `GCP_REGION`: GCP region (default: "us-central1")
- `GEMINI_LOCATION`: Gemini API location (default: "global")
- `MAX_GEMINI_CLIPS`: Max clips per run (default: 30)
- `GEMINI_COST_PER_CLIP_USD`: Cost per clip for tracking (default: 0)
- `CONTEXT_CACHING_ENABLED`: Enable cache metadata (default: true)
- `CACHE_TTL_SECONDS`: Cache TTL (default: 3600)

---

## Implementation Status

### Fully Implemented:
- REST API calls to Gemini 2.5/3 models
- Step 04: Label Clips (with thumbnail image + JSON schema)
- Step 07: Detect Events (full video + JSON schema)
- Step 08: Identify Players (full video + JSON schema)
- Step 04: Extract Important Scenes (full video + JSON schema)
- JSON schema validation and repair

### Partially Implemented:
- Context caching (metadata tracking only, not actual Vertex AI caching)
- File manager validation

### Not Implemented:
- Step 10 uses traditional tracking-based detection (not Gemini)
- Tactical analysis prompt (v1 exists but not used)
- Match summary generation prompt (v1 exists but not used)
- True Vertex AI Context Caching API calls
- Multi-modal input (combining video + audio + text)

---

## Key Findings & Recommendations

### Current Implementation:
1. **Gemini is primary for detection**: Uses vision models for event, scene, and player detection
2. **Flexible prompt architecture**: Easy to add new analysis types via JSON prompts
3. **Cost tracking**: Built-in cost per call monitoring
4. **Robust error handling**: Retry logic, schema validation, repair attempts

### Areas for Enhancement:
1. **True context caching**: Implement actual Vertex AI cachedContents API for 90% cost reduction
2. **Multi-model fusion**: Combine Gemini events with tracking-based events for better accuracy
3. **Real-time scoring**: Move some analyses to real-time processing
4. **Prompt optimization**: Fine-tune prompts based on performance metrics
5. **Confidence-based filtering**: Implement dynamic thresholds based on event type

### Technical Debt:
1. Context caching is only metadata tracking - actual implementation is missing
2. File validation could be more robust
3. Error messages could include more debugging context
4. Rate limiting not implemented (potential API quota issues)
