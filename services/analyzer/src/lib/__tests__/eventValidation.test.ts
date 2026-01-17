import { describe, it, expect } from "vitest";
import {
  validateTemporalConsistency,
  validateLogicalConsistency,
  validatePositionalConsistency,
  validateEvents,
  summarizeValidationResult,
  calculateEnsembleConfidence,
  DEFAULT_VALIDATION_CONFIG,
  type ValidationConfig,
} from "../eventValidation";
import type { DeduplicatedEvent } from "../deduplication";

// Helper function to create a test event
function createEvent(
  overrides: Partial<DeduplicatedEvent> & { absoluteTimestamp: number; type: DeduplicatedEvent["type"]; team: "home" | "away" }
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

describe("eventValidation", () => {
  describe("validateTemporalConsistency", () => {
    it("should pass for events in correct temporal order", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 15, type: "carry", team: "home" }),
        createEvent({ absoluteTimestamp: 20, type: "shot", team: "home" }),
      ];

      const result = validateTemporalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect duplicate events at same timestamp", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
      ];

      const result = validateTemporalConsistency(events);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe("temporal");
      expect(result.errors[0].message).toContain("Duplicate event");
    });

    it("should warn for short intervals between same team events", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "carry", team: "home" }),
        createEvent({ absoluteTimestamp: 10.3, type: "carry", team: "home" }), // 0.3s < 0.5s threshold
      ];

      const result = validateTemporalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe("temporal");
    });

    it("should not warn for valid short sequences like pass→shot", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 10.3, type: "shot", team: "home" }),
      ];

      const result = validateTemporalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("validateLogicalConsistency", () => {
    it("should pass for logical event sequences", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          details: { outcome: "complete" },
        }),
        createEvent({ absoluteTimestamp: 15, type: "carry", team: "home" }),
      ];

      const result = validateLogicalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn when completed pass is followed by opponent action without turnover", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          details: { outcome: "complete" },
        }),
        createEvent({ absoluteTimestamp: 15, type: "carry", team: "away" }),
      ];

      const result = validateLogicalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe("logical");
    });

    it("should warn when intercepted pass is followed by same team action", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          details: { outcome: "intercepted" },
        }),
        createEvent({ absoluteTimestamp: 15, type: "pass", team: "home" }),
      ];

      const result = validateLogicalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });

    it("should warn when goal is not followed by kickoff", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "shot",
          team: "home",
          details: { shotResult: "goal" },
        }),
        createEvent({ absoluteTimestamp: 25, type: "pass", team: "away" }), // 15s later, no kickoff
      ];

      const result = validateLogicalConsistency(events);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("no kickoff");
    });
  });

  describe("validatePositionalConsistency", () => {
    it("should pass for realistic movement speeds", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          mergedPosition: { x: 0.3, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 15,
          type: "carry",
          team: "home",
          mergedPosition: { x: 0.35, y: 0.5 }, // ~5m in 5s = 1 m/s
        }),
      ];

      const result = validatePositionalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn for impossible movement speeds", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "carry",
          team: "home",
          mergedPosition: { x: 0.1, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 11,
          type: "carry",
          team: "home",
          mergedPosition: { x: 0.9, y: 0.5 }, // ~84m in 1s = 84 m/s - impossible
        }),
      ];

      const result = validatePositionalConsistency(events);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe("positional");
      expect(result.warnings[0].message).toContain("Impossible movement");
    });

    it("should allow fast movement after pass (ball travel)", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          mergedPosition: { x: 0.1, y: 0.5 },
        }),
        createEvent({
          absoluteTimestamp: 11,
          type: "carry",
          team: "home",
          mergedPosition: { x: 0.7, y: 0.5 }, // Ball can travel fast
        }),
      ];

      const result = validatePositionalConsistency(events);
      expect(result.warnings).toHaveLength(0);
    });

    it("should skip events without position data", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 11, type: "carry", team: "home" }),
      ];

      const result = validatePositionalConsistency(events);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("validateEvents", () => {
    it("should combine all validation types", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({ absoluteTimestamp: 10, type: "pass", team: "home" }),
        createEvent({ absoluteTimestamp: 15, type: "carry", team: "home" }),
      ];

      const result = validateEvents(events);
      expect(result.valid).toBe(true);
    });

    it("should collect warnings from all validators", () => {
      const events: DeduplicatedEvent[] = [
        createEvent({
          absoluteTimestamp: 10,
          type: "pass",
          team: "home",
          details: { outcome: "complete" },
        }),
        createEvent({
          absoluteTimestamp: 15,
          type: "pass",
          team: "away", // Logical inconsistency
        }),
      ];

      const result = validateEvents(events);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("summarizeValidationResult", () => {
    it("should generate readable summary for passed validation", () => {
      const result = {
        valid: true,
        warnings: [],
        errors: [],
      };

      const summary = summarizeValidationResult(result);
      expect(summary).toContain("PASSED");
      expect(summary).toContain("Errors: 0");
      expect(summary).toContain("Warnings: 0");
    });

    it("should generate readable summary for failed validation", () => {
      const result = {
        valid: false,
        warnings: [
          { type: "temporal" as const, message: "test", eventIndex: 0, severity: "low" as const },
        ],
        errors: [
          { type: "temporal" as const, message: "duplicate", eventIndex: 1 },
        ],
      };

      const summary = summarizeValidationResult(result);
      expect(summary).toContain("FAILED");
      expect(summary).toContain("Errors: 1");
      expect(summary).toContain("Warnings: 1");
    });
  });

  describe("calculateEnsembleConfidence", () => {
    it("should return base confidence when no matches", () => {
      const event = createEvent({
        absoluteTimestamp: 10,
        type: "pass",
        team: "home",
        adjustedConfidence: 0.7,
      });

      const result = calculateEnsembleConfidence(event, false, false, false);
      expect(result).toBe(0.7);
    });

    it("should boost confidence for scene match", () => {
      const event = createEvent({
        absoluteTimestamp: 10,
        type: "pass",
        team: "home",
        adjustedConfidence: 0.7,
      });

      const result = calculateEnsembleConfidence(event, true, false, false);
      expect(result).toBeGreaterThan(0.7);
    });

    it("should boost more for multiple matches", () => {
      const event = createEvent({
        absoluteTimestamp: 10,
        type: "pass",
        team: "home",
        adjustedConfidence: 0.7,
      });

      const oneMatch = calculateEnsembleConfidence(event, true, false, false);
      const twoMatches = calculateEnsembleConfidence(event, true, true, false);
      const threeMatches = calculateEnsembleConfidence(event, true, true, true);

      expect(twoMatches).toBeGreaterThan(oneMatch);
      expect(threeMatches).toBeGreaterThan(twoMatches);
    });

    it("should cap confidence at 1.0", () => {
      const event = createEvent({
        absoluteTimestamp: 10,
        type: "pass",
        team: "home",
        adjustedConfidence: 0.95,
      });

      const result = calculateEnsembleConfidence(event, true, true, true);
      expect(result).toBeLessThanOrEqual(1.0);
    });
  });
});
