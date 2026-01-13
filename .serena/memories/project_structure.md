# Soccer Analyzer - Project Structure

## Project Overview
This is a monorepo project for analyzing soccer match videos and generating statistics. It's built with TypeScript and uses pnpm as the package manager.

## Monorepo Structure (pnpm Workspaces)

### Directory Layout
```
soccer-analyzer/
├── apps/                    # End-user applications
│   └── mobile/             # React Native mobile app (Expo)
├── services/               # Backend services
│   └── analyzer/           # Video analysis service
├── packages/               # Shared libraries
│   └── shared/             # Shared types, domain models, validation
├── functions/              # Firebase Cloud Functions
├── infra/                  # Infrastructure (Firebase rules, etc.)
├── docs/                   # Documentation
├── data/                   # Data files
└── x-pending/              # Pending work/features
```

## Workspaces Detailed

### 1. apps/mobile (@soccer/mobile)
**Purpose**: React Native mobile application for uploading videos and viewing analysis results
**Type**: Private workspace
**Framework**: React Native with Expo
**Language**: TypeScript + TSX
**Structure**:
- app/ - Expo Router file-based routing
  - (tabs)/ - Tab-based navigation
    - index.tsx - Home/matches screen
    - settings.tsx - Settings screen
  - match/[id]/ - Dynamic match detail routes
    - index.tsx - Match overview
    - stats.tsx - Statistics view
    - settings.tsx - Match settings
    - clips.tsx - Video clips
    - clip/[clipId]/ - Individual clip view
  - upload.tsx - Video upload screen
  - _layout.tsx - Root layout
- components/ - Reusable React components
- lib/ - Utility functions and hooks
  - hooks/useDefaultSettings.ts - Settings hook
- global.css - Global styles

**Key Dependencies**:
- @soccer/shared (workspace dependency)
- Expo 52.0.0
- React Native 0.76.9
- React 18.3.1
- expo-router 4.0.0
- expo-av (video playback)
- expo-image-picker (image selection)
- NativeWind 4.0.1 (Tailwind for React Native)
- React Native Reanimated 3.16.7 (animations)
- React Native Gesture Handler 2.20.2
- Bottom Sheet component
- Firebase 10.12.5
- AsyncStorage

**Scripts**:
- `dev` - Start development server (port 8082)
- `lint` - Run ESLint
- `typecheck` - Type checking with tsc
- `android` - Run on Android emulator
- `ios` - Run on iOS simulator

**Config Files**:
- tsconfig.json - Extends expo/tsconfig.base, strict mode enabled, path aliases
- app.config.ts - Expo configuration
- tailwind.config.js - Tailwind CSS configuration
- metro.config.js - Metro bundler config
- babel.config.js - Babel configuration
- nativewind-env.d.ts - Type definitions

### 2. services/analyzer (@soccer/analyzer)
**Purpose**: Backend video analysis service (Docker-based)
**Type**: Private workspace
**Framework**: Node.js with Express/custom
**Language**: TypeScript
**Architecture**: Multi-step job pipeline

**Structure**:
- src/
  - index.ts - Entry point
  - jobs/
    - runMatchPipeline.ts - Main orchestration
    - steps/ - Sequential processing steps
      - 01_extractMeta.ts - Extract video metadata
      - 02_detectShots.ts - Detect shots/goals
      - 03_extractClips.ts - Extract video clips
      - 04_labelClipsGemini.ts - Use Gemini AI to label clips
      - 05_buildEvents.ts - Build event timeline
      - 06_computeStats.ts - Calculate statistics
      - 07_detectPlayers.ts - Detect players
      - 08_classifyTeams.ts - Classify teams
      - 09_detectBall.ts - Detect ball
      - 10_detectEvents.ts - Detect game events
  - calculators/ - Metric calculation modules
    - registry.ts - Calculator registry
    - passesV1.ts - Pass statistics
    - carryV1.ts - Carry/dribbling statistics
    - possessionV1.ts - Possession tracking
    - turnoversV1.ts - Turnover tracking
    - heatmapV1.ts - Heatmap generation
    - matchSummary.ts - Match summary
    - playerInvolvement.ts - Player involvement metrics
    - proxySprintIndex.ts - Sprint index calculation
  - gemini/ - Google Gemini AI integration
    - labelClip.ts - Clip labeling
    - prompts/ - AI prompt templates
  - firebase/ - Firebase admin integration
    - admin.ts
  - lib/ - Utility functions
    - ids.ts - ID generation
    - storage.ts - Storage operations
    - ffmpeg.ts - Video processing

