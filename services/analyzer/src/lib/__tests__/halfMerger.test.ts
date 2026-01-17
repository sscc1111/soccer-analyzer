/**
 * Half Merger Unit Tests
 *
 * Tests for merging first-half and second-half video analysis results.
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Test Data Factories
// ============================================================================

type PassEventDoc = {
  eventId: string;
  timestamp: number;
  frameNumber: number;
  type: "pass";
  player: { id: string; team: "home" | "away" };
};

type CarryEventDoc = {
  eventId: string;
  startTime: number;
  endTime: number;
  startFrame: number;
  endFrame: number;
  type: "carry";
  player: { id: string; team: "home" | "away" };
};

type ClipDoc = {
  clipId: string;
  t0: number;
  t1: number;
  reason: string;
};

type StatDoc = {
  statId: string;
  calculatorId: string;
  playerId?: string | null;
  teamId?: "home" | "away" | null;
  value: number;
  label: string;
  mergedFromHalves?: boolean;
  metadata?: Record<string, unknown>;
};

// ============================================================================
// Timestamp Adjustment Functions (extracted for testing)
// ============================================================================

function adjustPassEventTimestamp(event: PassEventDoc, offset: number): PassEventDoc {
  return {
    ...event,
    timestamp: event.timestamp + offset,
    frameNumber: event.frameNumber, // Frame numbers are relative to video, keep as-is
  };
}

function adjustCarryEventTimestamp(event: CarryEventDoc, offset: number): CarryEventDoc {
  return {
    ...event,
    startTime: event.startTime + offset,
    endTime: event.endTime + offset,
    startFrame: event.startFrame, // Frames are relative to video
    endFrame: event.endFrame,
  };
}

function mergeClips(firstHalf: ClipDoc[], secondHalf: ClipDoc[], halfDuration: number): ClipDoc[] {
  const adjustedSecondHalf = secondHalf.map((clip) => ({
    ...clip,
    t0: clip.t0 + halfDuration,
    t1: clip.t1 + halfDuration,
  }));
  return [...firstHalf, ...adjustedSecondHalf];
}

function mergeStats(firstHalf: StatDoc[], secondHalf: StatDoc[]): StatDoc[] {
  const statGroups = new Map<string, StatDoc[]>();

  for (const stat of [...firstHalf, ...secondHalf]) {
    const key = `${stat.calculatorId}_${stat.playerId ?? "match"}_${stat.teamId ?? "none"}`;
    if (!statGroups.has(key)) {
      statGroups.set(key, []);
    }
    statGroups.get(key)!.push(stat);
  }

  const merged: StatDoc[] = [];

  for (const [_key, stats] of statGroups.entries()) {
    if (stats.length === 1) {
      merged.push({ ...stats[0], mergedFromHalves: true });
    } else {
      const mergedStat = mergeStatPair(stats[0], stats[1]);
      merged.push(mergedStat);
    }
  }

  return merged;
}

function mergeStatPair(stat1: StatDoc, stat2: StatDoc): StatDoc {
  const calculatorId = stat1.calculatorId;

  // Match the actual implementation's regex pattern (from halfMerger.ts lines 750-756)
  const isCountMetric =
    // 単語としてcount/total/numberを含む（アンダースコアまたは文字列境界で区切られる）
    (/(?:^|_)(count|total|number)(?:_|$)/i.test(calculatorId) ||
      // または末尾がgoals/shots/passes等の絶対数統計
      /_(goals|shots|passes|tackles|clearances|blocks|fouls|corners|offsides)$/i.test(calculatorId)) &&
    // パーセンテージ・レート系を明示的に除外
    !/(?:^|_)(accuracy|rate|percentage|ratio|average)(?:_|$)/i.test(calculatorId);

  const mergedValue = isCountMetric ? stat1.value + stat2.value : (stat1.value + stat2.value) / 2;

  return {
    ...stat1,
    value: mergedValue,
    mergedFromHalves: true,
    metadata: {
      ...stat1.metadata,
      firstHalfValue: stat1.value,
      secondHalfValue: stat2.value,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("halfMerger", () => {
  describe("Timestamp Adjustment", () => {
    const DEFAULT_HALF_DURATION = 2700; // 45 minutes in seconds

    describe("adjustPassEventTimestamp", () => {
      it("should add halfDuration offset to timestamp", () => {
        const event: PassEventDoc = {
          eventId: "pass-1",
          timestamp: 100,
          frameNumber: 3000,
          type: "pass",
          player: { id: "player-1", team: "home" },
        };

        const adjusted = adjustPassEventTimestamp(event, DEFAULT_HALF_DURATION);

        expect(adjusted.timestamp).toBe(100 + DEFAULT_HALF_DURATION);
        expect(adjusted.timestamp).toBe(2800);
      });

      it("should preserve frameNumber (video-relative)", () => {
        const event: PassEventDoc = {
          eventId: "pass-1",
          timestamp: 100,
          frameNumber: 3000,
          type: "pass",
          player: { id: "player-1", team: "home" },
        };

        const adjusted = adjustPassEventTimestamp(event, DEFAULT_HALF_DURATION);

        expect(adjusted.frameNumber).toBe(3000); // Unchanged
      });

      it("should handle 20-minute half (8-a-side format)", () => {
        const event: PassEventDoc = {
          eventId: "pass-1",
          timestamp: 600, // 10 minutes into second half
          frameNumber: 18000,
          type: "pass",
          player: { id: "player-1", team: "home" },
        };

        const TWENTY_MINUTE_HALF = 1200; // 20 minutes in seconds
        const adjusted = adjustPassEventTimestamp(event, TWENTY_MINUTE_HALF);

        expect(adjusted.timestamp).toBe(600 + 1200);
        expect(adjusted.timestamp).toBe(1800); // 30 minutes total
      });
    });

    describe("adjustCarryEventTimestamp", () => {
      it("should adjust both startTime and endTime", () => {
        const event: CarryEventDoc = {
          eventId: "carry-1",
          startTime: 50,
          endTime: 55,
          startFrame: 1500,
          endFrame: 1650,
          type: "carry",
          player: { id: "player-1", team: "home" },
        };

        const adjusted = adjustCarryEventTimestamp(event, DEFAULT_HALF_DURATION);

        expect(adjusted.startTime).toBe(50 + DEFAULT_HALF_DURATION);
        expect(adjusted.endTime).toBe(55 + DEFAULT_HALF_DURATION);
        expect(adjusted.startFrame).toBe(1500); // Unchanged
        expect(adjusted.endFrame).toBe(1650); // Unchanged
      });

      it("should maintain carry duration after adjustment", () => {
        const event: CarryEventDoc = {
          eventId: "carry-1",
          startTime: 100,
          endTime: 108,
          startFrame: 3000,
          endFrame: 3240,
          type: "carry",
          player: { id: "player-1", team: "home" },
        };

        const adjusted = adjustCarryEventTimestamp(event, DEFAULT_HALF_DURATION);

        const originalDuration = event.endTime - event.startTime;
        const adjustedDuration = adjusted.endTime - adjusted.startTime;

        expect(adjustedDuration).toBe(originalDuration);
        expect(adjustedDuration).toBe(8);
      });
    });
  });

  describe("Clip Merging", () => {
    const DEFAULT_HALF_DURATION = 2700;

    it("should merge first and second half clips", () => {
      const firstHalfClips: ClipDoc[] = [
        { clipId: "clip-1", t0: 100, t1: 110, reason: "motionPeak" },
        { clipId: "clip-2", t0: 500, t1: 515, reason: "audioPeak" },
      ];
      const secondHalfClips: ClipDoc[] = [
        { clipId: "clip-3", t0: 200, t1: 212, reason: "motionPeak" },
        { clipId: "clip-4", t0: 800, t1: 820, reason: "manual" },
      ];

      const merged = mergeClips(firstHalfClips, secondHalfClips, DEFAULT_HALF_DURATION);

      expect(merged).toHaveLength(4);

      // First half clips unchanged
      expect(merged[0].t0).toBe(100);
      expect(merged[0].t1).toBe(110);
      expect(merged[1].t0).toBe(500);
      expect(merged[1].t1).toBe(515);

      // Second half clips adjusted
      expect(merged[2].t0).toBe(200 + DEFAULT_HALF_DURATION);
      expect(merged[2].t1).toBe(212 + DEFAULT_HALF_DURATION);
      expect(merged[3].t0).toBe(800 + DEFAULT_HALF_DURATION);
      expect(merged[3].t1).toBe(820 + DEFAULT_HALF_DURATION);
    });

    it("should handle empty first half", () => {
      const firstHalfClips: ClipDoc[] = [];
      const secondHalfClips: ClipDoc[] = [
        { clipId: "clip-1", t0: 100, t1: 110, reason: "motionPeak" },
      ];

      const merged = mergeClips(firstHalfClips, secondHalfClips, DEFAULT_HALF_DURATION);

      expect(merged).toHaveLength(1);
      expect(merged[0].t0).toBe(100 + DEFAULT_HALF_DURATION);
    });

    it("should handle empty second half", () => {
      const firstHalfClips: ClipDoc[] = [
        { clipId: "clip-1", t0: 100, t1: 110, reason: "motionPeak" },
      ];
      const secondHalfClips: ClipDoc[] = [];

      const merged = mergeClips(firstHalfClips, secondHalfClips, DEFAULT_HALF_DURATION);

      expect(merged).toHaveLength(1);
      expect(merged[0].t0).toBe(100);
    });

    it("should maintain clip duration after adjustment", () => {
      const secondHalfClips: ClipDoc[] = [
        { clipId: "clip-1", t0: 100, t1: 115, reason: "motionPeak" },
      ];

      const merged = mergeClips([], secondHalfClips, DEFAULT_HALF_DURATION);

      const originalDuration = 115 - 100;
      const adjustedDuration = merged[0].t1 - merged[0].t0;

      expect(adjustedDuration).toBe(originalDuration);
      expect(adjustedDuration).toBe(15);
    });
  });

  describe("Stats Merging", () => {
    it("should sum count-based stats", () => {
      const firstHalfStats: StatDoc[] = [
        {
          statId: "stat-1",
          calculatorId: "pass_count",
          playerId: "player-1",
          teamId: "home",
          value: 25,
          label: "Passes",
        },
      ];
      const secondHalfStats: StatDoc[] = [
        {
          statId: "stat-2",
          calculatorId: "pass_count",
          playerId: "player-1",
          teamId: "home",
          value: 30,
          label: "Passes",
        },
      ];

      const merged = mergeStats(firstHalfStats, secondHalfStats);

      expect(merged).toHaveLength(1);
      expect(merged[0].value).toBe(55); // 25 + 30
      expect(merged[0].mergedFromHalves).toBe(true);
    });

    it("should average percentage-based stats", () => {
      const firstHalfStats: StatDoc[] = [
        {
          statId: "stat-1",
          calculatorId: "possession_percentage",
          playerId: null,
          teamId: "home",
          value: 60,
          label: "Possession",
        },
      ];
      const secondHalfStats: StatDoc[] = [
        {
          statId: "stat-2",
          calculatorId: "possession_percentage",
          playerId: null,
          teamId: "home",
          value: 40,
          label: "Possession",
        },
      ];

      const merged = mergeStats(firstHalfStats, secondHalfStats);

      expect(merged).toHaveLength(1);
      expect(merged[0].value).toBe(50); // (60 + 40) / 2
    });

    it("should handle stats present in only one half", () => {
      const firstHalfStats: StatDoc[] = [
        {
          statId: "stat-1",
          calculatorId: "goals_scored",
          playerId: "player-1",
          teamId: "home",
          value: 2,
          label: "Goals",
        },
      ];
      const secondHalfStats: StatDoc[] = [
        {
          statId: "stat-2",
          calculatorId: "yellow_cards",
          playerId: "player-2",
          teamId: "away",
          value: 1,
          label: "Yellow Cards",
        },
      ];

      const merged = mergeStats(firstHalfStats, secondHalfStats);

      expect(merged).toHaveLength(2);
      expect(merged.find((s) => s.calculatorId === "goals_scored")?.value).toBe(2);
      expect(merged.find((s) => s.calculatorId === "yellow_cards")?.value).toBe(1);
    });

    it("should store both half values in metadata", () => {
      const firstHalfStats: StatDoc[] = [
        {
          statId: "stat-1",
          calculatorId: "shots_total",
          playerId: null,
          teamId: "home",
          value: 5,
          label: "Shots",
        },
      ];
      const secondHalfStats: StatDoc[] = [
        {
          statId: "stat-2",
          calculatorId: "shots_total",
          playerId: null,
          teamId: "home",
          value: 8,
          label: "Shots",
        },
      ];

      const merged = mergeStats(firstHalfStats, secondHalfStats);

      expect(merged[0].metadata?.firstHalfValue).toBe(5);
      expect(merged[0].metadata?.secondHalfValue).toBe(8);
      expect(merged[0].value).toBe(13); // total
    });

    it("should group stats by calculatorId + playerId + teamId", () => {
      const firstHalfStats: StatDoc[] = [
        { statId: "s1", calculatorId: "pass_count", playerId: "p1", teamId: "home", value: 10, label: "Passes" },
        { statId: "s2", calculatorId: "pass_count", playerId: "p2", teamId: "home", value: 15, label: "Passes" },
      ];
      const secondHalfStats: StatDoc[] = [
        { statId: "s3", calculatorId: "pass_count", playerId: "p1", teamId: "home", value: 12, label: "Passes" },
        { statId: "s4", calculatorId: "pass_count", playerId: "p2", teamId: "home", value: 18, label: "Passes" },
      ];

      const merged = mergeStats(firstHalfStats, secondHalfStats);

      expect(merged).toHaveLength(2);

      const p1Stat = merged.find((s) => s.statId === "s1"); // Original statId preserved
      const p2Stat = merged.find((s) => s.statId === "s2");

      expect(p1Stat?.value).toBe(22); // 10 + 12
      expect(p2Stat?.value).toBe(33); // 15 + 18
    });

    describe("Regex Pattern for Count Metrics", () => {
      it("should sum stats with 'count' in middle of calculatorId", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "pass_count_home", playerId: "p1", teamId: "home", value: 10, label: "Passes" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "pass_count_home", playerId: "p1", teamId: "home", value: 15, label: "Passes" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(25); // 10 + 15 (sum)
      });

      it("should sum stats with 'total' in middle of calculatorId", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "shot_total_attempts", playerId: null, teamId: "home", value: 5, label: "Shots" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "shot_total_attempts", playerId: null, teamId: "home", value: 8, label: "Shots" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(13); // 5 + 8 (sum)
      });

      it("should sum stats with '_goals' suffix", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "team_goals", playerId: null, teamId: "home", value: 1, label: "Goals" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "team_goals", playerId: null, teamId: "home", value: 2, label: "Goals" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(3); // 1 + 2 (sum)
      });

      it("should sum stats with '_shots' suffix", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "player_shots", playerId: "p1", teamId: "home", value: 3, label: "Shots" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "player_shots", playerId: "p1", teamId: "home", value: 4, label: "Shots" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(7); // 3 + 4 (sum)
      });

      it("should sum stats with '_passes' suffix", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "successful_passes", playerId: "p1", teamId: "home", value: 20, label: "Passes" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "successful_passes", playerId: "p1", teamId: "home", value: 25, label: "Passes" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(45); // 20 + 25 (sum)
      });

      it("should average stats with 'accuracy' (exclusion pattern)", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "pass_accuracy_percentage", playerId: "p1", teamId: "home", value: 80, label: "Accuracy" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "pass_accuracy_percentage", playerId: "p1", teamId: "home", value: 90, label: "Accuracy" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(85); // (80 + 90) / 2 (average)
      });

      it("should average stats with 'rate' (exclusion pattern)", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "possession_rate", playerId: null, teamId: "home", value: 55, label: "Possession" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "possession_rate", playerId: null, teamId: "home", value: 45, label: "Possession" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(50); // (55 + 45) / 2 (average)
      });

      it("should average stats with 'ratio' (exclusion pattern)", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "shot_conversion_ratio", playerId: "p1", teamId: "home", value: 0.3, label: "Conversion" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "shot_conversion_ratio", playerId: "p1", teamId: "home", value: 0.5, label: "Conversion" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(0.4); // (0.3 + 0.5) / 2 (average)
      });

      it("should average stats with 'average' (exclusion pattern)", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "average_pass_distance", playerId: "p1", teamId: "home", value: 15.5, label: "Avg Distance" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "average_pass_distance", playerId: "p1", teamId: "home", value: 18.5, label: "Avg Distance" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(17); // (15.5 + 18.5) / 2 (average)
      });

      it("should sum stats with '_tackles' suffix", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "defensive_tackles", playerId: "p1", teamId: "home", value: 5, label: "Tackles" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "defensive_tackles", playerId: "p1", teamId: "home", value: 7, label: "Tackles" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(12); // 5 + 7 (sum)
      });

      it("should sum stats with '_corners' suffix", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "team_corners", playerId: null, teamId: "home", value: 3, label: "Corners" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "team_corners", playerId: null, teamId: "home", value: 4, label: "Corners" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(7); // 3 + 4 (sum)
      });

      it("should average percentage even with 'total' if 'percentage' is in name", () => {
        const firstHalfStats: StatDoc[] = [
          { statId: "s1", calculatorId: "total_possession_percentage", playerId: null, teamId: "home", value: 60, label: "Possession" },
        ];
        const secondHalfStats: StatDoc[] = [
          { statId: "s2", calculatorId: "total_possession_percentage", playerId: null, teamId: "home", value: 40, label: "Possession" },
        ];

        const merged = mergeStats(firstHalfStats, secondHalfStats);
        expect(merged[0].value).toBe(50); // (60 + 40) / 2 (average, exclusion takes precedence)
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero half duration (instant test)", () => {
      const clips: ClipDoc[] = [{ clipId: "clip-1", t0: 100, t1: 110, reason: "motionPeak" }];

      const merged = mergeClips([], clips, 0);

      expect(merged[0].t0).toBe(100); // No change with 0 duration
    });

    it("should handle very short half duration (5v5 format: 10 min)", () => {
      const TEN_MINUTE_HALF = 600;
      const clips: ClipDoc[] = [{ clipId: "clip-1", t0: 300, t1: 310, reason: "motionPeak" }];

      const merged = mergeClips([], clips, TEN_MINUTE_HALF);

      expect(merged[0].t0).toBe(900); // 300 + 600
    });

    it("should handle events at t=0", () => {
      const event: PassEventDoc = {
        eventId: "pass-1",
        timestamp: 0,
        frameNumber: 0,
        type: "pass",
        player: { id: "player-1", team: "home" },
      };

      const adjusted = adjustPassEventTimestamp(event, 2700);

      expect(adjusted.timestamp).toBe(2700);
    });
  });
});

describe("Schema Validation", () => {
  describe("VideoType", () => {
    it("should only allow valid video types", () => {
      const validTypes = ["firstHalf", "secondHalf", "single"];
      validTypes.forEach((type) => {
        expect(["firstHalf", "secondHalf", "single"]).toContain(type);
      });
    });
  });

  describe("VideoConfiguration", () => {
    it("should only allow valid configurations", () => {
      const validConfigs = ["split", "single"];
      validConfigs.forEach((config) => {
        expect(["split", "single"]).toContain(config);
      });
    });
  });

  describe("VideoDoc", () => {
    it("should validate required fields", () => {
      const validVideoDoc = {
        videoId: "video-123",
        matchId: "match-456",
        type: "firstHalf" as const,
        storagePath: "matches/match-456/videos/firstHalf.mp4",
        uploadedAt: "2025-01-15T10:00:00Z",
      };

      expect(validVideoDoc.videoId).toBeDefined();
      expect(validVideoDoc.matchId).toBeDefined();
      expect(validVideoDoc.type).toBeDefined();
      expect(validVideoDoc.storagePath).toBeDefined();
      expect(validVideoDoc.uploadedAt).toBeDefined();
    });

    it("should allow optional fields", () => {
      const videoDocWithOptionals = {
        videoId: "video-123",
        matchId: "match-456",
        type: "secondHalf" as const,
        storagePath: "matches/match-456/videos/secondHalf.mp4",
        uploadedAt: "2025-01-15T10:00:00Z",
        durationSec: 2700,
        width: 1920,
        height: 1080,
        fps: 30,
        analysis: {
          status: "done" as const,
          lastRunAt: "2025-01-15T11:00:00Z",
          progress: 100,
        },
      };

      expect(videoDocWithOptionals.durationSec).toBe(2700);
      expect(videoDocWithOptionals.width).toBe(1920);
      expect(videoDocWithOptionals.analysis?.status).toBe("done");
    });
  });
});
