/**
 * Tests for passesV1 calculator
 */

import { describe, it, expect } from "vitest";
import { calcPassesV1 } from "../passesV1";
import { metricKeys } from "@soccer/shared";
import type {
  PassEventDoc,
  TrackPlayerMapping,
} from "@soccer/shared";
import type { CalculatorContext } from "../registry";

// Helper to create a minimal CalculatorContext
function createContext(
  passEvents: PassEventDoc[] = [],
  trackMappings: TrackPlayerMapping[] = []
): CalculatorContext {
  return {
    matchId: "test-match",
    version: "1.0.0",
    match: null,
    shots: [],
    clips: [],
    events: [],
    passEvents,
    trackMappings,
  };
}

// Helper to create a PassEventDoc
function createPassEvent(
  overrides: Partial<PassEventDoc> = {}
): PassEventDoc {
  return {
    eventId: "pass-1",
    matchId: "test-match",
    type: "pass",
    frameNumber: 100,
    timestamp: 5.0,
    kicker: {
      trackId: "track-1",
      playerId: null,
      teamId: "home",
      position: { x: 0.5, y: 0.5 },
      confidence: 0.9,
    },
    receiver: {
      trackId: "track-2",
      playerId: null,
      teamId: "home",
      position: { x: 0.6, y: 0.6 },
      confidence: 0.85,
    },
    outcome: "complete",
    outcomeConfidence: 0.95,
    confidence: 0.9,
    needsReview: false,
    source: "auto",
    version: "1.0.0",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Helper to create a TrackPlayerMapping
function createMapping(
  trackId: string,
  playerId: string | null = null
): TrackPlayerMapping {
  return {
    trackId,
    playerId,
    jerseyNumber: playerId ? parseInt(playerId.replace("player-", "")) : null,
    ocrConfidence: 0.9,
    source: "ocr",
    needsReview: false,
  };
}

describe("calcPassesV1", () => {
  describe("Empty input handling", () => {
    it("should return empty array when no pass events", async () => {
      const ctx = createContext([], []);
      const result = await calcPassesV1(ctx);
      expect(result).toEqual([]);
    });

    it("should return empty array when passEvents is undefined", async () => {
      const ctx = createContext();
      ctx.passEvents = undefined;
      const result = await calcPassesV1(ctx);
      expect(result).toEqual([]);
    });
  });

  describe("Single event processing", () => {
    it("should process a single complete pass correctly", async () => {
      const passEvent = createPassEvent({
        kicker: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        },
        outcome: "complete",
        confidence: 0.85,
      });

      const ctx = createContext([passEvent], []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        calculatorId: "passesV1",
        scope: "player",
        playerId: "track:track-1",
        metrics: {
          [metricKeys.playerPassesAttempted]: 1,
          [metricKeys.playerPassesCompleted]: 1,
          [metricKeys.playerPassesIncomplete]: 0,
          [metricKeys.playerPassesIntercepted]: 0,
          [metricKeys.playerPassesSuccessRate]: 100,
        },
        confidence: {
          [metricKeys.playerPassesAttempted]: 0.85,
          [metricKeys.playerPassesCompleted]: 0.85,
          [metricKeys.playerPassesIncomplete]: 0.85,
          [metricKeys.playerPassesIntercepted]: 0.85,
          [metricKeys.playerPassesSuccessRate]: 0.85,
        },
      });
    });

    it("should process a single incomplete pass correctly", async () => {
      const passEvent = createPassEvent({
        kicker: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        },
        outcome: "incomplete",
        confidence: 0.8,
      });

      const ctx = createContext([passEvent], []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerPassesAttempted]: 1,
        [metricKeys.playerPassesCompleted]: 0,
        [metricKeys.playerPassesIncomplete]: 1,
        [metricKeys.playerPassesIntercepted]: 0,
        [metricKeys.playerPassesSuccessRate]: 0,
      });
    });

    it("should process a single intercepted pass correctly", async () => {
      const passEvent = createPassEvent({
        kicker: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        },
        outcome: "intercepted",
        confidence: 0.75,
      });

      const ctx = createContext([passEvent], []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerPassesAttempted]: 1,
        [metricKeys.playerPassesCompleted]: 0,
        [metricKeys.playerPassesIncomplete]: 0,
        [metricKeys.playerPassesIntercepted]: 1,
        [metricKeys.playerPassesSuccessRate]: 0,
      });
    });
  });

  describe("Multiple events for same player aggregation", () => {
    it("should aggregate multiple passes for the same track", async () => {
      const passEvents = [
        createPassEvent({
          eventId: "pass-1",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          confidence: 0.9,
        }),
        createPassEvent({
          eventId: "pass-2",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          confidence: 0.8,
        }),
        createPassEvent({
          eventId: "pass-3",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "incomplete",
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(passEvents, []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerPassesAttempted]: 3,
        [metricKeys.playerPassesCompleted]: 2,
        [metricKeys.playerPassesIncomplete]: 1,
        [metricKeys.playerPassesIntercepted]: 0,
        [metricKeys.playerPassesSuccessRate]: 67, // 2/3 = 66.67, rounded to 67
      });
    });

    it("should calculate success rate correctly", async () => {
      const passEvents = [
        createPassEvent({
          eventId: "pass-1",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          confidence: 0.9,
        }),
        createPassEvent({
          eventId: "pass-2",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "incomplete",
          confidence: 0.8,
        }),
        createPassEvent({
          eventId: "pass-3",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "incomplete",
          confidence: 0.7,
        }),
        createPassEvent({
          eventId: "pass-4",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "intercepted",
          confidence: 0.6,
        }),
      ];

      const ctx = createContext(passEvents, []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerPassesAttempted]: 4,
        [metricKeys.playerPassesCompleted]: 1,
        [metricKeys.playerPassesIncomplete]: 2,
        [metricKeys.playerPassesIntercepted]: 1,
        [metricKeys.playerPassesSuccessRate]: 25, // 1/4 = 0.25 = 25%
      });
    });
  });

  describe("Multiple players processed independently", () => {
    it("should track stats separately for different tracks", async () => {
      const passEvents = [
        createPassEvent({
          eventId: "pass-1",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          confidence: 0.9,
        }),
        createPassEvent({
          eventId: "pass-2",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          confidence: 0.8,
        }),
        createPassEvent({
          eventId: "pass-3",
          kicker: {
            trackId: "track-2",
            playerId: null,
            teamId: "away",
            position: { x: 0.3, y: 0.3 },
            confidence: 0.85,
          },
          outcome: "incomplete",
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(passEvents, []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(2);

      const track1Stats = result.find((r) => r.playerId === "track:track-1");
      const track2Stats = result.find((r) => r.playerId === "track:track-2");

      expect(track1Stats?.metrics).toMatchObject({
        [metricKeys.playerPassesAttempted]: 2,
        [metricKeys.playerPassesCompleted]: 2,
        [metricKeys.playerPassesSuccessRate]: 100,
      });

      expect(track2Stats?.metrics).toMatchObject({
        [metricKeys.playerPassesAttempted]: 1,
        [metricKeys.playerPassesCompleted]: 0,
        [metricKeys.playerPassesIncomplete]: 1,
        [metricKeys.playerPassesSuccessRate]: 0,
      });
    });
  });

  describe("Confidence averaging", () => {
    it("should calculate average confidence correctly", async () => {
      const passEvents = [
        createPassEvent({
          eventId: "pass-1",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          confidence: 0.9,
        }),
        createPassEvent({
          eventId: "pass-2",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          confidence: 0.8,
        }),
        createPassEvent({
          eventId: "pass-3",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(passEvents, []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      // Average confidence: (0.9 + 0.8 + 0.7) / 3 = 0.8
      expect(result[0].confidence[metricKeys.playerPassesAttempted]).toBeCloseTo(0.8, 10);
    });

    it("should apply same confidence to all metrics for a player", async () => {
      const passEvents = [
        createPassEvent({
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(passEvents, []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toMatchObject({
        [metricKeys.playerPassesAttempted]: 0.85,
        [metricKeys.playerPassesCompleted]: 0.85,
        [metricKeys.playerPassesIncomplete]: 0.85,
        [metricKeys.playerPassesIntercepted]: 0.85,
        [metricKeys.playerPassesSuccessRate]: 0.85,
      });
    });
  });

  describe("Track-to-player mapping with fallback", () => {
    it("should use playerId when mapping exists", async () => {
      const passEvent = createPassEvent({
        kicker: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        },
      });

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext([passEvent], mappings);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("player-10");
    });

    it("should fallback to track:trackId when no mapping exists", async () => {
      const passEvent = createPassEvent({
        kicker: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        },
      });

      const ctx = createContext([passEvent], []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("track:track-1");
    });

    it("should fallback to track:trackId when playerId is null in mapping", async () => {
      const passEvent = createPassEvent({
        kicker: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        },
      });

      const mappings = [createMapping("track-1", null)];

      const ctx = createContext([passEvent], mappings);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("track:track-1");
    });

    it("should handle multiple players with and without mappings", async () => {
      const passEvents = [
        createPassEvent({
          eventId: "pass-1",
          kicker: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
        }),
        createPassEvent({
          eventId: "pass-2",
          kicker: {
            trackId: "track-2",
            playerId: null,
            teamId: "away",
            position: { x: 0.3, y: 0.3 },
            confidence: 0.85,
          },
        }),
      ];

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext(passEvents, mappings);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(2);

      const player10 = result.find((r) => r.playerId === "player-10");
      const track2 = result.find((r) => r.playerId === "track:track-2");

      expect(player10).toBeDefined();
      expect(track2).toBeDefined();
    });
  });

  describe("Explanations", () => {
    it("should include explanations for all metrics", async () => {
      const passEvent = createPassEvent();
      const ctx = createContext([passEvent], []);
      const result = await calcPassesV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].explanations).toBeDefined();
      expect(result[0].explanations![metricKeys.playerPassesAttempted]).toContain(
        "Total passes attempted"
      );
      expect(result[0].explanations![metricKeys.playerPassesCompleted]).toContain(
        "successfully received"
      );
      expect(result[0].explanations![metricKeys.playerPassesIncomplete]).toContain(
        "not received"
      );
      expect(result[0].explanations![metricKeys.playerPassesIntercepted]).toContain(
        "intercepted"
      );
      expect(result[0].explanations![metricKeys.playerPassesSuccessRate]).toContain(
        "Percentage"
      );
    });
  });
});
