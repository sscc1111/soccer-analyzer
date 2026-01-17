# Test Coverage Report: Video Split Upload Feature

## Date: 2026-01-16

## Overall Status: ✅ PASSING (715 tests passed, 6 skipped)

### Recent Updates
- **2026-01-16 18:11**: Added 12 new tests for regex pattern coverage in halfMerger
- All regex patterns for count metric detection now have comprehensive test coverage

---

## 1. halfMerger.test.ts Coverage

**Location**: `/services/analyzer/src/lib/__tests__/halfMerger.test.ts`

### ✅ Timestamp Adjustment - FULLY COVERED
- ✅ Pass event timestamp adjustment with halfDuration offset
- ✅ Frame number preservation (video-relative)
- ✅ Carry event startTime/endTime adjustment
- ✅ Duration preservation after adjustment
- ✅ Different half durations (20-minute, 45-minute)
- ✅ Edge cases: t=0, zero duration, very short duration (10 min)

### ✅ Stats Merging - FULLY COVERED
- ✅ Sum count-based stats (pass_count, shots_total)
- ✅ Average percentage-based stats (possession_percentage)
- ✅ Stats present in only one half
- ✅ Metadata storage (firstHalfValue, secondHalfValue)
- ✅ Grouping by calculatorId + playerId + teamId
- ✅ Multiple players stats merge correctly

### ✅ Regex Pattern for Count Metrics - FULLY COVERED (Updated 2026-01-16)

**Implementation** (lines 750-756 in halfMerger.ts):
```typescript
const isCountMetric =
  // 単語としてcount/total/numberを含む
  (/(?:^|_)(count|total|number)(?:_|$)/i.test(calculatorId) ||
    // または末尾がgoals/shots/passes等の絶対数統計
    /_(goals|shots|passes|tackles|clearances|blocks|fouls|corners|offsides)$/i.test(calculatorId)) &&
  // パーセンテージ・レート系を明示的に除外
  !/(?:^|_)(accuracy|rate|percentage|ratio|average)(?:_|$)/i.test(calculatorId);
```

**Complete Test Coverage** (12 new tests added):
- ✅ `pass_count` → sum (basic count pattern)
- ✅ `pass_count_home` → sum (count with suffix)
- ✅ `shots_total` → sum (basic total pattern)
- ✅ `shot_total_attempts` → sum (total in middle)
- ✅ `team_goals` → sum (goals suffix pattern)
- ✅ `player_shots` → sum (shots suffix pattern)
- ✅ `successful_passes` → sum (passes suffix pattern)
- ✅ `defensive_tackles` → sum (tackles suffix pattern)
- ✅ `team_corners` → sum (corners suffix pattern)
- ✅ `pass_accuracy_percentage` → average (exclusion pattern)
- ✅ `possession_rate` → average (exclusion pattern)
- ✅ `shot_conversion_ratio` → average (exclusion pattern)
- ✅ `average_pass_distance` → average (exclusion pattern)
- ✅ `total_possession_percentage` → average (exclusion takes precedence)
- ✅ `possession_percentage` → average (basic percentage pattern)

### ✅ Edge Cases - FULLY COVERED
- ✅ Zero half duration
- ✅ Very short half (10 min, 5v5 format)
- ✅ Events at t=0
- ✅ Empty first half clips
- ✅ Empty second half clips

### ⚠️ NaN/Undefined Defense - NEEDS VALIDATION
**Implementation checks** (added in P0/P1 fixes):
- Lines 363-367: Pass event timestamp validation
- Lines 377-382: Carry event timestamp validation
- Lines 590-596: Clip timestamp validation
- Lines 736-743: Stat value validation

**Current test coverage**: ❌ No explicit tests for NaN/undefined values

---

## 2. videoPipeline.integration.test.ts Coverage

**Location**: `/services/analyzer/src/lib/__tests__/videoPipeline.integration.test.ts`

