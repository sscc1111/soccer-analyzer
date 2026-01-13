/**
 * Tests for turnoversV1 calculator
 */

import { describe, it, expect } from "vitest";
import { calcTurnoversV1 } from "../turnoversV1";
import { metricKeys } from "@soccer/shared";
import type { TurnoverEventDoc, TrackPlayerMapping } from "@soccer/shared";
import type { CalculatorContext } from "../registry";

// Helper to create a minimal CalculatorContext
function createContext(
  turnoverEvents: TurnoverEventDoc[] = [],
  trackMappings: TrackPlayerMapping[] = []
): CalculatorContext {
  return {
    matchId: "test-match",
    version: "1.0.0",
    match: null,
    shots: [],
    clips: [],
    events: [],
    turnoverEvents,
    trackMappings,
  };
}

// Helper to create a TurnoverEventDoc
function createTurnoverEvent(
  overrides: Partial<TurnoverEventDoc> = {}
): TurnoverEventDoc {
  return {
    eventId: "turnover-1",
    matchId: "test-match",
    type: "turnover",
    turnoverType: "lost",
    frameNumber: 100,
    timestamp: 5.0,
    player: {
      trackId: "track-1",
      playerId: null,
      teamId: "home",
      position: { x: 0.5, y: 0.5 },
    },
    confidence: 0.9,
    needsReview: false,
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

describe("calcTurnoversV1", () => {
  describe("Empty input handling", () => {
    it("should return empty array when no turnover events", async () => {
      const ctx = createContext([], []);
      const result = await calcTurnoversV1(ctx);
      expect(result).toEqual([]);
    });

    it("should return empty array when turnoverEvents is undefined", async () => {
      const ctx = createContext();
      ctx.turnoverEvents = undefined;
      const result = await calcTurnoversV1(ctx);
      expect(result).toEqual([]);
    });
  });

  describe("Single event processing", () => {
    it("should process a single lost turnover correctly", async () => {
      const turnoverEvent = createTurnoverEvent({
        turnoverType: "lost",
        player: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
        },
        confidence: 0.85,
      });

      const ctx = createContext([turnoverEvent], []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        calculatorId: "turnoversV1",
        scope: "player",
        playerId: "track:track-1",
        metrics: {
          [metricKeys.playerTurnoversLost]: 1,
          [metricKeys.playerTurnoversWon]: 0,
        },
        confidence: {
          [metricKeys.playerTurnoversLost]: 0.85,
          [metricKeys.playerTurnoversWon]: 0.85,
        },
      });
    });

    it("should process a single won turnover correctly", async () => {
      const turnoverEvent = createTurnoverEvent({
        turnoverType: "won",
        player: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
        },
        confidence: 0.9,
      });

      const ctx = createContext([turnoverEvent], []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 0,
        [metricKeys.playerTurnoversWon]: 1,
      });
    });
  });

  describe("Multiple events for same player aggregation", () => {
    it("should aggregate multiple turnover events for the same track", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
        createTurnoverEvent({
          eventId: "turnover-3",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 2,
        [metricKeys.playerTurnoversWon]: 1,
      });
    });

    it("should track both lost and won turnovers separately", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
        createTurnoverEvent({
          eventId: "turnover-3",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.85,
        }),
        createTurnoverEvent({
          eventId: "turnover-4",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 1,
        [metricKeys.playerTurnoversWon]: 3,
      });
    });
  });

  describe("Multiple players processed independently", () => {
    it("should track stats separately for different tracks", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
        createTurnoverEvent({
          eventId: "turnover-3",
          turnoverType: "won",
          player: {
            trackId: "track-2",
            playerId: null,
            teamId: "away",
            position: { x: 0.3, y: 0.3 },
          },
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(2);

      const track1Stats = result.find((r) => r.playerId === "track:track-1");
      const track2Stats = result.find((r) => r.playerId === "track:track-2");

      expect(track1Stats?.metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 2,
        [metricKeys.playerTurnoversWon]: 0,
      });

      expect(track2Stats?.metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 0,
        [metricKeys.playerTurnoversWon]: 1,
      });
    });

    it("should handle multiple players with mixed turnovers", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
        createTurnoverEvent({
          eventId: "turnover-3",
          turnoverType: "lost",
          player: {
            trackId: "track-2",
            playerId: null,
            teamId: "away",
            position: { x: 0.3, y: 0.3 },
          },
          confidence: 0.85,
        }),
        createTurnoverEvent({
          eventId: "turnover-4",
          turnoverType: "won",
          player: {
            trackId: "track-2",
            playerId: null,
            teamId: "away",
            position: { x: 0.3, y: 0.3 },
          },
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(2);

      const track1Stats = result.find((r) => r.playerId === "track:track-1");
      const track2Stats = result.find((r) => r.playerId === "track:track-2");

      expect(track1Stats?.metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 1,
        [metricKeys.playerTurnoversWon]: 1,
      });

      expect(track2Stats?.metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 1,
        [metricKeys.playerTurnoversWon]: 1,
      });
    });
  });

  describe("Confidence averaging", () => {
    it("should calculate average confidence correctly", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
        createTurnoverEvent({
          eventId: "turnover-3",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      // Average confidence: (0.9 + 0.8 + 0.7) / 3 = 0.8
      expect(result[0].confidence[metricKeys.playerTurnoversLost]).toBeCloseTo(0.8, 10);
      expect(result[0].confidence[metricKeys.playerTurnoversWon]).toBeCloseTo(0.8, 10);
    });

    it("should apply same confidence to all metrics for a player", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toMatchObject({
        [metricKeys.playerTurnoversLost]: 0.85,
        [metricKeys.playerTurnoversWon]: 0.85,
      });
    });
  });

  describe("Track-to-player mapping with fallback", () => {
    it("should use playerId when mapping exists", async () => {
      const turnoverEvent = createTurnoverEvent({
        player: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
        },
      });

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext([turnoverEvent], mappings);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("player-10");
    });

    it("should fallback to track:trackId when no mapping exists", async () => {
      const turnoverEvent = createTurnoverEvent({
        player: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
        },
      });

      const ctx = createContext([turnoverEvent], []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("track:track-1");
    });

    it("should fallback to track:trackId when playerId is null in mapping", async () => {
      const turnoverEvent = createTurnoverEvent({
        player: {
          trackId: "track-1",
          playerId: null,
          teamId: "home",
          position: { x: 0.5, y: 0.5 },
        },
      });

      const mappings = [createMapping("track-1", null)];

      const ctx = createContext([turnoverEvent], mappings);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("track:track-1");
    });

    it("should handle multiple players with and without mappings", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          player: {
            trackId: "track-2",
            playerId: null,
            teamId: "away",
            position: { x: 0.3, y: 0.3 },
          },
        }),
      ];

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext(turnoverEvents, mappings);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(2);

      const player10 = result.find((r) => r.playerId === "player-10");
      const track2 = result.find((r) => r.playerId === "track:track-2");

      expect(player10).toBeDefined();
      expect(track2).toBeDefined();
    });
  });

  describe("Explanations", () => {
    it("should include explanations for all metrics", async () => {
      const turnoverEvent = createTurnoverEvent();
      const ctx = createContext([turnoverEvent], []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].explanations).toBeDefined();
      expect(result[0].explanations![metricKeys.playerTurnoversLost]).toContain(
        "lost possession"
      );
      expect(result[0].explanations![metricKeys.playerTurnoversWon]).toContain(
        "won the ball"
      );
    });
  });

  describe("Edge cases", () => {
    it("should handle player with only lost turnovers", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          turnoverType: "lost",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 2,
        [metricKeys.playerTurnoversWon]: 0,
      });
    });

    it("should handle player with only won turnovers", async () => {
      const turnoverEvents = [
        createTurnoverEvent({
          eventId: "turnover-1",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.9,
        }),
        createTurnoverEvent({
          eventId: "turnover-2",
          turnoverType: "won",
          player: {
            trackId: "track-1",
            playerId: null,
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          confidence: 0.8,
        }),
      ];

      const ctx = createContext(turnoverEvents, []);
      const result = await calcTurnoversV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerTurnoversLost]: 0,
        [metricKeys.playerTurnoversWon]: 2,
      });
    });
  });
});
