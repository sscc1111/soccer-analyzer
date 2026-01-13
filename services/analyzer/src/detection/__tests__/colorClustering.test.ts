/**
 * Tests for K-means color clustering module
 */

import { describe, it, expect } from "vitest";
import {
  rgbDistance,
  hsvDistance,
  kMeansClustering,
  classifyTeamsByColor,
  rgbToHex,
  DEFAULT_KMEANS_CONFIG,
  type ColorSample,
} from "../colorClustering";

// ============================================================================
// Test Helpers
// ============================================================================

function createColorSample(
  trackId: string,
  color: { r: number; g: number; b: number }
): ColorSample {
  return {
    trackId,
    color,
    position: { x: 100, y: 100 },
  };
}

// ============================================================================
// Distance Function Tests
// ============================================================================

describe("rgbDistance", () => {
  it("should return 0 for identical colors", () => {
    const color = { r: 128, g: 64, b: 200 };
    expect(rgbDistance(color, color)).toBe(0);
  });

  it("should calculate correct distance for known colors", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    // Distance should be sqrt(255^2 * 3) ≈ 441.67
    expect(rgbDistance(black, white)).toBeCloseTo(441.67, 0);
  });

  it("should be symmetric", () => {
    const c1 = { r: 100, g: 50, b: 200 };
    const c2 = { r: 200, g: 100, b: 50 };
    expect(rgbDistance(c1, c2)).toBe(rgbDistance(c2, c1));
  });
});

describe("hsvDistance", () => {
  it("should return 0 for identical colors", () => {
    const color = { r: 128, g: 64, b: 200 };
    expect(hsvDistance(color, color)).toBeCloseTo(0);
  });

  it("should give lower distance for similar hues", () => {
    const red1 = { r: 255, g: 0, b: 0 };
    const red2 = { r: 200, g: 50, b: 50 };
    const blue = { r: 0, g: 0, b: 255 };

    expect(hsvDistance(red1, red2)).toBeLessThan(hsvDistance(red1, blue));
  });

  it("should handle hue wraparound", () => {
    // Red (0°) and magenta (300°) should be closer than red and cyan (180°)
    const red = { r: 255, g: 0, b: 0 };
    const magenta = { r: 255, g: 0, b: 255 };
    const cyan = { r: 0, g: 255, b: 255 };

    expect(hsvDistance(red, magenta)).toBeLessThan(hsvDistance(red, cyan));
  });
});

// ============================================================================
// K-Means Clustering Tests
// ============================================================================

describe("kMeansClustering", () => {
  it("should return empty array for insufficient samples", () => {
    const samples = [
      createColorSample("track-1", { r: 255, g: 0, b: 0 }),
      createColorSample("track-2", { r: 0, g: 0, b: 255 }),
    ];

    const result = kMeansClustering(samples, { minSamples: 10 });
    expect(result).toHaveLength(0);
  });

  it("should cluster clearly distinct colors", () => {
    // Create samples with clearly distinct red and blue colors
    const samples = [
      // Red team
      createColorSample("red-1", { r: 255, g: 0, b: 0 }),
      createColorSample("red-2", { r: 240, g: 20, b: 20 }),
      createColorSample("red-3", { r: 220, g: 30, b: 30 }),
      createColorSample("red-4", { r: 255, g: 10, b: 10 }),
      // Blue team
      createColorSample("blue-1", { r: 0, g: 0, b: 255 }),
      createColorSample("blue-2", { r: 20, g: 20, b: 240 }),
      createColorSample("blue-3", { r: 30, g: 30, b: 220 }),
      createColorSample("blue-4", { r: 10, g: 10, b: 255 }),
    ];

    const result = kMeansClustering(samples, { k: 2, minSamples: 6 });

    expect(result).toHaveLength(2);

    // Each cluster should have roughly 4 members
    expect(result[0].members.length).toBeGreaterThanOrEqual(3);
    expect(result[1].members.length).toBeGreaterThanOrEqual(3);

    // Members should be grouped by color (all reds together, all blues together)
    const cluster0TrackIds = result[0].members.map((m) => m.trackId);
    const cluster1TrackIds = result[1].members.map((m) => m.trackId);

    // Check that reds are in one cluster and blues in another
    const cluster0HasRed = cluster0TrackIds.some((id) => id.startsWith("red"));
    const cluster0HasBlue = cluster0TrackIds.some((id) => id.startsWith("blue"));

    // Clusters should not mix reds and blues
    if (cluster0HasRed) {
      expect(cluster0HasBlue).toBe(false);
    }
    if (cluster0HasBlue) {
      expect(cluster0HasRed).toBe(false);
    }
  });

  it("should handle 3 clusters for teams + referees", () => {
    const samples = [
      // Red team
      createColorSample("red-1", { r: 255, g: 0, b: 0 }),
      createColorSample("red-2", { r: 240, g: 20, b: 20 }),
      createColorSample("red-3", { r: 220, g: 30, b: 30 }),
      // Blue team
      createColorSample("blue-1", { r: 0, g: 0, b: 255 }),
      createColorSample("blue-2", { r: 20, g: 20, b: 240 }),
      createColorSample("blue-3", { r: 30, g: 30, b: 220 }),
      // Referees (black)
      createColorSample("ref-1", { r: 30, g: 30, b: 30 }),
      createColorSample("ref-2", { r: 40, g: 40, b: 40 }),
    ];

    const result = kMeansClustering(samples, { k: 3, minSamples: 6 });

    expect(result).toHaveLength(3);
  });
});

