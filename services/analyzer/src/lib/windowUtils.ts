/**
 * Window Utilities for Multi-pass Video Analysis
 *
 * Provides functions for generating analysis windows from video segments,
 * managing FPS settings, and converting between absolute/relative timestamps.
 */

// Import types (check if they exist in shared, otherwise define locally)
export type SegmentType = "active_play" | "stoppage" | "set_piece" | "goal_moment" | "replay";

export interface VideoSegment {
  segmentId: string;
  startSec: number;
  endSec: number;
  type: SegmentType;
  subtype?: string;
}

export interface AnalysisWindow {
  windowId: string;
  absoluteStart: number;
  absoluteEnd: number;
  overlap: {
    before: number;
    after: number;
  };
  targetFps: number;
  segmentType: SegmentType;
  segmentId?: string;
}

export interface WindowConfig {
  defaultWindowSizeSec: number;
  overlapSec: number;
  maxParallel: number;
  fpsMap: Record<SegmentType, number>;
}

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  defaultWindowSizeSec: 60,
  overlapSec: 15,
  maxParallel: 5,
  fpsMap: {
    active_play: 3,
    set_piece: 2,
    goal_moment: 5,
    stoppage: 1,
    replay: 1,
  },
};

/**
 * Get target FPS for a segment type
 */
export function getFpsForSegment(
  segmentType: SegmentType,
  config: WindowConfig = DEFAULT_WINDOW_CONFIG
): number {
  return config.fpsMap[segmentType] ?? config.fpsMap.active_play;
}

/**
 * Generate analysis windows from video segments
 *
 * Creates overlapping windows that respect segment boundaries.
 * Each window includes context from adjacent segments via overlap.
 */
export function generateWindows(
  segments: VideoSegment[],
  config: WindowConfig = DEFAULT_WINDOW_CONFIG
): AnalysisWindow[] {
  const windows: AnalysisWindow[] = [];

  for (const segment of segments) {
    // Skip very short segments
    const segmentDuration = segment.endSec - segment.startSec;
    if (segmentDuration < 2) continue;

    // Skip stoppage/replay segments if they're not important
    if (segment.type === "stoppage" || segment.type === "replay") {
      // Still create one window for context but with lower FPS
      windows.push({
        windowId: `${segment.segmentId}_w0`,
        absoluteStart: Math.max(0, segment.startSec - config.overlapSec),
        absoluteEnd: segment.endSec + config.overlapSec,
        overlap: {
          before: Math.min(config.overlapSec, segment.startSec),
          after: config.overlapSec,
        },
        targetFps: getFpsForSegment(segment.type, config),
        segmentType: segment.type,
        segmentId: segment.segmentId,
      });
      continue;
    }

    // Generate windows for this segment
    const windowSize = config.defaultWindowSizeSec;
    const effectiveWindowSize = windowSize - config.overlapSec; // Account for overlap

    let windowStart = segment.startSec;
    let windowIndex = 0;

    while (windowStart < segment.endSec) {
      const windowEnd = Math.min(
        windowStart + windowSize,
        segment.endSec + config.overlapSec
      );

      windows.push({
        windowId: `${segment.segmentId}_w${windowIndex}`,
        absoluteStart: Math.max(0, windowStart - config.overlapSec),
        absoluteEnd: windowEnd,
        overlap: {
          before: windowIndex === 0 ? Math.min(config.overlapSec, windowStart) : config.overlapSec,
          after: windowEnd >= segment.endSec ? config.overlapSec : 0,
        },
        targetFps: getFpsForSegment(segment.type, config),
        segmentType: segment.type,
        segmentId: segment.segmentId,
      });

      windowStart += effectiveWindowSize;
      windowIndex++;
    }
  }

  return windows;
}

/**
 * Convert absolute timestamp to relative timestamp within a window
 */
export function absoluteToRelativeTime(
  absoluteTime: number,
  windowStart: number
): number {
  return Math.max(0, absoluteTime - windowStart);
}

/**
 * Convert relative timestamp to absolute timestamp
 */
export function relativeToAbsoluteTime(
  relativeTime: number,
  windowStart: number
): number {
  return relativeTime + windowStart;
}

/**
 * Check if a timestamp falls within a window's core range (excluding overlap)
 */
export function isInCoreWindow(
  timestamp: number,
  window: AnalysisWindow
): boolean {
  const coreStart = window.absoluteStart + window.overlap.before;
  const coreEnd = window.absoluteEnd - window.overlap.after;
  return timestamp >= coreStart && timestamp < coreEnd;
}

/**
 * Get windows that could contain events at a given timestamp
 */
export function getWindowsForTimestamp(
  timestamp: number,
  windows: AnalysisWindow[]
): AnalysisWindow[] {
  return windows.filter(
    w => timestamp >= w.absoluteStart && timestamp < w.absoluteEnd
  );
}

/**
 * Calculate total analysis duration from windows
 */
export function getTotalAnalysisDuration(windows: AnalysisWindow[]): number {
  if (windows.length === 0) return 0;

  // Sort by start time
  const sorted = [...windows].sort((a, b) => a.absoluteStart - b.absoluteStart);

  // Merge overlapping ranges
  let totalDuration = 0;
  let currentEnd = 0;

  for (const window of sorted) {
    if (window.absoluteStart >= currentEnd) {
      totalDuration += window.absoluteEnd - window.absoluteStart;
      currentEnd = window.absoluteEnd;
    } else if (window.absoluteEnd > currentEnd) {
      totalDuration += window.absoluteEnd - currentEnd;
      currentEnd = window.absoluteEnd;
    }
  }

  return totalDuration;
}

/**
 * Batch windows into groups for parallel processing
 */
export function batchWindows(
  windows: AnalysisWindow[],
  maxParallel: number = DEFAULT_WINDOW_CONFIG.maxParallel
): AnalysisWindow[][] {
  const batches: AnalysisWindow[][] = [];

  for (let i = 0; i < windows.length; i += maxParallel) {
    batches.push(windows.slice(i, i + maxParallel));
  }

  return batches;
}
