/**
 * Tests for event detection module
 */

import { describe, it, expect } from "vitest";
import {
  distance,
  calculateProgress,
  findClosestPlayer,
  detectFramePossessions,
  buildPossessionSegments,
  detectPassEvents,
  detectCarryEvents,
  detectTurnoverEvents,
  detectAllEvents,
  extractPendingReviews,
  DEFAULT_EVENT_CONFIG,
  type TrackData,
  type BallData,
  type FramePossession,
  type DetectedEvents,
} from "../events";
import type { Point2D, TrackFrame, BallDetection, TeamId } from "@soccer/shared";

// ============================================================================
// Test Helpers
// ============================================================================

function createTrackFrame(
  trackId: string,
  frameNumber: number,
  center: Point2D,
  confidence: number = 0.9
): TrackFrame {
  return {
    trackId,
    frameNumber,
    timestamp: frameNumber / 30,
    bbox: { x: center.x - 0.02, y: center.y - 0.04, w: 0.04, h: 0.08 },
    center,
    confidence,
  };
}

function createBallDetection(
  frameNumber: number,
  position: Point2D,
  visible: boolean = true,
  confidence: number = 0.9
): BallDetection {
  return {
    frameNumber,
    timestamp: frameNumber / 30,
    position,
    confidence,
    visible,
  };
}

function createTrackData(
  trackId: string,
  frames: TrackFrame[],
  teamId: TeamId,
  playerId: string | null = null
): TrackData {
  return {
    trackId,
    frames: new Map(frames.map((f) => [f.frameNumber, f])),
    teamId,
    playerId,
  };
}

function createBallData(detections: BallDetection[]): BallData {
  return {
    frames: new Map(detections.map((d) => [d.frameNumber, d])),
  };
}

// ============================================================================
// Utility Function Tests
// ============================================================================

describe("distance", () => {
  it("should calculate correct Euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
  });
});

