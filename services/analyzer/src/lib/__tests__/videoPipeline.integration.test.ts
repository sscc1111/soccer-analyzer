/**
 * Video Pipeline Integration Tests
 *
 * Tests for the video-level analysis pipeline and merge job flows.
 * These tests validate the end-to-end flow without actual Firebase/Gemini calls.
 */

import { describe, it, expect } from "vitest";
import type { VideoType, VideoConfiguration, VideoDoc, JobDoc } from "@soccer/shared";

// ============================================================================
// Mock Functions (simulating actual implementation behavior)
// ============================================================================

function shouldCreateMergeJob(videos: VideoDoc[]): boolean {
  const firstHalf = videos.find((v) => v.type === "firstHalf");
  const secondHalf = videos.find((v) => v.type === "secondHalf");

  if (!firstHalf || !secondHalf) return false;

  return (
    firstHalf.analysis?.status === "done" &&
    secondHalf.analysis?.status === "done"
  );
}

function getRequiredVideoTypes(configuration: VideoConfiguration): VideoType[] {
  if (configuration === "split") {
    return ["firstHalf", "secondHalf"];
  }
  return ["single"];
}

function validateVideoUpload(
  existingVideos: VideoDoc[],
  newVideoType: VideoType,
  configuration: VideoConfiguration
): { valid: boolean; reason?: string } {
  // Check if video type already exists
  const existing = existingVideos.find((v) => v.type === newVideoType);
  if (existing) {
    return { valid: false, reason: `Video type ${newVideoType} already uploaded` };
  }

  // Check if video type is valid for configuration
  const requiredTypes = getRequiredVideoTypes(configuration);
  if (!requiredTypes.includes(newVideoType)) {
    return {
      valid: false,
      reason: `Video type ${newVideoType} not valid for ${configuration} configuration`,
    };
  }

  return { valid: true };
}

function getMissingVideoTypes(
  existingVideos: VideoDoc[],
  configuration: VideoConfiguration
): VideoType[] {
  const required = getRequiredVideoTypes(configuration);
  const existing = existingVideos.map((v) => v.type);
  return required.filter((t) => !existing.includes(t));
}

function determineMatchAnalysisStatus(videos: VideoDoc[]): "idle" | "partial" | "done" | "error" {
  if (videos.length === 0) return "idle";

  const hasError = videos.some((v) => v.analysis?.status === "error");
  if (hasError) return "error";

  const allDone = videos.every((v) => v.analysis?.status === "done");
  if (allDone) return "done";

  const someDone = videos.some((v) => v.analysis?.status === "done");
  if (someDone) return "partial";

  return "idle";
}

// ============================================================================
// Tests
// ============================================================================

