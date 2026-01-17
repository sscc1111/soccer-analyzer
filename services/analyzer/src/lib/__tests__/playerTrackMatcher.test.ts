/**
 * Tests for Player Track Matcher
 *
 * trackId → playerId マッピングと同一選手の複数検出マージのテスト
 */

import { describe, it, expect } from "vitest";
import {
  mergePlayerDetections,
  recalculatePlayerConfidence,
  deduplicatePlayers,
  validateJerseyNumberConsistency,
  type RawPlayerDetection,
  type MergedPlayerInfo,
} from "../playerTrackMatcher";

describe("mergePlayerDetections", () => {
  const matchId = "test-match-123";

  it("should merge players with the same jersey number", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
        trackingId: "track-1",
      },
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.9,
        trackingId: "track-2",
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    expect(result.mergedPlayers).toHaveLength(1);
    expect(result.mergedPlayers[0].jerseyNumber).toBe(10);
    expect(result.mergedPlayers[0].trackIds).toHaveLength(2);
    expect(result.mergedPlayers[0].detectionCount).toBe(2);
    // Should use higher confidence
    expect(result.mergedPlayers[0].confidence).toBe(0.9);
    expect(result.mergedPlayers[0].primaryTrackId).toBe("track-2");
  });

  it("should not merge players from different teams", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
      },
      {
        team: "away",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    expect(result.mergedPlayers).toHaveLength(2);
    expect(result.stats.uniquePlayers).toBe(2);
  });

  it("should not merge players with different jersey numbers", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
      },
      {
        team: "home",
        jerseyNumber: 11,
        role: "player",
        confidence: 0.8,
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    expect(result.mergedPlayers).toHaveLength(2);
  });

  it("should merge players without jersey numbers using fallback identifiers", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.5,
        fallbackIdentifiers: {
          bodyType: "tall",
          hairColor: "#000000",
          dominantPosition: "defender",
        },
      },
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.6,
        fallbackIdentifiers: {
          bodyType: "tall",
          hairColor: "#000000",
          dominantPosition: "defender",
        },
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    // Should merge because 3/3 characteristics match
    expect(result.mergedPlayers).toHaveLength(1);
    expect(result.mergedPlayers[0].detectionCount).toBe(2);
  });

  it("should not merge players with insufficient matching characteristics", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.5,
        fallbackIdentifiers: {
          bodyType: "tall",
          hairColor: "#000000",
          dominantPosition: "defender",
        },
      },
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.6,
        fallbackIdentifiers: {
          bodyType: "short",
          hairColor: "#FFFF00",
          dominantPosition: "forward",
        },
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    // Should not merge (0/3 characteristics match)
    expect(result.mergedPlayers).toHaveLength(2);
  });

  it("should merge players using trackingId", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.5,
        trackingId: "track-abc",
      },
      {
        team: "home",
        jerseyNumber: 10, // Later detected jersey number
        role: "player",
        confidence: 0.8,
        trackingId: "track-abc",
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    expect(result.mergedPlayers).toHaveLength(1);
    expect(result.mergedPlayers[0].jerseyNumber).toBe(10); // Should update to non-null value
    expect(result.mergedPlayers[0].confidence).toBe(0.8);
  });

  it("should create correct statistics", () => {
    const detections: RawPlayerDetection[] = [
      { team: "home", jerseyNumber: 10, role: "player", confidence: 0.8 },
      { team: "home", jerseyNumber: 10, role: "player", confidence: 0.9 },
      { team: "home", jerseyNumber: 11, role: "player", confidence: 0.7 },
      { team: "away", jerseyNumber: 5, role: "player", confidence: 0.85 },
      { team: "away", jerseyNumber: null, role: "player", confidence: 0.5 },
    ];

    const result = mergePlayerDetections(detections, matchId);

    expect(result.stats.totalDetections).toBe(5);
    expect(result.stats.uniquePlayers).toBe(4);
    expect(result.stats.mergedDetections).toBe(1); // Two #10 merged into one
    expect(result.stats.withJerseyNumber).toBe(3);
    expect(result.stats.withoutJerseyNumber).toBe(1);
  });

  it("should generate track mappings for all trackIds", () => {
    const detections: RawPlayerDetection[] = [
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
        trackingId: "track-1",
      },
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.9,
        trackingId: "track-2",
      },
    ];

    const result = mergePlayerDetections(detections, matchId);

    // Should create 2 trackMappings (one for each trackId)
    expect(result.trackMappings).toHaveLength(2);
    expect(result.trackMappings[0].trackId).toBe("track-1");
    expect(result.trackMappings[1].trackId).toBe("track-2");
    expect(result.trackMappings[0].jerseyNumber).toBe(10);
    expect(result.trackMappings[1].jerseyNumber).toBe(10);
  });

  it("should set source to roster_match for merged detections", () => {
    const detections: RawPlayerDetection[] = [
      { team: "home", jerseyNumber: 10, role: "player", confidence: 0.8 },
      { team: "home", jerseyNumber: 10, role: "player", confidence: 0.9 },
    ];

    const result = mergePlayerDetections(detections, matchId);

    // Merged detections should have source: roster_match
    expect(result.trackMappings[0].source).toBe("roster_match");
    expect(result.trackMappings[1].source).toBe("roster_match");
  });

  it("should set source to ocr for non-merged detections", () => {
    const detections: RawPlayerDetection[] = [
      { team: "home", jerseyNumber: 10, role: "player", confidence: 0.8 },
    ];

    const result = mergePlayerDetections(detections, matchId);

    expect(result.trackMappings[0].source).toBe("ocr");
  });
});

