import { describe, it, expect } from "vitest";
import {
  getZoneCenterCoordinate,
  getRandomPositionInZone,
  getPositionInZone,
  getZoneFromPosition,
  getPositionFromZone,
  mergePositions,
  calculateDistance,
  calculateDistanceMeters,
  normalizedToMeters,
  metersToNormalized,
  ZONE_BOUNDS,
  ZONE_BOUNDS_AWAY,
  type EventZone,
  type PositionWithMetadata,
} from "../zoneToCoordinate";

describe("zoneToCoordinate", () => {
  describe("getZoneCenterCoordinate", () => {
    it("should return center of defensive_third for home team", () => {
      const result = getZoneCenterCoordinate("defensive_third", "home");
      expect(result.x).toBeCloseTo(0.1665, 2);
      expect(result.y).toBeCloseTo(0.5, 2);
    });

    it("should return center of middle_third for home team", () => {
      const result = getZoneCenterCoordinate("middle_third", "home");
      expect(result.x).toBeCloseTo(0.5, 2);
      expect(result.y).toBeCloseTo(0.5, 2);
    });

    it("should return center of attacking_third for home team", () => {
      const result = getZoneCenterCoordinate("attacking_third", "home");
      expect(result.x).toBeCloseTo(0.8335, 2);
      expect(result.y).toBeCloseTo(0.5, 2);
    });

    it("should return inverted zones for away team", () => {
      // Away team's defensive_third is on the right side
      const awayDefensive = getZoneCenterCoordinate("defensive_third", "away");
      expect(awayDefensive.x).toBeCloseTo(0.8335, 2);

      // Away team's attacking_third is on the left side
      const awayAttacking = getZoneCenterCoordinate("attacking_third", "away");
      expect(awayAttacking.x).toBeCloseTo(0.1665, 2);
    });
  });

  describe("getRandomPositionInZone", () => {
    it("should return position within defensive_third bounds", () => {
      const bounds = ZONE_BOUNDS.defensive_third;
      for (let i = 0; i < 10; i++) {
        const result = getRandomPositionInZone("defensive_third", "home");
        expect(result.x).toBeGreaterThanOrEqual(bounds.xMin);
        expect(result.x).toBeLessThanOrEqual(bounds.xMax);
        expect(result.y).toBeGreaterThanOrEqual(bounds.yMin);
        expect(result.y).toBeLessThanOrEqual(bounds.yMax);
      }
    });

    it("should return different positions on multiple calls", () => {
      const positions = Array.from({ length: 5 }, () =>
        getRandomPositionInZone("middle_third", "home")
      );
      // At least some positions should be different
      const uniqueX = new Set(positions.map((p) => p.x.toFixed(4)));
      expect(uniqueX.size).toBeGreaterThan(1);
    });
  });

  describe("getPositionInZone", () => {
    it("should return exact position within zone", () => {
      // Top-left corner of middle_third
      const topLeft = getPositionInZone("middle_third", 0, 0, "home");
      expect(topLeft.x).toBeCloseTo(0.333, 2);
      expect(topLeft.y).toBeCloseTo(0, 2);

      // Bottom-right corner of middle_third
      const bottomRight = getPositionInZone("middle_third", 1, 1, "home");
      expect(bottomRight.x).toBeCloseTo(0.667, 2);
      expect(bottomRight.y).toBeCloseTo(1, 2);

      // Center of middle_third
      const center = getPositionInZone("middle_third", 0.5, 0.5, "home");
      expect(center.x).toBeCloseTo(0.5, 2);
      expect(center.y).toBeCloseTo(0.5, 2);
    });

    it("should clamp values outside 0-1 range", () => {
      const clamped = getPositionInZone("middle_third", -0.5, 1.5, "home");
      expect(clamped.x).toBeCloseTo(0.333, 2);
      expect(clamped.y).toBeCloseTo(1, 2);
    });
  });

  describe("getZoneFromPosition", () => {
    it("should correctly identify defensive_third", () => {
      expect(getZoneFromPosition({ x: 0.1, y: 0.5 }, "home")).toBe("defensive_third");
      expect(getZoneFromPosition({ x: 0.3, y: 0.5 }, "home")).toBe("defensive_third");
    });

    it("should correctly identify middle_third", () => {
      expect(getZoneFromPosition({ x: 0.4, y: 0.5 }, "home")).toBe("middle_third");
      expect(getZoneFromPosition({ x: 0.5, y: 0.5 }, "home")).toBe("middle_third");
      expect(getZoneFromPosition({ x: 0.6, y: 0.5 }, "home")).toBe("middle_third");
    });

    it("should correctly identify attacking_third", () => {
      expect(getZoneFromPosition({ x: 0.7, y: 0.5 }, "home")).toBe("attacking_third");
      expect(getZoneFromPosition({ x: 0.9, y: 0.5 }, "home")).toBe("attacking_third");
    });

    it("should invert zones for away team", () => {
      // Position on the left is attacking for away team
      expect(getZoneFromPosition({ x: 0.1, y: 0.5 }, "away")).toBe("attacking_third");
      // Position on the right is defensive for away team
      expect(getZoneFromPosition({ x: 0.9, y: 0.5 }, "away")).toBe("defensive_third");
    });
  });

  describe("getPositionFromZone", () => {
    it("should return position with zone_conversion source", () => {
      const result = getPositionFromZone("middle_third", "home");
      expect(result.source).toBe("zone_conversion");
      expect(result.confidence).toBe(0.5);
      expect(result.position.x).toBeCloseTo(0.5, 2);
    });

    it("should return default position for undefined zone", () => {
      const result = getPositionFromZone(undefined);
      expect(result.source).toBe("unknown");
      expect(result.confidence).toBe(0.1);
      expect(result.position.x).toBeCloseTo(0.5, 2);
      expect(result.position.y).toBeCloseTo(0.5, 2);
    });
  });

  describe("mergePositions", () => {
    it("should return weighted average of positions", () => {
      const positions: PositionWithMetadata[] = [
        { position: { x: 0.2, y: 0.3 }, source: "ball_detection", confidence: 0.8 },
        { position: { x: 0.4, y: 0.5 }, source: "zone_conversion", confidence: 0.5 },
      ];

      const result = mergePositions(positions);

      // Weighted average: (0.2*0.8 + 0.4*0.5) / (0.8+0.5) = 0.36 / 1.3 ≈ 0.277
      expect(result.position.x).toBeCloseTo(0.277, 2);
      // Source should be from highest confidence
      expect(result.source).toBe("ball_detection");
      // Confidence should be boosted
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should return single position unchanged", () => {
      const positions: PositionWithMetadata[] = [
        { position: { x: 0.5, y: 0.5 }, source: "gemini_output", confidence: 0.7 },
      ];

      const result = mergePositions(positions);
      expect(result).toEqual(positions[0]);
    });

    it("should return default for empty array", () => {
      const result = mergePositions([]);
      expect(result.source).toBe("unknown");
      expect(result.confidence).toBe(0);
    });
  });

  describe("calculateDistance", () => {
    it("should calculate distance between two points", () => {
      expect(calculateDistance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
      expect(calculateDistance({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(1);
      expect(calculateDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.SQRT2, 5);
    });

    it("should return 0 for same points", () => {
      expect(calculateDistance({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBe(0);
    });
  });

  describe("normalizedToMeters and metersToNormalized", () => {
    it("should convert normalized to meters correctly", () => {
      const normalized = { x: 1, y: 1 };
      const meters = normalizedToMeters(normalized);
      expect(meters.x).toBe(105); // Field length
      expect(meters.y).toBe(68);  // Field width
    });

    it("should convert meters to normalized correctly", () => {
      const meters = { x: 52.5, y: 34 };
      const normalized = metersToNormalized(meters);
      expect(normalized.x).toBeCloseTo(0.5, 5);
      expect(normalized.y).toBeCloseTo(0.5, 5);
    });

    it("should be inverse operations", () => {
      const original = { x: 0.3, y: 0.7 };
      const result = metersToNormalized(normalizedToMeters(original));
      expect(result.x).toBeCloseTo(original.x, 5);
      expect(result.y).toBeCloseTo(original.y, 5);
    });
  });

  describe("calculateDistanceMeters", () => {
    it("should calculate distance in meters", () => {
      // From center to right edge
      const distance = calculateDistanceMeters(
        { x: 0.5, y: 0.5 },
        { x: 1.0, y: 0.5 }
      );
      expect(distance).toBeCloseTo(52.5, 1); // Half of 105m
    });

    it("should calculate diagonal distance correctly", () => {
      // Corner to corner
      const distance = calculateDistanceMeters(
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      );
      // sqrt(105^2 + 68^2) ≈ 125.1m
      expect(distance).toBeCloseTo(125.1, 0);
    });
  });
});
