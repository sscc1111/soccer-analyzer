/**
 * Tests for Comprehensive Analysis Schema
 */

import { describe, it, expect } from "vitest";
import {
  ComprehensiveAnalysisResponseSchema,
  normalizeComprehensiveResponse,
  VideoQualitySchema,
  TeamSchema,
  SegmentTypeSchema,
  EventTypeSchema,
  SceneTypeSchema,
} from "../comprehensiveAnalysis";

describe("VideoQualitySchema", () => {
  it("should accept valid quality values", () => {
    expect(VideoQualitySchema.parse("good")).toBe("good");
    expect(VideoQualitySchema.parse("fair")).toBe("fair");
    expect(VideoQualitySchema.parse("poor")).toBe("poor");
  });

  it("should reject invalid quality values", () => {
    expect(() => VideoQualitySchema.parse("excellent")).toThrow();
    expect(() => VideoQualitySchema.parse("bad")).toThrow();
  });
});

describe("TeamSchema", () => {
  it("should accept valid team values", () => {
    expect(TeamSchema.parse("home")).toBe("home");
    expect(TeamSchema.parse("away")).toBe("away");
  });

  it("should reject invalid team values", () => {
    expect(() => TeamSchema.parse("neutral")).toThrow();
  });
});

describe("SegmentTypeSchema", () => {
  it("should accept valid segment types", () => {
    expect(SegmentTypeSchema.parse("active_play")).toBe("active_play");
    expect(SegmentTypeSchema.parse("stoppage")).toBe("stoppage");
    expect(SegmentTypeSchema.parse("set_piece")).toBe("set_piece");
    expect(SegmentTypeSchema.parse("goal_moment")).toBe("goal_moment");
    expect(SegmentTypeSchema.parse("replay")).toBe("replay");
  });
});

describe("EventTypeSchema", () => {
  it("should accept valid event types", () => {
    expect(EventTypeSchema.parse("pass")).toBe("pass");
    expect(EventTypeSchema.parse("shot")).toBe("shot");
    expect(EventTypeSchema.parse("carry")).toBe("carry");
    expect(EventTypeSchema.parse("turnover")).toBe("turnover");
    expect(EventTypeSchema.parse("setPiece")).toBe("setPiece");
  });
});

describe("SceneTypeSchema", () => {
  it("should accept valid scene types", () => {
    expect(SceneTypeSchema.parse("goal")).toBe("goal");
    expect(SceneTypeSchema.parse("shot")).toBe("shot");
    expect(SceneTypeSchema.parse("save")).toBe("save");
    expect(SceneTypeSchema.parse("chance")).toBe("chance");
  });
});

describe("ComprehensiveAnalysisResponseSchema", () => {
  const validResponse = {
    metadata: {
      totalDurationSec: 3600,
      videoQuality: "good",
    },
    teams: {
      home: {
        primaryColor: "#FF0000",
        attackingDirection: "left_to_right",
      },
      away: {
        primaryColor: "#0000FF",
        attackingDirection: "right_to_left",
      },
    },
    segments: [
      {
        startSec: 0,
        endSec: 60,
        type: "active_play",
        description: "アクティブプレイ区間",
        importance: 3,
        confidence: 0.9,
      },
    ],
    events: [
      {
        timestamp: 30,
        type: "pass",
        team: "home",
        confidence: 0.85,
      },
    ],
    scenes: [
      {
        startSec: 25,
        endSec: 35,
        type: "chance",
        description: "ホームチームの決定機",
        importance: 0.7,
        confidence: 0.8,
      },
    ],
    players: {
      teams: {
        home: { primaryColor: "#FF0000" },
        away: { primaryColor: "#0000FF" },
      },
      players: [
        {
          team: "home",
          jerseyNumber: 10,
          role: "player",
          confidence: 0.9,
        },
      ],
    },
    clipLabels: [
      {
        timestamp: 30,
        label: "chance",
        confidence: 0.85,
        title: "ビッグチャンス",
        summary: "ホームチームの決定機",
        tags: ["チャンス", "シュート"],
      },
    ],
  };

  it("should parse valid comprehensive analysis response", () => {
    const result = ComprehensiveAnalysisResponseSchema.parse(validResponse);
    expect(result.metadata.totalDurationSec).toBe(3600);
    expect(result.teams.home.primaryColor).toBe("#FF0000");
    expect(result.segments).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.scenes).toHaveLength(1);
    expect(result.players.players).toHaveLength(1);
    expect(result.clipLabels).toHaveLength(1);
  });

  it("should accept response without optional fields", () => {
    const minimalResponse = {
      metadata: {
        totalDurationSec: 600,
        videoQuality: "fair",
      },
      teams: {
        home: { primaryColor: "#FFFFFF" },
        away: { primaryColor: "#000000" },
      },
      segments: [],
      events: [],
      scenes: [],
      players: {
        teams: {
          home: { primaryColor: "#FFFFFF" },
          away: { primaryColor: "#000000" },
        },
        players: [],
      },
    };

    const result = ComprehensiveAnalysisResponseSchema.parse(minimalResponse);
    expect(result.clipLabels).toBeUndefined();
  });

  it("should reject response with invalid segment type", () => {
    const invalidResponse = {
      ...validResponse,
      segments: [
        {
          startSec: 0,
          endSec: 60,
          type: "invalid_type", // Invalid
          description: "テスト",
          importance: 3,
          confidence: 0.9,
        },
      ],
    };

    expect(() => ComprehensiveAnalysisResponseSchema.parse(invalidResponse)).toThrow();
  });

  it("should reject response with invalid event type", () => {
    const invalidResponse = {
      ...validResponse,
      events: [
        {
          timestamp: 30,
          type: "invalid_event", // Invalid
          team: "home",
          confidence: 0.85,
        },
      ],
    };

    expect(() => ComprehensiveAnalysisResponseSchema.parse(invalidResponse)).toThrow();
  });
});

describe("normalizeComprehensiveResponse", () => {
  it("should normalize event fields", () => {
    const response = {
      metadata: {
        totalDurationSec: 600,
        videoQuality: "good" as const,
      },
      teams: {
        home: { primaryColor: "#FF0000" },
        away: { primaryColor: "#0000FF" },
      },
      segments: [],
      events: [
        {
          timestamp: 30,
          type: "shot" as const,
          team: "home" as const,
          confidence: 0.9,
          details: {
            shotResult: "goal",
            shotType: "placed",
          },
        },
      ],
      scenes: [],
      players: {
        teams: {
          home: { primaryColor: "#FF0000" },
          away: { primaryColor: "#0000FF" },
        },
        players: [],
      },
    };

    const normalized = normalizeComprehensiveResponse(response);
    expect(normalized.events[0].details).toBeDefined();
    expect(normalized.events[0].details?.shotResult).toBe("goal");
  });
});