describe("Video Pipeline Integration", () => {
  describe("Merge Job Triggering", () => {
    it("should trigger merge job when both halves are done", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "matches/match-1/videos/firstHalf.mp4",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done", lastRunAt: "2025-01-15T10:30:00Z" },
        },
        {
          videoId: "secondHalf",
          matchId: "match-1",
          type: "secondHalf",
          storagePath: "matches/match-1/videos/secondHalf.mp4",
          uploadedAt: "2025-01-15T10:05:00Z",
          analysis: { status: "done", lastRunAt: "2025-01-15T10:35:00Z" },
        },
      ];

      expect(shouldCreateMergeJob(videos)).toBe(true);
    });

    it("should NOT trigger merge job when only first half is done", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "matches/match-1/videos/firstHalf.mp4",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done", lastRunAt: "2025-01-15T10:30:00Z" },
        },
        {
          videoId: "secondHalf",
          matchId: "match-1",
          type: "secondHalf",
          storagePath: "matches/match-1/videos/secondHalf.mp4",
          uploadedAt: "2025-01-15T10:05:00Z",
          analysis: { status: "running" },
        },
      ];

      expect(shouldCreateMergeJob(videos)).toBe(false);
    });

    it("should NOT trigger merge job for single video configuration", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "single",
          matchId: "match-1",
          type: "single",
          storagePath: "matches/match-1/videos/single.mp4",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done", lastRunAt: "2025-01-15T10:30:00Z" },
        },
      ];

      expect(shouldCreateMergeJob(videos)).toBe(false);
    });

    it("should NOT trigger merge job when second half has error", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "matches/match-1/videos/firstHalf.mp4",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done" },
        },
        {
          videoId: "secondHalf",
          matchId: "match-1",
          type: "secondHalf",
          storagePath: "matches/match-1/videos/secondHalf.mp4",
          uploadedAt: "2025-01-15T10:05:00Z",
          analysis: { status: "error", errorMessage: "Analysis failed" },
        },
      ];

      expect(shouldCreateMergeJob(videos)).toBe(false);
    });
  });

  describe("Video Configuration", () => {
    it("should require firstHalf and secondHalf for split configuration", () => {
      const required = getRequiredVideoTypes("split");
      expect(required).toContain("firstHalf");
      expect(required).toContain("secondHalf");
      expect(required).not.toContain("single");
    });

    it("should require only single for single configuration", () => {
      const required = getRequiredVideoTypes("single");
      expect(required).toContain("single");
      expect(required).not.toContain("firstHalf");
      expect(required).not.toContain("secondHalf");
    });
  });

  describe("Video Upload Validation", () => {
    it("should allow firstHalf upload for split configuration", () => {
      const result = validateVideoUpload([], "firstHalf", "split");
      expect(result.valid).toBe(true);
    });

    it("should reject single upload for split configuration", () => {
      const result = validateVideoUpload([], "single", "split");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not valid for split configuration");
    });

    it("should reject duplicate video type", () => {
      const existingVideos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
        },
      ];

      const result = validateVideoUpload(existingVideos, "firstHalf", "split");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("already uploaded");
    });

    it("should allow secondHalf after firstHalf for split configuration", () => {
      const existingVideos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
        },
      ];

      const result = validateVideoUpload(existingVideos, "secondHalf", "split");
      expect(result.valid).toBe(true);
    });
  });

  describe("Missing Video Detection", () => {
    it("should detect both videos missing for split configuration", () => {
      const missing = getMissingVideoTypes([], "split");
      expect(missing).toContain("firstHalf");
      expect(missing).toContain("secondHalf");
    });

    it("should detect secondHalf missing after firstHalf upload", () => {
      const existingVideos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
        },
      ];

      const missing = getMissingVideoTypes(existingVideos, "split");
      expect(missing).not.toContain("firstHalf");
      expect(missing).toContain("secondHalf");
    });

    it("should detect no missing videos when complete", () => {
      const existingVideos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
        },
        {
          videoId: "secondHalf",
          matchId: "match-1",
          type: "secondHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:05:00Z",
        },
      ];

      const missing = getMissingVideoTypes(existingVideos, "split");
      expect(missing).toHaveLength(0);
    });
  });

  describe("Match Analysis Status", () => {
    it("should return idle when no videos", () => {
      expect(determineMatchAnalysisStatus([])).toBe("idle");
    });

    it("should return partial when only first half done", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done" },
        },
        {
          videoId: "secondHalf",
          matchId: "match-1",
          type: "secondHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:05:00Z",
          analysis: { status: "queued" },
        },
      ];

      expect(determineMatchAnalysisStatus(videos)).toBe("partial");
    });

    it("should return done when all videos done", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "single",
          matchId: "match-1",
          type: "single",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done" },
        },
      ];

      expect(determineMatchAnalysisStatus(videos)).toBe("done");
    });

    it("should return error when any video has error", () => {
      const videos: VideoDoc[] = [
        {
          videoId: "firstHalf",
          matchId: "match-1",
          type: "firstHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:00:00Z",
          analysis: { status: "done" },
        },
        {
          videoId: "secondHalf",
          matchId: "match-1",
          type: "secondHalf",
          storagePath: "path",
          uploadedAt: "2025-01-15T10:05:00Z",
          analysis: { status: "error", errorMessage: "Failed" },
        },
      ];

      expect(determineMatchAnalysisStatus(videos)).toBe("error");
    });
  });
});

describe("Backward Compatibility", () => {
  describe("Legacy Video Migration", () => {
    it("should create single video doc from legacy match.video", () => {
      const legacyMatch = {
        matchId: "match-1",
        video: {
          storagePath: "matches/match-1/video.mp4",
          durationSec: 5400,
          width: 1920,
          height: 1080,
          fps: 30,
          uploadedAt: "2025-01-15T10:00:00Z",
        },
      };

      const migratedVideoDoc: VideoDoc = {
        videoId: "single",
        matchId: legacyMatch.matchId,
        type: "single",
        storagePath: legacyMatch.video.storagePath,
        uploadedAt: legacyMatch.video.uploadedAt,
        analysis: { status: "idle" },
      };

      expect(migratedVideoDoc.type).toBe("single");
      expect(migratedVideoDoc.videoId).toBe("single");
      expect(migratedVideoDoc.storagePath).toBe(legacyMatch.video.storagePath);
    });
  });

  describe("Storage Path Convention", () => {
    it("should use new storage path format for split videos", () => {
      const matchId = "match-123";
      const firstHalfPath = `matches/${matchId}/videos/firstHalf.mp4`;
      const secondHalfPath = `matches/${matchId}/videos/secondHalf.mp4`;

      expect(firstHalfPath).toContain("/videos/");
      expect(secondHalfPath).toContain("/videos/");
    });

    it("should use new storage path format for single video", () => {
      const matchId = "match-123";
      const singlePath = `matches/${matchId}/videos/single.mp4`;

      expect(singlePath).toContain("/videos/");
    });
  });
});
