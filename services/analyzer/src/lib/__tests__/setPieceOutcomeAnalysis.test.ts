/**
 * Tests for Set Piece Outcome Analysis (Section 3.2.2)
 */

import { describe, it, expect } from "vitest";
import {
  analyzeSetPieceOutcomes,
  type SetPieceOutcomeAnalysis,
} from "../setPieceOutcomeAnalysis";
import type { DeduplicatedEvent } from "../deduplication";
import type { TeamId } from "@soccer/shared";

/**
 * Helper: Create a deduplicated event
 */
function createEvent(
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece",
  timestamp: number,
  team: TeamId,
  details?: Record<string, unknown>
): DeduplicatedEvent {
  return {
    absoluteTimestamp: timestamp,
    type,
    team,
    player: "Player1",
    zone: "middle_third",
    details: details || {},
    confidence: 0.8,
    mergedFromWindows: ["window1"],
    adjustedConfidence: 0.8,
  };
}

describe("analyzeSetPieceOutcomes", () => {
  describe("Goal outcomes", () => {
    it("should detect goal from corner kick", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "corner",
      });
      const goal = createEvent("shot", 103, "home", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, goal];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("goal");
      expect(outcomes[0].timeToOutcome).toBe(3);
      expect(outcomes[0].scoringChance).toBe(true);
      expect(outcomes[0].outcomeEventId).toBe("shot_103");
    });

    it("should detect goal from free kick", () => {
      const setPiece = createEvent("setPiece", 200, "away", {
        setPieceType: "free_kick",
      });
      const goal = createEvent("shot", 208.5, "away", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, goal];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("goal");
      expect(outcomes[0].timeToOutcome).toBe(8.5);
      expect(outcomes[0].scoringChance).toBe(true);
    });

    it("should prioritize goal over shot", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "penalty",
      });
      const shot1 = createEvent("shot", 102, "home", {
        shotResult: "saved",
      });
      const goal = createEvent("shot", 104, "home", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, shot1, goal];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("goal");
      expect(outcomes[0].timeToOutcome).toBe(4);
    });
  });

  describe("Shot outcomes", () => {
    it("should detect shot on target as scoring chance", () => {
      const setPiece = createEvent("setPiece", 150, "home", {
        setPieceType: "corner",
      });
      const shot = createEvent("shot", 154, "home", {
        shotResult: "saved",
      });

      const allEvents = [setPiece, shot];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("shot");
      expect(outcomes[0].timeToOutcome).toBe(4);
      expect(outcomes[0].scoringChance).toBe(true);
    });

    it("should detect shot hitting post as scoring chance", () => {
      const setPiece = createEvent("setPiece", 150, "home", {
        setPieceType: "free_kick",
      });
      const shot = createEvent("shot", 152, "home", {
        shotResult: "post",
      });

      const allEvents = [setPiece, shot];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].scoringChance).toBe(true);
    });

    it("should detect missed shot as non-scoring chance", () => {
      const setPiece = createEvent("setPiece", 150, "home", {
        setPieceType: "corner",
      });
      const shot = createEvent("shot", 153, "home", {
        shotResult: "missed",
      });

      const allEvents = [setPiece, shot];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("shot");
      expect(outcomes[0].scoringChance).toBe(false);
    });

    it("should detect blocked shot as non-scoring chance", () => {
      const setPiece = createEvent("setPiece", 150, "away", {
        setPieceType: "free_kick",
      });
      const shot = createEvent("shot", 155.2, "away", {
        shotResult: "blocked",
      });

      const allEvents = [setPiece, shot];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].scoringChance).toBe(false);
    });
  });

  describe("Cleared outcomes", () => {
    it("should detect immediate opponent pass as cleared", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "corner",
      });
      const opponentPass = createEvent("pass", 102, "away");

      const allEvents = [setPiece, opponentPass];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("cleared");
      expect(outcomes[0].timeToOutcome).toBe(2);
      expect(outcomes[0].scoringChance).toBe(false);
      expect(outcomes[0].outcomeEventId).toBe("pass_102");
    });

    it("should only detect clearance within 5 seconds", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "free_kick",
      });
      const opponentPass = createEvent("pass", 106, "away");

      const allEvents = [setPiece, opponentPass];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      // Should not be detected as cleared (too late)
      expect(outcomes[0].resultType).not.toBe("cleared");
    });
  });

  describe("Turnover outcomes", () => {
    it("should detect interception as turnover", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "throw_in",
      });
      const turnover = createEvent("turnover", 102, "home", {
        context: "interception",
      });

      const allEvents = [setPiece, turnover];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("turnover");
      expect(outcomes[0].timeToOutcome).toBe(2);
      expect(outcomes[0].scoringChance).toBe(false);
    });

    it("should detect tackle as turnover", () => {
      const setPiece = createEvent("setPiece", 100, "away", {
        setPieceType: "goal_kick",
      });
      const turnover = createEvent("turnover", 105, "away", {
        context: "tackle",
      });

      const allEvents = [setPiece, turnover];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].resultType).toBe("turnover");
    });
  });

  describe("Continued play outcomes", () => {
    it("should detect same team maintaining possession", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "free_kick",
      });
      const pass = createEvent("pass", 103, "home");

      const allEvents = [setPiece, pass];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("continued_play");
      expect(outcomes[0].timeToOutcome).toBe(3);
      expect(outcomes[0].scoringChance).toBe(false);
    });
  });

  describe("Unknown outcomes", () => {
    it("should return unknown when no events follow", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "corner",
      });

      const allEvents = [setPiece];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].resultType).toBe("unknown");
      expect(outcomes[0].timeToOutcome).toBe(0);
      expect(outcomes[0].scoringChance).toBe(false);
    });

    it("should return unknown when all events are outside window", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "free_kick",
      });
      const shot = createEvent("shot", 120, "home", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, shot];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].resultType).toBe("unknown");
    });
  });

  describe("Priority order", () => {
    it("should prioritize goal over shot over turnover", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "corner",
      });
      const turnover = createEvent("turnover", 102, "home", {
        context: "bad_touch",
      });
      const shot = createEvent("shot", 104, "home", {
        shotResult: "saved",
      });
      const goal = createEvent("shot", 106, "home", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, turnover, shot, goal];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].resultType).toBe("goal");
      expect(outcomes[0].timeToOutcome).toBe(6);
    });

    it("should prioritize shot over turnover over cleared", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "free_kick",
      });
      const opponentPass = createEvent("pass", 102, "away");
      const turnover = createEvent("turnover", 104, "home");
      const shot = createEvent("shot", 106, "home", {
        shotResult: "missed",
      });

      const allEvents = [setPiece, opponentPass, turnover, shot];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].resultType).toBe("shot");
    });
  });

  describe("Custom outcome window", () => {
    it("should respect custom outcome window", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "corner",
      });
      const shot = createEvent("shot", 108, "home", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, shot];
      const setPieceEvents = [setPiece];

      // With 5-second window, shot should not be detected
      const outcomes5s = analyzeSetPieceOutcomes(setPieceEvents, allEvents, 5);
      expect(outcomes5s[0].resultType).toBe("unknown");

      // With 10-second window, shot should be detected
      const outcomes10s = analyzeSetPieceOutcomes(setPieceEvents, allEvents, 10);
      expect(outcomes10s[0].resultType).toBe("goal");
    });
  });

  describe("Multiple set pieces", () => {
    it("should analyze multiple set pieces independently", () => {
      const setPiece1 = createEvent("setPiece", 100, "home", {
        setPieceType: "corner",
      });
      const goal1 = createEvent("shot", 103, "home", {
        shotResult: "goal",
      });

      const setPiece2 = createEvent("setPiece", 200, "away", {
        setPieceType: "free_kick",
      });
      const shot2 = createEvent("shot", 204, "away", {
        shotResult: "saved",
      });

      const setPiece3 = createEvent("setPiece", 300, "home", {
        setPieceType: "throw_in",
      });
      const turnover3 = createEvent("turnover", 302, "home");

      const allEvents = [
        setPiece1,
        goal1,
        setPiece2,
        shot2,
        setPiece3,
        turnover3,
      ];
      const setPieceEvents = [setPiece1, setPiece2, setPiece3];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(3);

      // First set piece -> goal
      expect(outcomes[0].resultType).toBe("goal");
      expect(outcomes[0].scoringChance).toBe(true);

      // Second set piece -> shot
      expect(outcomes[1].resultType).toBe("shot");
      expect(outcomes[1].scoringChance).toBe(true);

      // Third set piece -> turnover
      expect(outcomes[2].resultType).toBe("turnover");
      expect(outcomes[2].scoringChance).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty set piece list", () => {
      const allEvents = [createEvent("pass", 100, "home")];
      const setPieceEvents: DeduplicatedEvent[] = [];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes).toHaveLength(0);
    });

    it("should handle set piece at end of match", () => {
      const setPiece = createEvent("setPiece", 5400, "home", {
        setPieceType: "corner",
      });

      const allEvents = [setPiece];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].resultType).toBe("unknown");
    });

    it("should handle very quick outcome (< 1 second)", () => {
      const setPiece = createEvent("setPiece", 100, "home", {
        setPieceType: "penalty",
      });
      const goal = createEvent("shot", 100.5, "home", {
        shotResult: "goal",
      });

      const allEvents = [setPiece, goal];
      const setPieceEvents = [setPiece];

      const outcomes = analyzeSetPieceOutcomes(setPieceEvents, allEvents);

      expect(outcomes[0].resultType).toBe("goal");
      expect(outcomes[0].timeToOutcome).toBe(0.5);
    });
  });
});
