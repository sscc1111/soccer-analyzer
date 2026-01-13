/**
 * Non-Player Filtering Module (Phase 1.2.5)
 *
 * Filters out non-relevant detections from the player tracking pipeline:
 * - Spectators, bench players, coaches
 * - People in civilian clothing
 * - Excessive detections (noise)
 *
 * Uses multiple filtering strategies:
 * 1. Pitch boundary filter (requires homography)
 * 2. Uniform color filter (requires team colors)
 * 3. Top-N filter (confidence-based)
 * 4. Motion pattern filter (stationary person detection)
 * 5. Roster matching filter (jersey number validation)
 */

import type { Detection } from "./types";
import type { GameFormat, HomographyData } from "@soccer/shared";
import { isOnPitch, screenToField, FIELD_DIMENSIONS } from "./homography";

// ============================================================================
// Types
// ============================================================================

export type FilterConfig = {
  /** Maximum number of players to track (based on game format) */
  maxPlayers: number;
  /** Minimum confidence threshold for detections */
  minConfidence: number;
  /** Minimum movement (pixels) required over the motion window to be considered active */
  minMovement: number;
  /** Number of frames to analyze for motion detection */
  motionWindowFrames: number;
  /** Color similarity threshold for uniform matching (0-1, lower = stricter) */
  colorSimilarityThreshold: number;
  /** Whether to filter out detections outside the pitch */
  filterOutsidePitch: boolean;
};

export type FilterResult = {
  /** Detections that passed all filters */
  passed: Detection[];
  /** Detections that were filtered out */
  filtered: Detection[];
  /** Filter statistics */
  stats: FilterStats;
};

export type FilterStats = {
  totalInput: number;
  passedCount: number;
  filteredByConfidence: number;
  filteredByPitch: number;
  filteredByColor: number;
  filteredByMotion: number;
  filteredByTopN: number;
  filteredByRoster: number;
};

export type TeamColors = {
  home: string; // hex color
  away: string; // hex color
};

export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };

// ============================================================================
// Configuration
// ============================================================================

/** Default filter configurations by game format */
export const DEFAULT_FILTER_CONFIG: Record<GameFormat, FilterConfig> = {
  eleven: {
    maxPlayers: 25, // 22 players + 3 refs
    minConfidence: 0.3,
    minMovement: 10,
    motionWindowFrames: 30, // 1 second at 30fps
    colorSimilarityThreshold: 0.4,
    filterOutsidePitch: true,
  },
  eight: {
    maxPlayers: 20, // 16 players + refs
    minConfidence: 0.3,
    minMovement: 10,
    motionWindowFrames: 30,
    colorSimilarityThreshold: 0.4,
    filterOutsidePitch: true,
  },
  five: {
    maxPlayers: 15, // 10 players + refs
    minConfidence: 0.3,
    minMovement: 10,
    motionWindowFrames: 30,
    colorSimilarityThreshold: 0.4,
    filterOutsidePitch: true,
  },
};

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Parse hex color string to RGB
 */
export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 128, g: 128, b: 128 }; // Default to gray
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to HSV color space
 * HSV is better for color comparison in sports scenarios
 */
export function rgbToHsv(rgb: RGB): HSV {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s, v };
}

/**
 * Calculate color distance in HSV space
 * Returns a value between 0 (identical) and 1 (completely different)
 */
export function colorDistance(color1: RGB, color2: RGB): number {
  const hsv1 = rgbToHsv(color1);
  const hsv2 = rgbToHsv(color2);

  // Hue is circular, so calculate the shortest distance
  const hueDiff = Math.min(
    Math.abs(hsv1.h - hsv2.h),
    360 - Math.abs(hsv1.h - hsv2.h)
  );
  const hueDistance = hueDiff / 180; // Normalize to 0-1

  const satDistance = Math.abs(hsv1.s - hsv2.s);
  const valDistance = Math.abs(hsv1.v - hsv2.v);

  // Weighted combination (hue is most important for jersey colors)
  return hueDistance * 0.5 + satDistance * 0.3 + valDistance * 0.2;
}

/**
 * Check if a color matches either team color
 */
export function matchesTeamColor(
  color: RGB,
  teamColors: TeamColors,
  threshold: number
): boolean {
  const homeRgb = hexToRgb(teamColors.home);
  const awayRgb = hexToRgb(teamColors.away);

  const homeDistance = colorDistance(color, homeRgb);
  const awayDistance = colorDistance(color, awayRgb);

  return homeDistance < threshold || awayDistance < threshold;
}

// ============================================================================
// Filter 1: Confidence Filter
// ============================================================================

/**
 * Filter detections by minimum confidence threshold
 */
