# Soccer Analyzer Pipeline Architecture Analysis

## Pipeline Overview
The match analysis pipeline consists of 10 sequential steps, orchestrated in `runMatchPipeline.ts`.

### Step Weights (Total = 100%)
- extract_meta: 5%
- detect_shots: 5%
- extract_clips: 10%
- label_clips: 15%
- build_events: 5%
- detect_players: 20%
- classify_teams: 10%
- detect_ball: 15%
- detect_events: 10%
- compute_stats: 5%

---

## Detailed Step Analysis

### Step 01: Extract Meta (5%)
**File**: `01_extractMeta.ts`
- **Role**: Extract video metadata (duration, dimensions, FPS)
- **Input**: Match document with `video.storagePath`
- **Output**: Updates match.video with {durationSec, width, height, fps, metaVersion}
- **Storage**: Firestore - `matches/{matchId}`
- **Error Handling**: Throws error if video.storagePath missing
- **Data Flow**: Single document update with merge
- **Vertex AI Potential**: None - basic FFmpeg operation

### Step 02: Detect Shots (5%)
**File**: `02_detectShots.ts`
- **Role**: Detect scene cuts in video to identify individual camera shots
- **Input**: Video file, motion analysis
- **Output**: Collection of shots with {shotId, t0, t1, motionAvg, motionType, thumbPath}
- **Storage**: Firestore - `matches/{matchId}/shots`
- **Key Constants**: 
  - MAX_SHOTS: 120
  - MIN_SHOT_SEC: 2
  - MOTION_THRESHOLD: 0.12 (panZoom detection)
- **Algorithm**: 
  1. Detect scene cuts using FFmpeg
  2. Calculate motion scores for time windows
  3. Filter by minimum duration
  4. Create thumbnails for each shot
- **Error Handling**: Skips frame extraction errors, continues
- **Vertex AI Potential**: MEDIUM - Could use Gemini to classify shot types (static camera, following shot, etc.)

### Step 03: Extract Clips (10%)
**File**: `03_extractClips.ts`
- **Role**: Extract interesting clips from shots based on motion/audio peaks
- **Input**: Shots, motion scores, audio levels
- **Output**: Collection of clips with {clipId, shotId, t0, t1, reason, media, motionScore}
- **Storage**: Firestore - `matches/{matchId}/clips`
- **Key Constants**:
  - MAX_CLIPS: 60
  - CLIP_TARGET_SEC: 12
  - PEAK_WINDOW_BEFORE: 8s
  - PEAK_WINDOW_AFTER: 12s
- **Algorithm**:
  1. Extract motion scores (1 FPS) and audio levels (1 FPS)
  2. Identify motion/audio peaks (60% of max)
  3. Create windows around peaks
  4. Merge overlapping windows
  5. Select top 60 by score
  6. Generate proxy video (240p)
- **Error Handling**: Skips proxy creation if fails, continues
- **Data Format**: Clips store clipPath (full video) and thumbPath
- **Vertex AI Potential**: MEDIUM - Could use Gemini to assess visual interest beyond motion/audio

### Step 04: Label Clips with Gemini (15%)
**File**: `04_labelClipsGemini.ts`
- **Role**: Use Gemini vision model to classify clip content
- **Input**: Clips with thumbnail images
- **Output**: Updates clips with {label, confidence, title, summary, tags, coachTips}
- **Storage**: Firestore - `matches/{matchId}/clips/{clipId}` (gemini field)
- **Current Vertex AI Usage**:
  - Model: gemini-2.5-flash-lite (configurable)
  - Uses thumbnail image + prompt
  - Structured output (JSON schema)
  - Retry logic with exponential backoff
  - Temperature: 0.2
- **Constraints**:
  - MAX_CLIPS_PER_RUN: 30 (env var, default 30)
  - COST_PER_CLIP: Configurable for cost tracking
