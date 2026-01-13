/**
 * Tests for possessionV1 calculator
 */

import { describe, it, expect } from "vitest";
import { calcPossessionV1 } from "../possessionV1";
import { metricKeys } from "@soccer/shared";
import type { PossessionSegment, TrackPlayerMapping, TeamId } from "@soccer/shared";
import type { CalculatorContext } from "../registry";

// Helper to create a minimal CalculatorContext
function createContext(
  possessionSegments: PossessionSegment[] = [],
  trackMappings: TrackPlayerMapping[] = []
): CalculatorContext {
  return {
    matchId: "test-match",
    version: "1.0.0",
    match: null,
    shots: [],
    clips: [],
    events: [],
    possessionSegments,
    trackMappings,
  };
}

// Helper to create a PossessionSegment
function createPossessionSegment(
  overrides: Partial<PossessionSegment> = {}
): PossessionSegment {
  return {
    trackId: "track-1",
    playerId: null,
    teamId: "home",
    startFrame: 100,
    endFrame: 120,
    startTime: 5.0,
    endTime: 6.0,
    confidence: 0.9,
    endReason: "pass",
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

describe("calcPossessionV1", () => {
  describe("Empty input handling", () => {
    it("should return empty array when no possession segments", async () => {
      const ctx = createContext([], []);
      const result = await calcPossessionV1(ctx);
      expect(result).toEqual([]);
    });

    it("should return empty array when possessionSegments is undefined", async () => {
      const ctx = createContext();
      ctx.possessionSegments = undefined;
      const result = await calcPossessionV1(ctx);
      expect(result).toEqual([]);
    });
  });

  describe("Single segment processing", () => {
    it("should process a single possession segment correctly", async () => {
      const segment = createPossessionSegment({
        trackId: "track-1",
        teamId: "home",
        startTime: 5.0,
        endTime: 6.5, // 1.5 seconds
        confidence: 0.85,
      });

      const ctx = createContext([segment], []);
      const result = await calcPossessionV1(ctx);

      // Should have 1 player stat and 1 team stat
      expect(result.length).toBeGreaterThanOrEqual(1);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat).toMatchObject({
        calculatorId: "possessionV1",
        scope: "player",
        playerId: "track:track-1",
        metrics: {
          [metricKeys.playerPossessionTimeSec]: 1.5,
          [metricKeys.playerPossessionCount]: 1,
        },
        confidence: {
          [metricKeys.playerPossessionTimeSec]: 0.85,
          [metricKeys.playerPossessionCount]: 0.85,
        },
      });
    });

    it("should calculate duration correctly", async () => {
      const segment = createPossessionSegment({
        trackId: "track-1",
        teamId: "home",
        startTime: 10.0,
        endTime: 13.7, // 3.7 seconds
        confidence: 0.9,
      });

      const ctx = createContext([segment], []);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat?.metrics[metricKeys.playerPossessionTimeSec]).toBe(3.7);
    });

    it("should round time to 1 decimal place", async () => {
      const segment = createPossessionSegment({
        trackId: "track-1",
        teamId: "home",
        startTime: 5.0,
        endTime: 6.789, // 1.789 seconds
        confidence: 0.9,
      });

      const ctx = createContext([segment], []);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat?.metrics[metricKeys.playerPossessionTimeSec]).toBe(1.8);
    });
  });

  describe("Multiple segments for same player aggregation", () => {
    it("should aggregate multiple possession segments for the same track", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 5.0,
          endTime: 6.5, // 1.5s
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 10.0,
          endTime: 12.3, // 2.3s
          confidence: 0.8,
        }),
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 15.0,
          endTime: 16.2, // 1.2s
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player" && r.playerId === "track:track-1");
      expect(playerStat?.metrics).toMatchObject({
        [metricKeys.playerPossessionTimeSec]: 5.0, // 1.5 + 2.3 + 1.2 = 5.0
        [metricKeys.playerPossessionCount]: 3,
      });
    });
  });

  describe("Multiple players processed independently", () => {
    it("should track stats separately for different tracks", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 5.0,
          endTime: 6.5, // 1.5s
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 10.0,
          endTime: 11.0, // 1.0s
          confidence: 0.8,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "away",
          startTime: 20.0,
          endTime: 23.5, // 3.5s
          confidence: 0.85,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const track1Stat = result.find((r) => r.scope === "player" && r.playerId === "track:track-1");
      const track2Stat = result.find((r) => r.scope === "player" && r.playerId === "track:track-2");

      expect(track1Stat?.metrics).toMatchObject({
        [metricKeys.playerPossessionTimeSec]: 2.5, // 1.5 + 1.0
        [metricKeys.playerPossessionCount]: 2,
      });

      expect(track2Stat?.metrics).toMatchObject({
        [metricKeys.playerPossessionTimeSec]: 3.5,
        [metricKeys.playerPossessionCount]: 1,
      });
    });
  });

  describe("Team possession percentages", () => {
    it("should calculate team possession percentages correctly", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 6.0, // 6s home
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "away",
          startTime: 6.0,
          endTime: 10.0, // 4s away
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      expect(matchStat).toBeDefined();
      expect(matchStat?.metrics[metricKeys.teamPossessionPercent]).toEqual({
        home: 60, // 6/(6+4) = 0.6 = 60%
        away: 40, // 4/(6+4) = 0.4 = 40%
      });
    });

    it("should handle uneven team possession", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 1.0, // 1s home
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "away",
          startTime: 1.0,
          endTime: 10.0, // 9s away
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      expect(matchStat?.metrics[metricKeys.teamPossessionPercent]).toEqual({
        home: 10, // 1/(1+9) = 0.1 = 10%
        away: 90, // 9/(1+9) = 0.9 = 90%
      });
    });

    it("should handle only one team having possession", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 5.0,
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "home",
          startTime: 5.0,
          endTime: 10.0,
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      expect(matchStat?.metrics[metricKeys.teamPossessionPercent]).toEqual({
        home: 100,
        away: 0,
      });
    });

    it("should exclude unknown team from percentage calculation", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 5.0, // 5s home
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "away",
          startTime: 5.0,
          endTime: 10.0, // 5s away
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-3",
          teamId: "unknown",
          startTime: 10.0,
          endTime: 15.0, // 5s unknown (should be excluded)
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      // Total possession time for percentage = 5 + 5 = 10 (unknown excluded)
      expect(matchStat?.metrics[metricKeys.teamPossessionPercent]).toEqual({
        home: 50, // 5/10 = 50%
        away: 50, // 5/10 = 50%
      });

      // But unknown player should still have individual stats
      const unknownPlayerStat = result.find(
        (r) => r.scope === "player" && r.playerId === "track:track-3"
      );
      expect(unknownPlayerStat?.metrics[metricKeys.playerPossessionTimeSec]).toBe(5.0);
    });

    it("should not create match stat when no team possession data", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "unknown",
          startTime: 0.0,
          endTime: 5.0,
          confidence: 0.9,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      expect(matchStat).toBeUndefined();
    });
  });

  describe("Confidence averaging", () => {
    it("should calculate average confidence correctly for player stats", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 1.0,
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 1.0,
          endTime: 2.0,
          confidence: 0.8,
        }),
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 2.0,
          endTime: 3.0,
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      // Average confidence: (0.9 + 0.8 + 0.7) / 3 = 0.8
      expect(playerStat?.confidence[metricKeys.playerPossessionTimeSec]).toBeCloseTo(0.8, 10);
      expect(playerStat?.confidence[metricKeys.playerPossessionCount]).toBeCloseTo(0.8, 10);
    });

    it("should calculate average confidence for match stats from all segments", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 5.0,
          confidence: 0.9,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "away",
          startTime: 5.0,
          endTime: 10.0,
          confidence: 0.7,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      // Average confidence: (0.9 + 0.7) / 2 = 0.8
      expect(matchStat?.confidence[metricKeys.teamPossessionPercent]).toBe(0.8);
    });
  });

  describe("Track-to-player mapping with fallback", () => {
    it("should use playerId when mapping exists", async () => {
      const segment = createPossessionSegment({
        trackId: "track-1",
        teamId: "home",
        startTime: 0.0,
        endTime: 1.0,
      });

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext([segment], mappings);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat?.playerId).toBe("player-10");
    });

    it("should fallback to track:trackId when no mapping exists", async () => {
      const segment = createPossessionSegment({
        trackId: "track-1",
        teamId: "home",
        startTime: 0.0,
        endTime: 1.0,
      });

      const ctx = createContext([segment], []);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat?.playerId).toBe("track:track-1");
    });

    it("should fallback to track:trackId when playerId is null in mapping", async () => {
      const segment = createPossessionSegment({
        trackId: "track-1",
        teamId: "home",
        startTime: 0.0,
        endTime: 1.0,
      });

      const mappings = [createMapping("track-1", null)];

      const ctx = createContext([segment], mappings);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat?.playerId).toBe("track:track-1");
    });

    it("should handle multiple players with and without mappings", async () => {
      const segments = [
        createPossessionSegment({
          trackId: "track-1",
          teamId: "home",
          startTime: 0.0,
          endTime: 1.0,
        }),
        createPossessionSegment({
          trackId: "track-2",
          teamId: "away",
          startTime: 1.0,
          endTime: 2.0,
        }),
      ];

      const mappings = [createMapping("track-1", "player-10")];

      const ctx = createContext(segments, mappings);
      const result = await calcPossessionV1(ctx);

      const player10 = result.find((r) => r.scope === "player" && r.playerId === "player-10");
      const track2 = result.find((r) => r.scope === "player" && r.playerId === "track:track-2");

      expect(player10).toBeDefined();
      expect(track2).toBeDefined();
    });
  });

  describe("Explanations", () => {
    it("should include explanations for player metrics", async () => {
      const segment = createPossessionSegment();
      const ctx = createContext([segment], []);
      const result = await calcPossessionV1(ctx);

      const playerStat = result.find((r) => r.scope === "player");
      expect(playerStat?.explanations).toBeDefined();
      expect(
        playerStat?.explanations![metricKeys.playerPossessionTimeSec]
      ).toContain("Total time");
      expect(
        playerStat?.explanations![metricKeys.playerPossessionCount]
      ).toContain("Number of times");
    });

    it("should include explanations for team metrics", async () => {
      const segments = [
        createPossessionSegment({
          teamId: "home",
          startTime: 0.0,
          endTime: 5.0,
        }),
        createPossessionSegment({
          teamId: "away",
          startTime: 5.0,
          endTime: 10.0,
        }),
      ];

      const ctx = createContext(segments, []);
      const result = await calcPossessionV1(ctx);

      const matchStat = result.find((r) => r.scope === "match");
      expect(matchStat?.explanations).toBeDefined();
      expect(
        matchStat?.explanations![metricKeys.teamPossessionPercent]
      ).toContain("Team possession percentage");
    });
  });
});
