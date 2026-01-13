/**
 * Tests for testHelpers module
 */

import { describe, it, expect } from "vitest";
import {
  createPoint2D,
  createBoundingBox,
  createTrackFrame,
  createTrackDoc,
  createBallDetection,
  createBallTrackDoc,
  createTrackPlayerMapping,
  createTrackTeamMeta,
  createPossessionSegment,
  createPassEvent,
  createIncompletePass,
  createInterceptedPass,
  createCarryEvent,
  createTurnoverEvent,
  createTrackData,
  createBallData,
  createMatchScenario,
  DEFAULT_MATCH_ID,
  DEFAULT_VERSION,
  DEFAULT_FPS,
  DEFAULT_CONFIDENCE,
} from "../testHelpers";

// ============================================================================
// Core Type Builders Tests
// ============================================================================

describe("createPoint2D", () => {
  it("should create default point at center", () => {
    const point = createPoint2D();
    expect(point).toEqual({ x: 0.5, y: 0.5 });
  });

  it("should create point with custom coordinates", () => {
    const point = createPoint2D(0.2, 0.8);
    expect(point).toEqual({ x: 0.2, y: 0.8 });
  });
});

describe("createBoundingBox", () => {
  it("should create bbox centered at point", () => {
    const bbox = createBoundingBox(0.5, 0.5, 0.1, 0.2);
    expect(bbox.x).toBeCloseTo(0.45);
    expect(bbox.y).toBeCloseTo(0.4);
    expect(bbox.w).toBe(0.1);
    expect(bbox.h).toBe(0.2);
  });
});

describe("createTrackFrame", () => {
  it("should create frame with correct timestamp", () => {
    const frame = createTrackFrame("track-1", 30);
    expect(frame.trackId).toBe("track-1");
    expect(frame.frameNumber).toBe(30);
    expect(frame.timestamp).toBe(1); // 30 frames / 30 fps = 1 second
  });

  it("should use custom FPS", () => {
    const frame = createTrackFrame("track-1", 60, { x: 0.5, y: 0.5 }, 0.9, 60);
    expect(frame.timestamp).toBe(1); // 60 frames / 60 fps = 1 second
  });
});

// ============================================================================
// Document Builders Tests
// ============================================================================

describe("createTrackDoc", () => {
  it("should create track with required trackId", () => {
    const track = createTrackDoc({ trackId: "player-1" });
    expect(track.trackId).toBe("player-1");
    expect(track.matchId).toBe(DEFAULT_MATCH_ID);
    expect(track.frames.length).toBeGreaterThan(0);
  });

  it("should calculate frame range correctly", () => {
    const frames = [
      createTrackFrame("test", 10),
      createTrackFrame("test", 20),
      createTrackFrame("test", 30),
    ];
    const track = createTrackDoc({ trackId: "test", frames });
    expect(track.startFrame).toBe(10);
    expect(track.endFrame).toBe(30);
  });

  it("should allow overriding properties", () => {
    const track = createTrackDoc({
      trackId: "custom",
      matchId: "custom-match",
      entityType: "goalkeeper",
    });
    expect(track.matchId).toBe("custom-match");
    expect(track.entityType).toBe("goalkeeper");
  });
});

describe("createBallDetection", () => {
  it("should create visible ball detection by default", () => {
    const detection = createBallDetection(100);
    expect(detection.frameNumber).toBe(100);
    expect(detection.visible).toBe(true);
    expect(detection.confidence).toBe(DEFAULT_CONFIDENCE);
  });

  it("should support invisible ball", () => {
    const detection = createBallDetection(100, { x: 0.5, y: 0.5 }, { visible: false });
    expect(detection.visible).toBe(false);
  });
});

describe("createBallTrackDoc", () => {
  it("should create ball track with defaults", () => {
    const ballTrack = createBallTrackDoc();
    expect(ballTrack.matchId).toBe(DEFAULT_MATCH_ID);
    expect(ballTrack.detections.length).toBeGreaterThan(0);
    expect(ballTrack.visibilityRate).toBeGreaterThan(0);
  });

  it("should calculate visibility rate correctly", () => {
    const detections = [
      createBallDetection(0, { x: 0.5, y: 0.5 }, { visible: true }),
      createBallDetection(1, { x: 0.5, y: 0.5 }, { visible: false }),
      createBallDetection(2, { x: 0.5, y: 0.5 }, { visible: true }),
      createBallDetection(3, { x: 0.5, y: 0.5 }, { visible: true }),
    ];
    const ballTrack = createBallTrackDoc({ detections });
    expect(ballTrack.visibilityRate).toBe(0.75);
  });
});

describe("createTrackPlayerMapping", () => {
  it("should create mapping with playerId", () => {
    const mapping = createTrackPlayerMapping("track-1", "player-10");
    expect(mapping.trackId).toBe("track-1");
    expect(mapping.playerId).toBe("player-10");
    expect(mapping.jerseyNumber).toBe(10);
  });

  it("should handle null playerId", () => {
    const mapping = createTrackPlayerMapping("track-1", null);
    expect(mapping.playerId).toBeNull();
    expect(mapping.jerseyNumber).toBeNull();
  });
});

describe("createTrackTeamMeta", () => {
  it("should create home team meta", () => {
    const meta = createTrackTeamMeta("track-1", "home");
    expect(meta.teamId).toBe("home");
    expect(meta.dominantColor).toBe("#FF0000");
  });

  it("should create away team meta", () => {
    const meta = createTrackTeamMeta("track-2", "away");
    expect(meta.teamId).toBe("away");
    expect(meta.dominantColor).toBe("#0000FF");
  });
});

// ============================================================================
// Event Builders Tests
// ============================================================================