describe("recalculatePlayerConfidence", () => {
  it("should boost confidence for multiple detections", () => {
    const player: MergedPlayerInfo = {
      team: "home",
      jerseyNumber: 10,
      role: "player",
      confidence: 0.7,
      trackIds: ["track-1", "track-2", "track-3"],
      primaryTrackId: "track-1",
      detectionCount: 3,
    };

    const newConfidence = recalculatePlayerConfidence(player);

    // 0.7 + 0.1 * 2 (detection boost, capped at 0.2) + 0.1 (jersey boost) = 1.0 (capped at 1.0)
    expect(newConfidence).toBeCloseTo(1.0, 5);
  });

  it("should boost confidence for players with jersey numbers", () => {
    const player: MergedPlayerInfo = {
      team: "home",
      jerseyNumber: 10,
      role: "player",
      confidence: 0.6,
      trackIds: ["track-1"],
      primaryTrackId: "track-1",
      detectionCount: 1,
    };

    const newConfidence = recalculatePlayerConfidence(player);

    // 0.6 + 0.1 (jersey boost) = 0.7
    expect(newConfidence).toBeCloseTo(0.7, 1);
  });

  it("should cap confidence at 1.0", () => {
    const player: MergedPlayerInfo = {
      team: "home",
      jerseyNumber: 10,
      role: "player",
      confidence: 0.95,
      trackIds: ["track-1", "track-2"],
      primaryTrackId: "track-1",
      detectionCount: 2,
    };

    const newConfidence = recalculatePlayerConfidence(player);

    expect(newConfidence).toBe(1.0);
  });

  it("should lower confidence when player count mismatch is large", () => {
    const player: MergedPlayerInfo = {
      team: "home",
      jerseyNumber: 10,
      role: "player",
      confidence: 0.8,
      trackIds: ["track-1"],
      primaryTrackId: "track-1",
      detectionCount: 1,
    };

    const newConfidence = recalculatePlayerConfidence(player, {
      expectedPlayerCount: 11,
      detectedPlayerCount: 15, // Gap of 4
    });

    // 0.8 + 0.1 (jersey) - 0.2 (gap penalty) = 0.7
    expect(newConfidence).toBeCloseTo(0.7, 1);
  });

  it("should not lower confidence when player count is close", () => {
    const player: MergedPlayerInfo = {
      team: "home",
      jerseyNumber: 10,
      role: "player",
      confidence: 0.8,
      trackIds: ["track-1"],
      primaryTrackId: "track-1",
      detectionCount: 1,
    };

    const newConfidence = recalculatePlayerConfidence(player, {
      expectedPlayerCount: 11,
      detectedPlayerCount: 12, // Gap of 1
    });

    // 0.8 + 0.1 (jersey) = 0.9 (no gap penalty)
    expect(newConfidence).toBeCloseTo(0.9, 1);
  });
});

