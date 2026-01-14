/**
 * Tests for Summary and Tactics Schema
 */

import { describe, it, expect } from "vitest";
import {
  SummaryAndTacticsResponseSchema,
  TacticalAnalysisSchema,
  MatchSummarySchema,
  calculateEventStats,
} from "../summaryAndTactics";

describe("TacticalAnalysisSchema", () => {
  const validTactical = {
    formation: {
      home: "4-3-3",
      away: "4-4-2",
    },
    tempo: {
      home: 12.5,
      away: 8.3,
    },
    attackPatterns: [
      "左サイドからの攻撃が多い",
      "中盤のトライアングルでビルドアップ",
    ],
    defensivePatterns: [
      "前線からのプレス",
      "4-4ブロック形成",
    ],
    keyInsights: [
      "ホームの左サイド攻撃が効果的",
      "アウェイのカウンターに注意",
    ],
    pressingIntensity: {
      home: 75,
      away: 45,
    },
    buildUpStyle: {
      home: "short",
      away: "long",
    },
  };

  it("should parse valid tactical analysis", () => {
    const result = TacticalAnalysisSchema.parse(validTactical);
    expect(result.formation.home).toBe("4-3-3");
    expect(result.formation.away).toBe("4-4-2");
    expect(result.tempo.home).toBe(12.5);
    expect(result.pressingIntensity.home).toBe(75);
    expect(result.buildUpStyle.home).toBe("short");
  });

  it("should accept valid buildUpStyle values", () => {
    const tactical1 = { ...validTactical, buildUpStyle: { home: "short", away: "short" } };
    const tactical2 = { ...validTactical, buildUpStyle: { home: "long", away: "long" } };
    const tactical3 = { ...validTactical, buildUpStyle: { home: "mixed", away: "mixed" } };

    expect(TacticalAnalysisSchema.parse(tactical1).buildUpStyle.home).toBe("short");
    expect(TacticalAnalysisSchema.parse(tactical2).buildUpStyle.home).toBe("long");
    expect(TacticalAnalysisSchema.parse(tactical3).buildUpStyle.home).toBe("mixed");
  });

  it("should reject invalid buildUpStyle", () => {
    const invalid = { ...validTactical, buildUpStyle: { home: "invalid", away: "short" } };
    expect(() => TacticalAnalysisSchema.parse(invalid)).toThrow();
  });
});

describe("MatchSummarySchema", () => {
  const validSummary = {
    headline: "ホームが2-1で勝利",
    narrative: {
      firstHalf: "前半からホームがボールを支配。25分に先制点を奪取。",
      secondHalf: "後半も攻勢を維持し、65分に追加点。",
    },
    keyMoments: [
      {
        timestamp: 1500,
        description: "ホームの先制ゴール",
        importance: 0.9,
        type: "goal",
      },
    ],
    playerHighlights: [
      {
        player: "#9",
        team: "home",
        achievement: "2ゴールで勝利に貢献",
      },
    ],
  };

  it("should parse valid match summary", () => {
    const result = MatchSummarySchema.parse(validSummary);
    expect(result.headline).toBe("ホームが2-1で勝利");
    expect(result.narrative.firstHalf).toContain("前半");
    expect(result.keyMoments).toHaveLength(1);
    expect(result.playerHighlights).toHaveLength(1);
  });

  it("should accept optional score", () => {
    const withScore = {
      ...validSummary,
      score: { home: 2, away: 1 },
    };
    const result = MatchSummarySchema.parse(withScore);
    expect(result.score?.home).toBe(2);
    expect(result.score?.away).toBe(1);
  });

  it("should accept optional MVP", () => {
    const withMvp = {
      ...validSummary,
      mvp: {
        player: "#9",
        team: "home",
        achievement: "2ゴールでマンオブザマッチ",
      },
    };
    const result = MatchSummarySchema.parse(withMvp);
    expect(result.mvp?.player).toBe("#9");
  });

  it("should accept valid key moment types", () => {
    const types = ["goal", "chance", "save", "foul", "substitution", "tactical_change", "other"];

    for (const type of types) {
      const summary = {
        ...validSummary,
        keyMoments: [
          {
            timestamp: 1000,
            description: "Test moment",
            importance: 0.5,
            type,
          },
        ],
      };
      const result = MatchSummarySchema.parse(summary);
      expect(result.keyMoments[0].type).toBe(type);
    }
  });
});

