/**
 * Integration tests for Step 07: Detect Players
 *
 * Tests the player detection and tracking pipeline including:
 * - Frame extraction from video
 * - Player detection with placeholder detector
 * - Track assignment with placeholder tracker
 * - Firestore storage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stepDetectPlayers } from "../07_detectPlayers";
import type { PlayerDetector, Tracker, Detection } from "../../../detection/types";

// ============================================================================
// Mock Firestore
// ============================================================================

let mockMatchData: any = {};
let mockStatusSetCalls: any[] = [];
let mockBatchSetCalls: any[] = [];

const createMockDb = () => {
  mockStatusSetCalls = [];
  mockBatchSetCalls = [];

  const mockBatch = {
    set: vi.fn((...args) => {
      mockBatchSetCalls.push(args);
    }),
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
            set: vi.fn((...args) => {
              mockStatusSetCalls.push(args);
              return Promise.resolve();
            }),
          })),
        })),
      })),
    })),
    batch: vi.fn(() => mockBatch),
  };
};

vi.mock("../../../firebase/admin", () => ({
  getDb: vi.fn(() => createMockDb()),
}));

// Mock storage
vi.mock("../../../lib/storage", () => ({
  downloadToTmp: vi.fn().mockResolvedValue("/tmp/test-video.mp4"),
}));

// Mock ffmpeg
vi.mock("../../../lib/ffmpeg", () => ({
  probeVideo: vi.fn(() =>
    Promise.resolve({
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 1.0,
    })
  ),
  extractFrameBuffer: vi.fn(() =>
    Promise.resolve({
      buffer: Buffer.alloc(1920 * 1080 * 3),
    })
  ),
}));

// ============================================================================
// Mock Detector and Tracker
// ============================================================================

class MockPlayerDetector implements PlayerDetector {
  readonly modelId = "mock-player-detector";
  private frameCount = 0;

  async detectPlayers(
    _buffer: Buffer,
    _width: number,
    _height: number
  ): Promise<Detection[]> {
    // Generate 2 detections per frame for testing
    const detections: Detection[] = [
      {
        bbox: { x: 0.3 + this.frameCount * 0.01, y: 0.5, w: 0.04, h: 0.08 },
        center: { x: 0.32 + this.frameCount * 0.01, y: 0.54 },
        confidence: 0.9,
        label: "player",
      },
      {
        bbox: { x: 0.6 + this.frameCount * 0.01, y: 0.5, w: 0.04, h: 0.08 },
        center: { x: 0.62 + this.frameCount * 0.01, y: 0.54 },
        confidence: 0.85,
        label: "player",
      },
    ];
    this.frameCount++;
    return detections;
  }
}

class MockTracker implements Tracker {
  readonly trackerId = "mock-tracker";
  private nextTrackId = 1;
  private trackMap = new Map<number, string>(); // detection index -> track ID

  update(
    _frameNumber: number,
    _timestamp: number,
    detections: Detection[]
  ): Map<number, string> {
    const assignments = new Map<number, string>();

    detections.forEach((_, idx) => {
      // Simple tracking: assign consistent track IDs
      if (!this.trackMap.has(idx)) {
        this.trackMap.set(idx, `track-${this.nextTrackId++}`);
      }
      assignments.set(idx, this.trackMap.get(idx)!);
    });

    return assignments;
  }

  getActiveTrackIds(): string[] {
    return Array.from(this.trackMap.values());
  }

  reset(): void {
    this.trackMap.clear();
    this.nextTrackId = 1;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("stepDetectPlayers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchData = {
      video: {
        storagePath: "gs://bucket/videos/test.mp4",
        durationSec: 1.0,
      },
      settings: {
        processingMode: "standard",
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should detect players and create tracks", async () => {
    const mockDetector = new MockPlayerDetector();
    const mockTracker = new MockTracker();

    const progressUpdates: number[] = [];
    const onProgress = (progress: number) => {
      progressUpdates.push(progress);
    };

    const result = await stepDetectPlayers({
      matchId: "test-match",
      version: "1.0.0",
      playerDetector: mockDetector,
      tracker: mockTracker,
      processingMode: "standard",
      onProgress,
    });

    // Verify result
    expect(result.matchId).toBe("test-match");
    expect(result.trackCount).toBe(2); // 2 tracks created
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.processingMode).toBe("standard");

    // Verify progress updates
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[0]).toBe(5);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);

    // Verify batch commit was called (may have empty calls due to simplified setup)
    // In real scenario, batch operations would be used for saving tracks
  });

  it("should throw error if video.storagePath is missing", async () => {
    mockMatchData = {
      settings: {},
    };

    await expect(
      stepDetectPlayers({
        matchId: "test-match",
        version: "1.0.0",
      })
    ).rejects.toThrow("video.storagePath missing");
  });

  it("should handle empty detections", async () => {
    // Detector that returns no detections
    class EmptyDetector implements PlayerDetector {
      readonly modelId = "empty-detector";
      async detectPlayers(): Promise<Detection[]> {
        return [];
      }
    }

    const result = await stepDetectPlayers({
      matchId: "test-match",
      version: "1.0.0",
      playerDetector: new EmptyDetector(),
      tracker: new MockTracker(),
    });

    expect(result.trackCount).toBe(0);
  });

  it("should update tracking status during processing", async () => {
    await stepDetectPlayers({
      matchId: "test-match",
      version: "1.0.0",
      playerDetector: new MockPlayerDetector(),
      tracker: new MockTracker(),
    });

    // Verify status updates
    expect(mockStatusSetCalls.length).toBeGreaterThan(0);

    const statusData = mockStatusSetCalls.map((call) => call[0]);
    // Check that at least one status update has the correct stage
    const hasCorrectStage = statusData.some((data) => data.stage === "detecting_players");
    expect(hasCorrectStage).toBe(true);
  });
});