describe("calculateProgress", () => {
  it("should calculate positive progress for LTR when moving right", () => {
    const progress = calculateProgress({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, "LTR");
    expect(progress).toBeCloseTo(0.6);
  });

  it("should calculate negative progress for LTR when moving left", () => {
    const progress = calculateProgress({ x: 0.8, y: 0.5 }, { x: 0.2, y: 0.5 }, "LTR");
    expect(progress).toBeCloseTo(-0.6);
  });

  it("should calculate positive progress for RTL when moving left", () => {
    const progress = calculateProgress({ x: 0.8, y: 0.5 }, { x: 0.2, y: 0.5 }, "RTL");
    expect(progress).toBeCloseTo(0.6);
  });

  it("should return 0 when attack direction is not set", () => {
    const progress = calculateProgress({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, null);
    expect(progress).toBe(0);
  });
});

// ============================================================================
// Possession Detection Tests
// ============================================================================

describe("findClosestPlayer", () => {
  it("should find the closest player to the ball", () => {
    const tracks: TrackData[] = [
      createTrackData("track-1", [createTrackFrame("track-1", 1, { x: 0.1, y: 0.5 })], "home"),
      createTrackData("track-2", [createTrackFrame("track-2", 1, { x: 0.5, y: 0.5 })], "away"),
      createTrackData("track-3", [createTrackFrame("track-3", 1, { x: 0.9, y: 0.5 })], "home"),
    ];

    const ballPos = { x: 0.12, y: 0.5 };
    const closest = findClosestPlayer(ballPos, tracks, 1);

    expect(closest).not.toBeNull();
    expect(closest!.trackId).toBe("track-1");
    expect(closest!.teamId).toBe("home");
  });

  it("should return null if no players at frame", () => {
    const tracks: TrackData[] = [
      createTrackData("track-1", [createTrackFrame("track-1", 2, { x: 0.1, y: 0.5 })], "home"),
    ];

    const closest = findClosestPlayer({ x: 0.5, y: 0.5 }, tracks, 1); // Frame 1 has no data
    expect(closest).toBeNull();
  });
});

describe("detectFramePossessions", () => {
  it("should assign possession to closest player within threshold", () => {
    const tracks: TrackData[] = [
      createTrackData(
        "track-1",
        [createTrackFrame("track-1", 1, { x: 0.5, y: 0.5 })],
        "home"
      ),
    ];

    const ball = createBallData([
      createBallDetection(1, { x: 0.52, y: 0.5 }), // Very close to track-1
    ]);

    const possessions = detectFramePossessions(
      tracks,
      ball,
      [1],
      { ...DEFAULT_EVENT_CONFIG, possessionDistanceThreshold: 0.1 }
    );

    expect(possessions).toHaveLength(1);
    expect(possessions[0].possessorTrackId).toBe("track-1");
    expect(possessions[0].possessorTeamId).toBe("home");
  });

  it("should not assign possession if player is too far", () => {
    const tracks: TrackData[] = [
      createTrackData(
        "track-1",
        [createTrackFrame("track-1", 1, { x: 0.1, y: 0.5 })],
        "home"
      ),
    ];

    const ball = createBallData([
      createBallDetection(1, { x: 0.9, y: 0.5 }), // Far from track-1
    ]);

    const possessions = detectFramePossessions(
      tracks,
      ball,
      [1],
      { ...DEFAULT_EVENT_CONFIG, possessionDistanceThreshold: 0.1 }
    );

    expect(possessions).toHaveLength(1);
    expect(possessions[0].possessorTrackId).toBeNull();
  });

  it("should handle ball not visible", () => {
    const tracks: TrackData[] = [
      createTrackData(
        "track-1",
        [createTrackFrame("track-1", 1, { x: 0.5, y: 0.5 })],
        "home"
      ),
    ];

    const ball = createBallData([
      createBallDetection(1, { x: 0.5, y: 0.5 }, false), // Not visible
    ]);

    const possessions = detectFramePossessions(tracks, ball, [1], DEFAULT_EVENT_CONFIG);

    expect(possessions).toHaveLength(1);
    expect(possessions[0].ballVisible).toBe(false);
    expect(possessions[0].possessorTrackId).toBeNull();
  });
});

// ============================================================================
// Possession Segment Tests
// ============================================================================

describe("buildPossessionSegments", () => {
  it("should build segments from consecutive possessions", () => {
    const framePossessions: FramePossession[] = [
      {
        frameNumber: 1,
        timestamp: 1 / 30,
        ballPosition: { x: 0.5, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.5, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.9,
      },
      {
        frameNumber: 2,
        timestamp: 2 / 30,
        ballPosition: { x: 0.52, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.52, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.9,
      },
      {
        frameNumber: 3,
        timestamp: 3 / 30,
        ballPosition: { x: 0.54, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.54, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.9,
      },
    ];

    const segments = buildPossessionSegments(
      framePossessions,
      new Map([["track-1", "player-1"]]),
      { ...DEFAULT_EVENT_CONFIG, minPossessionFrames: 2 }
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].trackId).toBe("track-1");
    expect(segments[0].playerId).toBe("player-1");
    expect(segments[0].teamId).toBe("home");
    expect(segments[0].startFrame).toBe(1);
  });

  it("should create new segment when possessor changes", () => {
    const framePossessions: FramePossession[] = [
      // Track-1 possession (frames 1-3)
      ...Array.from({ length: 3 }, (_, i) => ({
        frameNumber: i + 1,
        timestamp: (i + 1) / 30,
        ballPosition: { x: 0.5, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.5, y: 0.5 },
        possessorTeamId: "home" as TeamId,
        distance: 0.01,
        confidence: 0.9,
      })),
      // Track-2 possession (frames 4-6)
      ...Array.from({ length: 3 }, (_, i) => ({
        frameNumber: i + 4,
        timestamp: (i + 4) / 30,
        ballPosition: { x: 0.6, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-2",
        possessorPosition: { x: 0.6, y: 0.5 },
        possessorTeamId: "home" as TeamId,
        distance: 0.01,
        confidence: 0.9,
      })),
    ];

    const segments = buildPossessionSegments(
      framePossessions,
      new Map(),
      { ...DEFAULT_EVENT_CONFIG, minPossessionFrames: 2 }
    );

    expect(segments).toHaveLength(2);
    expect(segments[0].trackId).toBe("track-1");
    expect(segments[1].trackId).toBe("track-2");
  });
});

// ============================================================================
// Pass Detection Tests
// ============================================================================

describe("detectPassEvents", () => {
  it("should detect complete pass between same team", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "pass" as const,
      },
      {
        trackId: "track-2",
        playerId: "player-2",
        teamId: "home" as TeamId,
        startFrame: 31,
        endFrame: 60,
        startTime: 1,
        endTime: 2,
        confidence: 0.85,
        endReason: "pass" as const,
      },
    ];

    const framePossessions: FramePossession[] = [
      {
        frameNumber: 30,
        timestamp: 1,
        ballPosition: { x: 0.5, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.5, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.9,
      },
      {
        frameNumber: 31,
        timestamp: 31 / 30,
        ballPosition: { x: 0.6, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-2",
        possessorPosition: { x: 0.6, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.85,
      },
    ];

    const possessionsByFrame = new Map(framePossessions.map((fp) => [fp.frameNumber, fp]));
    const passes = detectPassEvents(
      segments,
      "match-1",
      DEFAULT_EVENT_CONFIG,
      possessionsByFrame
    );

    expect(passes).toHaveLength(1);
    expect(passes[0].outcome).toBe("complete");
    expect(passes[0].kicker.trackId).toBe("track-1");
    expect(passes[0].receiver?.trackId).toBe("track-2");
  });

  it("should detect intercepted pass between different teams", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "lost" as const,
      },
      {
        trackId: "track-2",
        playerId: "player-2",
        teamId: "away" as TeamId, // Different team
        startFrame: 31,
        endFrame: 60,
        startTime: 1,
        endTime: 2,
        confidence: 0.85,
        endReason: "pass" as const,
      },
    ];

    // Create frame possessions with positions for pass detection
    const framePossessions: FramePossession[] = [
      {
        frameNumber: 30,
        timestamp: 1,
        ballPosition: { x: 0.5, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.5, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.9,
      },
      {
        frameNumber: 31,
        timestamp: 31 / 30,
        ballPosition: { x: 0.6, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-2",
        possessorPosition: { x: 0.6, y: 0.5 },
        possessorTeamId: "away",
        distance: 0.01,
        confidence: 0.85,
      },
    ];
    const possessionsByFrame = new Map(framePossessions.map((fp) => [fp.frameNumber, fp]));
    const passes = detectPassEvents(segments, "match-1", DEFAULT_EVENT_CONFIG, possessionsByFrame);

    expect(passes).toHaveLength(1);
    expect(passes[0].outcome).toBe("intercepted");
  });
});

// ============================================================================
// Carry Detection Tests
// ============================================================================

describe("detectCarryEvents", () => {
  it("should detect carry with movement", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "pass" as const,
      },
    ];

    // Movement from x=0.3 to x=0.7
    const framePossessions: FramePossession[] = Array.from({ length: 30 }, (_, i) => ({
      frameNumber: i + 1,
      timestamp: (i + 1) / 30,
      ballPosition: { x: 0.3 + (i / 30) * 0.4, y: 0.5 },
      ballVisible: true,
      possessorTrackId: "track-1",
      possessorPosition: { x: 0.3 + (i / 30) * 0.4, y: 0.5 },
      possessorTeamId: "home" as TeamId,
      distance: 0.01,
      confidence: 0.9,
    }));

    const possessionsByFrame = new Map(framePossessions.map((fp) => [fp.frameNumber, fp]));
    const carries = detectCarryEvents(
      segments,
      "match-1",
      { ...DEFAULT_EVENT_CONFIG, minCarryDistance: 0.01 },
      possessionsByFrame,
      "LTR"
    );

    expect(carries).toHaveLength(1);
    expect(carries[0].trackId).toBe("track-1");
    expect(carries[0].progressIndex).toBeGreaterThan(0); // Moving forward (LTR)
    expect(carries[0].carryIndex).toBeGreaterThan(0);
  });

  it("should skip carry if movement is too small", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "pass" as const,
      },
    ];

    // Minimal movement
    const framePossessions: FramePossession[] = Array.from({ length: 30 }, (_, i) => ({
      frameNumber: i + 1,
      timestamp: (i + 1) / 30,
      ballPosition: { x: 0.5, y: 0.5 },
      ballVisible: true,
      possessorTrackId: "track-1",
      possessorPosition: { x: 0.5 + (i / 30) * 0.001, y: 0.5 }, // Very small movement
      possessorTeamId: "home" as TeamId,
      distance: 0.01,
      confidence: 0.9,
    }));

    const possessionsByFrame = new Map(framePossessions.map((fp) => [fp.frameNumber, fp]));
    const carries = detectCarryEvents(
      segments,
      "match-1",
      { ...DEFAULT_EVENT_CONFIG, minCarryDistance: 0.1 }, // High threshold
      possessionsByFrame,
      "LTR"
    );

    expect(carries).toHaveLength(0);
  });
});

