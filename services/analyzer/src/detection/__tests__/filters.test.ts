/**
 * Tests for non-player filtering module
 */

import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHsv,
  colorDistance,
  filterByConfidence,
  filterByPitchBoundary,
  filterTopN,
  filterByMotion,
  calculateMovement,
  createMotionHistory,
  updateMotionHistory,
  runFilterPipeline,
  DEFAULT_FILTER_CONFIG,
  type FilterConfig,
} from "../filters";
import type { Detection } from "../types";

// ============================================================================
// Test Helpers
// ============================================================================

function createDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    bbox: { x: 100, y: 100, w: 50, h: 100 },
    center: { x: 125, y: 150 },
    confidence: 0.9,
    classConfidence: 0.9,
    label: "track-1",
    ...overrides,
  };
}

// ============================================================================
// Color Utility Tests
// ============================================================================

describe("hexToRgb", () => {
  it("should convert hex color to RGB", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("should handle hex without # prefix", () => {
    expect(hexToRgb("ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("should return gray for invalid hex", () => {
    expect(hexToRgb("invalid")).toEqual({ r: 128, g: 128, b: 128 });
    expect(hexToRgb("")).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe("rgbToHsv", () => {
  it("should convert pure red to HSV", () => {
    const hsv = rgbToHsv({ r: 255, g: 0, b: 0 });
    expect(hsv.h).toBeCloseTo(0);
    expect(hsv.s).toBeCloseTo(1);
    expect(hsv.v).toBeCloseTo(1);
  });

  it("should convert pure green to HSV", () => {
    const hsv = rgbToHsv({ r: 0, g: 255, b: 0 });
    expect(hsv.h).toBeCloseTo(120);
    expect(hsv.s).toBeCloseTo(1);
    expect(hsv.v).toBeCloseTo(1);
  });

  it("should convert pure blue to HSV", () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 255 });
    expect(hsv.h).toBeCloseTo(240);
    expect(hsv.s).toBeCloseTo(1);
    expect(hsv.v).toBeCloseTo(1);
  });

  it("should convert white to HSV", () => {
    const hsv = rgbToHsv({ r: 255, g: 255, b: 255 });
    expect(hsv.s).toBeCloseTo(0);
    expect(hsv.v).toBeCloseTo(1);
  });

  it("should convert black to HSV", () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 0 });
    expect(hsv.v).toBeCloseTo(0);
  });
});

describe("colorDistance", () => {
  it("should return 0 for identical colors", () => {
    const color = { r: 128, g: 64, b: 200 };
    expect(colorDistance(color, color)).toBeCloseTo(0);
  });

  it("should return high distance for opposite colors", () => {
    const red = { r: 255, g: 0, b: 0 };
    const cyan = { r: 0, g: 255, b: 255 };
    expect(colorDistance(red, cyan)).toBeGreaterThanOrEqual(0.5);
  });

  it("should return lower distance for similar colors", () => {
    const red1 = { r: 255, g: 0, b: 0 };
    const red2 = { r: 230, g: 20, b: 20 };
    expect(colorDistance(red1, red2)).toBeLessThan(0.2);
  });
});

// ============================================================================
// Filter Tests
// ============================================================================

describe("filterByConfidence", () => {
  it("should pass all detections above threshold", () => {
    const detections = [
      createDetection({ confidence: 0.9, label: "track-1" }),
      createDetection({ confidence: 0.8, label: "track-2" }),
      createDetection({ confidence: 0.5, label: "track-3" }),
    ];

    const result = filterByConfidence(detections, 0.6);
    expect(result.passed).toHaveLength(2);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].label).toBe("track-3");
  });

  it("should filter all below threshold", () => {
    const detections = [
      createDetection({ confidence: 0.3 }),
      createDetection({ confidence: 0.2 }),
    ];

    const result = filterByConfidence(detections, 0.5);
    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(2);
  });

  it("should include detections exactly at threshold", () => {
    const detections = [createDetection({ confidence: 0.5 })];

    const result = filterByConfidence(detections, 0.5);
    expect(result.passed).toHaveLength(1);
  });
});

