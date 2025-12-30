# Soccer Analyzer — Implementation Plan (Split by Frontend / Backend in One File)

This single plan document contains two separated plans for parallel implementation by different engineers.

---

## Part A — Frontend (Mobile) Plan (Expo React Native + NativeWind + Firestore)

### A0) Scope / Responsibilities
- Mobile app only (no heavy video processing on device)
- Upload match video → show progress
- Show analysis status (queued/running/done/error)
- Browse candidate clips + event labels + summaries
- Show stats dashboard (confidence-aware)
- Provide optional “accuracy boosters” settings UI
- Provide manual corrections:
  - player roster / jersey numbers
  - formation setup
  - tag involved players per event/clip

### A1) Project Setup
- [ ] Ensure `apps/mobile` runs with Expo
- [ ] expo-router routing works (`app/_layout.tsx`, tabs)
- [ ] NativeWind configured and `className` styling works
- [ ] Firebase client config via `EXPO_PUBLIC_*` env vars (app.config.ts)
- [ ] Import shared types/metric keys from `@soccer/shared`
- [ ] Lint + typecheck scripts succeed

### A2) shadcn-like UI Layer (Native)
> Implement shadcn/ui-like APIs for RN using NativeWind + small wrappers.

- [ ] `components/ui/button.tsx` (variants: default/outline)
- [ ] `components/ui/card.tsx` (Card, CardHeader, CardTitle, CardContent)
- [ ] `components/ui/badge.tsx`
- [ ] `components/ui/progress.tsx`
- [ ] `components/ui/tabs.tsx`
- [ ] `components/ui/toast.tsx` (wrap a toast lib or custom)
- [ ] (optional) `sheet.tsx` (BottomSheet wrapper)
- [ ] (optional) `dialog.tsx` (Modal wrapper)
- [ ] Theme tokens: `lib/theme/tokens.ts` + Tailwind color mapping
- [ ] Utility: `lib/cn.ts`

### A3) Screens & Flows (expo-router)
- [ ] Matches list (`/(tabs)/index`)
  - [ ] list matches from Firestore
  - [ ] show status + lastRunAt
- [ ] Match create + upload flow
  - [ ] select video
  - [ ] upload to Firebase Storage
  - [ ] create/update `matches/{matchId}` with `video.storagePath`
  - [ ] show upload progress + retry
- [ ] Match dashboard
  - [ ] summary cards (event counts, top moments, confidence)
  - [ ] “Improve accuracy” CTA
- [ ] Clips list
  - [ ] thumbnails virtualization
  - [ ] filters by label / confidence
- [ ] Clip detail (player tagging)
  - [ ] video player for clip
  - [ ] show gemini label/summary/tags
  - [ ] tag involved players (select jerseyNo quickly)
  - [ ] write to `events/{eventId}.involved.players`
- [ ] Stats screen
  - [ ] show metrics grouped
  - [ ] show confidence per metric
  - [ ] show explanation tooltips
- [ ] Settings (accuracy boosters)
  - [ ] attack direction toggle
  - [ ] team colors
  - [ ] camera position/direction court UI (rough)
  - [ ] formation editor
  - [ ] roster (jersey numbers)

### A4) Data Access Patterns
- [ ] Use Firestore realtime subscriptions for match status, clips/events/stats
- [ ] Cache thumbnails/clip lists locally (simple memo + list virtualization)
- [ ] Optimistic updates for manual tagging, revert on failure
- [ ] Handle partial data gracefully (missing clips, missing stats)

### A5) Quality / UX
- [ ] Loading/empty/error states on every screen
- [ ] Offline-ish behavior: show cached last results when possible
- [ ] Guardrails: warn user when settings changes trigger recompute
- [ ] Analytics (optional): track funnel (upload → view clips → tag players)

---

## Part B — Backend Plan (Firebase Functions + Cloud Run Analyzer)

### B0) Scope / Responsibilities
- Orchestrate analysis when video is uploaded or settings change
- Generate artifacts:
  - shots (segments)
  - candidate clips + thumbnails
  - gemini labels
  - events
  - stats (calculator plug-in outputs)
- Store outputs in Firestore + Firebase Storage
- Provide re-run capability (versioned outputs)

### B1) Infra / Runtime
- [ ] Firebase project + service accounts
- [x] Firestore rules/indexes baseline (`infra/`)
- [ ] Firebase Storage bucket for videos/clips/thumbs
- [ ] Cloud Run service `services/analyzer` deployed with secrets:
  - [ ] Gemini API key
  - [ ] Firebase admin credentials (or workload identity)
- [ ] Functions `functions/` deployed (triggers + enqueue)
- [x] Backend runbook (`docs/backend_runbook.md`)

