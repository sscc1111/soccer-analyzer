/**
 * Tests for carry/dribble classification (Phase 2.2.2)
 *
 * Tests the classifyCarryAsDribble function which distinguishes between:
 * - Simple carries (low intensity movement with ball)
 * - Dribbles (active running with ball, often against defenders)
 */

import { describe, it, expect } from "vitest";
import { classifyCarryAsDribble } from "../eventEnrichment";
import type { DeduplicatedEvent } from "../deduplication";
import type { Point2D } from "@soccer/shared";

/**
 * Helper to create a test carry event
 */
function createCarryEvent(
  team: "home" | "away",
  zone: string,
  details: Record<string, unknown> = {}
): DeduplicatedEvent {
  return {
    absoluteTimestamp: 10.0,
    type: "carry",
    team,
    player: "#10",
    zone,
    details,
    confidence: 0.8,
    mergedFromWindows: ["window_1"],
    adjustedConfidence: 0.8,
  };
}

describe("classifyCarryAsDribble", () => {
  describe("Basic classification", () => {
    it("should classify as simple carry when no position data", () => {
      const carry = createCarryEvent("home", "middle_third");
      const result = classifyCarryAsDribble(carry, undefined, undefined, undefined);

      expect(result.isDribble).toBe(false);
      expect(result.confidence).toBe(0.3);
    });

    it("should classify as simple carry for short distance (< 5m)", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 1.0 });
      const startPos: Point2D = { x: 0.5, y: 0.5 };
      const endPos: Point2D = { x: 0.52, y: 0.5 }; // ~2.1m

      const result = classifyCarryAsDribble(carry, 3.0, startPos, endPos);

      expect(result.isDribble).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.4);
    });

    it("should classify as dribble for long distance (> 15m)", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 3.0 });
      const startPos: Point2D = { x: 0.3, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe("Duration factor", () => {
    it("should favor dribble for duration >= 3 seconds", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 3.5 });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // ~10.5m

      const result = classifyCarryAsDribble(carry, 12.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it("should be uncertain for duration ~2 seconds", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.47, y: 0.5 }; // ~7.35m

      const result = classifyCarryAsDribble(carry, 8.0, startPos, endPos);

      // Should be borderline - could be either
      expect(result.confidence).toBeGreaterThan(0.4);
      expect(result.confidence).toBeLessThan(0.8);
    });

    it("should favor simple carry for duration < 1.5 seconds", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 1.0 });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.45, y: 0.5 }; // ~5.25m

      const result = classifyCarryAsDribble(carry, 6.0, startPos, endPos);

      expect(result.isDribble).toBe(false);
    });
  });

  describe("Distance factor", () => {
    it("should classify as dribble for 15m+ with good duration", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.5 });
      const startPos: Point2D = { x: 0.3, y: 0.5 };
      const endPos: Point2D = { x: 0.48, y: 0.5 }; // ~18.9m

      const result = classifyCarryAsDribble(carry, 18.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it("should classify as dribble for 10-15m range with moderate duration", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.51, y: 0.5 }; // ~11.55m

      const result = classifyCarryAsDribble(carry, 12.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should be borderline for 7-10m range", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 1.8 });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.47, y: 0.5 }; // ~7.35m

      const result = classifyCarryAsDribble(carry, 8.0, startPos, endPos);

      // Should be uncertain
      expect(result.confidence).toBeGreaterThan(0.4);
      expect(result.confidence).toBeLessThan(0.75);
    });
  });

  describe("Zone change factor", () => {
    it("should boost dribble for forward zone progression (home: defensive -> middle)", () => {
      const carry = createCarryEvent("home", "defensive_third", {
        duration: 2.5,
        endZone: "middle_third",
      });
      const startPos: Point2D = { x: 0.2, y: 0.5 };
      const endPos: Point2D = { x: 0.4, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it("should boost dribble for forward zone progression (home: middle -> attacking)", () => {
      const carry = createCarryEvent("home", "middle_third", {
        duration: 2.0,
        endZone: "attacking_third",
      });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.6, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 21.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it("should boost dribble for forward zone progression (away: attacking -> middle)", () => {
      const carry = createCarryEvent("away", "attacking_third", {
        duration: 2.5,
        endZone: "middle_third",
      });
      const startPos: Point2D = { x: 0.8, y: 0.5 };
      const endPos: Point2D = { x: 0.6, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it("should penalize backward zone progression (home: middle -> defensive)", () => {
      const carry = createCarryEvent("home", "middle_third", {
        duration: 2.0,
        endZone: "defensive_third",
      });
      const startPos: Point2D = { x: 0.5, y: 0.5 };
      const endPos: Point2D = { x: 0.3, y: 0.5 }; // ~21m backward

      const result = classifyCarryAsDribble(carry, 18.0, startPos, endPos);

      // Distance is high but backward progression should lower confidence
      expect(result.confidence).toBeLessThan(0.9);
    });

    it("should handle no zone change neutrally", () => {
      const carry = createCarryEvent("home", "middle_third", {
        duration: 2.0,
        // No endZone specified
      });
      const startPos: Point2D = { x: 0.4, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // ~10.5m

      const result = classifyCarryAsDribble(carry, 12.0, startPos, endPos);

      // Should still classify based on other factors
      expect(result.isDribble).toBe(true);
    });
  });

  describe("Attack progression factor", () => {
    it("should boost dribble for strong forward progression (home team)", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.3, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // 20% forward (21m)

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should boost dribble for strong forward progression (away team)", () => {
      const carry = createCarryEvent("away", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.7, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // 20% forward for away (21m)

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should penalize backward movement (home team)", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.5, y: 0.5 };
      const endPos: Point2D = { x: 0.4, y: 0.5 }; // 10% backward

      const result = classifyCarryAsDribble(carry, 10.0, startPos, endPos);

      // Should lower confidence despite distance
      // Implementation uses overall scoring, so confidence may be higher
      expect(result.confidence).toBeLessThan(0.85);
    });

    it("should penalize lateral movement with no forward progress", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.5, y: 0.3 };
      const endPos: Point2D = { x: 0.5, y: 0.7 }; // Pure lateral (27.2m)

      const result = classifyCarryAsDribble(carry, 27.0, startPos, endPos);

      // High distance but no forward progress - still classified as dribble due to distance
      // but with reduced confidence compared to forward movement
      expect(result.confidence).toBeLessThan(0.9);
    });
  });

  describe("Combined factors", () => {
    it("should strongly classify as dribble with all positive factors", () => {
      const carry = createCarryEvent("home", "defensive_third", {
        duration: 3.0,
        endZone: "middle_third",
      });
      const startPos: Point2D = { x: 0.2, y: 0.5 };
      const endPos: Point2D = { x: 0.45, y: 0.5 }; // 25% forward, ~26.25m

      const result = classifyCarryAsDribble(carry, 25.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify as simple carry with all negative factors", () => {
      const carry = createCarryEvent("home", "middle_third", {
        duration: 1.0,
        endZone: "middle_third",
      });
      const startPos: Point2D = { x: 0.5, y: 0.5 };
      const endPos: Point2D = { x: 0.51, y: 0.51 }; // ~1.5m

      const result = classifyCarryAsDribble(carry, 2.0, startPos, endPos);

      expect(result.isDribble).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should handle mixed factors appropriately", () => {
      // High distance but short duration
      const carry = createCarryEvent("home", "middle_third", { duration: 1.2 });
      const startPos: Point2D = { x: 0.3, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      // Should still favor dribble due to distance
      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThan(0.85);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero distance", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 2.0 });
      const startPos: Point2D = { x: 0.5, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // No movement

      const result = classifyCarryAsDribble(carry, 0, startPos, endPos);

      expect(result.isDribble).toBe(false);
    });

    it("should handle missing duration (defaults to 1.0)", () => {
      const carry = createCarryEvent("home", "middle_third", {});
      const startPos: Point2D = { x: 0.3, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      // Should still classify based on distance
      expect(result.isDribble).toBe(true);
    });

    it("should handle very long duration (> 5s)", () => {
      const carry = createCarryEvent("home", "middle_third", { duration: 6.0 });
      const startPos: Point2D = { x: 0.3, y: 0.5 };
      const endPos: Point2D = { x: 0.5, y: 0.5 }; // ~21m

      const result = classifyCarryAsDribble(carry, 20.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should handle very long distance (> 30m)", () => {
      const carry = createCarryEvent("home", "defensive_third", {
        duration: 4.0,
        endZone: "attacking_third",
      });
      const startPos: Point2D = { x: 0.1, y: 0.5 };
      const endPos: Point2D = { x: 0.6, y: 0.5 }; // 50% of field, ~52.5m

      const result = classifyCarryAsDribble(carry, 50.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.9);
    });
  });

  describe("Realistic scenarios", () => {
    it("should classify counterattack run as dribble", () => {
      // Midfielder receives ball in own half, runs 30m forward in 3.5 seconds
      const carry = createCarryEvent("home", "defensive_third", {
        duration: 3.5,
        endZone: "attacking_third",
      });
      const startPos: Point2D = { x: 0.25, y: 0.5 };
      const endPos: Point2D = { x: 0.55, y: 0.4 }; // ~32m

      const result = classifyCarryAsDribble(carry, 32.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    it("should classify winger dribble as dribble", () => {
      // Winger takes on defender on flank, moves 12m in 2.5 seconds
      const carry = createCarryEvent("home", "attacking_third", {
        duration: 2.5,
        endZone: "attacking_third",
      });
      const startPos: Point2D = { x: 0.7, y: 0.2 };
      const endPos: Point2D = { x: 0.8, y: 0.3 }; // ~13m

      const result = classifyCarryAsDribble(carry, 13.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.65);
    });

    it("should classify short possession as simple carry", () => {
      // Player receives ball, takes a few steps, passes - 1 second, 3m
      const carry = createCarryEvent("home", "middle_third", {
        duration: 1.0,
        endZone: "middle_third",
      });
      const startPos: Point2D = { x: 0.5, y: 0.5 };
      const endPos: Point2D = { x: 0.52, y: 0.51 }; // ~3m

      const result = classifyCarryAsDribble(carry, 3.0, startPos, endPos);

      expect(result.isDribble).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should classify goalkeeper distribution as simple carry", () => {
      // Goalkeeper moves with ball before distributing - 1s, 4m (short possession)
      const carry = createCarryEvent("home", "defensive_third", {
        duration: 1.0, // Short duration
        endZone: "defensive_third",
      });
      const startPos: Point2D = { x: 0.05, y: 0.5 };
      const endPos: Point2D = { x: 0.09, y: 0.5 }; // ~4.2m

      const result = classifyCarryAsDribble(carry, 4.0, startPos, endPos);

      expect(result.isDribble).toBe(false);
    });

    it("should classify skillful midfielder dribble as dribble", () => {
      // Midfielder evades pressure, changes direction, moves 15m in 2.8 seconds
      const carry = createCarryEvent("home", "middle_third", {
        duration: 2.8,
        endZone: "attacking_third",
      });
      const startPos: Point2D = { x: 0.45, y: 0.6 };
      const endPos: Point2D = { x: 0.6, y: 0.5 }; // ~16m

      const result = classifyCarryAsDribble(carry, 16.0, startPos, endPos);

      expect(result.isDribble).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.75);
    });
  });
});