// ============================================================================
// Turnover Detection Tests
// ============================================================================

describe("detectTurnoverEvents", () => {
  it("should detect turnover when team changes", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "lost" as const,
      },
      {
        trackId: "track-2",
        playerId: "player-2",
        teamId: "away" as TeamId, // Different team
        startFrame: 31,
        endFrame: 60,
        startTime: 1,
        endTime: 2,
        confidence: 0.85,
        endReason: "pass" as const,
      },
    ];

    // Create frame possessions with positions for turnover detection
    const framePossessions: FramePossession[] = [
      {
        frameNumber: 30,
        timestamp: 1,
        ballPosition: { x: 0.5, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-1",
        possessorPosition: { x: 0.5, y: 0.5 },
        possessorTeamId: "home",
        distance: 0.01,
        confidence: 0.9,
      },
      {
        frameNumber: 31,
        timestamp: 31 / 30,
        ballPosition: { x: 0.6, y: 0.5 },
        ballVisible: true,
        possessorTrackId: "track-2",
        possessorPosition: { x: 0.6, y: 0.5 },
        possessorTeamId: "away",
        distance: 0.01,
        confidence: 0.85,
      },
    ];
    const possessionsByFrame = new Map(framePossessions.map((fp) => [fp.frameNumber, fp]));
    const turnovers = detectTurnoverEvents(segments, "match-1", DEFAULT_EVENT_CONFIG, possessionsByFrame);

    // Should create both "lost" and "won" events
    expect(turnovers).toHaveLength(2);
    expect(turnovers.find((t) => t.turnoverType === "lost")).toBeDefined();
    expect(turnovers.find((t) => t.turnoverType === "won")).toBeDefined();
  });

  it("should not detect turnover when same team", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "pass" as const,
      },
      {
        trackId: "track-2",
        playerId: "player-2",
        teamId: "home" as TeamId, // Same team
        startFrame: 31,
        endFrame: 60,
        startTime: 1,
        endTime: 2,
        confidence: 0.85,
        endReason: "pass" as const,
      },
    ];

    const turnovers = detectTurnoverEvents(segments, "match-1", DEFAULT_EVENT_CONFIG, new Map());

    expect(turnovers).toHaveLength(0);
  });

  it("should skip turnover if team is unknown", () => {
    const segments = [
      {
        trackId: "track-1",
        playerId: null,
        teamId: "unknown" as TeamId,
        startFrame: 1,
        endFrame: 30,
        startTime: 0,
        endTime: 1,
        confidence: 0.9,
        endReason: "lost" as const,
      },
      {
        trackId: "track-2",
        playerId: null,
        teamId: "away" as TeamId,
        startFrame: 31,
        endFrame: 60,
        startTime: 1,
        endTime: 2,
        confidence: 0.85,
        endReason: "pass" as const,
      },
    ];

    const turnovers = detectTurnoverEvents(segments, "match-1", DEFAULT_EVENT_CONFIG, new Map());

    expect(turnovers).toHaveLength(0);
  });
});

