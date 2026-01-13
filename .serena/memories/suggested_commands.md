# Suggested Commands for Development

## Core Development Commands

### Starting Development
```bash
# Start mobile app development server
pnpm dev:mobile

# Or start specific workspace
cd apps/mobile && pnpm dev

# Start analyzer service
cd services/analyzer && pnpm dev

# Start specific function locally
cd functions && pnpm build && firebase emulator:start
```

### Building
```bash
# Build all workspaces
pnpm -r build

# Build specific workspace
pnpm --filter @soccer/mobile build
pnpm --filter @soccer/analyzer build
pnpm --filter @soccer/functions build
pnpm --filter @soccer/shared build

# Build just the shared library
cd packages/shared && pnpm build
```

### Type Checking & Linting
```bash
# Type check all workspaces
pnpm typecheck

# Lint all workspaces
pnpm lint

# Type check specific workspace
pnpm --filter @soccer/mobile typecheck
pnpm --filter @soccer/analyzer typecheck

# Run ESLint with auto-fix
cd apps/mobile && pnpm lint -- --fix
cd services/analyzer && pnpm lint -- --fix
```

### Mobile App Specific
```bash
# Start dev server
cd apps/mobile && pnpm dev

# Build and run on iOS simulator
cd apps/mobile && pnpm ios

# Build and run on Android emulator
cd apps/mobile && pnpm android

# Lint
cd apps/mobile && pnpm lint

# Type check
cd apps/mobile && pnpm typecheck
```

### Backend Services
```bash
# Analyzer service
cd services/analyzer && pnpm build
cd services/analyzer && pnpm dev

# Cloud Functions
cd functions && pnpm build
cd functions && pnpm typecheck
cd functions && pnpm lint

# Shared library
cd packages/shared && pnpm build
cd packages/shared && pnpm typecheck
```

## Useful Utilities (Darwin/macOS)

### System Commands
```bash
# List files
ls -la /path/to/directory

# View file contents
cat /path/to/file

# Search in files
grep -r "pattern" /path/to/directory

# Find files by name
find /path/to/directory -name "*.ts" -type f

# Check git status
git status

# View recent commits
git log --oneline -10

# View changes
git diff
git diff HEAD~1
```

### pnpm Monorepo Commands
```bash
# List all workspaces
pnpm ls -r

# Install dependencies (run from root)
pnpm install

# Run script in specific workspace
pnpm --filter @soccer/shared build
pnpm --filter @soccer/mobile dev

# Run script in all workspaces
pnpm -r lint
pnpm -r typecheck

# Add dependency to workspace
pnpm --filter @soccer/shared add zod
pnpm --filter @soccer/mobile add react-native-new-package
```

## Formatting & Code Quality

### Automatic Fixes
```bash
# Fix TypeScript errors where possible
cd packages/shared && pnpm lint -- --fix

# Format with Prettier (if configured)
# Note: Check if prettier is available in eslint config
```

### Verification Workflow
```bash
# Full quality check before committing
pnpm typecheck  # Type check all
pnpm lint       # Lint all
pnpm -r build   # Build all
```

## Common Development Workflows

### Making Changes to Shared Library
1. Edit files in `packages/shared/src/`
2. Run `cd packages/shared && pnpm build`
3. Changes are immediately available to other workspaces via workspace:* reference
4. No need to reinstall dependencies

### Adding New Screen to Mobile App
1. Create new file in `apps/mobile/app/` following Expo Router conventions
2. Edit `apps/mobile/tsconfig.json` if adding path aliases
3. Run `pnpm --filter @soccer/mobile typecheck` to verify types
4. Run `pnpm dev:mobile` to see changes

### Modifying Analysis Pipeline
1. Edit step files in `services/analyzer/src/jobs/steps/`
2. Or edit calculator in `services/analyzer/src/calculators/`
3. Run `cd services/analyzer && pnpm build`
4. Run `pnpm typecheck` to verify
5. If Docker deployment: update Dockerfile if needed

### Adding New Domain Model
1. Create new file in `packages/shared/src/domain/`
2. Export from `packages/shared/src/index.ts`
3. If needs validation: add Zod schema in `packages/shared/src/validation/`
4. Run `cd packages/shared && pnpm build`
5. Use in mobile app or analyzer service

## Environment & Setup

### Project Root Directory
```
/Users/fujiwarakazuma/Works/soccer-analyzer
```

### Key Directories
```
apps/mobile/           - React Native/Expo app
services/analyzer/     - Video analysis backend
functions/             - Firebase Cloud Functions
packages/shared/       - Shared types & schemas
infra/                 - Infrastructure config
docs/                  - Documentation
```

### Version Info
- pnpm: 9.12.3
- TypeScript: 5.5.4
- Node: Must support ES2022 modules
- iOS: For mobile development
- Android SDK: For Android development (optional)

## Git Workflow

### Viewing Changes
```bash
git status              # See modified files
git diff               # See all changes
git diff HEAD~1        # See recent commit changes
git log --oneline      # See commit history
```

### Committing
```bash
git add .              # Stage all changes
git commit -m "message" # Commit with message
git push               # Push to remote
```

### Branch Management
```bash
git checkout -b feature/name  # Create feature branch
git checkout main             # Switch to main
git merge feature/name        # Merge feature
```
