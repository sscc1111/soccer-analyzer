# Pipeline Analysis Report

**Generated**: 2026-01-17  
**Analysis Scope**: Current pipeline implementation vs original/stable version

---

## Executive Summary

The analyzer service has **THREE distinct pipeline implementations** with **environment flags controlling which is used**. Currently, the deployment is configured to use the **LEGACY MULTIPASS pipeline**, which means the newly implemented **Comprehensive Analysis** and **Hybrid Pipeline** features are **NOT being used in production**.

---

## Current Deployment Configuration

### Environment Variables (from `cloudbuild.yaml`)
```bash
ANALYZER_TIER=1                       # Gemini-only mode
USE_CONSOLIDATED_ANALYSIS=false       # ❌ Consolidated (2-call) disabled
USE_HYBRID_PIPELINE=false            # ❌ Hybrid (4-call) disabled  
USE_MULTIPASS_DETECTION=true         # ✅ Legacy multipass enabled
```

### Deployed Service URL
```
https://soccer-analyzer-d66xab245q-uc.a.run.app
```

---

## Pipeline Dispatcher (index.ts)

### Job Type Routing
The main entry point dispatches to different pipelines based on job type:

```typescript
if (type === "analyze_video") {
  // NEW: Video-based pipeline (split videos: firstHalf/secondHalf)
  result = await runVideoPipeline({ matchId, videoId, jobId, type });
} else if (type === "merge_half_analysis") {
  // NEW: Merge results from multiple videos
  result = await mergeHalfResults({ matchId });
} else {
  // LEGACY: Single video per match
  result = await runMatchPipeline({ matchId, jobId, type });
}
```

**Key Finding**: The system now supports **split video analysis** (first half / second half), but the legacy single-video path is still available.

---

## Three Pipeline Modes Comparison

### 1. Legacy Multipass Pipeline (CURRENTLY ACTIVE)
**Enabled when**: `USE_CONSOLIDATED_ANALYSIS=false` AND `USE_HYBRID_PIPELINE=false`

#### Steps (Tier 1 - Gemini only):
1. `extract_meta` - Video metadata extraction
2. `detect_shots` - Shot detection
3. `upload_video_to_gemini` - Upload with context caching
4. `extract_clips` - FFmpeg clip extraction
5. `extract_important_scenes` - Gemini scene detection *(12% weight)*
6. `label_clips` - Gemini clip labeling *(10% weight)*
7. `build_events` - Event construction *(8% weight)*
8. `detect_events_gemini` - Event detection with optional multipass:
   - If `USE_MULTIPASS_DETECTION=true` (CURRENT):
     - `segment_video` (07a) - Segment into active/stoppage/setpiece
     - `detect_events_windowed` (07b) - Overlapping window detection
     - `deduplicate_events` (07c) - Deduplication
     - `verify_events` (07d) - Low-confidence verification
     - `supplement_clips` (07e) - Uncovered event clips
   - Else: Single-pass detection *(18% weight)*
9. `identify_players_gemini` - Player identification *(12% weight)*
10. `generate_tactical_insights` - Tactical analysis *(8% weight)*
11. `generate_match_summary` - Match summary *(7% weight)*
12. `compute_stats` - Statistics calculation *(5% weight)*

**Characteristics**:
- **20+ API calls** to Gemini
- **Multiple specialized steps** for each analysis aspect
- **Highest granularity** but highest cost
- **Most tested** and stable

---

### 2. Consolidated Analysis (2-Call Architecture)
**Enabled when**: `USE_CONSOLIDATED_ANALYSIS=true`

#### Steps:
1-4. Same as legacy (extract_meta, detect_shots, upload, extract_clips)
5. **`comprehensive_analysis`** *(55% weight)* - Single Gemini call returns:
   - segments
   - events
   - scenes
   - players
   - clipLabels
6. **`summary_and_tactics`** *(20% weight)* - Text-only analysis (no video)
7. Skip `compute_stats` (calculated inline)

**Characteristics**:
- **2 API calls** (vs 20+)
- **90%+ cost reduction**
- **Single comprehensive prompt** with full schema
- **Newer implementation** (less battle-tested)

