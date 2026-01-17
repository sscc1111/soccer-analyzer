# Timestamp/Duration Mismatch - Quick Summary

**Issue:** Key moments show timestamps up to 1:25 (85s) for a 1:00 (60s) video

## Root Cause

Gemini generates timestamps **without knowledge** of the video duration reported by ffprobe.

### Why This Happens

1. **Step 01** extracts duration: ffprobe reports `60s` (container metadata)
2. **Step 11** generates summary: Gemini analyzes video and perceives `85s` (actual frame data)
3. **No validation** occurs between these steps
4. **Result:** Timestamps exceed clip boundaries → broken navigation

### Technical Details

```
ffprobe reads:    format.duration = 60s  (container header)
Gemini perceives: lastFrame / fps = 85s  (actual stream data)
```

**Common causes of mismatch:**
- Video trimmed with stale container metadata
- Variable frame rate (VFR) content
- Audio track extends beyond video track
- Re-encoded video without container rebuild

## Impact

- **Severity:** High (core feature broken)
- **Affected users:** Anyone viewing key moments beyond reported duration
- **Symptoms:** "Play" button doesn't work, video player can't seek to timestamp

## Fix

### Quick Fix (30 min)
```typescript
// In services/analyzer/src/jobs/steps/11_generateMatchSummary.ts
// After line 212, add validation:

const videoDurationSec = await getVideoDuration(matchRef, videoId) || Infinity;
const enhancedKeyMoments: KeyMoment[] = result.keyMoments
  .map((moment) => ({
    ...moment,
    timestamp: Math.min(moment.timestamp, videoDurationSec), // Cap at max
    clipId: findClipByTimestamp(Math.min(moment.timestamp, videoDurationSec)),
  }));
```

### Complete Fix (1-2 hours)
```typescript
// Pass duration to Gemini (before line 199):

const videoDurationSec = await getVideoDuration(matchRef, videoId);
const contextInfo = [
  formatContext,
  "",
  "## 動画情報",
  `- 動画の長さ: ${videoDurationSec}秒`,
  "- 重要: タイムスタンプは0秒から${videoDurationSec}秒の範囲内で指定してください",
  "",
  "## 戦術分析データ（参考）",
  // ... rest of context
];
```

## Files to Check

- `/Users/fujiwarakazuma/Works/soccer-analyzer/services/analyzer/src/jobs/steps/11_generateMatchSummary.ts` - Main fix location
- `/Users/fujiwarakazuma/Works/soccer-analyzer/services/analyzer/src/jobs/steps/01_extractMeta.ts` - Duration extraction
- `/Users/fujiwarakazuma/Works/soccer-analyzer/services/analyzer/src/lib/ffmpeg.ts` - ffprobe implementation

## Related Issues

Check these steps for similar problems:
- `07_detectEventsGemini.ts` - Event timestamps
- `04_extractImportantScenes.ts` - Scene timestamps

## Testing

```bash
# After fix, verify:
# 1. All keyMoments have timestamp <= videoDurationSec
# 2. All keyMoments have valid clipId (not null)
# 3. Logs show warning for any out-of-bounds timestamps
```

## Detailed Reports

- `TIMESTAMP_DURATION_MISMATCH_REPORT.md` - Full investigation
- `TIMESTAMP_MISMATCH_DIAGRAM.txt` - Visual flow diagram