export function filterByConfidence(
  detections: Detection[],
  minConfidence: number
): { passed: Detection[]; filtered: Detection[] } {
  const passed: Detection[] = [];
  const filtered: Detection[] = [];

  for (const detection of detections) {
    if (detection.confidence >= minConfidence) {
      passed.push(detection);
    } else {
      filtered.push(detection);
    }
  }

  return { passed, filtered };
}

// ============================================================================
// Filter 2: Pitch Boundary Filter
// ============================================================================

/**
 * Filter detections that are outside the pitch boundaries
 * Requires homography data for coordinate transformation
 */
export function filterByPitchBoundary(
  detections: Detection[],
  homography: HomographyData | null,
  gameFormat: GameFormat
): { passed: Detection[]; filtered: Detection[] } {
  const passed: Detection[] = [];
  const filtered: Detection[] = [];

  // If no homography available, pass all detections
  if (!homography) {
    return { passed: [...detections], filtered: [] };
  }

  const fieldSize = FIELD_DIMENSIONS[gameFormat];

  for (const detection of detections) {
    // Use center point for pitch boundary check
    const fieldPos = screenToField(homography, detection.center);

    if (fieldPos && isOnPitch(fieldPos, fieldSize)) {
      passed.push(detection);
    } else {
      filtered.push(detection);
    }
  }

  return { passed, filtered };
}

// ============================================================================
// Filter 3: Top-N Filter (Confidence-based)
// ============================================================================

/**
 * Keep only the top N detections by confidence
 * This limits the number of tracked objects to a reasonable amount
 */
export function filterTopN(
  detections: Detection[],
  maxCount: number
): { passed: Detection[]; filtered: Detection[] } {
  if (detections.length <= maxCount) {
    return { passed: [...detections], filtered: [] };
  }

  // Sort by confidence descending
  const sorted = [...detections].sort(
    (a, b) => b.confidence - a.confidence
  );

  return {
    passed: sorted.slice(0, maxCount),
    filtered: sorted.slice(maxCount),
  };
}

// ============================================================================
// Filter 4: Motion Pattern Filter
// ============================================================================

export type MotionHistory = Map<
  string,
  { positions: { x: number; y: number }[]; frameNumbers: number[] }
>;

/**
 * Calculate total movement distance for a detection over its history
 */
export function calculateMovement(
  positions: { x: number; y: number }[]
): number {
  if (positions.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    const dx = positions[i].x - positions[i - 1].x;
    const dy = positions[i].y - positions[i - 1].y;
    totalDistance += Math.sqrt(dx * dx + dy * dy);
  }

  return totalDistance;
}

/**
 * Update motion history with new detections
 * trackId should be assigned before calling this function
 */
export function updateMotionHistory(
  history: MotionHistory,
  detections: Detection[],
  frameNumber: number,
  maxWindowFrames: number
): void {
  for (const detection of detections) {
    const trackId = detection.label ?? `det_${frameNumber}_${detections.indexOf(detection)}`;

    if (!history.has(trackId)) {
      history.set(trackId, { positions: [], frameNumbers: [] });
    }

    const entry = history.get(trackId)!;
    entry.positions.push(detection.center);
    entry.frameNumbers.push(frameNumber);

    // Trim old entries
    while (
      entry.frameNumbers.length > 0 &&
      frameNumber - entry.frameNumbers[0] > maxWindowFrames
    ) {
      entry.positions.shift();
      entry.frameNumbers.shift();
    }
  }
}

/**
 * Filter out stationary detections (likely spectators or bench players)
 */
export function filterByMotion(
  detections: Detection[],
  history: MotionHistory,
  minMovement: number
): { passed: Detection[]; filtered: Detection[] } {
  const passed: Detection[] = [];
  const filtered: Detection[] = [];

  for (const detection of detections) {
    const trackId = detection.label;

    if (!trackId || !history.has(trackId)) {
      // No history yet, pass by default
      passed.push(detection);
      continue;
    }

    const entry = history.get(trackId)!;
    const movement = calculateMovement(entry.positions);

    if (movement >= minMovement) {
      passed.push(detection);
    } else {
      filtered.push(detection);
    }
  }

  return { passed, filtered };
}

// ============================================================================
// Filter 5: Roster Matching Filter
// ============================================================================

export type RosterEntry = {
  jerseyNumber: number;
  teamId: "home" | "away";
};

/**
 * Filter detections that have jersey numbers not in the roster
 * Only applies to detections that have jerseyNumber attached
 */