describe("createPassEvent", () => {
  it("should create complete pass by default", () => {
    const pass = createPassEvent();
    expect(pass.type).toBe("pass");
    expect(pass.outcome).toBe("complete");
    expect(pass.receiver).not.toBeNull();
  });

  it("should allow custom kicker", () => {
    const pass = createPassEvent({
      kicker: {
        trackId: "custom-track",
        playerId: "player-7",
        teamId: "away",
        position: { x: 0.3, y: 0.7 },
        confidence: 0.95,
      },
    });
    expect(pass.kicker.trackId).toBe("custom-track");
    expect(pass.kicker.teamId).toBe("away");
  });
});

describe("createIncompletePass", () => {
  it("should create incomplete pass with null receiver", () => {
    const pass = createIncompletePass();
    expect(pass.outcome).toBe("incomplete");
    expect(pass.receiver).toBeNull();
  });
});

describe("createInterceptedPass", () => {
  it("should create intercepted pass with opposing team receiver", () => {
    const pass = createInterceptedPass();
    expect(pass.outcome).toBe("intercepted");
    expect(pass.receiver?.teamId).toBe("away");
  });
});

describe("createCarryEvent", () => {
  it("should create carry with calculated indices", () => {
    const carry = createCarryEvent({
      startPosition: { x: 0.3, y: 0.5 },
      endPosition: { x: 0.7, y: 0.5 },
    });
    expect(carry.type).toBe("carry");
    expect(carry.carryIndex).toBeCloseTo(0.4);
    expect(carry.progressIndex).toBeCloseTo(0.4);
  });
});

describe("createTurnoverEvent", () => {
  it("should create lost turnover by default", () => {
    const turnover = createTurnoverEvent();
    expect(turnover.type).toBe("turnover");
    expect(turnover.turnoverType).toBe("lost");
    expect(turnover.otherPlayer).toBeDefined();
  });

  it("should allow won turnover", () => {
    const turnover = createTurnoverEvent({ turnoverType: "won" });
    expect(turnover.turnoverType).toBe("won");
  });
});

// ============================================================================
// Detection Data Builders Tests
// ============================================================================

describe("createTrackData", () => {
  it("should create track data with Map-based frames", () => {
    const frames = [
      createTrackFrame("track-1", 0),
      createTrackFrame("track-1", 1),
    ];
    const trackData = createTrackData("track-1", frames, "home", "player-1");

    expect(trackData.trackId).toBe("track-1");
    expect(trackData.teamId).toBe("home");
    expect(trackData.playerId).toBe("player-1");
    expect(trackData.frames.size).toBe(2);
    expect(trackData.frames.get(0)).toBeDefined();
    expect(trackData.frames.get(1)).toBeDefined();
  });
});

describe("createBallData", () => {
  it("should create ball data with Map-based frames", () => {
    const detections = [
      createBallDetection(0),
      createBallDetection(1),
    ];
    const ballData = createBallData(detections);

    expect(ballData.frames.size).toBe(2);
    expect(ballData.frames.get(0)).toBeDefined();
    expect(ballData.frames.get(1)).toBeDefined();
  });
});

// ============================================================================
// Scenario Generator Tests
// ============================================================================

describe("createMatchScenario", () => {
  it("should create complete match scenario with defaults", () => {
    const scenario = createMatchScenario();

    expect(scenario.matchId).toBe(DEFAULT_MATCH_ID);
    expect(scenario.tracks.length).toBe(10); // 5 per team * 2 teams
    expect(scenario.teamMetas.length).toBe(10);
    expect(scenario.mappings.length).toBe(10);
    expect(scenario.ballTrack.detections.length).toBeGreaterThan(0);
    expect(scenario.passEvents.length).toBe(10);
    expect(scenario.carryEvents.length).toBe(5);
    expect(scenario.turnoverEvents.length).toBe(2);
    expect(scenario.possessionSegments.length).toBeGreaterThan(0);
  });

  it("should respect custom options", () => {
    const scenario = createMatchScenario({
      playersPerTeam: 3,
      frameCount: 100,
      passCount: 5,
      carryCount: 2,
      turnoverCount: 1,
    });

    expect(scenario.tracks.length).toBe(6);
    expect(scenario.passEvents.length).toBeLessThanOrEqual(5);
    expect(scenario.carryEvents.length).toBeLessThanOrEqual(2);
    expect(scenario.turnoverEvents.length).toBeLessThanOrEqual(1);
  });

  it("should produce deterministic results with same seed", () => {
    const scenario1 = createMatchScenario({ seed: 42 });
    const scenario2 = createMatchScenario({ seed: 42 });

    expect(scenario1.passEvents.length).toBe(scenario2.passEvents.length);
    expect(scenario1.tracks[0].frames[0].center.x).toBe(
      scenario2.tracks[0].frames[0].center.x
    );
  });

  it("should produce different results with different seeds", () => {
    const scenario1 = createMatchScenario({ seed: 42 });
    const scenario2 = createMatchScenario({ seed: 123 });

    // The exact values will differ
    expect(scenario1.tracks[0].frames[0].center.x).not.toBe(
      scenario2.tracks[0].frames[0].center.x
    );
  });

  it("should create proper team distribution", () => {
    const scenario = createMatchScenario({ playersPerTeam: 4 });

    const homePlayers = scenario.teamMetas.filter((m) => m.teamId === "home");
    const awayPlayers = scenario.teamMetas.filter((m) => m.teamId === "away");

    expect(homePlayers.length).toBe(4);
    expect(awayPlayers.length).toBe(4);
  });

  it("should create ball track with same frame count", () => {
    const frameCount = 150;
    const scenario = createMatchScenario({ frameCount });

    expect(scenario.ballTrack.detections.length).toBe(frameCount);
  });
});
