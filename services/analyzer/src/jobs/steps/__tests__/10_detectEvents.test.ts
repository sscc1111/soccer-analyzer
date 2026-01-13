/**
 * Integration tests for Step 10: Detect Events
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { stepDetectEvents } from "../10_detectEvents";
import {
  createTrackDoc,
  createBallTrackDoc,
  createTrackTeamMeta,
  createTrackPlayerMapping,
} from "../../../lib/testHelpers";
import type { DetectedEvents } from "../../../detection/events";

// ============================================================================
// Mock Firestore
// ============================================================================

let mockMatchData: any = {};
let mockTracksData: any[] = [];
let mockBallTrackData: any = null;

const createMockDb = () => {
  const mockBatch = {
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };

  const mockCollectionGet = vi.fn((name: string) => {
    if (name === "tracks") {
      return Promise.resolve({
        docs: mockTracksData.map((d) => ({ data: () => d })),
      });
    }
    if (name === "trackTeamMetas") {
      return Promise.resolve({
        docs: mockTracksData.map((d) => ({
          id: d.trackId,
          data: () => createTrackTeamMeta(d.trackId, "home"),
        })),
      });
    }
    if (name === "trackMappings") {
      return Promise.resolve({
        docs: mockTracksData.map((d) => ({
          id: d.trackId,
          data: () => createTrackPlayerMapping(d.trackId, `player-${d.trackId}`),
        })),
      });
    }
    return Promise.resolve({ docs: [] });
  });

  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => mockMatchData,
        }),
        collection: vi.fn((name: string) => ({
          doc: vi.fn(() => ({
            set: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue({
              exists: !!mockBallTrackData,
              data: () => mockBallTrackData,
            }),
          })),
          get: () => mockCollectionGet(name),
        })),
      })),
    })),
    batch: vi.fn(() => mockBatch),
  };
};

vi.mock("../../../firebase/admin", () => ({
  getDb: vi.fn(() => createMockDb()),
}));

// Mock event detection
const mockDetectedEvents: DetectedEvents = {
  possessionSegments: [
    {
      trackId: "track-1",
      playerId: "player-1",
      teamId: "home",
      startFrame: 0,
      endFrame: 30,
      startTime: 0,
      endTime: 1,
      confidence: 0.9,
      endReason: "pass",
    },
  ],
  passEvents: [
    {
      eventId: "pass-1",
      matchId: "test-match",
      type: "pass",
      frameNumber: 30,
      timestamp: 1,
      kicker: {
        trackId: "track-1",
        playerId: "player-1",
        teamId: "home",
        position: { x: 0.3, y: 0.5 },
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

vi.mock("../../../detection/events", () => ({
  detectAllEvents: vi.fn(() => mockDetectedEvents),
  extractPendingReviews: vi.fn(() => []),
  convertTracksForDetection: vi.fn((tracks) =>
    tracks.map((t: any) => ({
      trackId: t.trackId,
      frames: new Map(t.frames.map((f: any) => [f.frameNumber, f])),
      teamId: "home",
      playerId: null,
    }))
  ),
  convertBallForDetection: vi.fn((detections) => ({
    frames: new Map(detections.map((d: any) => [d.frameNumber, d])),
  })),
  DEFAULT_EVENT_CONFIG: {
    possessionDistanceThreshold: 0.05,
    minPossessionFrames: 5,
    minCarryDistance: 0.05,
    reviewThreshold: 0.6,
    fps: 30,
  },
}));

// ============================================================================
// Tests
// ============================================================================

describe("stepDetectEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchData = { settings: {} };
    mockTracksData = [createTrackDoc({ trackId: "track-1" })];
    mockBallTrackData = createBallTrackDoc();
  });

  it("should detect events from tracking data", async () => {
    const result = await stepDetectEvents({
      matchId: "test-match",
      version: "1.0.0",
    });

    expect(result.matchId).toBe("test-match");
    expect(result.possessionCount).toBe(1);
    expect(result.passCount).toBe(1);
  });

  it("should handle insufficient data gracefully", async () => {
    mockTracksData = [];
    mockBallTrackData = null;

    const result = await stepDetectEvents({
      matchId: "test-match",
      version: "1.0.0",
    });

    expect(result.possessionCount).toBe(0);
    expect(result.passCount).toBe(0);
  });

  it("should handle no ball track scenario", async () => {
    mockBallTrackData = null;

    const result = await stepDetectEvents({
      matchId: "test-match",
      version: "1.0.0",
    });

    expect(result.possessionCount).toBe(0);
  });
});
