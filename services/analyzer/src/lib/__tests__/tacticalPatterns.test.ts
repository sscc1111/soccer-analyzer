/**
 * Tactical Pattern Detection Tests
 *
 * Tests for position-based tactical pattern analysis
 */

import { describe, it, expect } from "vitest";
import type { PassEventDoc, ShotEventDoc, TurnoverEventDoc, Point2D } from "@soccer/shared";
import {
  classifyAttackZone,
  classifyFieldThird,
  detectCounterAttacks,
  calculatePressHeight,
  detectAttackPatterns,
  detectDefensivePatterns,
  analyzeTeamTacticalPatterns,
  generateTacticalSummary,
} from "../tacticalPatterns";

// Test helpers
function createPassEvent(
  team: "home" | "away",
  kickerPosition: Point2D,
  outcome: "complete" | "incomplete" | "intercepted" = "complete"
): PassEventDoc {
  return {
    eventId: `pass-${Math.random()}`,
    matchId: "test-match",
    type: "pass",
    frameNumber: 100,
    timestamp: 10,
    kicker: {
      trackId: "track-1",
      playerId: null,
      teamId: team,
      position: kickerPosition,
      confidence: 0.9,
    },
    receiver: outcome === "complete"
      ? {
          trackId: "track-2",
          playerId: null,
          teamId: team,
          position: { x: kickerPosition.x + 0.1, y: kickerPosition.y },
          confidence: 0.8,
        }
      : null,
    outcome,
    outcomeConfidence: 0.9,
    confidence: 0.9,
    needsReview: false,
    source: "auto",
    version: "v1",
    createdAt: new Date().toISOString(),
  };
}

function createShotEvent(
  team: "home" | "away",
  position: Point2D,
  result: "goal" | "saved" | "missed" = "saved"
): ShotEventDoc {
  return {
    eventId: `shot-${Math.random()}`,
    matchId: "test-match",
    type: "shot",
    timestamp: 20,
    team,
    result,
    position,
    confidence: 0.9,
    source: "auto",
    version: "v1",
    createdAt: new Date().toISOString(),
  };
}

function createTurnoverEvent(
  team: "home" | "away",
  turnoverType: "won" | "lost",
  position: Point2D,
  timestamp: number = 5
): TurnoverEventDoc {
  return {
    eventId: `turnover-${Math.random()}`,
    matchId: "test-match",
    type: "turnover",
    turnoverType,
    frameNumber: 50,
    timestamp,
    player: {
      trackId: "track-1",
      playerId: null,
      teamId: team,
      position,
    },
    confidence: 0.9,
    needsReview: false,
    version: "v1",
    createdAt: new Date().toISOString(),
  };
}

describe("Tactical Patterns - Zone Classification", () => {
  describe("classifyAttackZone", () => {
    it("should classify left zone correctly", () => {
      expect(classifyAttackZone({ x: 0.5, y: 0.1 })).toBe("left");
      expect(classifyAttackZone({ x: 0.5, y: 0.3 })).toBe("left");
    });

    it("should classify center zone correctly", () => {
      expect(classifyAttackZone({ x: 0.5, y: 0.4 })).toBe("center");
      expect(classifyAttackZone({ x: 0.5, y: 0.5 })).toBe("center");
      expect(classifyAttackZone({ x: 0.5, y: 0.6 })).toBe("center");
    });

    it("should classify right zone correctly", () => {
      expect(classifyAttackZone({ x: 0.5, y: 0.7 })).toBe("right");
      expect(classifyAttackZone({ x: 0.5, y: 0.9 })).toBe("right");
    });

    it("should handle boundary cases", () => {
      expect(classifyAttackZone({ x: 0.5, y: 0.33 })).toBe("center");
      expect(classifyAttackZone({ x: 0.5, y: 0.67 })).toBe("center");
    });

    it("should handle undefined position", () => {
      expect(classifyAttackZone(undefined)).toBe("center");
    });
  });

  describe("classifyFieldThird", () => {
    it("should classify home team thirds correctly", () => {
      expect(classifyFieldThird({ x: 0.2, y: 0.5 }, "home")).toBe("defensive_third");
      expect(classifyFieldThird({ x: 0.5, y: 0.5 }, "home")).toBe("middle_third");
      expect(classifyFieldThird({ x: 0.8, y: 0.5 }, "home")).toBe("attacking_third");
    });

    it("should classify away team thirds correctly (reversed)", () => {
      expect(classifyFieldThird({ x: 0.2, y: 0.5 }, "away")).toBe("attacking_third");
      expect(classifyFieldThird({ x: 0.5, y: 0.5 }, "away")).toBe("middle_third");
      expect(classifyFieldThird({ x: 0.8, y: 0.5 }, "away")).toBe("defensive_third");
    });

    it("should handle boundary cases", () => {
      expect(classifyFieldThird({ x: 0.33, y: 0.5 }, "home")).toBe("middle_third");
      expect(classifyFieldThird({ x: 0.67, y: 0.5 }, "home")).toBe("middle_third");
    });

    it("should handle undefined position", () => {
      expect(classifyFieldThird(undefined, "home")).toBe("middle_third");
      expect(classifyFieldThird(undefined, "away")).toBe("middle_third");
    });
  });
});

