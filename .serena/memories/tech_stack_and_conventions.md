# Tech Stack & Development Conventions

## Technology Stack Summary

### Core Framework & Language
- **Language**: TypeScript 5.5.4
- **Package Manager**: pnpm 9.12.3
- **Module System**: Mixed (ESNext for services, CommonJS for functions)

### Frontend (Mobile App)
- **Framework**: React Native 0.76.9 + Expo 52.0.0
- **Routing**: Expo Router 4.0.0 (file-based routing)
- **Styling**: NativeWind 4.0.1 (Tailwind CSS for React Native)
- **UI Animations**: React Native Reanimated 3.16.7
- **Gestures**: React Native Gesture Handler 2.20.2
- **State Management**: AsyncStorage for local persistence
- **Video**: expo-av for video playback
- **File Handling**: expo-image-picker for image selection
- **Native UI**: Bottom Sheet (@gorhom/bottom-sheet)
- **Backend Integration**: Firebase 10.12.5 (client SDK)
- **Notifications**: Burnt (toast notifications)
- **Build System**: Metro (React Native bundler) with Babel

### Backend (Services)
- **Video Processing**: FFmpeg integration
- **AI/ML**: Google Gemini API for clip analysis
- **Database/Backend**: Firebase Admin 12.5.0
- **Validation**: Zod 3.23.8
- **Deployment**: Docker (Dockerfile present)

### Cloud Functions
- **Runtime**: Firebase Cloud Functions 5.1.1
- **Admin**: Firebase Admin 12.5.0

### Shared Library
- **Validation**: Zod 3.23.8
- **Distribution**: Built as CommonJS with TypeScript declarations

### Development Tools
- **Linting**: ESLint 9.9.0
- **Type Checking**: TypeScript compiler (tsc)
- **Infrastructure as Code**: Firebase rules (firestore.rules, storage.rules, realtime database rules)

## Development Conventions & Code Style

### TypeScript Configuration
- **Strict Mode**: Enabled across all packages (except mobile uses expo defaults)
- **Module Resolution**: 
  - Mobile: bundler (Expo)
  - Services: Bundler
  - Functions: Node-style resolution
- **Target**:
  - Mobile: ESNext (Expo handles transpilation)
  - Services: ES2022
  - Functions: ES2022
  - Shared: ES2022

### Path Aliases
- Mobile: `@/*` maps to current directory
- Mobile: `@soccer/shared` maps to ../../packages/shared/src
- Services: `@soccer/shared` maps to ../../packages/shared/src/index.ts
- Functions: `@soccer/shared` maps to ../packages/shared/src/index.ts

### File Organization
- **Mobile**: 
  - app/ - Route components with file-based structure
  - components/ - Reusable components
  - lib/ - Utilities and hooks
  - lib/hooks/ - Custom React hooks
  
- **Services**:
  - src/jobs/ - Job orchestration and pipeline steps
  - src/calculators/ - Metric calculation logic
  - src/gemini/ - External AI integration
  - src/firebase/ - Database integration
  - src/lib/ - Shared utilities
  
- **Functions**:
  - src/triggers/ - Event-driven functions
  - src/enqueue/ - Job enqueueing logic
  
- **Shared**:
  - src/domain/ - Core data models/entities
  - src/validation/ - Runtime validation schemas
  - src/metricKeys.ts - Constants and enums

### Code Style Requirements
Based on project structure:
- **TypeScript**: Always use strict type annotations
- **Validation**: Use Zod for runtime data validation
- **Exports**: Use barrel exports (index.ts)
- **Module Pattern**: Consistent workspace references with workspace:*
- **Naming**: Domain-driven design (domain/ folder indicates bounded contexts)

### Linting
- ESLint configuration: Local to each workspace
- Common rules: JavaScript/TypeScript best practices
- No specific code style config visible (likely using ESLint defaults with TypeScript support)

## Project-Specific Patterns

### Video Analysis Pipeline
The services/analyzer follows a step-by-step processing pipeline:
1. Extract metadata from video
2. Detect shots/goals
3. Extract video clips
4. Label clips using Gemini AI
5. Build event timeline
6. Compute statistics
7. Detect players
8. Classify teams
9. Detect ball
10. Detect game events

Calculators (passesV1, carryV1, etc.) compute specific metrics based on tracking data.

### Firebase Integration
- Cloud Firestore for data storage
- Cloud Storage for video/clip storage
- Cloud Functions for serverless processing
- Real-time database rules for security

### Data Flow
1. User uploads video via mobile app
2. Firebase Storage trigger → Cloud Function
3. Cloud Function enqueues analysis job
4. Analysis service processes video through pipeline
5. Results stored in Firestore
6. Mobile app reads results in real-time

## Workspace Dependencies
```
mobile (@soccer/mobile)
  └── depends on @soccer/shared

analyzer (@soccer/analyzer)
  └── depends on @soccer/shared

functions (@soccer/functions)
  └── depends on @soccer/shared

shared (@soccer/shared)
  └── no dependencies on other workspaces
```

All workspace dependencies use `workspace:*` pattern, ensuring local monorepo references.