describe("filterByPitchBoundary", () => {
  it("should pass all detections when homography is null", () => {
    const detections = [createDetection(), createDetection()];

    const result = filterByPitchBoundary(detections, null, "eleven");
    expect(result.passed).toHaveLength(2);
    expect(result.filtered).toHaveLength(0);
  });

  // Note: Full pitch boundary tests would require a real homography matrix
  // These are placeholder tests for the structure
});

describe("filterTopN", () => {
  it("should keep all detections if count is below max", () => {
    const detections = [
      createDetection({ confidence: 0.9 }),
      createDetection({ confidence: 0.8 }),
    ];

    const result = filterTopN(detections, 5);
    expect(result.passed).toHaveLength(2);
    expect(result.filtered).toHaveLength(0);
  });

  it("should keep only top N by confidence", () => {
    const detections = [
      createDetection({ confidence: 0.5, label: "track-1" }),
      createDetection({ confidence: 0.9, label: "track-2" }),
      createDetection({ confidence: 0.7, label: "track-3" }),
      createDetection({ confidence: 0.3, label: "track-4" }),
      createDetection({ confidence: 0.8, label: "track-5" }),
    ];

    const result = filterTopN(detections, 3);
    expect(result.passed).toHaveLength(3);
    expect(result.filtered).toHaveLength(2);

    // Should keep highest confidence ones
    const passedLabels = result.passed.map((d) => d.label);
    expect(passedLabels).toContain("track-2"); // 0.9
    expect(passedLabels).toContain("track-5"); // 0.8
    expect(passedLabels).toContain("track-3"); // 0.7
  });
});

// ============================================================================
// Motion Pattern Tests
// ============================================================================

describe("calculateMovement", () => {
  it("should return 0 for empty positions", () => {
    expect(calculateMovement([])).toBe(0);
  });

  it("should return 0 for single position", () => {
    expect(calculateMovement([{ x: 100, y: 100 }])).toBe(0);
  });

  it("should calculate correct movement distance", () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }, // distance = 5
      { x: 3, y: 4 }, // distance = 0
      { x: 6, y: 8 }, // distance = 5
    ];

    expect(calculateMovement(positions)).toBe(10);
  });
});

describe("motion history", () => {
  it("should create empty motion history", () => {
    const history = createMotionHistory();
    expect(history.size).toBe(0);
  });

  it("should update motion history with detections", () => {
    const history = createMotionHistory();
    const detections = [
      createDetection({ label: "track-1", center: { x: 100, y: 100 } }),
      createDetection({ label: "track-2", center: { x: 200, y: 200 } }),
    ];

    updateMotionHistory(history, detections, 1, 30);

    expect(history.has("track-1")).toBe(true);
    expect(history.has("track-2")).toBe(true);
    expect(history.get("track-1")!.positions).toHaveLength(1);
  });

  it("should trim old entries from motion history", () => {
    const history = createMotionHistory();

    // Add detection at frame 1
    updateMotionHistory(
      history,
      [createDetection({ label: "track-1", center: { x: 100, y: 100 } })],
      1,
      30 // 30 frame window
    );

    // Add detection at frame 10 (within 30 frame window from frame 1)
    updateMotionHistory(
      history,
      [createDetection({ label: "track-1", center: { x: 150, y: 150 } })],
      10,
      30
    );

    expect(history.get("track-1")!.positions).toHaveLength(2);

    // Add detection at frame 50 (frame 1 should be trimmed: 50 - 1 = 49 > 30)
    updateMotionHistory(
      history,
      [createDetection({ label: "track-1", center: { x: 200, y: 200 } })],
      50,
      30
    );

    // Frame 1 should be trimmed (50 - 1 = 49 > 30)
    // Frame 10 should also be trimmed (50 - 10 = 40 > 30)
    // Only frame 50 remains
    expect(history.get("track-1")!.positions).toHaveLength(1);
  });
});

