/**
 * Integration tests for Step 08: Classify Teams
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { stepClassifyTeams } from "../08_classifyTeams";
import { createTrackDoc } from "../../../lib/testHelpers";

// ============================================================================
// Mock Firestore
// ============================================================================

let mockMatchData: any = {};
let mockTracksData: any[] = [];

const createMockDb = () => {
  const mockBatch = {
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };

  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => mockMatchData,
        }),
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            set: vi.fn().mockResolvedValue(undefined),
          })),
          get: vi.fn().mockResolvedValue({
            docs: mockTracksData.map((d) => ({ data: () => d })),
          }),
        })),
      })),
    })),
    batch: vi.fn(() => mockBatch),
  };
};

vi.mock("../../../firebase/admin", () => ({
  getDb: vi.fn(() => createMockDb()),
}));

vi.mock("../../../lib/storage", () => ({
  downloadToTmp: vi.fn().mockResolvedValue("/tmp/test.mp4"),
}));

vi.mock("../../../lib/ffmpeg", () => ({
  probeVideo: vi.fn().mockResolvedValue({
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 1.0,
  }),
  extractFrameBuffer: vi.fn().mockResolvedValue({
    buffer: Buffer.alloc(1920 * 1080 * 3),
  }),
}));

vi.mock("../../../detection/colorClustering", () => ({
  extractDominantColor: vi.fn(() => ({ r: 200, g: 50, b: 50 })),
  classifyTeamsByColor: vi.fn(() => ({
    assignments: new Map([
      ["track-1", "home"],
      ["track-2", "away"],
    ]),
    confidence: 0.85,
    detectedColors: { home: "#FF0000", away: "#0000FF" },
    clusters: [],
  })),
  DEFAULT_KMEANS_CONFIG: { k: 2, maxIterations: 100 },
}));

// ============================================================================
// Tests
// ============================================================================

describe("stepClassifyTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchData = {
      video: {
        storagePath: "gs://bucket/test.mp4",
        durationSec: 1.0,
      },
      settings: {},
    };
    mockTracksData = [
      createTrackDoc({ trackId: "track-1" }),
      createTrackDoc({ trackId: "track-2" }),
    ];
  });

  it("should classify teams from tracks", async () => {
    const result = await stepClassifyTeams({
      matchId: "test-match",
      version: "1.0.0",
      samplesPerTrack: 3,
    });

    expect(result.matchId).toBe("test-match");
    expect(result.classifiedCount).toBe(2);
    expect(result.confidence).toBe(0.85);
  });

  it("should throw error if video.storagePath is missing", async () => {
    mockMatchData = { settings: {} };

    await expect(
      stepClassifyTeams({
        matchId: "test-match",
        version: "1.0.0",
      })
    ).rejects.toThrow("video.storagePath missing");
  });

  it("should handle no tracks scenario", async () => {
    mockTracksData = [];

    const result = await stepClassifyTeams({
      matchId: "test-match",
      version: "1.0.0",
    });

    expect(result.classifiedCount).toBe(0);
  });
});
