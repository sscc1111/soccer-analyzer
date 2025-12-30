# Backend Runbook (Firebase Functions + Cloud Run Analyzer)

## Prerequisites
- Firebase project created
- Google Cloud project linked
- `firebase` CLI and `gcloud` installed
- Docker available for Cloud Run build

## Required environment variables
### Cloud Run `services/analyzer`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (default: `gemini-1.5-flash`)
- `MAX_GEMINI_CLIPS` (default: `30`)
- `GEMINI_COST_PER_CLIP_USD` (optional)

### Firebase Functions `functions`
- `ANALYZER_URL` (Cloud Run HTTPS endpoint)
- `ANALYZER_TOKEN` (optional bearer token)

## Deploy checklist
1. Firestore rules / indexes
   - `firebase deploy --only firestore:rules,firestore:indexes`
2. Cloud Run analyzer
   - Build + deploy `services/analyzer` (Docker build includes ffmpeg)
   - Set environment variables above
3. Firebase Functions
   - Deploy functions after setting `ANALYZER_URL` / `ANALYZER_TOKEN`
   - `firebase deploy --only functions`
4. Storage bucket
   - Ensure bucket exists and permissions allow analyzer to read/write

## Validation checklist
- Upload a sample video to Storage and write `matches/{matchId}.video.storagePath`
- Confirm `jobs` doc is created and status transitions to `done`
- Confirm `matches/{matchId}` analysis status updated
- Confirm `shots`, `clips`, `events`, `stats` subcollections populated

## Reliability validation (varied footage)
Validate with at least 5 representative videos and record results:
- Camera distance: near / mid / far
- Camera angle: sideline / endline / corner
- Lighting: indoor / outdoor / night
- Motion: steady / panning / zooming
- Field quality: clean grass / dirt / mixed

For each video:
- Expected: job finishes without error
- Expected: clips >= 1 and events >= 1
- Expected: stats generated with confidence values
- Note any anomalies (missed events, bad labels, excessive clips)

### Validation log template
Record results per video in the following format:

```
video_id: "<id or filename>"
date: "YYYY-MM-DD"
conditions:
  camera_distance: "near|mid|far"
  camera_angle: "sideline|endline|corner"
  lighting: "indoor|outdoor|night"
  motion: "steady|panning|zooming"
  field_quality: "clean|dirt|mixed"
results:
  job_status: "done|error"
  clips_count: <number>
  events_count: <number>
  stats_present: true|false
notes: "free text"
```

### Failure tracking
If a validation run fails, add a new entry to `docs/implementation_failures.yaml`
with `area: "validation"` and include the video id and reason.

## Optional settings
- `matches/{matchId}.settings.relabelOnChange = true`
  - Settings changes trigger `relabel_and_stats` (default is stats-only)
