# Soccer Analyzer (Scaffold)

This is a starter scaffold generated from the implementation plan.

## What's included
- `apps/mobile`: Expo React Native + NativeWind (Tailwind) + shadcn-like UI layer (native)
- `services/analyzer`: Cloud Run Node/TS skeleton (pipeline steps + calculators registry)
- `functions`: Firebase Functions skeleton (enqueue + triggers)
- `packages/shared`: shared domain types + metric keys + version constants
- `docs`: includes the plan markdown

## Quick start (suggested)
1. Install pnpm
2. `pnpm i`
3. `pnpm dev:mobile`

> NOTE: You still need to create and configure a Firebase project and set environment variables.

## Backend configuration (required)
### Cloud Run `services/analyzer`
- `GEMINI_API_KEY`: Gemini API key
- `GEMINI_MODEL`: model id (default: `gemini-1.5-flash`)
- `MAX_GEMINI_CLIPS`: max clips per run (default: `30`)
- `GEMINI_COST_PER_CLIP_USD`: per-clip USD estimate for cost tracking (optional)

### Firebase Functions `functions`
- `ANALYZER_URL`: Cloud Run endpoint URL
- `ANALYZER_TOKEN`: bearer token for analyzer (optional)

### Match settings flags
- `matches/{matchId}.settings.relabelOnChange = true`  
  Settings変更時に `relabel_and_stats` を実行（既定は `recompute_stats`）

## Implementation plan
- docs/soccer-analyzer_implementation-plan_frontend-backend.md

## Backend runbook
- docs/backend_runbook.md