// ============================================================================
// Integration Test
// ============================================================================

describe("detectAllEvents", () => {
  it("should run complete detection pipeline", () => {
    // Create a simple scenario: track-1 passes to track-2 (same team)
    const tracks: TrackData[] = [
      createTrackData(
        "track-1",
        Array.from({ length: 30 }, (_, i) =>
          createTrackFrame("track-1", i + 1, { x: 0.3, y: 0.5 })
        ),
        "home",
        "player-1"
      ),
      createTrackData(
        "track-2",
        Array.from({ length: 30 }, (_, i) =>
          createTrackFrame("track-2", i + 31, { x: 0.7, y: 0.5 })
        ),
        "home",
        "player-2"
      ),
    ];

    const ball = createBallData([
      // Ball near track-1 for first 30 frames
      ...Array.from({ length: 30 }, (_, i) =>
        createBallDetection(i + 1, { x: 0.32, y: 0.5 })
      ),
      // Ball near track-2 for next 30 frames
      ...Array.from({ length: 30 }, (_, i) =>
        createBallDetection(i + 31, { x: 0.68, y: 0.5 })
      ),
    ]);

    const trackPlayerMap = new Map([
      ["track-1", "player-1"],
      ["track-2", "player-2"],
    ]);

    const result = detectAllEvents(
      tracks,
      ball,
      "match-1",
      trackPlayerMap,
      "LTR",
      { minPossessionFrames: 3, minCarryDistance: 0.001 }
    );

    expect(result.possessionSegments.length).toBeGreaterThan(0);
    expect(result.passEvents.length).toBeGreaterThan(0);
    // No turnovers (same team)
    expect(result.turnoverEvents).toHaveLength(0);
  });
});

// ============================================================================
// Configuration Tests
// ============================================================================

describe("DEFAULT_EVENT_CONFIG", () => {
  it("should have reasonable default values", () => {
    expect(DEFAULT_EVENT_CONFIG.possessionDistanceThreshold).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_CONFIG.possessionDistanceThreshold).toBeLessThan(0.5);
    expect(DEFAULT_EVENT_CONFIG.minPossessionFrames).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_CONFIG.reviewThreshold).toBe(0.6);
    expect(DEFAULT_EVENT_CONFIG.fps).toBe(30);
  });
});