describe("deduplicatePlayers", () => {
  it("should deduplicate players with same team and jersey number", () => {
    const players: MergedPlayerInfo[] = [
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
        trackIds: ["track-1"],
        primaryTrackId: "track-1",
        detectionCount: 1,
      },
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.9,
        trackIds: ["track-2"],
        primaryTrackId: "track-2",
        detectionCount: 1,
      },
    ];

    const result = deduplicatePlayers(players);

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9); // Should use higher confidence
    expect(result[0].trackIds).toContain("track-1");
    expect(result[0].trackIds).toContain("track-2");
    expect(result[0].detectionCount).toBe(2);
  });

  it("should not deduplicate players with null jersey numbers", () => {
    const players: MergedPlayerInfo[] = [
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.5,
        trackIds: ["track-1"],
        primaryTrackId: "track-1",
        detectionCount: 1,
      },
      {
        team: "home",
        jerseyNumber: null,
        role: "player",
        confidence: 0.6,
        trackIds: ["track-2"],
        primaryTrackId: "track-2",
        detectionCount: 1,
      },
    ];

    const result = deduplicatePlayers(players);

    expect(result).toHaveLength(2); // Should not merge
  });

  it("should not deduplicate players from different teams", () => {
    const players: MergedPlayerInfo[] = [
      {
        team: "home",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
        trackIds: ["track-1"],
        primaryTrackId: "track-1",
        detectionCount: 1,
      },
      {
        team: "away",
        jerseyNumber: 10,
        role: "player",
        confidence: 0.8,
        trackIds: ["track-2"],
        primaryTrackId: "track-2",
        detectionCount: 1,
      },
    ];

    const result = deduplicatePlayers(players);

    expect(result).toHaveLength(2);
  });
});

describe("validateJerseyNumberConsistency", () => {
  it("should validate consistent jersey numbers", () => {
    const mappings = [
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: 10,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
      {
        trackId: "track-2",
        playerId: null,
        jerseyNumber: 11,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
    ];

    const result = validateJerseyNumberConsistency(mappings);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("should detect inconsistent jersey numbers for same trackId", () => {
    const mappings = [
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: 10,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: 11,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
    ];

    const result = validateJerseyNumberConsistency(mappings);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].trackId).toBe("track-1");
    expect(result.issues[0].jerseyNumbers).toContain(10);
    expect(result.issues[0].jerseyNumbers).toContain(11);
  });

  it("should ignore null jersey numbers in consistency check", () => {
    const mappings = [
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: 10,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: null,
        ocrConfidence: 0.3,
        source: "ocr" as const,
        needsReview: true,
      },
    ];

    const result = validateJerseyNumberConsistency(mappings);

    expect(result.valid).toBe(true); // null is ignored
  });

  it("should validate multiple trackIds with different jersey numbers", () => {
    const mappings = [
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: 10,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
      {
        trackId: "track-2",
        playerId: null,
        jerseyNumber: 11,
        ocrConfidence: 0.8,
        source: "ocr" as const,
        needsReview: false,
      },
      {
        trackId: "track-1",
        playerId: null,
        jerseyNumber: 10,
        ocrConfidence: 0.9,
        source: "ocr" as const,
        needsReview: false,
      },
    ];

    const result = validateJerseyNumberConsistency(mappings);

    expect(result.valid).toBe(true); // Same trackId with same jersey number is OK
  });
});