export function filterByRoster(
  detections: Detection[],
  roster: RosterEntry[],
  detectionJerseyNumbers: Map<string, number | null>
): { passed: Detection[]; filtered: Detection[] } {
  const passed: Detection[] = [];
  const filtered: Detection[] = [];

  const validNumbers = new Set(roster.map((r) => r.jerseyNumber));

  for (const detection of detections) {
    const trackId = detection.label;

    if (!trackId) {
      // No track ID, pass by default
      passed.push(detection);
      continue;
    }

    const jerseyNumber = detectionJerseyNumbers.get(trackId);

    if (jerseyNumber === null || jerseyNumber === undefined) {
      // No jersey number detected, pass by default
      passed.push(detection);
    } else if (validNumbers.has(jerseyNumber)) {
      // Jersey number matches roster
      passed.push(detection);
    } else {
      // Jersey number not in roster (bench player or wrong detection)
      filtered.push(detection);
    }
  }

  return { passed, filtered };
}

// ============================================================================
// Combined Filter Pipeline
// ============================================================================

export type FilterPipelineInput = {
  detections: Detection[];
  frameNumber: number;
  gameFormat: GameFormat;
  config?: Partial<FilterConfig>;
  homography?: HomographyData | null;
  teamColors?: TeamColors | null;
  motionHistory?: MotionHistory;
  roster?: RosterEntry[];
  detectionJerseyNumbers?: Map<string, number | null>;
};

/**
 * Run the complete non-player filtering pipeline
 *
 * Filter order (from plan):
 * 1. Confidence filter (basic quality)
 * 2. Pitch boundary filter (requires homography)
 * 3. Uniform color filter (requires team colors)
 * 4. Motion pattern filter (requires history)
 * 5. Roster matching filter (requires OCR results)
 * 6. Top-N filter (final count limit)
 */
export function runFilterPipeline(input: FilterPipelineInput): FilterResult {
  const {
    detections,
    frameNumber,
    gameFormat,
    config: customConfig,
    homography = null,
    teamColors = null,
    motionHistory,
    roster,
    detectionJerseyNumbers,
  } = input;

  const config: FilterConfig = {
    ...DEFAULT_FILTER_CONFIG[gameFormat],
    ...customConfig,
  };

  const stats: FilterStats = {
    totalInput: detections.length,
    passedCount: 0,
    filteredByConfidence: 0,
    filteredByPitch: 0,
    filteredByColor: 0,
    filteredByMotion: 0,
    filteredByTopN: 0,
    filteredByRoster: 0,
  };

  let current = detections;

  // Filter 1: Confidence
  {
    const result = filterByConfidence(current, config.minConfidence);
    stats.filteredByConfidence = result.filtered.length;
    current = result.passed;
  }

  // Filter 2: Pitch boundary (if homography available)
  if (config.filterOutsidePitch && homography) {
    const result = filterByPitchBoundary(current, homography, gameFormat);
    stats.filteredByPitch = result.filtered.length;
    current = result.passed;
  }

  // Filter 3: Uniform color (if team colors available)
  // NOTE: This filter requires dominant color extraction from bbox
  // Currently skipped as ColorExtractor returns placeholder values
  // Will be implemented when actual color extraction is available
  if (teamColors) {
    // TODO: Implement when ColorExtractor provides real colors
    // For now, pass all detections
    stats.filteredByColor = 0;
  }

  // Filter 4: Motion pattern (if history available)
  if (motionHistory) {
    // Update history with current detections
    updateMotionHistory(
      motionHistory,
      current,
      frameNumber,
      config.motionWindowFrames
    );

    const result = filterByMotion(current, motionHistory, config.minMovement);
    stats.filteredByMotion = result.filtered.length;
    current = result.passed;
  }

  // Filter 5: Roster matching (if roster and jersey numbers available)
  if (roster && roster.length > 0 && detectionJerseyNumbers) {
    const result = filterByRoster(current, roster, detectionJerseyNumbers);
    stats.filteredByRoster = result.filtered.length;
    current = result.passed;
  }

  // Filter 6: Top-N (final count limit)
  {
    const result = filterTopN(current, config.maxPlayers);
    stats.filteredByTopN = result.filtered.length;
    current = result.passed;
  }

  stats.passedCount = current.length;

  return {
    passed: current,
    filtered: detections.filter((d) => !current.includes(d)),
    stats,
  };
}

// ============================================================================
// Utility: Motion History Management
// ============================================================================

export function createMotionHistory(): MotionHistory {
  return new Map();
}

/**
 * Remove stale tracks from motion history to prevent memory leaks
 * @param history Motion history map
 * @param currentFrame Current frame number
 * @param maxStaleFrames Remove tracks not seen for this many frames
 * @returns Number of tracks removed
 */
export function pruneStaleTracksFromHistory(
  history: MotionHistory,
  currentFrame: number,
  maxStaleFrames: number
): number {
  let removed = 0;

  for (const [trackId, entry] of history) {
    const lastFrame = entry.frameNumbers[entry.frameNumbers.length - 1] ?? 0;

    if (currentFrame - lastFrame > maxStaleFrames) {
      history.delete(trackId);
      removed++;
    }
  }

  return removed;
}