**Key Dependencies**:
- @soccer/shared (workspace dependency)
- firebase-admin 12.5.0
- zod 3.23.8 (schema validation)

**Scripts**:
- `dev` - Watch mode: node --watch dist/index.js
- `build` - Compile TypeScript
- `typecheck` - Type checking only
- `lint` - Run ESLint

**Config Files**:
- tsconfig.json - ES2022 target, ESNext modules, Bundler resolution
- Dockerfile - Container definition

### 3. packages/shared (@soccer/shared)
**Purpose**: Shared types, domain models, and validation schemas
**Type**: Public workspace (can be published)
**Language**: TypeScript
**Distribution**: CommonJS with type declarations

**Structure**:
- src/
  - index.ts - Main export barrel
  - metricKeys.ts - Metric key definitions
  - version.ts - Version info
  - domain/ - Domain models (core data structures)
    - match.ts - Match entity
    - clip.ts - Video clip entity
    - event.ts - Game event entity
    - stats.ts - Statistics entity
    - settings.ts - Settings/configuration
    - tracking.ts - Tracking data (likely player/ball positions)
    - passEvent.ts - Pass event specialized model
  - validation/ - Zod schemas for runtime validation
    - settings.ts - Settings schema

**Key Dependencies**:
- zod 3.23.8 (schema validation library)

**Scripts**:
- `build` - Compile TypeScript
- `typecheck` - Type checking only
- `lint` - Run ESLint

**Outputs**:
- dist/index.js - Compiled JavaScript
- dist/index.d.ts - Type definitions
- Exported as workspace:* to other packages

**Config Files**:
- tsconfig.json - ES2022 target, declaration maps enabled

### 4. functions (@soccer/functions)
**Purpose**: Firebase Cloud Functions for serverless operations
**Type**: Private workspace
**Language**: TypeScript
**Target**: Firebase Cloud Functions runtime

**Structure**:
- src/
  - index.ts - Main export
  - firebase/ - Firebase initialization
    - admin.ts
  - triggers/ - Trigger handlers
    - onVideoUploaded.ts - Handle video upload events
    - onSettingsChanged.ts - Handle settings changes
    - onJobCreated.ts - Handle job creation
  - enqueue/ - Job enqueueing
    - createJob.ts - Create analysis jobs

**Key Dependencies**:
- @soccer/shared (workspace dependency)
- firebase-admin 12.5.0
- firebase-functions 5.1.1

**Scripts**:
- `build` - Compile TypeScript
- `typecheck` - Type checking only
- `lint` - Run ESLint

**Config Files**:
- tsconfig.json - ES2022 target, CommonJS modules

## Root Configuration

### pnpm-workspace.yaml
```yaml
packages:
  - "apps/*"
  - "services/*"
  - "functions"
  - "packages/*"
```

### Root package.json
- packageManager: pnpm@9.12.3
- Scripts:
  - `dev:mobile` - Start mobile development
  - `lint` - Lint all packages
  - `typecheck` - Type check all packages

### Root tsconfig.json
- Extends expo/tsconfig.base
- Empty compilerOptions (relies on Expo's defaults)

## Dependencies Overview

### Shared Across All:
- TypeScript 5.5.4
- ESLint 9.9.0
- zod 3.23.8 (shared)

### Frontend (Mobile):
- React 18.3.1
- React Native 0.76.9
- Expo 52.0.0
- Expo Router 4.0.0
- NativeWind 4.0.1 (Tailwind for React Native)
- Firebase 10.12.5 (client)

### Backend (Services & Functions):
- Firebase Admin 12.5.0
- Firebase Functions 5.1.1 (functions)

## Build & Development Flow

### Development
- `pnpm dev:mobile` - Start mobile dev server on port 8082
- `pnpm lint` - Run ESLint on all workspaces
- `pnpm typecheck` - Run TypeScript type checking on all workspaces

### Build
Each workspace has its own build process:
- Mobile: Expo handles bundling
- Services: `pnpm --filter @soccer/analyzer build` compiles TypeScript
- Functions: `pnpm --filter @soccer/functions build` compiles TypeScript
- Shared: `pnpm --filter @soccer/shared build` compiles TypeScript

### Key Characteristics
- **Monorepo Pattern**: All packages share versions, use workspace:* references
- **TypeScript**: Strict mode enabled in most packages
- **ESLint**: Shared linting across all workspaces
- **Firebase**: Central backend infrastructure
- **Video Processing**: Service uses FFmpeg and Gemini AI for analysis
- **Mobile-first**: Main user interface is React Native/Expo