describe("Tactical Patterns - Counter-Attack Detection", () => {
  it("should detect counter-attack when turnover leads to shot within 10s", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.3, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }, "saved"),
    ];
    shotEvents[0].timestamp = 12; // 7 seconds after turnover

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(1);
    expect(counterAttacks[0].team).toBe("home");
    expect(counterAttacks[0].duration).toBe(7);
    expect(counterAttacks[0].distanceTraveled).toBeGreaterThan(20);
  });

  it("should not detect counter-attack if shot is too late (>10s)", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.3, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }, "saved"),
    ];
    shotEvents[0].timestamp = 20; // 15 seconds after turnover

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(0);
  });

  it("should not detect counter-attack if distance is too short (<20m)", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.8, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }, "saved"),
    ];
    shotEvents[0].timestamp = 8; // 3 seconds after turnover

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(0);
  });

  it("should not detect counter-attack if shot is not in attacking third", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.2, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.5, y: 0.5 }, "saved"), // Middle third
    ];
    shotEvents[0].timestamp = 10;

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(0);
  });

  it("should ignore turnovers lost (only count won)", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "lost", { x: 0.3, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }, "saved"),
    ];
    shotEvents[0].timestamp = 12;

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(0);
  });

  it("should detect multiple counter-attacks", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.3, y: 0.3 }, 5),
      createTurnoverEvent("home", "won", { x: 0.25, y: 0.7 }, 30),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.4 }, "saved"),
      createShotEvent("home", { x: 0.9, y: 0.6 }, "goal"),
    ];
    shotEvents[0].timestamp = 10; // 5s after first turnover
    shotEvents[1].timestamp = 35; // 5s after second turnover

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(2);
    expect(counterAttacks[0].duration).toBe(5);
    expect(counterAttacks[1].duration).toBe(5);
  });

  it("should include shot result in counter-attack data", () => {
    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.3, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }, "goal"),
    ];
    shotEvents[0].timestamp = 12;

    const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

    expect(counterAttacks).toHaveLength(1);
    expect(counterAttacks[0].shotResult).toBe("goal");
  });
});