- **Labels**: shot, chance, setPiece, dribble, defense, other
- **Cost Tracking**: Updates match.analysis.cost incrementally
- **Vertex AI Potential**: ALREADY USING - Could enhance with:
  - Multi-modal analysis (clip video + audio)
  - Player identification
  - Tactical analysis
  - Risk assessment for defensive plays

### Step 05: Build Events (5%)
**File**: `05_buildEvents.ts`
- **Role**: Convert Gemini-labeled clips into formalized event documents
- **Input**: Clips with gemini.label
- **Output**: Collection of events with {eventId, clipId, label, confidence, source}
- **Storage**: Firestore - `matches/{matchId}/events`
- **Logic**:
  1. Maps gemini labels to standard event types
  2. Preserves manual edits (source: "manual" or "hybrid")
  3. Maintains existing player involvement data
- **Source Types**: "gemini" (auto), "manual" (user), "hybrid" (both)
- **Vertex AI Potential**: MEDIUM - Could use Gemini for automatic player involvement detection

### Step 06: Compute Stats (5%)
**File**: `06_computeStats.ts`
- **Role**: Run calculator registry to generate statistical summaries
- **Input**: Shots, clips, events, pass/carry/turnover events (Phase 3), possessions
- **Output**: Statistical metrics stored in stats collection
- **Storage**: Firestore - `matches/{matchId}/stats`
- **Data Integration**:
  - Existing: clips, shots, events, events
  - Phase 3: passEvents, carryEvents, turnoverEvents, possessionSegments, trackMappings
- **Calculators**: matchSummary, playerInvolvement, proxySprintIndex, heatmapV1, passesV1, carryV1, possessionV1, turnoversV1
- **Vertex AI Potential**: LOW - Statistical computation, but could use Gemini to generate insights/narrative

### Step 07: Detect Players (20%)
**File**: `07_detectPlayers.ts`
- **Role**: Run YOLO player detection on video frames, apply tracking (ByteTrack/SORT)
- **Input**: Video file
- **Output**: Collection of tracks with {trackId, frames[], avgConfidence, entityType}
- **Storage**: Firestore - `matches/{matchId}/tracks`
- **Algorithm**:
  1. Extract frames at configured FPS (from processingMode)
  2. Run player detection model on each frame
  3. Apply tracking algorithm (currently PlaceholderTracker)
  4. Aggregate detections into continuous tracks
- **Frame Processing**: Batch size 30, with progress tracking
- **Status Tracking**: Updates `matches/{matchId}/trackingStatus/current`
- **Processing Modes**: standard, fast, detailed (define FPS)
- **Error Handling**: Skips failed frame extractions, continues
- **Vertex AI Potential**: MEDIUM - Could use Gemini to verify/classify player types (goalkeeper, defender, midfielder, striker)

### Step 08: Classify Teams (10%)
**File**: `08_classifyTeams.ts`
- **Role**: Use K-means color clustering to classify tracked players into teams
- **Input**: Tracks with frame data, team color hints from settings
- **Output**: Collection of TrackTeamMeta with {trackId, teamId, teamConfidence, dominantColor}
- **Storage**: Firestore - `matches/{matchId}/trackTeamMetas`
- **Algorithm**:
  1. Sample 1 frame per track (middle) for speed
  2. Extract dominant color from uniform area
  3. Filter out gray/neutral colors
  4. Run K-means clustering (k=2) for team separation
  5. Uses team color hints from settings if available
- **Team IDs**: "home", "away", "unknown"
- **Color Extraction**: From normalized bbox position in frame
- **Performance**: Processes tracks in parallel batches (5 tracks at once)
- **Vertex AI Potential**: HIGH - Could use Gemini vision to:
  - Verify team classification visually
  - Detect referee/substitute uniforms
  - Handle complex scenarios (multiple kits, weather conditions)
  - Analyze jersey numbers and player positions