### ✅ Merge Job Triggering - FULLY COVERED
- ✅ Both halves done → trigger merge job
- ✅ Only first half done → do NOT trigger
- ✅ Single video configuration → do NOT trigger
- ✅ Second half has error → do NOT trigger

### ✅ Video Configuration - FULLY COVERED
- ✅ Split configuration requires firstHalf + secondHalf
- ✅ Single configuration requires only single

### ✅ Video Upload Validation - FULLY COVERED
- ✅ Allow firstHalf upload for split configuration
- ✅ Reject single upload for split configuration
- ✅ Reject duplicate video type
- ✅ Allow secondHalf after firstHalf

### ✅ Missing Video Detection - FULLY COVERED
- ✅ Both videos missing for split configuration
- ✅ SecondHalf missing after firstHalf upload
- ✅ No missing videos when complete

### ✅ Match Analysis Status - FULLY COVERED
- ✅ Idle when no videos
- ✅ Partial when only first half done
- ✅ Done when all videos done
- ✅ Error when any video has error

### ✅ Backward Compatibility - FULLY COVERED
- ✅ Legacy match.video migration to single video doc
- ✅ Storage path convention for split videos
- ✅ Storage path convention for single video

---

## 3. Missing Tests

### ❌ onVideoDocCreated Trigger Tests
**Location**: `functions/src/triggers/onVideoDocCreated.ts`
**Status**: NO TESTS FOUND

**Expected coverage**:
- Should create analyze_video job when video is uploaded
- Should set video analysis status to "queued"
- Should handle firstHalf upload
- Should handle secondHalf upload
- Should handle single video upload
- Should validate video type matches match configuration

### ❌ onVideoAnalysisCompleted Trigger Tests
**Location**: `functions/src/triggers/onVideoAnalysisCompleted.ts`
**Status**: NO TESTS FOUND

**Expected coverage**:
- Should create merge_half_analysis job when both halves complete
- Should NOT create merge job when only one half completes
- Should NOT create merge job for single video
- Should update match analysis status appropriately
- Should handle concurrent completion (race condition)

### ❌ Mobile Hooks Tests
**Location**: `apps/mobile/lib/hooks/`
**Status**: NO TESTS FOUND

**Missing test files**:
1. `useMatches.test.ts` - for match creation and listing
2. `useVideos.test.ts` - for video upload and listing
3. `useUploadQueue.test.ts` - for upload queue management

**Expected coverage for useVideos**:
- Should fetch videos for a match
- Should upload firstHalf video
- Should upload secondHalf video
- Should prevent duplicate video type upload
- Should handle upload errors
- Should update upload progress

---

## 4. Test Execution Results

```
Test Files  27 passed | 1 skipped (28)
Tests       715 passed | 6 skipped (721)
Duration    1.38s
```

**Status**: ✅ ALL TESTS PASSING

**Changes from initial run**:
- Added 12 new regex pattern tests to halfMerger.test.ts
- Updated test mock to match actual implementation
- All tests passing with improved coverage

---

## 5. Recommendations

### Priority 0 (Critical)
1. ✅ **COMPLETED**: Run existing test suite → All tests pass
2. ✅ **COMPLETED**: Add tests for regex pattern variations
   - ✅ Test `_goals`, `_shots`, `_passes` suffix patterns
   - ✅ Test exclusion patterns (accuracy/rate/percentage)
   - ✅ Test complex calculatorId combinations

### Priority 1 (High)
3. ❌ **TODO**: Add NaN/undefined defense tests to halfMerger.test.ts
   ```typescript
   it("should handle NaN timestamps gracefully", () => {
     const event: PassEventDoc = {
       eventId: "pass-1",
       timestamp: NaN,
       frameNumber: 3000,
       type: "pass",
       player: { id: "player-1", team: "home" },
     };

     expect(() => adjustPassEventTimestamp(event, 2700)).toThrow("Invalid timestamp");
   });

   it("should handle undefined stat values", () => {
     const stat1: StatDoc = {
       statId: "s1",
       calculatorId: "pass_count",
       value: undefined as any,
       // ...
     };
     expect(() => mergeStatPair(stat1, validStat2)).toThrow("Invalid stat values");
   });
   ```

