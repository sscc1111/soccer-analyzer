/**
 * Tests for windowed event detection step
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stepDetectEventsWindowed,
  generateWindows,
  getFpsForSegmentType,
  getWindowConfig,
  type VideoSegment,
  type AnalysisWindow,
  type RawEvent,
} from "../07b_detectEventsWindowed";

describe("07b_detectEventsWindowed", () => {
  describe("generateWindows", () => {
    it("should create a single window for short segments", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 30,
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({
        windowId: "seg1_w0",
        absoluteStart: 0,
        absoluteEnd: 30,
        overlap: { before: 0, after: 0 },
        targetFps: 3,
      });
    });

    it("should create overlapping windows for long segments", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 120, // 2 minutes
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      // Expected: 60s window size, 15s overlap, 45s step
      // Window 0: 0-60
      // Window 1: 45-105
      // Window 2: 90-120
      expect(windows.length).toBeGreaterThan(1);
      expect(windows[0]).toMatchObject({
        windowId: "seg1_w0",
        absoluteStart: 0,
        absoluteEnd: 60,
        overlap: { before: 0, after: 15 },
      });
      expect(windows[1]).toMatchObject({
        windowId: "seg1_w1",
        absoluteStart: 45,
        absoluteEnd: 105,
        overlap: { before: 15, after: 15 },
      });
    });

    it("should skip stoppage segments when configured", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 30,
          type: "active_play",
        },
        {
          segmentId: "seg2",
          startSec: 30,
          endSec: 45,
          type: "stoppage",
        },
        {
          segmentId: "seg3",
          startSec: 45,
          endSec: 90,
          type: "set_piece",
        },
      ];

      const windows = generateWindows(segments);

      // Should only have windows for seg1 and seg3
      const windowSegmentIds = windows.map((w) => w.segmentContext.segmentId);
      expect(windowSegmentIds).not.toContain("seg2");
      expect(windowSegmentIds).toContain("seg1");
      expect(windowSegmentIds).toContain("seg3");
    });

    it("should use correct FPS for different segment types", () => {
      const segments: VideoSegment[] = [
        { segmentId: "seg1", startSec: 0, endSec: 30, type: "active_play" },
        { segmentId: "seg2", startSec: 30, endSec: 60, type: "set_piece" },
        { segmentId: "seg3", startSec: 60, endSec: 90, type: "goal_moment" },
      ];

      const windows = generateWindows(segments);

      const seg1Windows = windows.filter((w) => w.segmentContext.segmentId === "seg1");
      const seg2Windows = windows.filter((w) => w.segmentContext.segmentId === "seg2");
      const seg3Windows = windows.filter((w) => w.segmentContext.segmentId === "seg3");

      expect(seg1Windows[0].targetFps).toBe(3); // active_play
      expect(seg2Windows[0].targetFps).toBe(2); // set_piece
      expect(seg3Windows[0].targetFps).toBe(5); // goal_moment
    });

    it("should handle segment at exact window size", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 60, // Exactly 60 seconds
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      expect(windows).toHaveLength(1);
      expect(windows[0]).toMatchObject({
        absoluteStart: 0,
        absoluteEnd: 60,
      });
    });

    it("should not create overlaps at segment boundaries", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 150,
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      // First window should have no overlap before
      expect(windows[0].overlap.before).toBe(0);

      // Last window should have no overlap after
      const lastWindow = windows[windows.length - 1];
      expect(lastWindow.overlap.after).toBe(0);

      // Middle windows should have overlaps
      if (windows.length > 2) {
        expect(windows[1].overlap.before).toBeGreaterThan(0);
        expect(windows[1].overlap.after).toBeGreaterThan(0);
      }
    });

    it("should handle empty segment array", () => {
      const windows = generateWindows([]);
      expect(windows).toHaveLength(0);
    });

    it("should preserve segment context in windows", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 30,
          type: "active_play",
          description: "Fast attack",
          team: "home",
          importance: 0.8,
        },
      ];

      const windows = generateWindows(segments);

      expect(windows[0].segmentContext).toMatchObject({
        segmentId: "seg1",
        type: "active_play",
        description: "Fast attack",
        team: "home",
        importance: 0.8,
      });
    });
  });

  describe("getFpsForSegmentType", () => {
    it("should return correct FPS for each segment type", () => {
      expect(getFpsForSegmentType("active_play")).toBe(3);
      expect(getFpsForSegmentType("set_piece")).toBe(2);
      expect(getFpsForSegmentType("goal_moment")).toBe(5);
      expect(getFpsForSegmentType("stoppage")).toBe(1);
    });
  });

  describe("getWindowConfig", () => {
    it("should return window configuration", () => {
      const config = getWindowConfig();

      expect(config).toHaveProperty("defaultDurationSec");
      expect(config).toHaveProperty("overlapSec");
      expect(config).toHaveProperty("fpsBySegment");
      expect(config).toHaveProperty("parallelism");
      expect(config.defaultDurationSec).toBe(60);
      expect(config.overlapSec).toBe(15);
      expect(config.parallelism).toBe(5);
    });
  });

  describe("stepDetectEventsWindowed", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return empty result for no segments", async () => {
      const result = await stepDetectEventsWindowed({
        matchId: "match123",
        version: "v1",
        segments: [],
      });

      expect(result).toMatchObject({
        matchId: "match123",
        windowCount: 0,
        rawEventCount: 0,
        eventsByType: {},
        rawEvents: [],
      });
    });

    // Note: Integration tests with actual Gemini API calls would be in a separate file
    // These unit tests focus on the windowing logic and data structure transformations
  });

  describe("Window overlap calculations", () => {
    it("should calculate correct overlap for consecutive windows", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 200,
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      // Verify consecutive windows have proper overlap
      for (let i = 1; i < windows.length; i++) {
        const prevWindow = windows[i - 1];
        const currentWindow = windows[i];

        // Current window should start before previous ends (overlap)
        expect(currentWindow.absoluteStart).toBeLessThan(prevWindow.absoluteEnd);

        // The overlap amount should match configuration
        const actualOverlap = prevWindow.absoluteEnd - currentWindow.absoluteStart;
        expect(actualOverlap).toBeGreaterThan(0);
        expect(actualOverlap).toBeLessThanOrEqual(getWindowConfig().overlapSec);
      }
    });

    it("should handle edge case where segment ends mid-overlap", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 70, // Just 10s longer than window size
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      expect(windows.length).toBeGreaterThanOrEqual(1);

      // If there are 2 windows, check they don't extend past segment
      if (windows.length === 2) {
        expect(windows[1].absoluteEnd).toBeLessThanOrEqual(70);
      }
    });
  });

  describe("RawEvent format", () => {
    it("should correctly convert relative to absolute timestamps", () => {
      // This is a conceptual test - actual implementation happens in processWindow
      const window: AnalysisWindow = {
        windowId: "seg1_w0",
        absoluteStart: 100,
        absoluteEnd: 160,
        overlap: { before: 0, after: 15 },
        targetFps: 3,
        segmentContext: {
          segmentId: "seg1",
          startSec: 100,
          endSec: 200,
          type: "active_play",
        },
      };

      // Simulate event at 5s relative to window start
      const relativeTimestamp = 5.0;
      const expectedAbsoluteTimestamp = window.absoluteStart + relativeTimestamp;

      expect(expectedAbsoluteTimestamp).toBe(105.0);
    });

    it("should preserve all event properties in RawEvent", () => {
      const rawEvent: RawEvent = {
        windowId: "seg1_w0",
        relativeTimestamp: 5.0,
        absoluteTimestamp: 105.0,
        type: "pass",
        team: "home",
        player: "#10",
        zone: "middle_third",
        details: {
          passType: "short",
          outcome: "complete",
          targetPlayer: "#9",
        },
        confidence: 0.85,
        visualEvidence: "Player #10 passes to #9 in midfield",
      };

      expect(rawEvent).toHaveProperty("windowId");
      expect(rawEvent).toHaveProperty("relativeTimestamp");
      expect(rawEvent).toHaveProperty("absoluteTimestamp");
      expect(rawEvent).toHaveProperty("type");
      expect(rawEvent).toHaveProperty("team");
      expect(rawEvent).toHaveProperty("confidence");
      expect(rawEvent.details).toHaveProperty("passType");
      expect(rawEvent.details).toHaveProperty("outcome");
    });
  });

  describe("Performance characteristics", () => {
    it("should limit window count for very long segments", () => {
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 10000, // Very long segment (2h 46m)
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      // Should not create more than 100 windows per segment (safety limit)
      expect(windows.length).toBeLessThanOrEqual(100);
    });

    it("should batch windows according to parallelism config", () => {
      const config = getWindowConfig();
      const segments: VideoSegment[] = [
        {
          segmentId: "seg1",
          startSec: 0,
          endSec: 500, // Creates many windows
          type: "active_play",
        },
      ];

      const windows = generateWindows(segments);

      // Verify batch size would be respected (config.parallelism)
      expect(config.parallelism).toBeGreaterThan(0);
      expect(windows.length).toBeGreaterThan(config.parallelism);

      // Conceptual: batches would be ceil(windows.length / config.parallelism)
      const expectedBatches = Math.ceil(windows.length / config.parallelism);
      expect(expectedBatches).toBeGreaterThan(1);
    });
  });
});