### Step 09: Detect Ball (15%)
**File**: `09_detectBall.ts`
- **Role**: Run YOLO ball detection on frames, apply Kalman filtering
- **Input**: Video file
- **Output**: BallTrackDoc with {detections[], visibilityRate, avgConfidence}
- **Storage**: Firestore - `matches/{matchId}/ballTrack/current`
- **Algorithm**:
  1. Extract frames at configured FPS
  2. Run ball detection model
  3. Apply Kalman filter for temporal smoothing
  4. Interpolate missing detections (up to 1 second)
  5. Decay confidence for interpolated frames
- **Kalman Filter**: 2D position tracking with velocity prediction
- **Confidence Threshold**: Varies by camera zoom hint (near: 0.6, mid: 0.4, far: 0.3)
- **Visibility Tracking**: Tracks visible vs. interpolated detections
- **Error Handling**: Marks extraction failures as "not visible"
- **Vertex AI Potential**: MEDIUM - Could use Gemini to detect ball-related context (out of bounds, in play status)

### Step 10: Detect Events (10%)
**File**: `10_detectEvents.ts`
- **Role**: Analyze ball-player interactions to detect passes, carries, turnovers
- **Input**: Tracks with team assignments, ball track, settings
- **Output**: {possessionSegments, passEvents, carryEvents, turnoverEvents, pendingReviews}
- **Storage**: Firestore - `matches/{matchId}/{collections}`
- **Event Detection Process**:
  1. Build track data with team/player mappings
  2. Analyze ball-player proximity
  3. Detect possession segments
  4. Extract pass events (ball transfer between teams)
  5. Extract carry events (ball movement in possession)
  6. Extract turnover events (possession change)
  7. Flag low-confidence events for review
- **Data Integration**: Uses trackMappings (player identification)
- **Pending Reviews**: Stores events needing human validation
- **Vertex AI Potential**: HIGH - Could use Gemini to:
  - Verify event classification
  - Add contextual information (pass type, carry difficulty)
  - Detect offsides, fouls, handball
  - Generate event narratives/summaries

---

## Data Storage Schema

### Main Collections
```
matches/{matchId}/
  ├── shots/        → ShotDoc (t0, t1, motionType, thumbPath)
  ├── clips/        → ClipDoc (t0, t1, gemini{label, confidence, title, summary, tags, coachTips})
  ├── events/       → EventDoc (clipId, label, confidence, source)
  ├── tracks/       → TrackDoc (frames[], avgConfidence, entityType)
  ├── trackTeamMetas/  → TrackTeamMeta (teamId, dominantColor, teamConfidence)
  ├── ballTrack/    → BallTrackDoc (detections[], visibilityRate)
  ├── passEvents/   → PassEventDoc (ballTransfer between players)
  ├── carryEvents/  → CarryEventDoc (ball movement in possession)
  ├── turnoverEvents/ → TurnoverEventDoc (possession change)
  ├── possessionSegments/ → PossessionSegment (time segments by team)
  ├── trackMappings/ → TrackPlayerMapping (track → player ID mapping)
  ├── pendingReviews/ → PendingReviewDoc (events needing validation)
  ├── stats/        → StatsOutput (computed metrics)
  └── trackingStatus/current → TrackingProcessingStatus (progress tracking)
```

### Version Control
- Each pipeline run generates version-specific documents
- Version is tracked in: video.metaVersion, shots.version, clips.version, etc.
- Allows comparison across different analysis runs
- Stats are keyed by version for reproducibility

---

## Vertex AI Integration Opportunities

### Current Usage (Step 04)
- **Model**: Gemini 2.5 Flash Lite
- **Capabilities**: Vision + structured JSON output
- **Input**: Thumbnail image + prompt
- **Rate**: 30 clips per run (configurable)
- **Cost**: Tracked incrementally

### High Priority Enhancements (Gemini Vision)