describe("Tactical Patterns - Attack Pattern Detection", () => {
  it("should calculate zone distribution correctly", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.2 }), // left
      createPassEvent("home", { x: 0.5, y: 0.5 }), // center
      createPassEvent("home", { x: 0.5, y: 0.8 }), // right
      createPassEvent("home", { x: 0.5, y: 0.5 }), // center
    ];

    const shotEvents: ShotEventDoc[] = [];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.zoneDistribution.left).toBeGreaterThan(0);
    expect(result.zoneDistribution.center).toBeGreaterThan(0);
    expect(result.zoneDistribution.right).toBeGreaterThan(0);
    expect(
      result.zoneDistribution.left +
        result.zoneDistribution.center +
        result.zoneDistribution.right
    ).toBe(100);
  });

  it("should detect central penetration pattern", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.5 }),
      createPassEvent("home", { x: 0.6, y: 0.5 }),
      createPassEvent("home", { x: 0.7, y: 0.5 }),
      createPassEvent("home", { x: 0.8, y: 0.5 }),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.9, y: 0.5 }), // center
      createShotEvent("home", { x: 0.85, y: 0.5 }), // center
    ];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.dominantPattern).toBe("central_penetration");
    expect(result.zoneDistribution.center).toBeGreaterThan(45);
  });

  it("should detect side attack pattern", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.1 }), // left
      createPassEvent("home", { x: 0.6, y: 0.15 }), // left
      createPassEvent("home", { x: 0.7, y: 0.2 }), // left
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.25 }), // left (weighted 3x)
      createShotEvent("home", { x: 0.9, y: 0.3 }), // left (weighted 3x)
    ];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.dominantPattern).toBe("side_attack");
    expect(result.zoneDistribution.left).toBeGreaterThan(45);
  });

  it("should detect balanced attack pattern", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.2 }), // left
      createPassEvent("home", { x: 0.5, y: 0.5 }), // center
      createPassEvent("home", { x: 0.5, y: 0.8 }), // right
      createPassEvent("home", { x: 0.6, y: 0.3 }), // left
      createPassEvent("home", { x: 0.6, y: 0.5 }), // center
      createPassEvent("home", { x: 0.6, y: 0.7 }), // right
    ];

    const shotEvents: ShotEventDoc[] = [];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.dominantPattern).toBe("balanced");
    // No zone should dominate (< 45%)
    expect(result.zoneDistribution.left).toBeLessThan(45);
    expect(result.zoneDistribution.center).toBeLessThan(45);
    expect(result.zoneDistribution.right).toBeLessThan(45);
  });

  it("should classify build-up speed as fast", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.5 }),
      createPassEvent("home", { x: 0.6, y: 0.5 }),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }),
    ];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.buildUpSpeed).toBe("fast"); // 2 passes per shot
  });

  it("should classify build-up speed as slow", () => {
    const passEvents: PassEventDoc[] = [
      ...Array.from({ length: 15 }, (_, i) =>
        createPassEvent("home", { x: 0.5 + i * 0.02, y: 0.5 })
      ),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }),
      createShotEvent("home", { x: 0.9, y: 0.5 }),
    ];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.buildUpSpeed).toBe("slow"); // 7.5 passes per shot
  });

  it("should calculate pass completion rate", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.5 }, "complete"),
      createPassEvent("home", { x: 0.5, y: 0.5 }, "complete"),
      createPassEvent("home", { x: 0.5, y: 0.5 }, "complete"),
      createPassEvent("home", { x: 0.5, y: 0.5 }, "incomplete"),
    ];

    const shotEvents: ShotEventDoc[] = [];

    const result = detectAttackPatterns(passEvents, shotEvents, []);

    expect(result.passCompletionRate).toBe(75);
  });

  it("should handle empty pass events", () => {
    const result = detectAttackPatterns([], [], []);

    expect(result.zoneDistribution).toEqual({ left: 33, center: 34, right: 33 });
    // Empty pass events = no build up data, defaults to slow
    expect(result.buildUpSpeed).toBe("slow");
    expect(result.passCompletionRate).toBe(0);
  });
});