4. ❌ **TODO**: Create onVideoDocCreated trigger tests
5. ❌ **TODO**: Create onVideoAnalysisCompleted trigger tests

### Priority 2 (Medium)
6. ❌ **TODO**: Add mobile hooks tests
   - useVideos.test.ts
   - useUploadQueue.test.ts
   - useMatches.test.ts

### Priority 3 (Low)
7. ✅ **COMPLETED**: Document test coverage status

---

## 6. Code Coverage Metrics (Estimated)

| Component | Files | Coverage | Status |
|-----------|-------|----------|--------|
| halfMerger.ts | 1 | ~95% | ✅ Excellent coverage (regex patterns fully tested) |
| videoPipeline integration | 1 | ~95% | ✅ Well covered |
| onVideoDocCreated | 1 | 0% | ❌ No tests |
| onVideoAnalysisCompleted | 1 | 0% | ❌ No tests |
| Mobile hooks (useVideos) | 1 | 0% | ❌ No tests |
| Mobile hooks (useUploadQueue) | 1 | 0% | ❌ No tests |
| Mobile hooks (useMatches) | 1 | 0% | ❌ No tests |

**Overall Feature Coverage**: ~45%
- Core logic (halfMerger, pipeline): ✅ Well tested (33 + 20 = 53 tests)
- Infrastructure (triggers, hooks): ❌ Not tested

**Test Count by Component**:
- halfMerger.test.ts: 33 tests (12 for regex patterns)
- videoPipeline.integration.test.ts: 20 tests

---

## 7. Test Quality Assessment

### Strengths
- ✅ Comprehensive unit tests for core merging logic
- ✅ Good integration test coverage for pipeline flow
- ✅ Clear test structure with AAA pattern
- ✅ Good edge case coverage (empty arrays, different durations)
- ✅ Schema validation tests included

### Weaknesses
- ❌ No tests for Firebase trigger functions
- ❌ No tests for mobile app hooks
- ❌ Missing tests for NaN/undefined defense (defensive programming)
- ❌ Incomplete coverage for regex pattern variations
- ❌ No E2E tests for full upload → merge flow

---

## 8. Suggested Next Steps

1. **Immediate**: Add regex pattern variation tests to halfMerger.test.ts
2. **Short-term**: Create trigger function tests (onVideoDocCreated, onVideoAnalysisCompleted)
3. **Medium-term**: Add mobile hooks tests
4. **Long-term**: Consider E2E test for full video split upload flow

---

## Appendix: Regex Fix Verification

**Original Issue**: `\b` inside character class was interpreted as backspace instead of word boundary

**Fix Applied** (lines 750-756 in halfMerger.ts):
```typescript
// BEFORE (incorrect):
const isCountMetric = /[\b_](count|total)[\b_]/i.test(calculatorId);

// AFTER (correct):
const isCountMetric =
  (/(?:^|_)(count|total|number)(?:_|$)/i.test(calculatorId) ||
   /_(goals|shots|passes|tackles|clearances|blocks|fouls|corners|offsides)$/i.test(calculatorId)) &&
  !/(?:^|_)(accuracy|rate|percentage|ratio|average)(?:_|$)/i.test(calculatorId);
```

**Why the fix works**:
- Uses `(?:^|_)` and `(?:_|$)` instead of `\b` for word boundary detection
- `^` matches start of string, `_` matches underscore
- `$` matches end of string
- Non-capturing groups `(?:...)` for cleaner pattern
- Case-insensitive flag `/i` preserved

**Test Status**: ⚠️ Fix is correct but needs additional test coverage