#### 1. Step 08 - Team Classification Enhancement
- **Why**: Color clustering alone fails in complex scenarios
- **What**: Use Gemini to verify team assignments
- **Input**: Frame crops of players with jersey visibility
- **Output**: Confidence-weighted team classification
- **Example**: "Home team wears red jersey #7, Away team wears blue"

#### 2. Step 10 - Event Verification & Classification
- **Why**: Ball-proximity analysis misses context
- **What**: Use Gemini to analyze event video clips
- **Input**: Short video clip of possession/pass/carry
- **Output**: Event type confidence, player involvement, event narrative
- **Example**: "Pass from midfielder to striker, ~5m distance, successful"

#### 3. New Step - Player Identification
- **Why**: Current tracking is anonymous
- **What**: Use Gemini to identify jersey numbers, positions, characteristics
- **Input**: Tracked player frames, jersey detection
- **Output**: Player → track mapping with confidence
- **Example**: "Track #42 is likely player #7 based on jersey number and position"

### Medium Priority Enhancements

#### 4. Step 05 - Event Narratives
- **Why**: Events lack human-readable descriptions
- **What**: Use Gemini to generate match narratives
- **Input**: Event sequence, player/team context
- **Output**: Natural language event descriptions, tactical commentary
- **Example**: "Quick counter-attack: pass to forward, shot attempt blocked"

#### 5. Step 07 - Player Type Classification
- **Why**: Need to identify goalkeeper, defenders, midfielders, forwards
- **What**: Use Gemini to classify by position/movement patterns
- **Input**: Track trajectory, field position, movement patterns
- **Output**: Position classification with confidence

#### 6. Step 09 - Ball Context Analysis
- **Why**: Ball detection alone doesn't explain game state
- **What**: Analyze ball-player interactions
- **Input**: Ball position + nearby player tracks
- **Output**: In-play status, possession holder, threat level

### Lower Priority (Statistical/Summary Generation)

#### 7. Step 06 - Match Insights Generation
- **Why**: Raw stats don't tell the story
- **What**: Use Gemini to generate match insights and analysis
- **Input**: Computed statistics, event sequences, team patterns
- **Output**: Match summary, key moments, tactical analysis

---

## Error Handling Patterns

1. **Graceful Degradation**: Missing optional outputs don't block pipeline
   - Skip frame extraction errors, continue with available data
   - Proxy video generation failure is non-blocking
   - Missing thumbnails don't prevent clip creation

2. **Retry Logic**: 
   - Gemini calls: 3 retries with exponential backoff (2s → 30s)
   - 2-minute timeout for Gemini requests
   - Step-level retry in pipeline: 1 retry after 1s delay

3. **Status Tracking**:
   - Real-time progress updates to `trackingStatus` collection
   - Detailed error logging with context
   - Cost tracking for paid API calls

4. **Data Validation**:
   - Zod schema validation for Gemini responses
   - Fallback to original response if repair fails
   - Type checking at database boundaries

---

## Performance Characteristics

### Memory Efficiency
- Batch processing: 30 frames at a time (Steps 07, 09)
- Track processing: 5 parallel operations (Step 08)
- Firestore batch writes: 400 documents per batch

### Computational Cost
- Video extraction: Heavy (FFmpeg operations)
- Player detection: Heavy (YOLO model inference)
- Color clustering: Light (K-means on ~100 samples)
- Gemini calls: Heavy (API cost + latency)

### Processing Time (Estimated)
- Full pipeline: 5-15 minutes depending on video length
- Dominant bottleneck: Player detection + Ball detection
- Gemini labeling: ~5-10 seconds per clip

---

## Job Type Variations

### analyze_match (Full Pipeline)
- Runs all 10 steps
- Generates new version of all data

### relabel_and_stats (Partial Pipeline)
- Runs: label_clips (04) → build_events (05) → compute_stats (06)
- Use case: Re-run analysis with updated prompts/settings

### recompute_stats (Minimal Pipeline)
- Runs: compute_stats (06) only
- Use case: Regenerate stats from existing data