**Implementation Files**:
- `services/analyzer/src/gemini/comprehensiveAnalysis.ts`
- `services/analyzer/src/jobs/steps/04_comprehensiveAnalysis.ts`
- `services/analyzer/src/jobs/steps/05_summaryAndTactics.ts`

---

### 3. Hybrid Pipeline (4-Call Architecture)
**Enabled when**: `USE_HYBRID_PIPELINE=true`

#### Steps:
1-4. Same as legacy (extract_meta, detect_shots, upload, extract_clips)
5. **`segment_and_events`** *(25% weight)* - Call 1: Segments + Events
6. **`scenes_and_players`** *(20% weight)* - Call 2: Scenes + Players (uses Call 1 context)
7. **`label_clips_hybrid`** *(15% weight)* - Call 3: Batch clip labeling
8. **`summary_and_tactics`** *(20% weight)* - Call 4: Summary + Tactics (text-only)
9. Skip `compute_stats` (calculated inline)

**Characteristics**:
- **4-5 API calls** (middle ground)
- **Balance between quality and cost**
- **Contextual chaining** (each call uses previous results)
- **Newest implementation**

**Implementation Files**:
- `services/analyzer/src/jobs/steps/04a_segmentAndEvents.ts`
- `services/analyzer/src/jobs/steps/04b_scenesAndPlayers.ts`
- `services/analyzer/src/jobs/steps/04c_labelClipsHybrid.ts`
- `services/analyzer/src/jobs/steps/04d_summaryAndTacticsHybrid.ts`

---

## Key Implementation Changes

### New Features Added (Since Initial Commit)

1. **Video Pipeline** (`runVideoPipeline.ts`)
   - Supports split video analysis (firstHalf/secondHalf/single)
   - Per-video subcollection storage
   - Video document status tracking

2. **Half Merger** (`lib/halfMerger.ts`)
   - Merges results from multiple video analyses
   - Combines events, stats, and tactical insights

3. **Context Caching**
   - `GEMINI_CONTEXT_CACHE_ENABLED=true`
   - Cache creation timeout dynamically calculated based on video duration
   - Reduces redundant video processing

4. **Comprehensive Analysis Module**
   - Single-call video analysis
   - JSON schema validation
   - Event statistics calculation
   - Token calculation based on video duration

5. **Multipass Event Detection**
   - Windowed detection (07b)
   - Deduplication (07c)
   - Verification (07d)
   - Clip supplementation (07e)

6. **Player Tracking Improvements**
   - Dynamic tracking consistency calculation
   - TrackDoc integration (Section 5.2.2)
   - Confidence scoring based on actual frames

---

## Architecture Comparison

### API Call Count
```
Legacy Multipass:        20+ calls
Hybrid (4-call):         4-5 calls   (75-80% reduction)
Consolidated (2-call):   2 calls     (90% reduction)
```

### Cost vs Quality Trade-off
```
Legacy:        Highest cost, most granular, most tested
Hybrid:        Medium cost, good quality, contextual
Consolidated:  Lowest cost, single prompt, newer
```

### Progress Tracking Weights
All three modes have different step weights configured in `STEP_WEIGHTS`:
- Legacy focuses on granular steps (8-18% each)
- Consolidated has large steps (55% + 20%)
- Hybrid has balanced steps (15-25% each)

---

## Critical Finding: Mismatch Between Code and Deployment

### What the Code Says
The latest commit message states:
```
feat: Implement comprehensive analysis and hybrid pipeline for soccer video processing
```

### What's Actually Running
```bash
USE_CONSOLIDATED_ANALYSIS=false
USE_HYBRID_PIPELINE=false
```

**Conclusion**: The new pipeline features have been **implemented** but are **not enabled** in the deployed environment.

---

## Recommendations

### Option 1: Enable Consolidated Analysis (Aggressive Cost Reduction)
```yaml
USE_CONSOLIDATED_ANALYSIS=true
USE_HYBRID_PIPELINE=false
```
**Pros**: 90% cost reduction, fastest processing  
**Cons**: Newest code, less battle-tested, single prompt dependency