// ============================================================================
// Team Classification Tests
// ============================================================================

describe("classifyTeamsByColor", () => {
  it("should return unknown for insufficient samples", () => {
    const samples = [createColorSample("track-1", { r: 255, g: 0, b: 0 })];

    const result = classifyTeamsByColor(samples, null, { minSamples: 6 });

    expect(result.assignments.get("track-1")).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("should classify players into home and away teams", () => {
    const samples = [
      // Home team (red)
      createColorSample("home-1", { r: 255, g: 0, b: 0 }),
      createColorSample("home-2", { r: 240, g: 20, b: 20 }),
      createColorSample("home-3", { r: 220, g: 30, b: 30 }),
      createColorSample("home-4", { r: 255, g: 10, b: 10 }),
      // Away team (blue)
      createColorSample("away-1", { r: 0, g: 0, b: 255 }),
      createColorSample("away-2", { r: 20, g: 20, b: 240 }),
      createColorSample("away-3", { r: 30, g: 30, b: 220 }),
      createColorSample("away-4", { r: 10, g: 10, b: 255 }),
    ];

    const result = classifyTeamsByColor(samples, null, { minSamples: 6 });

    // Should have high confidence for well-separated colors
    expect(result.confidence).toBeGreaterThan(0);

    // All samples should be assigned
    expect(result.assignments.size).toBe(8);

    // Check that assignments are consistent within groups
    const homeAssignments = ["home-1", "home-2", "home-3", "home-4"].map(
      (id) => result.assignments.get(id)
    );
    const awayAssignments = ["away-1", "away-2", "away-3", "away-4"].map(
      (id) => result.assignments.get(id)
    );

    // All home players should have the same team
    const homeTeam = homeAssignments[0];
    expect(homeAssignments.every((a) => a === homeTeam)).toBe(true);

    // All away players should have the same team
    const awayTeam = awayAssignments[0];
    expect(awayAssignments.every((a) => a === awayTeam)).toBe(true);

    // Home and away should be different teams
    expect(homeTeam).not.toBe(awayTeam);
  });

  it("should align clusters with user-specified team colors", () => {
    const samples = [
      // Should be home (red)
      createColorSample("player-1", { r: 255, g: 0, b: 0 }),
      createColorSample("player-2", { r: 240, g: 20, b: 20 }),
      createColorSample("player-3", { r: 220, g: 30, b: 30 }),
      // Should be away (blue)
      createColorSample("player-4", { r: 0, g: 0, b: 255 }),
      createColorSample("player-5", { r: 20, g: 20, b: 240 }),
      createColorSample("player-6", { r: 30, g: 30, b: 220 }),
    ];

    const result = classifyTeamsByColor(
      samples,
      { home: "#ff0000", away: "#0000ff" },
      { minSamples: 6 }
    );

    // Red players should be classified as "home"
    expect(result.assignments.get("player-1")).toBe("home");
    expect(result.assignments.get("player-2")).toBe("home");
    expect(result.assignments.get("player-3")).toBe("home");

    // Blue players should be classified as "away"
    expect(result.assignments.get("player-4")).toBe("away");
    expect(result.assignments.get("player-5")).toBe("away");
    expect(result.assignments.get("player-6")).toBe("away");
  });

  it("should return detected colors", () => {
    const samples = [
      createColorSample("r-1", { r: 200, g: 50, b: 50 }),
      createColorSample("r-2", { r: 220, g: 40, b: 40 }),
      createColorSample("r-3", { r: 180, g: 60, b: 60 }),
      createColorSample("b-1", { r: 50, g: 50, b: 200 }),
      createColorSample("b-2", { r: 40, g: 40, b: 220 }),
      createColorSample("b-3", { r: 60, g: 60, b: 180 }),
    ];

    const result = classifyTeamsByColor(samples, null, { minSamples: 6 });

    // Should detect team colors
    expect(result.detectedColors.home).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.detectedColors.away).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe("rgbToHex", () => {
  it("should convert RGB to hex", () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
    expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe("#00ff00");
    expect(rgbToHex({ r: 0, g: 0, b: 255 })).toBe("#0000ff");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("should handle intermediate values", () => {
    expect(rgbToHex({ r: 128, g: 64, b: 32 })).toBe("#804020");
  });
});

// ============================================================================
// Configuration Tests
// ============================================================================

describe("DEFAULT_KMEANS_CONFIG", () => {
  it("should have reasonable default values", () => {
    expect(DEFAULT_KMEANS_CONFIG.k).toBe(2);
    expect(DEFAULT_KMEANS_CONFIG.maxIterations).toBeGreaterThan(0);
    expect(DEFAULT_KMEANS_CONFIG.minSamples).toBeGreaterThan(0);
    expect(DEFAULT_KMEANS_CONFIG.useHsvSpace).toBe(true);
  });
});
