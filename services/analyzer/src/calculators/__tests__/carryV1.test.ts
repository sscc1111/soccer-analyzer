/**
 * Tests for carryV1 calculator
 */

import { describe, it, expect } from "vitest";
import { calcCarryV1 } from "../carryV1";
import { metricKeys } from "@soccer/shared";
import type { CarryEventDoc, TrackPlayerMapping } from "@soccer/shared";
import type { CalculatorContext } from "../registry";

// Helper to create a minimal CalculatorContext
function createContext(
  carryEvents: CarryEventDoc[] = [],
  trackMappings: TrackPlayerMapping[] = []
): CalculatorContext {
  return {
    matchId: "test-match",
    version: "1.0.0",
    match: null,
    shots: [],
    clips: [],
    events: [],
    carryEvents,
    trackMappings,
  };
}

// Helper to create a CarryEventDoc
function createCarryEvent(
  overrides: Partial<CarryEventDoc> = {}
): CarryEventDoc {
  return {
    eventId: "carry-1",
    matchId: "test-match",
    type: "carry",
    trackId: "track-1",
    playerId: null,
    teamId: "home",
    startFrame: 100,
    endFrame: 120,
    startTime: 5.0,
    endTime: 6.0,
    startPosition: { x: 0.4, y: 0.5 },
    endPosition: { x: 0.6, y: 0.5 },
    carryIndex: 10.5,
    progressIndex: 8.2,
    confidence: 0.9,
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

describe("calcCarryV1", () => {
  describe("Empty input handling", () => {
    it("should return empty array when no carry events", async () => {
      const ctx = createContext([], []);
      const result = await calcCarryV1(ctx);
      expect(result).toEqual([]);
    });

    it("should return empty array when carryEvents is undefined", async () => {
      const ctx = createContext();
      ctx.carryEvents = undefined;
      const result = await calcCarryV1(ctx);
      expect(result).toEqual([]);
    });
  });

  describe("Single event processing", () => {
    it("should process a single carry event correctly", async () => {
      const carryEvent = createCarryEvent({
        trackId: "track-1",
        carryIndex: 10.5,
        progressIndex: 8.2,
        confidence: 0.85,
      });

      const ctx = createContext([carryEvent], []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        calculatorId: "carryV1",
        scope: "player",
        playerId: "track:track-1",
        metrics: {
          [metricKeys.playerCarryCount]: 1,
          [metricKeys.playerCarryIndex]: 10.5,
          [metricKeys.playerCarryProgressIndex]: 8.2,
        },
        confidence: {
          [metricKeys.playerCarryCount]: 0.85,
          [metricKeys.playerCarryIndex]: 0.85,
          [metricKeys.playerCarryProgressIndex]: 0.85,
        },
      });
    });

    it("should include distanceMeters when available", async () => {
      const carryEvent = createCarryEvent({
        trackId: "track-1",
        carryIndex: 10.5,
        progressIndex: 8.2,
        distanceMeters: 15.7,
        confidence: 0.85,
      });

      const ctx = createContext([carryEvent], []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerCarryCount]: 1,
        [metricKeys.playerCarryIndex]: 10.5,
        [metricKeys.playerCarryProgressIndex]: 8.2,
        [metricKeys.playerCarryMeters]: 15.7,
      });
      expect(result[0].confidence[metricKeys.playerCarryMeters]).toBe(0.85);
    });

    it("should not include distanceMeters when undefined", async () => {
      const carryEvent = createCarryEvent({
        trackId: "track-1",
        carryIndex: 10.5,
        progressIndex: 8.2,
        distanceMeters: undefined,
        confidence: 0.85,
      });

      const ctx = createContext([carryEvent], []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics[metricKeys.playerCarryMeters]).toBeUndefined();
      expect(result[0].confidence[metricKeys.playerCarryMeters]).toBeUndefined();
    });
  });

  describe("Multiple events for same player aggregation", () => {
    it("should aggregate multiple carry events for the same track", async () => {
      const carryEvents = [
        createCarryEvent({
          eventId: "carry-1",
          trackId: "track-1",
          carryIndex: 10.5,
          progressIndex: 8.2,
          confidence: 0.9,
        }),
        createCarryEvent({
          eventId: "carry-2",
          trackId: "track-1",
          carryIndex: 12.3,
          progressIndex: 9.1,
          confidence: 0.8,
        }),
        createCarryEvent({
          eventId: "carry-3",
          trackId: "track-1",
          carryIndex: 8.7,
          progressIndex: -2.5,
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics).toMatchObject({
        [metricKeys.playerCarryCount]: 3,
        [metricKeys.playerCarryIndex]: 31.5, // 10.5 + 12.3 + 8.7
        [metricKeys.playerCarryProgressIndex]: 14.8, // 8.2 + 9.1 + (-2.5)
      });
    });

    it("should aggregate distanceMeters when calibration is available", async () => {
      const carryEvents = [
        createCarryEvent({
          eventId: "carry-1",
          trackId: "track-1",
          carryIndex: 10.5,
          progressIndex: 8.2,
          distanceMeters: 15.5,
          confidence: 0.9,
        }),
        createCarryEvent({
          eventId: "carry-2",
          trackId: "track-1",
          carryIndex: 12.3,
          progressIndex: 9.1,
          distanceMeters: 18.2,
          confidence: 0.8,
        }),
        createCarryEvent({
          eventId: "carry-3",
          trackId: "track-1",
          carryIndex: 8.7,
          progressIndex: -2.5,
          distanceMeters: 10.3,
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics[metricKeys.playerCarryMeters]).toBe(44.0); // 15.5 + 18.2 + 10.3 = 44.0
    });

    it("should set hasCalibration flag when any event has distanceMeters", async () => {
      const carryEvents = [
        createCarryEvent({
          eventId: "carry-1",
          trackId: "track-1",
          carryIndex: 10.5,
          progressIndex: 8.2,
          distanceMeters: undefined,
          confidence: 0.9,
        }),
        createCarryEvent({
          eventId: "carry-2",
          trackId: "track-1",
          carryIndex: 12.3,
          progressIndex: 9.1,
          distanceMeters: 18.2,
          confidence: 0.8,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics[metricKeys.playerCarryMeters]).toBe(18.2);
    });

    it("should round carryIndex and progressIndex to 2 decimal places", async () => {
      const carryEvents = [
        createCarryEvent({
          trackId: "track-1",
          carryIndex: 10.555,
          progressIndex: 8.237,
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics[metricKeys.playerCarryIndex]).toBe(10.56);
      expect(result[0].metrics[metricKeys.playerCarryProgressIndex]).toBe(8.24);
    });

    it("should round distanceMeters to 1 decimal place", async () => {
      const carryEvents = [
        createCarryEvent({
          trackId: "track-1",
          carryIndex: 10.5,
          progressIndex: 8.2,
          distanceMeters: 15.789,
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].metrics[metricKeys.playerCarryMeters]).toBe(15.8);
    });
  });

  describe("Multiple players processed independently", () => {
    it("should track stats separately for different tracks", async () => {
      const carryEvents = [
        createCarryEvent({
          eventId: "carry-1",
          trackId: "track-1",
          carryIndex: 10.5,
          progressIndex: 8.2,
          confidence: 0.9,
        }),
        createCarryEvent({
          eventId: "carry-2",
          trackId: "track-1",
          carryIndex: 12.3,
          progressIndex: 9.1,
          confidence: 0.8,
        }),
        createCarryEvent({
          eventId: "carry-3",
          trackId: "track-2",
          carryIndex: 7.5,
          progressIndex: 5.3,
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(2);

      const track1Stats = result.find((r) => r.playerId === "track:track-1");
      const track2Stats = result.find((r) => r.playerId === "track:track-2");

      expect(track1Stats?.metrics).toMatchObject({
        [metricKeys.playerCarryCount]: 2,
        [metricKeys.playerCarryIndex]: 22.8, // 10.5 + 12.3
        [metricKeys.playerCarryProgressIndex]: 17.3, // 8.2 + 9.1
      });

      expect(track2Stats?.metrics).toMatchObject({
        [metricKeys.playerCarryCount]: 1,
        [metricKeys.playerCarryIndex]: 7.5,
        [metricKeys.playerCarryProgressIndex]: 5.3,
      });
    });
  });

  describe("Confidence averaging", () => {
    it("should calculate average confidence correctly", async () => {
      const carryEvents = [
        createCarryEvent({
          eventId: "carry-1",
          trackId: "track-1",
          confidence: 0.9,
        }),
        createCarryEvent({
          eventId: "carry-2",
          trackId: "track-1",
          confidence: 0.8,
        }),
        createCarryEvent({
          eventId: "carry-3",
          trackId: "track-1",
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      // Average confidence: (0.9 + 0.8 + 0.7) / 3 = 0.8
      expect(result[0].confidence[metricKeys.playerCarryCount]).toBeCloseTo(0.8, 10);
    });

    it("should apply same confidence to all metrics for a player", async () => {
      const carryEvents = [
        createCarryEvent({
          trackId: "track-1",
          distanceMeters: 15.5,
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(carryEvents, []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toMatchObject({
        [metricKeys.playerCarryCount]: 0.85,
        [metricKeys.playerCarryIndex]: 0.85,
        [metricKeys.playerCarryProgressIndex]: 0.85,
        [metricKeys.playerCarryMeters]: 0.85,
      });
    });
  });

  describe("Track-to-player mapping with fallback", () => {
    it("should use playerId when mapping exists", async () => {
      const carryEvent = createCarryEvent({
        trackId: "track-1",
      });

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext([carryEvent], mappings);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("player-10");
    });

    it("should fallback to track:trackId when no mapping exists", async () => {
      const carryEvent = createCarryEvent({
        trackId: "track-1",
      });

      const ctx = createContext([carryEvent], []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("track:track-1");
    });

    it("should fallback to track:trackId when playerId is null in mapping", async () => {
      const carryEvent = createCarryEvent({
        trackId: "track-1",
      });

      const mappings = [createMapping("track-1", null)];

      const ctx = createContext([carryEvent], mappings);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe("track:track-1");
    });

    it("should handle multiple players with and without mappings", async () => {
      const carryEvents = [
        createCarryEvent({
          eventId: "carry-1",
          trackId: "track-1",
        }),
        createCarryEvent({
          eventId: "carry-2",
          trackId: "track-2",
        }),
      ];

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext(carryEvents, mappings);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(2);

      const player10 = result.find((r) => r.playerId === "player-10");
      const track2 = result.find((r) => r.playerId === "track:track-2");

      expect(player10).toBeDefined();
      expect(track2).toBeDefined();
    });
  });

  describe("Explanations", () => {
    it("should include explanations for all metrics without calibration", async () => {
      const carryEvent = createCarryEvent({ distanceMeters: undefined });
      const ctx = createContext([carryEvent], []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].explanations).toBeDefined();
      expect(result[0].explanations![metricKeys.playerCarryCount]).toContain(
        "Number of times"
      );
      expect(result[0].explanations![metricKeys.playerCarryIndex]).toContain(
        "Cumulative movement"
      );
      expect(result[0].explanations![metricKeys.playerCarryProgressIndex]).toContain(
        "Net progress"
      );
      expect(result[0].explanations![metricKeys.playerCarryMeters]).toBeUndefined();
    });

    it("should include meters explanation when calibration available", async () => {
      const carryEvent = createCarryEvent({ distanceMeters: 15.5 });
      const ctx = createContext([carryEvent], []);
      const result = await calcCarryV1(ctx);

      expect(result).toHaveLength(1);
      expect(result[0].explanations![metricKeys.playerCarryMeters]).toContain(
        "Total distance carried in meters"
      );
    });
  });
});