// ============================================================================
// Pending Review Extraction Tests
// ============================================================================

describe("extractPendingReviews", () => {
  it("should extract pass events that need review", () => {
    const events: DetectedEvents = {
      possessionSegments: [],
      passEvents: [
        {
          eventId: "pass_1",
          matchId: "match-1",
          type: "pass",
          frameNumber: 30,
          timestamp: 1,
          kicker: {
            trackId: "track-1",
            playerId: "player-1",
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.4, // Low confidence
          },
          receiver: {
            trackId: "track-2",
            playerId: "player-2",
            teamId: "home",
            position: { x: 0.6, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          outcomeConfidence: 0.7,
          confidence: 0.5, // Low overall
          needsReview: true,
          reviewReason: "low_kicker_confidence",
          source: "auto",
          version: "1.0.0",
          createdAt: new Date().toISOString(),
        },
        {
          eventId: "pass_2",
          matchId: "match-1",
          type: "pass",
          frameNumber: 60,
          timestamp: 2,
          kicker: {
            trackId: "track-2",
            playerId: "player-2",
            teamId: "home",
            position: { x: 0.6, y: 0.5 },
            confidence: 0.9, // High confidence
          },
          receiver: {
            trackId: "track-3",
            playerId: "player-3",
            teamId: "home",
            position: { x: 0.7, y: 0.5 },
            confidence: 0.9,
          },
          outcome: "complete",
          outcomeConfidence: 0.9,
          confidence: 0.9, // High overall
          needsReview: false,
          source: "auto",
          version: "1.0.0",
          createdAt: new Date().toISOString(),
        },
      ],
      carryEvents: [],
      turnoverEvents: [],
    };

    const pendingReviews = extractPendingReviews(events, "match-1");

    expect(pendingReviews).toHaveLength(1);
    expect(pendingReviews[0].eventId).toBe("pass_1");
    expect(pendingReviews[0].eventType).toBe("pass");
    expect(pendingReviews[0].matchId).toBe("match-1");
    expect(pendingReviews[0].resolved).toBe(false);
    expect(pendingReviews[0].candidates).toHaveLength(2);
  });

  it("should extract turnover events that need review (lost type only)", () => {
    const events: DetectedEvents = {
      possessionSegments: [],
      passEvents: [],
      carryEvents: [],
      turnoverEvents: [
        {
          eventId: "turnover_lost_1",
          matchId: "match-1",
          type: "turnover",
          turnoverType: "lost",
          frameNumber: 30,
          timestamp: 1,
          player: {
            trackId: "track-1",
            playerId: "player-1",
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          otherPlayer: {
            trackId: "track-2",
            playerId: "player-2",
            teamId: "away",
            position: { x: 0.6, y: 0.5 },
          },
          context: "other",
          confidence: 0.4, // Low confidence
          needsReview: true,
          version: "1.0.0",
          createdAt: new Date().toISOString(),
        },
        {
          eventId: "turnover_won_1",
          matchId: "match-1",
          type: "turnover",
          turnoverType: "won", // Won type should be skipped
          frameNumber: 31,
          timestamp: 1,
          player: {
            trackId: "track-2",
            playerId: "player-2",
            teamId: "away",
            position: { x: 0.6, y: 0.5 },
          },
          otherPlayer: {
            trackId: "track-1",
            playerId: "player-1",
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
          },
          context: "other",
          confidence: 0.4,
          needsReview: true,
          version: "1.0.0",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const pendingReviews = extractPendingReviews(events, "match-1");

    // Should only include "lost" type
    expect(pendingReviews).toHaveLength(1);
    expect(pendingReviews[0].eventId).toBe("turnover_lost_1");
    expect(pendingReviews[0].eventType).toBe("turnover");
    expect(pendingReviews[0].matchId).toBe("match-1");
  });

  it("should return empty array when no events need review", () => {
    const events: DetectedEvents = {
      possessionSegments: [],
      passEvents: [
        {
          eventId: "pass_1",
          matchId: "match-1",
          type: "pass",
          frameNumber: 30,
          timestamp: 1,
          kicker: {
            trackId: "track-1",
            playerId: "player-1",
            teamId: "home",
            position: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
          receiver: null,
          outcome: "incomplete",
          outcomeConfidence: 0.9,
          confidence: 0.9,
          needsReview: false,
          source: "auto",
          version: "1.0.0",
          createdAt: new Date().toISOString(),
        },
      ],
      carryEvents: [],
      turnoverEvents: [],
    };

    const pendingReviews = extractPendingReviews(events, "match-1");
    expect(pendingReviews).toHaveLength(0);
  });
});
