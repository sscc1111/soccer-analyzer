/**
 * Integration tests for Step 09: Detect Ball
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { stepDetectBall } from "../09_detectBall";
import type { BallDetector, Detection } from "../../../detection/types";

// ============================================================================
// Mock Firestore
// ============================================================================

let mockMatchData: any = {};

const createMockDb = () => ({
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
      })),
    })),
  })),
});

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

// ============================================================================
// Mock Ball Detector
// ============================================================================

class MockBallDetector implements BallDetector {
  readonly modelId = "mock-ball-detector";
  private frameCount = 0;

  async detectBall(): Promise<Detection | null> {
    this.frameCount++;
    const x = 0.3 + (this.frameCount * 0.02);

    return {
      bbox: { x: x - 0.01, y: 0.49, w: 0.02, h: 0.02 },
      center: { x, y: 0.5 },
      confidence: 0.9,
      label: "ball",
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("stepDetectBall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchData = {
      video: {
        storagePath: "gs://bucket/test.mp4",
        durationSec: 1.0,
      },
      settings: {},
    };
  });

  it("should detect ball and create ball track", async () => {
    const result = await stepDetectBall({
      matchId: "test-match",
      version: "1.0.0",
      ballDetector: new MockBallDetector(),
    });

    expect(result.matchId).toBe("test-match");
    expect(result.detectionCount).toBeGreaterThan(0);
    expect(result.visibleCount).toBeGreaterThan(0);
  });

  it("should throw error if video.storagePath is missing", async () => {
    mockMatchData = { settings: {} };

    await expect(
      stepDetectBall({
        matchId: "test-match",
        version: "1.0.0",
      })
    ).rejects.toThrow("video.storagePath missing");
  });

  it("should handle all invisible ball detections", async () => {
    class InvisibleDetector implements BallDetector {
      readonly modelId = "invisible-detector";
      async detectBall(): Promise<Detection | null> {
        return null;
      }
    }

    const result = await stepDetectBall({
      matchId: "test-match",
      version: "1.0.0",
      ballDetector: new InvisibleDetector(),
    });

    expect(result.visibleCount).toBe(0);
  });
});