describe("Tactical Patterns - Defense Pattern Detection", () => {
  describe("calculatePressHeight", () => {
    it("should detect high press", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.8, y: 0.5 }), // attacking third
        createTurnoverEvent("home", "won", { x: 0.85, y: 0.5 }), // attacking third
        createTurnoverEvent("home", "won", { x: 0.75, y: 0.5 }), // attacking third
      ];

      const pressHeight = calculatePressHeight(turnoverEvents, "home");

      expect(pressHeight).toBe("high");
    });

    it("should detect low press (retreat)", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.2, y: 0.5 }), // defensive third
        createTurnoverEvent("home", "won", { x: 0.25, y: 0.5 }), // defensive third
        createTurnoverEvent("home", "won", { x: 0.15, y: 0.5 }), // defensive third
      ];

      const pressHeight = calculatePressHeight(turnoverEvents, "home");

      expect(pressHeight).toBe("low");
    });

    it("should detect mid press", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.5, y: 0.5 }), // middle third
        createTurnoverEvent("home", "won", { x: 0.45, y: 0.5 }), // middle third
        createTurnoverEvent("home", "won", { x: 0.55, y: 0.5 }), // middle third
      ];

      const pressHeight = calculatePressHeight(turnoverEvents, "home");

      expect(pressHeight).toBe("mid");
    });

    it("should handle away team (reversed coordinates)", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("away", "won", { x: 0.2, y: 0.5 }), // attacking third for away
        createTurnoverEvent("away", "won", { x: 0.15, y: 0.5 }), // attacking third for away
      ];

      const pressHeight = calculatePressHeight(turnoverEvents, "away");

      expect(pressHeight).toBe("high");
    });

    it("should ignore turnovers lost", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "lost", { x: 0.8, y: 0.5 }),
        createTurnoverEvent("home", "lost", { x: 0.85, y: 0.5 }),
      ];

      const pressHeight = calculatePressHeight(turnoverEvents, "home");

      expect(pressHeight).toBe("mid"); // default when no won turnovers
    });

    it("should handle empty turnover events", () => {
      const pressHeight = calculatePressHeight([], "home");

      expect(pressHeight).toBe("mid");
    });
  });

  describe("detectDefensivePatterns", () => {
    it("should calculate correct average turnover position", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.6, y: 0.4 }),
        createTurnoverEvent("home", "won", { x: 0.8, y: 0.6 }),
      ];

      const result = detectDefensivePatterns(turnoverEvents, "home");

      expect(result.averageTurnoverPosition.x).toBeCloseTo(0.7);
      expect(result.averageTurnoverPosition.y).toBeCloseTo(0.5);
    });

    it("should count turnovers by third correctly", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.8, y: 0.5 }), // attacking
        createTurnoverEvent("home", "won", { x: 0.85, y: 0.5 }), // attacking
        createTurnoverEvent("home", "won", { x: 0.5, y: 0.5 }), // middle
        createTurnoverEvent("home", "won", { x: 0.2, y: 0.5 }), // defensive
      ];

      const result = detectDefensivePatterns(turnoverEvents, "home");

      expect(result.turnoversInAttackingThird).toBe(2);
      expect(result.turnoversInMiddleThird).toBe(1);
      expect(result.turnoversInDefensiveThird).toBe(1);
    });

    it("should determine recovery zone correctly", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.8, y: 0.5 }),
        createTurnoverEvent("home", "won", { x: 0.85, y: 0.5 }),
        createTurnoverEvent("home", "won", { x: 0.9, y: 0.5 }),
        createTurnoverEvent("home", "won", { x: 0.5, y: 0.5 }),
      ];

      const result = detectDefensivePatterns(turnoverEvents, "home");

      expect(result.recoveryZone).toBe("attacking_third");
    });

    it("should calculate press intensity based on attacking third turnovers", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.8, y: 0.5 }), // attacking
        createTurnoverEvent("home", "won", { x: 0.85, y: 0.5 }), // attacking
        createTurnoverEvent("home", "won", { x: 0.9, y: 0.5 }), // attacking
        createTurnoverEvent("home", "won", { x: 0.95, y: 0.5 }), // attacking
        createTurnoverEvent("home", "won", { x: 0.5, y: 0.5 }), // middle
      ];

      const result = detectDefensivePatterns(turnoverEvents, "home");

      // 80% in attacking third + low total count = moderate intensity
      expect(result.pressIntensity).toBeGreaterThan(30);
      expect(result.pressIntensity).toBeLessThan(70);
    });

    it("should handle high press intensity with many turnovers", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        ...Array.from({ length: 20 }, (_, i) =>
          createTurnoverEvent("home", "won", { x: 0.8 + (i % 3) * 0.05, y: 0.5 })
        ),
      ];

      const result = detectDefensivePatterns(turnoverEvents, "home");

      expect(result.pressIntensity).toBeGreaterThan(70);
    });

    it("should filter by team correctly", () => {
      const turnoverEvents: TurnoverEventDoc[] = [
        createTurnoverEvent("home", "won", { x: 0.8, y: 0.5 }),
        createTurnoverEvent("away", "won", { x: 0.2, y: 0.5 }),
        createTurnoverEvent("home", "won", { x: 0.85, y: 0.5 }),
      ];

      const result = detectDefensivePatterns(turnoverEvents, "home");

      expect(result.turnoversInAttackingThird).toBe(2);
    });

    it("should handle empty turnover events", () => {
      const result = detectDefensivePatterns([], "home");

      expect(result.averageTurnoverPosition).toEqual({ x: 0.5, y: 0.5 });
      expect(result.pressHeight).toBe("mid");
      expect(result.recoveryZone).toBe("middle_third");
      expect(result.pressIntensity).toBe(0);
    });
  });
});

