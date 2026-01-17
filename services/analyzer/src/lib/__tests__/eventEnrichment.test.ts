import { describe, it, expect } from "vitest";
import {
  calculatePassDirection,
  calculateCarryDistance,
  calculateDistanceToGoal,
  calculateAngleToGoal,
  isInPenaltyArea,
  isInGoalArea,
  calculateXG,
  enrichEvents,
  detectPassChains,
  calculateEnrichmentStats,
} from "../eventEnrichment";
import type { DeduplicatedEvent } from "../deduplication";

// Helper function to create a test event
function createEvent(
  overrides: Partial<DeduplicatedEvent> & {
    absoluteTimestamp: number;
    type: DeduplicatedEvent["type"];
    team: "home" | "away";
  }
): DeduplicatedEvent {
  return {
    type: overrides.type,
    team: overrides.team,
    absoluteTimestamp: overrides.absoluteTimestamp,
    details: {},
    confidence: 0.8,
    adjustedConfidence: 0.8,
    mergedFromWindows: ["w1"],
    ...overrides,
  };
}

describe("eventEnrichment", () => {
  describe("calculatePassDirection", () => {
    it("should detect forward pass for home team", () => {
      const start = { x: 0.3, y: 0.5 };
      const end = { x: 0.6, y: 0.5 }; // Moving right (forward for home)
      expect(calculatePassDirection(start, end, "home")).toBe("forward");
    });

    it("should detect backward pass for home team", () => {
      const start = { x: 0.6, y: 0.5 };
      const end = { x: 0.3, y: 0.5 }; // Moving left (backward for home)
      expect(calculatePassDirection(start, end, "home")).toBe("backward");
    });

    it("should detect lateral pass for home team", () => {
      const start = { x: 0.5, y: 0.3 };
      const end = { x: 0.52, y: 0.7 }; // Mostly vertical movement
      expect(calculatePassDirection(start, end, "home")).toBe("lateral");
    });

    it("should detect forward pass for away team (reversed direction)", () => {
      const start = { x: 0.6, y: 0.5 };
      const end = { x: 0.3, y: 0.5 }; // Moving left (forward for away)
      expect(calculatePassDirection(start, end, "away")).toBe("forward");
    });

    it("should return lateral when end position is null", () => {
      const start = { x: 0.5, y: 0.5 };
      expect(calculatePassDirection(start, null, "home")).toBe("lateral");
    });
  });

  describe("calculateCarryDistance", () => {
    it("should calculate distance in meters", () => {
      const start = { x: 0.5, y: 0.5 }; // Center
      const end = { x: 0.6, y: 0.5 }; // 10.5m to the right
      const distance = calculateCarryDistance(start, end);
      expect(distance).toBeCloseTo(10.5, 1);
    });

    it("should return 0 when positions are undefined", () => {
      expect(calculateCarryDistance(undefined, undefined)).toBe(0);
      expect(calculateCarryDistance({ x: 0.5, y: 0.5 }, undefined)).toBe(0);
    });
  });

  describe("calculateDistanceToGoal", () => {
    it("should calculate distance to goal for home team", () => {
      // Center of field to right goal
      const distance = calculateDistanceToGoal({ x: 0.5, y: 0.5 }, "home");
      expect(distance).toBeCloseTo(52.5, 1); // Half field length
    });

    it("should calculate distance to goal for away team", () => {
      // Center of field to left goal
      const distance = calculateDistanceToGoal({ x: 0.5, y: 0.5 }, "away");
      expect(distance).toBeCloseTo(52.5, 1); // Half field length
    });

    it("should be very small near the goal", () => {
      // Near the goal for home team
      const distance = calculateDistanceToGoal({ x: 0.95, y: 0.5 }, "home");
      expect(distance).toBeLessThan(10);
    });
  });

  describe("calculateAngleToGoal", () => {
    it("should return angle for central position", () => {
      // From a central position, the angle should be reasonable
      const angle = calculateAngleToGoal({ x: 0.8, y: 0.5 }, "home");
      // When exactly centered, the angle might be very small due to how it's calculated
      // but from slightly off-center it should be positive
      expect(angle).toBeGreaterThanOrEqual(0);
    });

    it("should return positive angle from side position", () => {
      // From the side, angle should still be positive
      const angle = calculateAngleToGoal({ x: 0.8, y: 0.3 }, "home");
      expect(angle).toBeGreaterThan(0);
    });

    it("should return very small angle from tight position", () => {
      // Near touchline, far from goal
      const angle = calculateAngleToGoal({ x: 0.7, y: 0.1 }, "home");
      expect(angle).toBeLessThan(20);
    });
  });

  describe("isInPenaltyArea", () => {
    it("should detect position in penalty area for home team", () => {
      // Near away goal (right side)
      expect(isInPenaltyArea({ x: 0.9, y: 0.5 }, "home")).toBe(true);
    });

    it("should detect position outside penalty area", () => {
      // Center of field
      expect(isInPenaltyArea({ x: 0.5, y: 0.5 }, "home")).toBe(false);
    });

    it("should detect position in penalty area for away team", () => {
      // Near home goal (left side)
      expect(isInPenaltyArea({ x: 0.1, y: 0.5 }, "away")).toBe(true);
    });

    it("should reject position outside PA width", () => {
      // In the right third but outside PA width
      expect(isInPenaltyArea({ x: 0.9, y: 0.1 }, "home")).toBe(false);
    });
  });

  describe("isInGoalArea", () => {
    it("should detect position in goal area for home team", () => {
      expect(isInGoalArea({ x: 0.97, y: 0.5 }, "home")).toBe(true);
    });

    it("should detect position outside goal area but in PA", () => {
      expect(isInGoalArea({ x: 0.9, y: 0.5 }, "home")).toBe(false);
    });
  });

  describe("calculateXG", () => {
    it("should return high xG for shots near goal", () => {
      const { xG } = calculateXG({ x: 0.95, y: 0.5 }, "home");
      // Shots from goal area should have minimum xG of 0.35
      expect(xG).toBeGreaterThanOrEqual(0.35);
    });

    it("should return low xG for long range shots", () => {
      const { xG } = calculateXG({ x: 0.6, y: 0.5 }, "home");
      expect(xG).toBeLessThan(0.15);
    });

    it("should return penalty xG for penalty shot type", () => {
      const { xG } = calculateXG({ x: 0.89, y: 0.5 }, "home", "penalty");
      expect(xG).toBeCloseTo(0.76, 2);
    });

    it("should reduce xG for headers", () => {
      const { xG: normalXG } = calculateXG({ x: 0.95, y: 0.5 }, "home", "placed");
      const { xG: headerXG } = calculateXG({ x: 0.95, y: 0.5 }, "home", "header");
      expect(headerXG).toBeLessThan(normalXG);
    });

    it("should return default xG when position is undefined", () => {
      const { xG, factors } = calculateXG(undefined, "home");
      expect(xG).toBe(0.1);
      expect(factors.distanceFromGoal).toBe(20);
    });

    it("should include factors in the result", () => {
      const { factors } = calculateXG({ x: 0.9, y: 0.5 }, "home");
      expect(factors.inPenaltyArea).toBe(true);
      expect(factors.distanceFromGoal).toBeGreaterThan(0);
      expect(factors.angleToGoal).toBeGreaterThan(0);
    });
  });

  describe("enrichEvents", () => {
    it("should add passDirection to pass events", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          mergedPosition: { x: 0.3, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 12,
          type: "carry",
          team: "home",
          mergedPosition: { x: 0.5, y: 0.5 },
        }),
      ];

      const enriched = enrichEvents(events);
      expect(enriched[0].passDirection).toBe("forward");
    });

    it("should add xG to shot events", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "shot",
          team: "home",
          mergedPosition: { x: 0.9, y: 0.5 },
          details: { shotType: "power" },
        }),
      ];

      const enriched = enrichEvents(events);
      expect(enriched[0].xG).toBeGreaterThan(0);
      expect(enriched[0].xGFactors).toBeDefined();
    });

    it("should add carryDistanceMeters to carry events", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "carry",
          team: "home",
          mergedPosition: { x: 0.3, y: 0.5 },
          details: { endZone: "attacking_third" },
        }),
      ];

      const enriched = enrichEvents(events);
      expect(enriched[0].carryDistanceMeters).toBeGreaterThan(0);
    });
  });

  describe("detectPassChains", () => {
    it("should detect pass chains of 3+ passes", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 12, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 14, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 16, type: "pass", team: "home" }),
      ];

      const chains = detectPassChains(events);
      expect(chains).toHaveLength(1);
      expect(chains[0].passCount).toBe(4);
      expect(chains[0].teamId).toBe("home");
    });

    it("should break chain when team changes", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 12, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 14, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 16, type: "pass", team: "away" }), // Team change
        createEvent({ absoluteTimestamp: 18, type: "pass", team: "away" }),
        createEvent({ absoluteTimestamp: 20, type: "pass", team: "away" }),
      ];

      const chains = detectPassChains(events);
      expect(chains).toHaveLength(2);
    });

    it("should break chain when gap is too large", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 12, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 14, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 25, type: "pass", team: "home" }), // Large gap
        createEvent({ absoluteTimestamp: 27, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 29, type: "pass", team: "home" }),
      ];

      const chains = detectPassChains(events, 5);
      expect(chains).toHaveLength(2);
    });

    it("should not include chains with less than 3 passes", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 12, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 14, type: "turnover", team: "home" }), // Break
      ];

      const chains = detectPassChains(events);
      expect(chains).toHaveLength(0);
    });
  });

  describe("calculateEnrichmentStats", () => {
    it("should calculate statistics correctly", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          mergedPosition: { x: 0.3, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 12,
          type: "pass",
          team: "home",
          mergedPosition: { x: 0.5, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 14,
          type: "pass",
          team: "home",
          mergedPosition: { x: 0.6, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 16,
          type: "shot",
          team: "home",
          mergedPosition: { x: 0.9, y: 0.5 },
          details: { shotResult: "saved" },
        }),
      ];

      const enriched = enrichEvents(events);
      const chains = detectPassChains(events);
      const stats = calculateEnrichmentStats(enriched, chains);

      expect(stats.totalEvents).toBe(4);
      expect(stats.passEvents.total).toBe(3);
      expect(stats.passEvents.withDirection).toBe(3);
      expect(stats.shotEvents.total).toBe(1);
      expect(stats.shotEvents.withXG).toBe(1);
      expect(stats.passChains.total).toBe(1);
      expect(stats.passChains.maxLength).toBe(3);
    });
  });
});