### B2) Job Orchestration
- [x] `jobs/{jobId}` schema (status, type, matchId, step, progress, error)
- [x] Trigger: on `matches/{matchId}` write when `video.storagePath` appears → enqueue `analyze_match`
- [x] Trigger: on `matches/{matchId}.settings` change → enqueue `recompute_stats` (or `relabel_and_stats`)
- [x] Worker strategy:
  - [x] simplest: Cloud Run endpoint invoked with `{matchId}` to run pipeline
  - [x] idempotent steps based on `(matchId, PIPELINE_VERSION, PROMPT_VERSION)`
- [x] Status updates:
  - [x] update `matches/{matchId}.analysis.status` throughout pipeline
  - [x] set job status in `jobs`

### B3) Media Processing (ffmpeg)
- [x] Extract metadata (ffprobe):
  - [x] duration, fps, resolution
  - [x] write back to `matches/{matchId}.video.*`
- [x] Shot detection (best-effort):
  - [x] detect hard cuts
  - [x] optionally detect heavy pan/zoom segments
  - [x] write `shots/{shotId}` with `t0/t1` + type + thumb
- [x] Candidate clip extraction:
  - [x] generate low-res proxy (e.g., 240p) for analysis
  - [x] motion proxy scores at 1–2 fps (frame diffs)
  - [x] audio peaks (RMS)
  - [x] produce windows (e.g., t-8..t+12)
  - [x] merge overlaps + cap max clips
  - [x] export clip mp4 + thumbnails to Storage
  - [x] create `clips/{clipId}` docs

### B4) Gemini Labeling (Clip-level Only)
- [x] Prompt versioned output (strict JSON):
  - label, confidence, title, summary, tags, coachTips
- [ ] Call strategy:
  - [x] use cheaper model for primary classification
  - [x] retry on invalid JSON with repair prompt
  - [x] store raw response (optional) for debugging
- [x] Write results into `clips/{clipId}.gemini`

### B5) Events Builder
- [x] Convert labeled clips to `events/{eventId}`
  - [x] map clip label → event label enum
  - [x] carry confidence/title/summary
  - [x] source = gemini
- [x] Keep manual edits safe:
  - [x] if event already exists with manual tags, merge carefully

### B6) Stats System (Calculator Plug-in)
> Key requirement: easy to add new stats later without schema changes.

- [x] Implement `calculators/registry.ts`
- [x] Each calculator returns:
  - scope: match|player
  - playerId? (optional)
  - metrics: Record<metricKey, any>
  - confidence: Record<metricKey, number>
  - explanations: Record<metricKey, string>
- [x] Persist to `matches/{matchId}/stats/{statId}` with:
  - [x] version, computedAt, pipelineVersion
- [x] MVP calculators (distance not required now):
  - [x] match summary: event counts, top moments
  - [x] player involvement: from manual tags (events.involved.players)
  - [x] proxy sprint metrics: from motion intensity per clip/shot (relative)
  - [x] heatmap v1: zone-based (manual or simple heuristics), confidence low initially

### B7) Reprocessing / Versioning
- [x] `PIPELINE_VERSION`, `PROMPT_VERSION` stored in outputs
- [x] Recompute rules:
  - settings change:
    - recompute stats always
    - optionally relabel clips only if requested
  - pipeline version bump:
    - allow running pipeline into new version and mark `matches.analysis.activeVersion`
- [x] Keep old results (do not overwrite), switch active pointers

### B8) Observability / Cost Controls
- [x] Structured logs with `matchId`, `jobId`, `step`
- [x] Error handling + retry policy per step
- [x] Clip cap + model selection to control spend
- [x] Store cost estimate per match (optional)
- [x] Reliability validation checklist in runbook
- [x] Validation log template + failure tracking guidance

---

## Part C — Shared Contract (FE/BE Alignment)

### Data ownership (who writes what)
- [ ] Mobile writes:
  - matches (create + upload metadata)
  - matches.settings (optional)
  - players roster / formation
  - event involvement tags
- [x] Backend writes:
  - shots, clips, events (gemini)
  - stats outputs
  - analysis status fields
  - jobs status

### Required Firestore fields (minimum)
- [x] `matches/{matchId}.video.storagePath`
- [x] `matches/{matchId}.analysis.status`
- [x] `clips/{clipId}.media.clipPath`
- [x] `events/{eventId}.label` + `confidence`
- [x] `stats/{statId}.metrics` + `confidence`

---

## Definition of Done (per part)
### Frontend Done
- [ ] User can upload match video and see progress
- [ ] User can browse clips/events and read summaries
- [ ] User can edit settings and tag players
- [ ] Stats show with confidence + explanation
- [ ] No crashes on missing/partial data

### Backend Done
- [x] Upload triggers analysis job
- [ ] Pipeline produces shots/clips/events/stats reliably for varied camera + dirt fields
- [x] Rerun works on settings change
- [x] Outputs are versioned and idempotent