### Option 2: Enable Hybrid Pipeline (Balanced Approach)
```yaml
USE_CONSOLIDATED_ANALYSIS=false
USE_HYBRID_PIPELINE=true
```
**Pros**: 75-80% cost reduction, contextual chaining, better quality than consolidated  
**Cons**: Still newer code, more API calls than consolidated

### Option 3: Keep Legacy (Current - Safe but Expensive)
```yaml
USE_CONSOLIDATED_ANALYSIS=false
USE_HYBRID_PIPELINE=false
USE_MULTIPASS_DETECTION=true
```
**Pros**: Most tested, highest granularity  
**Cons**: Highest cost, slowest processing

### Option 4: Gradual Rollout
1. Test consolidated/hybrid on a subset of videos
2. Compare output quality with legacy
3. Monitor costs and error rates
4. Gradually increase percentage of new pipeline usage

---

## Testing Status

### Existing Tests
- Legacy pipeline: **662 tests passing**
- Player tracking: **116 tests passing**
- Event detection: Multiple test files

### Missing Tests
- No integration tests found for:
  - Consolidated analysis pipeline
  - Hybrid pipeline
  - Video pipeline (split videos)
  - Half merger

**Recommendation**: Add integration tests before enabling new pipelines in production.

---

## Environment Variable Summary

### Critical Flags
| Variable | Current | Purpose |
|----------|---------|---------|
| `ANALYZER_TIER` | `1` | 1=Gemini only, 2=Gemini+YOLO |
| `USE_CONSOLIDATED_ANALYSIS` | `false` | Enable 2-call pipeline |
| `USE_HYBRID_PIPELINE` | `false` | Enable 4-call pipeline |
| `USE_MULTIPASS_DETECTION` | `true` | Enable multipass event detection |
| `GEMINI_CONTEXT_CACHE_ENABLED` | `true` | Enable context caching |
| `GEMINI_VIDEO_UPLOAD_FULL` | `true` | Upload full video to Gemini |

### Gemini Configuration
| Variable | Current | Purpose |
|----------|---------|---------|
| `GEMINI_LOCATION` | `us-central1` | Gemini API region |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Model version |
| `PROMPT_VERSION` | `v3` | Prompt version |

---

## Next Steps

1. **Decision Required**: Which pipeline mode to use?
2. **Testing**: Run integration tests on consolidated/hybrid pipelines
3. **Comparison**: Analyze output quality differences between modes
4. **Cost Analysis**: Calculate actual cost differences with production data
5. **Gradual Rollout**: Implement feature flags for per-video pipeline selection
6. **Monitoring**: Add detailed logging/metrics for new pipelines

---

## Files Referenced

### Pipeline Core
- `services/analyzer/src/index.ts` - Main dispatcher
- `services/analyzer/src/jobs/runMatchPipeline.ts` - Legacy pipeline
- `services/analyzer/src/jobs/runVideoPipeline.ts` - Video-based pipeline

### Consolidated Analysis
- `services/analyzer/src/gemini/comprehensiveAnalysis.ts`
- `services/analyzer/src/jobs/steps/04_comprehensiveAnalysis.ts`
- `services/analyzer/src/jobs/steps/05_summaryAndTactics.ts`

### Hybrid Pipeline
- `services/analyzer/src/jobs/steps/04a_segmentAndEvents.ts`
- `services/analyzer/src/jobs/steps/04b_scenesAndPlayers.ts`
- `services/analyzer/src/jobs/steps/04c_labelClipsHybrid.ts`
- `services/analyzer/src/jobs/steps/04d_summaryAndTacticsHybrid.ts`

### Legacy Steps
- `services/analyzer/src/jobs/steps/01_extractMeta.ts`
- `services/analyzer/src/jobs/steps/02_detectShots.ts`
- `services/analyzer/src/jobs/steps/03_uploadVideoToGemini.ts`
- `services/analyzer/src/jobs/steps/04_extractImportantScenes.ts`
- `services/analyzer/src/jobs/steps/07a_segmentVideo.ts`
- `services/analyzer/src/jobs/steps/07b_detectEventsWindowed.ts`
- `services/analyzer/src/jobs/steps/07c_deduplicateEvents.ts`
- And 20+ more step files...

### Configuration
- `cloudbuild.yaml` - Deployment configuration
- `functions/.env` - Local environment variables

---

**Report End**