describe("Tactical Patterns - Team Analysis", () => {
  it("should analyze complete team tactical patterns", () => {
    const passEvents: PassEventDoc[] = [
      createPassEvent("home", { x: 0.5, y: 0.5 }),
      createPassEvent("home", { x: 0.6, y: 0.5 }),
      createPassEvent("away", { x: 0.4, y: 0.5 }),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }),
      createShotEvent("away", { x: 0.15, y: 0.5 }),
    ];

    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.7, y: 0.5 }, 5),
      createTurnoverEvent("away", "won", { x: 0.3, y: 0.5 }, 10),
    ];

    const result = analyzeTeamTacticalPatterns("home", passEvents, shotEvents, turnoverEvents);

    expect(result.team).toBe("home");
    expect(result.attack).toBeDefined();
    expect(result.defense).toBeDefined();
    expect(result.attack.zoneDistribution).toBeDefined();
    expect(result.defense.pressHeight).toBeDefined();
  });

  it("should detect counter-attacks correctly in team analysis", () => {
    const passEvents: PassEventDoc[] = [];

    const turnoverEvents: TurnoverEventDoc[] = [
      createTurnoverEvent("home", "won", { x: 0.3, y: 0.5 }, 5),
    ];

    const shotEvents: ShotEventDoc[] = [
      createShotEvent("home", { x: 0.85, y: 0.5 }),
    ];
    shotEvents[0].timestamp = 10; // 5s after turnover

    const result = analyzeTeamTacticalPatterns("home", passEvents, shotEvents, turnoverEvents);

    expect(result.attack.counterAttacks.length).toBeGreaterThan(0);
  });
});

describe("Tactical Patterns - Summary Generation", () => {
  it("should generate summary for side attack pattern", () => {
    const patterns = {
      team: "home" as const,
      attack: {
        zoneDistribution: { left: 60, center: 30, right: 10 },
        counterAttacks: [],
        buildUpSpeed: "moderate" as const,
        dominantPattern: "side_attack" as const,
        averagePassesPerPossession: 5,
        passCompletionRate: 80,
      },
      defense: {
        pressHeight: "mid" as const,
        averageTurnoverPosition: { x: 0.5, y: 0.5 },
        pressIntensity: 50,
        recoveryZone: "middle_third" as const,
        turnoversInAttackingThird: 5,
        turnoversInMiddleThird: 10,
        turnoversInDefensiveThird: 5,
      },
    };

    const summary = generateTacticalSummary(patterns, "ホーム");

    expect(summary).toContain("サイド攻撃");
    expect(summary).toContain("左サイド");
    expect(summary).toContain("ミッドプレス");
  });

  it("should generate summary for high press defense", () => {
    const patterns = {
      team: "home" as const,
      attack: {
        zoneDistribution: { left: 33, center: 34, right: 33 },
        counterAttacks: [],
        buildUpSpeed: "moderate" as const,
        dominantPattern: "balanced" as const,
        averagePassesPerPossession: 4,
        passCompletionRate: 85,
      },
      defense: {
        pressHeight: "high" as const,
        averageTurnoverPosition: { x: 0.8, y: 0.5 },
        pressIntensity: 75,
        recoveryZone: "attacking_third" as const,
        turnoversInAttackingThird: 15,
        turnoversInMiddleThird: 5,
        turnoversInDefensiveThird: 2,
      },
    };

    const summary = generateTacticalSummary(patterns, "ホーム");

    expect(summary).toContain("ハイプレス");
    expect(summary).toContain("高強度プレス");
    expect(summary).toContain("敵陣でのボール奪取");
  });

  it("should include counter-attack information in summary", () => {
    const patterns = {
      team: "home" as const,
      attack: {
        zoneDistribution: { left: 30, center: 40, right: 30 },
        counterAttacks: Array(5).fill({
          turnoverTimestamp: 5,
          shotTimestamp: 10,
          team: "home",
          duration: 5,
        }),
        buildUpSpeed: "fast" as const,
        dominantPattern: "balanced" as const,
        averagePassesPerPossession: 2,
        passCompletionRate: 70,
      },
      defense: {
        pressHeight: "mid" as const,
        averageTurnoverPosition: { x: 0.5, y: 0.5 },
        pressIntensity: 50,
        recoveryZone: "middle_third" as const,
        turnoversInAttackingThird: 5,
        turnoversInMiddleThird: 10,
        turnoversInDefensiveThird: 5,
      },
    };

    const summary = generateTacticalSummary(patterns, "ホーム");

    expect(summary).toContain("カウンター攻撃");
    expect(summary).toContain("5回");
    expect(summary).toContain("速攻型");
  });
});
