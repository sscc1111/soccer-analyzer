# Phase 3 Calculator Tests

Unit tests for the Phase 3 auto-stats calculators in the soccer-analyzer project.

## Test Coverage

### Calculators Tested
- **passesV1** - Pass statistics calculator
- **carryV1** - Carry/dribble statistics calculator
- **possessionV1** - Possession statistics calculator (player and team level)
- **turnoversV1** - Turnover statistics calculator

### Test Scenarios

Each calculator is tested for:

1. **Empty input handling**
   - Returns empty array when no events
   - Handles undefined input gracefully

2. **Single event processing**
   - Correctly processes a single event
   - Calculates metrics accurately
   - Sets appropriate confidence values

3. **Multiple events for same player aggregation**
   - Aggregates multiple events for the same track/player
   - Calculates cumulative metrics correctly
   - Handles different event outcomes/types

4. **Multiple players processed independently**
   - Tracks stats separately for different players
   - Prevents cross-contamination of data

5. **Confidence averaging**
   - Calculates average confidence from multiple events
   - Applies confidence uniformly to all metrics

6. **Track-to-player mapping with fallback**
   - Uses playerId when mapping exists
   - Falls back to `track:trackId` when no mapping
   - Falls back when playerId is null in mapping
   - Handles mixed scenarios (some mapped, some not)

7. **Explanations**
   - Includes human-readable explanations for metrics
   - Provides context for each statistic

## Running Tests

### Install dependencies
```bash
cd services/analyzer
pnpm install
```

### Run all tests
```bash
pnpm test
```

### Run tests in watch mode
```bash
pnpm test:watch
```

### Run specific test file
```bash
pnpm test passesV1.test.ts
```

### Run with coverage
```bash
pnpm test --coverage
```

## Test Structure

### Helper Functions

Each test file includes helper functions to create test data:

```typescript
// Create minimal test context
function createContext(
  events: EventDoc[] = [],
  trackMappings: TrackPlayerMapping[] = []
): CalculatorContext

// Create event with defaults and overrides
function createEvent(overrides: Partial<EventDoc> = {}): EventDoc

// Create track-to-player mapping
function createMapping(
  trackId: string,
  playerId: string | null = null
): TrackPlayerMapping
```

### Test Pattern

Tests follow the AAA (Arrange-Act-Assert) pattern:

```typescript
it("should aggregate multiple events for the same track", async () => {
  // Arrange - Set up test data
  const events = [
    createEvent({ trackId: "track-1", confidence: 0.9 }),
    createEvent({ trackId: "track-1", confidence: 0.8 }),
  ];
  const ctx = createContext(events, []);

  // Act - Call the calculator
  const result = await calcPassesV1(ctx);

  // Assert - Verify the results
  expect(result).toHaveLength(1);
  expect(result[0].metrics[metricKeys.playerPassesAttempted]).toBe(2);
});
```

## Key Test Cases

### passesV1 Tests
- Pass outcomes: complete, incomplete, intercepted
- Success rate calculation (percentage)
- Aggregation of different pass types

### carryV1 Tests
- Carry index and progress index aggregation
- Distance in meters (with/without calibration)
- Rounding: 2 decimals for indices, 1 decimal for meters

### possessionV1 Tests
- Player possession time and count
- Team possession percentages (match-level stats)
- Exclusion of "unknown" team from percentage calculation
- Duration calculation from time ranges

### turnoversV1 Tests
- Lost vs won turnover tracking
- Separate counters for each type
- Edge cases: only lost or only won turnovers

## Type Safety

All tests use proper TypeScript types from `@soccer/shared`:
- `PassEventDoc`
- `CarryEventDoc`
- `TurnoverEventDoc`
- `PossessionSegment`
- `TrackPlayerMapping`
- `CalculatorContext`
- `StatsOutput`

## Mock Data

Test data is created with realistic values:
- Confidence values: 0.7 - 0.9 (typical range)
- Timestamps and frame numbers: Sequential and logical
- Positions: Normalized 0-1 coordinates
- Team IDs: "home", "away", "unknown"

## Extending Tests

To add new test cases:

1. Use existing helper functions for consistency
2. Follow the AAA pattern
3. Test one specific behavior per test case
4. Use descriptive test names (should + behavior)
5. Group related tests in `describe` blocks

Example:
```typescript
describe("New feature", () => {
  it("should handle new scenario correctly", async () => {
    // Arrange
    const data = createTestData();

    // Act
    const result = await calculator(data);

    // Assert
    expect(result).toMatchExpectedOutput();
  });
});
```

## Notes

- Tests are isolated and can run in any order
- No external dependencies (database, API calls)
- Fast execution (unit tests only)
- Comprehensive coverage of calculator logic
- Edge cases and error conditions tested