describe("filterByMotion", () => {
  it("should pass detections without history", () => {
    const history = createMotionHistory();
    const detections = [createDetection({ label: "track-1" })];

    const result = filterByMotion(detections, history, 10);
    expect(result.passed).toHaveLength(1);
  });

  it("should filter stationary detections", () => {
    const history = createMotionHistory();

    // Set up history with stationary track
    history.set("track-1", {
      positions: [
        { x: 100, y: 100 },
        { x: 101, y: 100 },
        { x: 100, y: 101 },
      ],
      frameNumbers: [1, 2, 3],
    });

    const detections = [createDetection({ label: "track-1" })];
    const result = filterByMotion(detections, history, 10);

    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(1);
  });

  it("should pass moving detections", () => {
    const history = createMotionHistory();

    // Set up history with moving track
    history.set("track-1", {
      positions: [
        { x: 100, y: 100 },
        { x: 150, y: 100 },
        { x: 200, y: 100 },
      ],
      frameNumbers: [1, 2, 3],
    });

    const detections = [createDetection({ label: "track-1" })];
    const result = filterByMotion(detections, history, 10);

    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
  });
});

// ============================================================================
// Pipeline Tests
// ============================================================================

describe("runFilterPipeline", () => {
  it("should run all filters and return stats", () => {
    const detections = [
      createDetection({ confidence: 0.9, label: "track-1" }),
      createDetection({ confidence: 0.8, label: "track-2" }),
      createDetection({ confidence: 0.2, label: "track-3" }), // Will be filtered by confidence
    ];

    const result = runFilterPipeline({
      detections,
      frameNumber: 1,
      gameFormat: "eleven",
      config: { minConfidence: 0.5 },
    });

    expect(result.stats.totalInput).toBe(3);
    expect(result.stats.filteredByConfidence).toBe(1);
    expect(result.passed).toHaveLength(2);
  });

  it("should respect maxPlayers from game format config", () => {
    // Create more detections than max for "five" format
    const detections = Array.from({ length: 20 }, (_, i) =>
      createDetection({ confidence: 0.9 - i * 0.01, label: `track-${i}` })
    );

    const result = runFilterPipeline({
      detections,
      frameNumber: 1,
      gameFormat: "five", // maxPlayers = 15
    });

    expect(result.passed).toHaveLength(DEFAULT_FILTER_CONFIG.five.maxPlayers);
    expect(result.stats.filteredByTopN).toBe(5);
  });

  it("should allow custom config overrides", () => {
    const detections = Array.from({ length: 10 }, (_, i) =>
      createDetection({ confidence: 0.9, label: `track-${i}` })
    );

    const result = runFilterPipeline({
      detections,
      frameNumber: 1,
      gameFormat: "eleven",
      config: { maxPlayers: 5 },
    });

    expect(result.passed).toHaveLength(5);
    expect(result.stats.filteredByTopN).toBe(5);
  });
});

// ============================================================================
// Default Config Tests
// ============================================================================

describe("DEFAULT_FILTER_CONFIG", () => {
  it("should have correct maxPlayers for each format", () => {
    expect(DEFAULT_FILTER_CONFIG.eleven.maxPlayers).toBe(25);
    expect(DEFAULT_FILTER_CONFIG.eight.maxPlayers).toBe(20);
    expect(DEFAULT_FILTER_CONFIG.five.maxPlayers).toBe(15);
  });

  it("should have reasonable default values", () => {
    const config = DEFAULT_FILTER_CONFIG.eleven;
    expect(config.minConfidence).toBeGreaterThan(0);
    expect(config.minConfidence).toBeLessThan(1);
    expect(config.minMovement).toBeGreaterThan(0);
    expect(config.motionWindowFrames).toBeGreaterThan(0);
  });
});