describe("SummaryAndTacticsResponseSchema", () => {
  const validResponse = {
    tactical: {
      formation: { home: "4-3-3", away: "4-4-2" },
      tempo: { home: 12.5, away: 8.3 },
      attackPatterns: ["Pattern 1"],
      defensivePatterns: ["Pattern 2"],
      keyInsights: ["Insight 1"],
      pressingIntensity: { home: 70, away: 50 },
      buildUpStyle: { home: "short", away: "long" },
    },
    summary: {
      headline: "ホームが勝利",
      narrative: {
        firstHalf: "前半の内容",
        secondHalf: "後半の内容",
      },
      keyMoments: [],
      playerHighlights: [],
    },
  };

  it("should parse valid combined response", () => {
    const result = SummaryAndTacticsResponseSchema.parse(validResponse);
    expect(result.tactical.formation.home).toBe("4-3-3");
    expect(result.summary.headline).toBe("ホームが勝利");
  });

  it("should reject response missing tactical", () => {
    const invalid = { summary: validResponse.summary };
    expect(() => SummaryAndTacticsResponseSchema.parse(invalid)).toThrow();
  });

  it("should reject response missing summary", () => {
    const invalid = { tactical: validResponse.tactical };
    expect(() => SummaryAndTacticsResponseSchema.parse(invalid)).toThrow();
  });
});

describe("calculateEventStats", () => {
  it("should calculate stats from events array", () => {
    const events = [
      { type: "pass" as const, team: "home" as const, details: { outcome: "complete" } },
      { type: "pass" as const, team: "home" as const, details: { outcome: "complete" } },
      { type: "pass" as const, team: "home" as const, details: { outcome: "incomplete" } },
      { type: "pass" as const, team: "away" as const, details: { outcome: "complete" } },
      { type: "shot" as const, team: "home" as const, details: { shotResult: "saved" } },
      { type: "shot" as const, team: "home" as const, details: { shotResult: "goal" } },
      { type: "shot" as const, team: "away" as const, details: { shotResult: "missed" } },
      { type: "turnover" as const, team: "home" as const },
      { type: "turnover" as const, team: "away" as const },
    ];

    const stats = calculateEventStats(events);

    expect(stats.home.passes).toBe(3);
    expect(stats.home.passesComplete).toBe(2);
    expect(stats.home.shots).toBe(2);
    expect(stats.home.shotsOnTarget).toBe(2); // saved + goal = on target
    expect(stats.away.passes).toBe(1);
    expect(stats.away.passesComplete).toBe(1);
    expect(stats.away.shots).toBe(1);
    expect(stats.away.shotsOnTarget).toBe(0); // missed = off target
  });

  it("should return zeros for empty events", () => {
    const stats = calculateEventStats([]);
    expect(stats.home.passes).toBe(0);
    expect(stats.away.passes).toBe(0);
    expect(stats.home.shots).toBe(0);
    expect(stats.away.shots).toBe(0);
  });

  it("should handle turnovers correctly", () => {
    const events = [
      { type: "turnover" as const, team: "home" as const },
      { type: "turnover" as const, team: "home" as const },
      { type: "turnover" as const, team: "away" as const },
    ];

    const stats = calculateEventStats(events);

    // Turnovers by home team mean away team won possession
    expect(stats.home.turnoversLost).toBe(2);
    expect(stats.away.turnoversWon).toBe(2);
    expect(stats.away.turnoversLost).toBe(1);
    expect(stats.home.turnoversWon).toBe(1);
  });
});
