# Task Completion Checklist

## When Completing Any Development Task

### Code Quality Checks
- [ ] Type checking passes: `pnpm typecheck`
- [ ] Linting passes: `pnpm lint` (or `cd {workspace} && pnpm lint -- --fix` to auto-fix)
- [ ] No TypeScript errors in affected workspace
- [ ] No ESLint warnings in modified files

### Building
- [ ] Affected workspace builds successfully: `cd {workspace} && pnpm build`
- [ ] No build errors or warnings
- [ ] If shared library modified: `pnpm -r build` to ensure dependents build

### Testing Workflow (if applicable)
- [ ] Manual testing completed in relevant environment
  - For mobile: Run on simulator/device
  - For services: Verify via API/CLI
  - For functions: Test with Firebase emulator
- [ ] Check console for runtime errors
- [ ] Verify expected behavior with sample data

### Dependency Updates
- [ ] No unnecessary dependencies added
- [ ] If dependencies changed: `pnpm install` successful
- [ ] If workspace:* reference changed: Verify path aliases in tsconfig.json
- [ ] pnpm-lock.yaml updates are clean

### Git & Version Control
- [ ] All changes staged and ready to commit
- [ ] Commit message is clear and descriptive
- [ ] Related files modified together in single commit
- [ ] No unintended files in staging area

### Mobile App Specific
- [ ] TypeScript paths correct in tsconfig.json
- [ ] Expo Router file structure matches intent
- [ ] No missing imports or type errors
- [ ] Screen layouts render without errors
- [ ] Navigation works as expected
- [ ] Firebase integration functional

### Backend Services Specific
- [ ] All imports resolve correctly
- [ ] Firebase Admin initialization works
- [ ] Zod validation schemas match domain types
- [ ] Error handling implemented
- [ ] Logging adequate for debugging

### Shared Library Changes
- [ ] Type definitions exported correctly from index.ts
- [ ] Validation schemas match domain types
- [ ] No circular dependencies
- [ ] Consumer packages can import and use new types
- [ ] TypeScript strict mode compliance

## Before Final Commit

### Verification Steps
```bash
# 1. Type check everything
pnpm typecheck

# 2. Lint all code
pnpm lint

# 3. Build all affected packages
pnpm -r build

# 4. Verify no uncommitted changes except intended ones
git status
```

### Review Checklist
- [ ] Code follows project conventions (TypeScript strict, proper folder structure)
- [ ] No console.log statements left (unless intentional for debugging)
- [ ] Error handling is appropriate
- [ ] Comments added for complex logic
- [ ] No hardcoded values (use constants or config)
- [ ] Environment variables handled correctly

### Documentation
- [ ] If adding new domain model: Documented in code comments
- [ ] If changing API: Update related comments
- [ ] If complex algorithm: Add explanation comments
- [ ] README.md updated if needed

## Failure Recovery

### If Type Check Fails
- [ ] Review error messages carefully
- [ ] Check workspace tsconfig.json settings
- [ ] Verify path aliases are correct
- [ ] Ensure all imported types are exported
- [ ] Run `pnpm install` if type definitions missing

### If Build Fails
- [ ] Check for syntax errors
- [ ] Verify imports exist
- [ ] Review error stack trace
- [ ] Check if dependencies need building first
- [ ] Try `cd {workspace} && pnpm build` for more detailed output

### If Lint Fails
- [ ] Run with `--fix` flag to auto-fix: `cd {workspace} && pnpm lint -- --fix`
- [ ] Manually fix violations that can't be auto-fixed
- [ ] Review ESLint configuration for the workspace
- [ ] Check if any rules are overly strict

### If Mobile App Won't Run
- [ ] Check Expo version compatibility
- [ ] Clear cache: `cd apps/mobile && rm -rf node_modules .expo`
- [ ] Reinstall: `cd apps/mobile && pnpm install`
- [ ] Check metro bundler errors: `pnpm dev:mobile`

### If Shared Library Changes Break Other Workspaces
- [ ] Verify exports in packages/shared/src/index.ts
- [ ] Rebuild shared: `cd packages/shared && pnpm build`
- [ ] Rebuild dependent: `cd {workspace} && pnpm build`
- [ ] Check path alias correctness in consumer tsconfig.json

## Final Checklist Before Pushing

- [ ] All tests/checks pass
- [ ] Commit message follows conventions
- [ ] No sensitive data in code (API keys, passwords)
- [ ] Code has been reviewed
- [ ] Related issues mentioned in commit/PR
- [ ] Documentation updated if needed
- [ ] No breaking changes without justification

## Common Issues & Solutions

### "Cannot find module" errors
- Check path aliases in tsconfig.json
- Verify file exists at expected location
- Run `pnpm install` to ensure dependencies installed
- Clear node_modules and reinstall if persistent

### TypeScript strict mode violations
- Add proper type annotations
- Avoid `any` type
- Use union types instead of optional
- Check for null/undefined before use

### ESLint violations
- Run with `--fix` flag for auto-fixes
- Read rule documentation for complex violations
- Don't disable rules without commenting why

### Dependency conflicts
- Check pnpm-lock.yaml for duplicates
- Use workspace:* for internal packages
- Keep versions aligned across workspaces
- Use exact versions for critical dependencies

### Build optimization
- Ensure incremental builds work
- Don't commit node_modules
- Keep bundle sizes minimal
- Use code splitting in mobile app
