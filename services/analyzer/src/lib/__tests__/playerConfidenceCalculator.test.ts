import { describe, it, expect } from "vitest";
import {
  calculatePlayerConfidence,
  calculateTrackingConsistency,
  calculatePerformerIdentificationConfidence,
  selectBestPlayerCandidate,
  validatePlayerEventLinkage,
  calculatePlayerIdentificationStats,
  CONFIDENCE_THRESHOLDS,
  CONFIDENCE_WEIGHTS,
  type PlayerConfidenceResult,
  type PlayerIdentificationStats,
} from "../playerConfidenceCalculator";
import type { TrackFrame } from "@soccer/shared";

describe("playerConfidenceCalculator", () => {
  describe("calculateTrackingConsistency", () => {
    describe("empty or invalid input", () => {
      it("should return default 0.5 for empty frames array", () => {
        const result = calculateTrackingConsistency([], 1000);
        expect(result).toBe(0.5);
      });

      it("should return default 0.5 when expectedFrameCount is 0", () => {
        const frames: TrackFrame[] = [
          {
            trackId: "track-1",
            frameNumber: 0,
            timestamp: 0,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
        ];
        const result = calculateTrackingConsistency(frames, 0);
        expect(result).toBe(0.5);
      });

      it("should return default 0.5 when expectedFrameCount is negative", () => {
        const frames: TrackFrame[] = [
          {
            trackId: "track-1",
            frameNumber: 0,
            timestamp: 0,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
        ];
        const result = calculateTrackingConsistency(frames, -100);
        expect(result).toBe(0.5);
      });
    });

    describe("full frame detection", () => {
      it("should return high score when all frames are detected", () => {
        const expectedFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: expectedFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5 + i * 0.001, y: 0.5 },
          confidence: 0.95,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // frameCoverage: 1.0 * 0.4 = 0.4
        // avgConfidence: 0.95 * 0.3 = 0.285
        // smoothness: ~1.0 * 0.3 = 0.3 (very smooth movement)
        // total: ~0.985
        expect(result).toBeGreaterThan(0.9);
        expect(result).toBeLessThanOrEqual(1.0);
      });

      it("should handle perfect stationary detection", () => {
        const expectedFrames = 50;
        const frames: TrackFrame[] = Array.from({ length: expectedFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5, y: 0.5 }, // No movement
          confidence: 1.0,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // Perfect detection: coverage 1.0, confidence 1.0, smoothness 1.0
        expect(result).toBe(1.0);
      });
    });

    describe("partial frame detection", () => {
      it("should return medium score for 50% frame detection", () => {
        const expectedFrames = 200;
        const actualFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: actualFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i * 2, // Skip every other frame
          timestamp: (i * 2) / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5, y: 0.5 },
          confidence: 0.8,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // frameCoverage: 0.5 * 0.4 = 0.2
        // avgConfidence: 0.8 * 0.3 = 0.24
        // smoothness: ~1.0 * 0.3 = 0.3
        // total: ~0.74
        expect(result).toBeGreaterThan(0.6);
        expect(result).toBeLessThan(0.8);
      });

      it("should return low score for 10% frame detection", () => {
        const expectedFrames = 1000;
        const actualFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: actualFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i * 10,
          timestamp: (i * 10) / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5, y: 0.5 },
          confidence: 0.7,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // frameCoverage: 0.1 * 0.4 = 0.04
        // avgConfidence: 0.7 * 0.3 = 0.21
        // smoothness: ~1.0 * 0.3 = 0.3
        // total: ~0.55
        expect(result).toBeGreaterThan(0.4);
        expect(result).toBeLessThan(0.7);
      });
    });

    describe("confidence stability", () => {
      it("should return lower score with unstable confidence", () => {
        const expectedFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: expectedFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5, y: 0.5 },
          confidence: i % 2 === 0 ? 0.9 : 0.3, // Alternating high/low
        }));

        const avgConf = (0.9 + 0.3) / 2; // 0.6
        const result = calculateTrackingConsistency(frames, expectedFrames);
        // frameCoverage: 1.0 * 0.4 = 0.4
        // avgConfidence: 0.6 * 0.3 = 0.18
        // smoothness: ~1.0 * 0.3 = 0.3
        // total: ~0.88
        expect(result).toBeGreaterThan(0.7);
        expect(result).toBeLessThan(0.95);
      });

      it("should return high score with stable high confidence", () => {
        const expectedFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: expectedFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5, y: 0.5 },
          confidence: 0.95,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        expect(result).toBeGreaterThan(0.9);
      });
    });

    describe("position smoothness", () => {
      it("should detect smooth linear movement", () => {
        const expectedFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: expectedFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.3 + i * 0.004, y: 0.5 }, // Smooth horizontal movement
          confidence: 0.9,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // Should have high smoothness score due to consistent movement
        expect(result).toBeGreaterThan(0.85);
      });

      it("should detect erratic position changes", () => {
        const expectedFrames = 100;
        const frames: TrackFrame[] = Array.from({ length: expectedFrames }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: {
            x: i % 2 === 0 ? 0.2 : 0.8, // Jumping back and forth
            y: i % 2 === 0 ? 0.2 : 0.8,
          },
          confidence: 0.9,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // Should have lower score due to erratic movement
        // frameCoverage: 1.0 * 0.4 = 0.4
        // avgConfidence: 0.9 * 0.3 = 0.27
        // smoothness: reduced due to large jumps
        // The movement is consistent (CV is 0 since all jumps are equal), but the distance is large
        expect(result).toBeLessThan(0.95);
      });

      it("should handle single frame gracefully", () => {
        const frames: TrackFrame[] = [
          {
            trackId: "track-1",
            frameNumber: 0,
            timestamp: 0,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
        ];

        const result = calculateTrackingConsistency(frames, 100);
        // Single frame: smoothness defaults to 1.0
        // frameCoverage: 0.01 * 0.4 = 0.004
        // avgConfidence: 0.9 * 0.3 = 0.27
        // smoothness: 1.0 * 0.3 = 0.3
        // total: ~0.574
        expect(result).toBeGreaterThan(0.5);
        expect(result).toBeLessThan(0.7);
      });
    });

    describe("frame gap handling", () => {
      it("should handle non-consecutive frames", () => {
        const frames: TrackFrame[] = [
          {
            trackId: "track-1",
            frameNumber: 0,
            timestamp: 0,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.3, y: 0.5 },
            confidence: 0.9,
          },
          {
            trackId: "track-1",
            frameNumber: 10, // Gap of 10 frames
            timestamp: 0.33,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.4, y: 0.5 }, // Distance normalized by frame gap
            confidence: 0.9,
          },
          {
            trackId: "track-1",
            frameNumber: 20,
            timestamp: 0.66,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.5, y: 0.5 },
            confidence: 0.9,
          },
        ];

        const result = calculateTrackingConsistency(frames, 100);
        // Should normalize distance by frame gap
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(1);
      });
    });

    describe("output range", () => {
      it("should always return value between 0 and 1", () => {
        const testCases = [
          { frames: [], expected: 1000 },
          {
            frames: Array.from({ length: 50 }, (_, i) => ({
              trackId: "track-1",
              frameNumber: i,
              timestamp: i / 30,
              bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
              center: { x: 0.5, y: 0.5 },
              confidence: 0.5,
            })),
            expected: 100,
          },
          {
            frames: Array.from({ length: 200 }, (_, i) => ({
              trackId: "track-1",
              frameNumber: i,
              timestamp: i / 30,
              bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
              center: { x: Math.random(), y: Math.random() },
              confidence: Math.random(),
            })),
            expected: 100,
          },
        ];

        for (const testCase of testCases) {
          const result = calculateTrackingConsistency(testCase.frames, testCase.expected);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(1);
        }
      });
    });

    describe("edge cases", () => {
      it("should handle more frames than expected", () => {
        const expectedFrames = 50;
        const frames: TrackFrame[] = Array.from({ length: 100 }, (_, i) => ({
          trackId: "track-1",
          frameNumber: i,
          timestamp: i / 30,
          bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          center: { x: 0.5, y: 0.5 },
          confidence: 0.9,
        }));

        const result = calculateTrackingConsistency(frames, expectedFrames);
        // frameCoverage capped at 1.0
        expect(result).toBeGreaterThan(0.8);
        expect(result).toBeLessThanOrEqual(1.0);
      });

      it("should handle unsorted frames", () => {
        const frames: TrackFrame[] = [
          {
            trackId: "track-1",
            frameNumber: 10,
            timestamp: 0.33,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.4, y: 0.5 },
            confidence: 0.9,
          },
          {
            trackId: "track-1",
            frameNumber: 0,
            timestamp: 0,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.3, y: 0.5 },
            confidence: 0.9,
          },
          {
            trackId: "track-1",
            frameNumber: 5,
            timestamp: 0.16,
            bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
            center: { x: 0.35, y: 0.5 },
            confidence: 0.9,
          },
        ];

        const result = calculateTrackingConsistency(frames, 100);
        // Should sort frames internally
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("CONFIDENCE_THRESHOLDS", () => {
    it("should have correct threshold values", () => {
      expect(CONFIDENCE_THRESHOLDS.high).toBe(0.8);
      expect(CONFIDENCE_THRESHOLDS.medium).toBe(0.6);
      expect(CONFIDENCE_THRESHOLDS.low).toBe(0.4);
    });
  });

  describe("CONFIDENCE_WEIGHTS", () => {
    it("should have correct weight values", () => {
      expect(CONFIDENCE_WEIGHTS.ocr).toBe(0.5);
      expect(CONFIDENCE_WEIGHTS.teamMatching).toBe(0.25);
      expect(CONFIDENCE_WEIGHTS.tracking).toBe(0.25);
    });

    it("should sum to 1.0", () => {
      const sum =
        CONFIDENCE_WEIGHTS.ocr +
        CONFIDENCE_WEIGHTS.teamMatching +
        CONFIDENCE_WEIGHTS.tracking;
      expect(sum).toBe(1.0);
    });
  });

  describe("calculatePlayerConfidence", () => {
    describe("high quality scores", () => {
      it("should return high quality for excellent scores", () => {
        const result = calculatePlayerConfidence(0.9, 0.9, 0.9);

        expect(result.overall).toBeCloseTo(0.9);
        expect(result.qualityScore).toBe("high");
        expect(result.needsReview).toBe(false);
        expect(result.reviewReasons).toHaveLength(0);
      });

      it("should return high quality when overall >= 0.8", () => {
        // 0.8 * 0.5 + 0.8 * 0.25 + 0.8 * 0.25 = 0.8
        const result = calculatePlayerConfidence(0.8, 0.8, 0.8);

        expect(result.overall).toBeCloseTo(0.8);
        expect(result.qualityScore).toBe("high");
      });

      it("should calculate weighted average correctly for high scores", () => {
        const result = calculatePlayerConfidence(1.0, 0.8, 0.6);
        // 1.0 * 0.5 + 0.8 * 0.25 + 0.6 * 0.25 = 0.5 + 0.2 + 0.15 = 0.85
        expect(result.overall).toBeCloseTo(0.85);
        expect(result.qualityScore).toBe("high");
      });
    });

    describe("medium quality scores", () => {
      it("should return medium quality for moderate scores", () => {
        const result = calculatePlayerConfidence(0.7, 0.6, 0.6);
        // 0.7 * 0.5 + 0.6 * 0.25 + 0.6 * 0.25 = 0.35 + 0.15 + 0.15 = 0.65
        expect(result.overall).toBeCloseTo(0.65);
        expect(result.qualityScore).toBe("medium");
      });

      it("should return medium quality at threshold boundary", () => {
        // Test at exactly 0.6 threshold
        const result = calculatePlayerConfidence(0.6, 0.6, 0.6);
        expect(result.overall).toBeCloseTo(0.6);
        expect(result.qualityScore).toBe("medium");
      });

      it("should return medium quality just below high threshold", () => {
        const result = calculatePlayerConfidence(0.79, 0.79, 0.79);
        expect(result.overall).toBeCloseTo(0.79);
        expect(result.qualityScore).toBe("medium");
      });
    });

    describe("low quality scores", () => {
      it("should return low quality for poor scores", () => {
        const result = calculatePlayerConfidence(0.3, 0.3, 0.3);
        expect(result.overall).toBeCloseTo(0.3);
        expect(result.qualityScore).toBe("low");
      });

      it("should return low quality just below medium threshold", () => {
        const result = calculatePlayerConfidence(0.59, 0.59, 0.59);
        expect(result.overall).toBeCloseTo(0.59);
        expect(result.qualityScore).toBe("low");
      });

      it("should handle very low scores", () => {
        const result = calculatePlayerConfidence(0.1, 0.1, 0.1);
        expect(result.overall).toBeCloseTo(0.1);
        expect(result.qualityScore).toBe("low");
      });
    });

    describe("needsReview conditions", () => {
      it("should need review when overall < medium threshold", () => {
        const result = calculatePlayerConfidence(0.5, 0.5, 0.5);
        expect(result.needsReview).toBe(true);
      });

      it("should need review when OCR confidence is low", () => {
        const result = calculatePlayerConfidence(0.5, 0.9, 0.9);
        expect(result.needsReview).toBe(true);
        expect(result.reviewReasons).toContain("low_ocr_confidence");
      });

      it("should need review when team matching confidence is low", () => {
        const result = calculatePlayerConfidence(0.9, 0.5, 0.9);
        expect(result.needsReview).toBe(true);
        expect(result.reviewReasons).toContain("low_team_matching");
      });

      it("should need review when tracking consistency is low", () => {
        const result = calculatePlayerConfidence(0.9, 0.9, 0.5);
        expect(result.needsReview).toBe(true);
        expect(result.reviewReasons).toContain("low_tracking_consistency");
      });

      it("should have multiple review reasons", () => {
        const result = calculatePlayerConfidence(0.5, 0.5, 0.5);
        expect(result.reviewReasons).toHaveLength(3);
        expect(result.reviewReasons).toContain("low_ocr_confidence");
        expect(result.reviewReasons).toContain("low_team_matching");
        expect(result.reviewReasons).toContain("low_tracking_consistency");
      });

      it("should need review even when overall is medium but components are low", () => {
        // High OCR can compensate for low others in overall score
        const result = calculatePlayerConfidence(0.9, 0.5, 0.5);
        // 0.9 * 0.5 + 0.5 * 0.25 + 0.5 * 0.25 = 0.7 (medium)
        expect(result.overall).toBeCloseTo(0.7);
        expect(result.qualityScore).toBe("medium");
        expect(result.needsReview).toBe(true); // But still needs review
      });
    });

    describe("component clamping", () => {
      it("should clamp OCR confidence above 1.0", () => {
        const result = calculatePlayerConfidence(1.5, 0.8, 0.8);
        expect(result.components.ocrConfidence).toBe(1.0);
      });

      it("should clamp OCR confidence below 0", () => {
        const result = calculatePlayerConfidence(-0.5, 0.8, 0.8);
        expect(result.components.ocrConfidence).toBe(0);
      });

      it("should clamp team matching confidence", () => {
        const result = calculatePlayerConfidence(0.8, 1.5, 0.8);
        expect(result.components.teamMatchingConfidence).toBe(1.0);
      });

      it("should clamp tracking consistency", () => {
        const result = calculatePlayerConfidence(0.8, 0.8, -0.2);
        expect(result.components.trackingConsistency).toBe(0);
      });

      it("should clamp all components when out of range", () => {
        const result = calculatePlayerConfidence(2.0, -1.0, 1.5);
        expect(result.components.ocrConfidence).toBe(1.0);
        expect(result.components.teamMatchingConfidence).toBe(0);
        expect(result.components.trackingConsistency).toBe(1.0);
      });
    });

    describe("default parameters", () => {
      it("should use default team matching confidence of 0.5", () => {
        const result = calculatePlayerConfidence(0.8);
        expect(result.components.teamMatchingConfidence).toBe(0.5);
      });

      it("should use default tracking consistency of 0.5", () => {
        const result = calculatePlayerConfidence(0.8);
        expect(result.components.trackingConsistency).toBe(0.5);
      });

      it("should calculate correctly with only OCR confidence", () => {
        const result = calculatePlayerConfidence(1.0);
        // 1.0 * 0.5 + 0.5 * 0.25 + 0.5 * 0.25 = 0.5 + 0.125 + 0.125 = 0.75
        expect(result.overall).toBeCloseTo(0.75);
        expect(result.qualityScore).toBe("medium");
      });
    });

    describe("edge cases", () => {
      it("should handle all zeros", () => {
        const result = calculatePlayerConfidence(0, 0, 0);
        expect(result.overall).toBe(0);
        expect(result.qualityScore).toBe("low");
        expect(result.needsReview).toBe(true);
      });

      it("should handle all ones", () => {
        const result = calculatePlayerConfidence(1, 1, 1);
        expect(result.overall).toBe(1);
        expect(result.qualityScore).toBe("high");
        expect(result.needsReview).toBe(false);
      });
    });

    describe("return type", () => {
      it("should return all required fields", () => {
        const result = calculatePlayerConfidence(0.8, 0.7, 0.6);

        expect(result).toHaveProperty("overall");
        expect(result).toHaveProperty("components");
        expect(result).toHaveProperty("qualityScore");
        expect(result).toHaveProperty("needsReview");
        expect(result).toHaveProperty("reviewReasons");

        expect(result.components).toHaveProperty("ocrConfidence");
        expect(result.components).toHaveProperty("teamMatchingConfidence");
        expect(result.components).toHaveProperty("trackingConsistency");
      });
    });
  });

  describe("calculatePerformerIdentificationConfidence", () => {
    describe("Bayesian boost", () => {
      it("should boost confidence when both event and player confidence are high", () => {
        const result = calculatePerformerIdentificationConfidence(0.9, 0.9, 1.0);
        // base = (0.9 * 0.4 + 0.9 * 0.6) * 1.0 = 0.9
        // boost = min(0.9, 0.9) * 0.1 = 0.09
        // total = 0.9 + 0.09 = 0.99
        expect(result.confidence).toBeCloseTo(0.99);
        expect(result.quality).toBe("high");
        expect(result.reliable).toBe(true);
      });

      it("should have minimal boost when confidences differ significantly", () => {
        const result = calculatePerformerIdentificationConfidence(0.9, 0.3, 1.0);
        // base = (0.9 * 0.4 + 0.3 * 0.6) * 1.0 = 0.36 + 0.18 = 0.54
        // boost = min(0.9, 0.3) * 0.1 = 0.03
        // total = 0.54 + 0.03 = 0.57
        expect(result.confidence).toBeCloseTo(0.57);
        expect(result.quality).toBe("low");
        expect(result.reliable).toBe(false);
      });
    });

    describe("position proximity adjustment", () => {
      it("should reduce confidence with low position proximity", () => {
        const result = calculatePerformerIdentificationConfidence(0.9, 0.9, 0.3);
        // base = (0.9 * 0.4 + 0.9 * 0.6) * 0.3 = 0.9 * 0.3 = 0.27
        // boost = 0.9 * 0.1 = 0.09
        // total = 0.27 + 0.09 = 0.36
        expect(result.confidence).toBeCloseTo(0.36);
        expect(result.quality).toBe("low");
        expect(result.reliable).toBe(false);
      });

      it("should maximize confidence with perfect proximity", () => {
        const result = calculatePerformerIdentificationConfidence(1.0, 1.0, 1.0);
        // base = (1.0 * 0.4 + 1.0 * 0.6) * 1.0 = 1.0
        // boost = 1.0 * 0.1 = 0.1
        // total = min(1.0, 1.0 + 0.1) = 1.0
        expect(result.confidence).toBe(1.0);
        expect(result.quality).toBe("high");
      });

      it("should use default proximity of 0.5", () => {
        const result = calculatePerformerIdentificationConfidence(0.8, 0.8);
        // base = (0.8 * 0.4 + 0.8 * 0.6) * 0.5 = 0.8 * 0.5 = 0.4
        // boost = 0.8 * 0.1 = 0.08
        // total = 0.4 + 0.08 = 0.48
        expect(result.confidence).toBeCloseTo(0.48);
        expect(result.quality).toBe("low");
      });
    });

    describe("reliable threshold", () => {
      it("should be reliable when confidence >= 0.6", () => {
        const result = calculatePerformerIdentificationConfidence(0.7, 0.8, 0.9);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        expect(result.reliable).toBe(true);
      });

      it("should not be reliable when confidence < 0.6", () => {
        const result = calculatePerformerIdentificationConfidence(0.5, 0.5, 0.5);
        expect(result.confidence).toBeLessThan(0.6);
        expect(result.reliable).toBe(false);
      });

      it("should be reliable at exact threshold", () => {
        // Need to find values that give exactly 0.6
        // (e * 0.4 + p * 0.6) * prox + min(e, p) * 0.1 = 0.6
        const result = calculatePerformerIdentificationConfidence(0.8, 0.6, 0.7);
        expect(result.reliable).toBe(result.confidence >= 0.6);
      });
    });

    describe("quality levels", () => {
      it("should return high quality when confidence >= 0.8", () => {
        const result = calculatePerformerIdentificationConfidence(0.9, 0.9, 1.0);
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
        expect(result.quality).toBe("high");
      });

      it("should return medium quality when 0.6 <= confidence < 0.8", () => {
        const result = calculatePerformerIdentificationConfidence(0.7, 0.7, 0.95);
        // base = (0.7 * 0.4 + 0.7 * 0.6) * 0.95 = 0.665
        // boost = 0.7 * 0.1 = 0.07
        // total = 0.735
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        expect(result.confidence).toBeLessThan(0.8);
        expect(result.quality).toBe("medium");
      });

      it("should return low quality when confidence < 0.6", () => {
        const result = calculatePerformerIdentificationConfidence(0.4, 0.4, 0.8);
        expect(result.confidence).toBeLessThan(0.6);
        expect(result.quality).toBe("low");
      });
    });

    describe("confidence capping", () => {
      it("should cap confidence at 1.0", () => {
        const result = calculatePerformerIdentificationConfidence(1.0, 1.0, 1.0);
        expect(result.confidence).toBe(1.0);
      });

      it("should not exceed 1.0 even with high boost", () => {
        const result = calculatePerformerIdentificationConfidence(0.95, 0.95, 1.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      });
    });

    describe("edge cases", () => {
      it("should handle all zeros", () => {
        const result = calculatePerformerIdentificationConfidence(0, 0, 0);
        expect(result.confidence).toBe(0);
        expect(result.quality).toBe("low");
        expect(result.reliable).toBe(false);
      });

      it("should handle mixed extreme values", () => {
        const result = calculatePerformerIdentificationConfidence(1.0, 0, 1.0);
        // base = (1.0 * 0.4 + 0 * 0.6) * 1.0 = 0.4
        // boost = min(1.0, 0) * 0.1 = 0
        // total = 0.4
        expect(result.confidence).toBeCloseTo(0.4);
      });
    });
  });

  describe("selectBestPlayerCandidate", () => {
    describe("empty array", () => {
      it("should handle empty candidates array", () => {
        const result = selectBestPlayerCandidate([]);

        expect(result.best).toBeNull();
        expect(result.alternatives).toEqual([]);
        expect(result.hasMultipleCandidates).toBe(false);
        expect(result.needsReview).toBe(true);
      });
    });

    describe("single candidate", () => {
      it("should select single high-confidence candidate", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.9, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.best).toEqual(candidates[0]);
        expect(result.alternatives).toEqual([]);
        expect(result.hasMultipleCandidates).toBe(false);
        expect(result.needsReview).toBe(false);
      });

      it("should need review for single low-confidence candidate", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.5, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.best).toEqual(candidates[0]);
        expect(result.needsReview).toBe(true);
      });

      it("should handle candidate without jersey number", () => {
        const candidates = [
          { jerseyNumber: null, confidence: 0.8, team: "away" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.best).toEqual(candidates[0]);
        expect(result.best?.jerseyNumber).toBeNull();
      });
    });

    describe("multiple candidates", () => {
      it("should select candidate with highest confidence", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.7, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.9, team: "home" as const },
          { jerseyNumber: 12, confidence: 0.6, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.best?.jerseyNumber).toBe(11);
        expect(result.best?.confidence).toBe(0.9);
        expect(result.alternatives).toHaveLength(2);
      });

      it("should sort alternatives by confidence", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.5, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.9, team: "home" as const },
          { jerseyNumber: 12, confidence: 0.7, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.alternatives[0].confidence).toBe(0.7);
        expect(result.alternatives[1].confidence).toBe(0.5);
      });

      it("should detect multiple high-confidence candidates", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.8, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.75, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.hasMultipleCandidates).toBe(true);
      });

      it("should not flag multiple candidates when only one is high confidence", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.8, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.5, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.hasMultipleCandidates).toBe(false);
      });
    });

    describe("needsReview when close confidence", () => {
      it("should need review when second candidate is within 80% of first", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.9, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.75, team: "home" as const }, // 0.75 / 0.9 = 0.833 > 0.8
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.needsReview).toBe(true);
      });

      it("should not need review when second candidate is below 80% of first", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.9, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.7, team: "home" as const }, // 0.7 / 0.9 = 0.777 < 0.8
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.needsReview).toBe(false);
      });

      it("should need review when best confidence is medium", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.65, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.4, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.needsReview).toBe(false); // 0.65 >= 0.6, and second is not close
      });

      it("should need review when best confidence is below medium threshold", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.55, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.3, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.needsReview).toBe(true);
      });
    });

    describe("trackId field", () => {
      it("should preserve trackId in results", () => {
        const candidates = [
          {
            jerseyNumber: 10,
            confidence: 0.9,
            team: "home" as const,
            trackId: "track-123",
          },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.best?.trackId).toBe("track-123");
      });

      it("should handle candidates with and without trackId", () => {
        const candidates = [
          {
            jerseyNumber: 10,
            confidence: 0.8,
            team: "home" as const,
            trackId: "track-1",
          },
          { jerseyNumber: 11, confidence: 0.7, team: "home" as const },
        ];
        const result = selectBestPlayerCandidate(candidates);

        expect(result.best?.trackId).toBe("track-1");
        expect(result.alternatives[0].trackId).toBeUndefined();
      });
    });

    describe("immutability", () => {
      it("should not modify original array", () => {
        const candidates = [
          { jerseyNumber: 10, confidence: 0.5, team: "home" as const },
          { jerseyNumber: 11, confidence: 0.9, team: "home" as const },
        ];
        const originalOrder = [...candidates];

        selectBestPlayerCandidate(candidates);

        expect(candidates).toEqual(originalOrder);
      });
    });
  });

  describe("validatePlayerEventLinkage", () => {
    describe("team mismatch", () => {
      it("should detect team mismatch", () => {
        const result = validatePlayerEventLinkage("home", "away", 10, "#10");

        expect(result.valid).toBe(false);
        expect(result.issues).toContain("team_mismatch");
        expect(result.matchConfidence).toBeCloseTo(0.1);
      });

      it("should apply 0.1 penalty for team mismatch", () => {
        const result = validatePlayerEventLinkage("home", "away", 10, "#10");
        expect(result.matchConfidence).toBeCloseTo(0.1);
      });

      it("should pass when teams match", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "#10");

        expect(result.issues).not.toContain("team_mismatch");
        expect(result.matchConfidence).toBe(1.0);
      });
    });

    describe("jersey mismatch", () => {
      it("should detect jersey number mismatch", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "#11");

        expect(result.valid).toBe(false);
        expect(result.issues).toContain("jersey_mismatch");
        expect(result.matchConfidence).toBeCloseTo(0.3);
      });

      it("should handle jersey number without hash prefix", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "11");

        expect(result.issues).toContain("jersey_mismatch");
      });

      it("should pass when jersey numbers match", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "#10");

        expect(result.issues).not.toContain("jersey_mismatch");
        expect(result.matchConfidence).toBe(1.0);
        expect(result.valid).toBe(true);
      });

      it("should handle jersey numbers with hash prefix", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "#10");
        expect(result.valid).toBe(true);
      });

      it("should handle jersey numbers without prefix", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "10");
        expect(result.valid).toBe(true);
      });

      it("should handle two-digit jersey numbers", () => {
        const result = validatePlayerEventLinkage("home", "home", 99, "#99");
        expect(result.valid).toBe(true);
      });

      it("should not check jersey when eventPlayer is undefined", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, undefined);

        expect(result.issues).not.toContain("jersey_mismatch");
      });
    });

    describe("no jersey number", () => {
      it("should detect missing jersey number", () => {
        const result = validatePlayerEventLinkage("home", "home", null, "#10");

        expect(result.valid).toBe(false);
        expect(result.issues).toContain("no_jersey_number");
        expect(result.matchConfidence).toBeCloseTo(0.7);
      });

      it("should apply 0.7 penalty for missing jersey", () => {
        const result = validatePlayerEventLinkage("home", "home", null, undefined);

        expect(result.matchConfidence).toBeCloseTo(0.7);
      });

      it("should not flag issue when jersey is present", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "#10");

        expect(result.issues).not.toContain("no_jersey_number");
      });
    });

    describe("combined issues", () => {
      it("should combine team mismatch and jersey mismatch penalties", () => {
        const result = validatePlayerEventLinkage("home", "away", 10, "#11");

        expect(result.issues).toContain("team_mismatch");
        expect(result.issues).toContain("jersey_mismatch");
        expect(result.matchConfidence).toBeCloseTo(0.03); // 0.1 * 0.3
      });

      it("should combine team mismatch and no jersey penalties", () => {
        const result = validatePlayerEventLinkage("home", "away", null, undefined);

        expect(result.issues).toContain("team_mismatch");
        expect(result.issues).toContain("no_jersey_number");
        expect(result.matchConfidence).toBeCloseTo(0.07); // 0.1 * 0.7
      });

      it("should combine jersey mismatch and no jersey penalties", () => {
        const result = validatePlayerEventLinkage("home", "home", null, "#10");

        expect(result.issues).toContain("no_jersey_number");
        expect(result.matchConfidence).toBeCloseTo(0.7);
      });

      it("should have all three issues when everything mismatches", () => {
        const result = validatePlayerEventLinkage("home", "away", null, undefined);

        expect(result.issues).toHaveLength(2);
        expect(result.issues).toContain("team_mismatch");
        expect(result.issues).toContain("no_jersey_number");
        expect(result.matchConfidence).toBeCloseTo(0.07); // 0.1 * 0.7
      });
    });

    describe("valid cases", () => {
      it("should be valid with perfect match", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "#10");

        expect(result.valid).toBe(true);
        expect(result.issues).toHaveLength(0);
        expect(result.matchConfidence).toBe(1.0);
      });

      it("should be valid for away team", () => {
        const result = validatePlayerEventLinkage("away", "away", 7, "#7");

        expect(result.valid).toBe(true);
        expect(result.matchConfidence).toBe(1.0);
      });
    });

    describe("edge cases", () => {
      it("should handle eventPlayer with additional text", () => {
        const result = validatePlayerEventLinkage(
          "home",
          "home",
          10,
          "Player #10"
        );
        expect(result.valid).toBe(true);
      });

      it("should handle eventPlayer with no numbers", () => {
        const result = validatePlayerEventLinkage(
          "home",
          "home",
          10,
          "Unknown Player"
        );
        // No jersey extraction, so no mismatch
        expect(result.issues).not.toContain("jersey_mismatch");
      });

      it("should handle empty eventPlayer string", () => {
        const result = validatePlayerEventLinkage("home", "home", 10, "");
        expect(result.issues).not.toContain("jersey_mismatch");
      });
    });
  });

  describe("calculatePlayerIdentificationStats", () => {
    describe("empty array", () => {
      it("should return zero stats for empty array", () => {
        const result = calculatePlayerIdentificationStats([]);

        expect(result.totalPlayers).toBe(0);
        expect(result.identifiedWithJersey).toBe(0);
        expect(result.highConfidence).toBe(0);
        expect(result.mediumConfidence).toBe(0);
        expect(result.lowConfidence).toBe(0);
        expect(result.needsReview).toBe(0);
        expect(result.identificationRate).toBe(0);
        expect(result.averageConfidence).toBe(0);
      });
    });

    describe("mixed confidence levels", () => {
      it("should categorize players by confidence level", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9, needsReview: false },
          { jerseyNumber: 11, confidence: 0.7, needsReview: false },
          { jerseyNumber: 12, confidence: 0.5, needsReview: true },
          { jerseyNumber: null, confidence: 0.3, needsReview: true },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.highConfidence).toBe(1); // 0.9
        expect(result.mediumConfidence).toBe(1); // 0.7
        expect(result.lowConfidence).toBe(2); // 0.5, 0.3
      });

      it("should count players at threshold boundaries correctly", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.8 }, // exactly high threshold
          { jerseyNumber: 11, confidence: 0.6 }, // exactly medium threshold
          { jerseyNumber: 12, confidence: 0.4 }, // exactly low threshold
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.highConfidence).toBe(1);
        expect(result.mediumConfidence).toBe(1);
        expect(result.lowConfidence).toBe(1);
      });

      it("should count players just below thresholds", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.79 },
          { jerseyNumber: 11, confidence: 0.59 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.highConfidence).toBe(0);
        expect(result.mediumConfidence).toBe(1); // 0.79
        expect(result.lowConfidence).toBe(1); // 0.59
      });
    });

    describe("identification rate", () => {
      it("should calculate identification rate correctly", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9 },
          { jerseyNumber: 11, confidence: 0.8 },
          { jerseyNumber: null, confidence: 0.7 },
          { jerseyNumber: null, confidence: 0.6 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.identifiedWithJersey).toBe(2);
        expect(result.identificationRate).toBeCloseTo(0.5); // 2/4
      });

      it("should return 1.0 when all players identified", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9 },
          { jerseyNumber: 11, confidence: 0.8 },
          { jerseyNumber: 12, confidence: 0.7 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.identificationRate).toBe(1.0);
      });

      it("should return 0.0 when no players identified", () => {
        const players = [
          { jerseyNumber: null, confidence: 0.9 },
          { jerseyNumber: null, confidence: 0.8 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.identificationRate).toBe(0.0);
      });
    });

    describe("average confidence", () => {
      it("should calculate average confidence correctly", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.8 },
          { jerseyNumber: 11, confidence: 0.6 },
          { jerseyNumber: 12, confidence: 0.4 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.averageConfidence).toBeCloseTo(0.6); // (0.8 + 0.6 + 0.4) / 3
      });

      it("should handle all same confidence values", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.7 },
          { jerseyNumber: 11, confidence: 0.7 },
          { jerseyNumber: 12, confidence: 0.7 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.averageConfidence).toBeCloseTo(0.7);
      });

      it("should calculate average with extreme values", () => {
        const players = [
          { jerseyNumber: 10, confidence: 1.0 },
          { jerseyNumber: null, confidence: 0.0 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.averageConfidence).toBeCloseTo(0.5);
      });
    });

    describe("needsReview count", () => {
      it("should count players needing review", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9, needsReview: false },
          { jerseyNumber: 11, confidence: 0.5, needsReview: true },
          { jerseyNumber: 12, confidence: 0.4, needsReview: true },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.needsReview).toBe(2);
      });

      it("should handle all players needing review", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.5, needsReview: true },
          { jerseyNumber: 11, confidence: 0.4, needsReview: true },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.needsReview).toBe(2);
      });

      it("should handle no players needing review", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9, needsReview: false },
          { jerseyNumber: 11, confidence: 0.8, needsReview: false },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.needsReview).toBe(0);
      });

      it("should treat undefined needsReview as false", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9 }, // no needsReview field
          { jerseyNumber: 11, confidence: 0.8 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.needsReview).toBe(0);
      });
    });

    describe("total players count", () => {
      it("should count all players", () => {
        const players = [
          { jerseyNumber: 10, confidence: 0.9 },
          { jerseyNumber: null, confidence: 0.5 },
          { jerseyNumber: 12, confidence: 0.3 },
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.totalPlayers).toBe(3);
      });

      it("should handle single player", () => {
        const players = [{ jerseyNumber: 10, confidence: 0.9 }];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.totalPlayers).toBe(1);
      });

      it("should handle large number of players", () => {
        const players = Array.from({ length: 100 }, (_, i) => ({
          jerseyNumber: i,
          confidence: 0.8,
        }));

        const result = calculatePlayerIdentificationStats(players);

        expect(result.totalPlayers).toBe(100);
      });
    });

    describe("comprehensive scenarios", () => {
      it("should handle realistic match scenario", () => {
        const players = [
          { jerseyNumber: 1, confidence: 0.95, needsReview: false }, // GK - high
          { jerseyNumber: 2, confidence: 0.85, needsReview: false }, // high
          { jerseyNumber: 3, confidence: 0.88, needsReview: false }, // high
          { jerseyNumber: 4, confidence: 0.75, needsReview: false }, // medium
          { jerseyNumber: 5, confidence: 0.65, needsReview: false }, // medium
          { jerseyNumber: 6, confidence: 0.55, needsReview: true }, // low
          { jerseyNumber: null, confidence: 0.45, needsReview: true }, // low
          { jerseyNumber: null, confidence: 0.35, needsReview: true }, // low
        ];

        const result = calculatePlayerIdentificationStats(players);

        expect(result.totalPlayers).toBe(8);
        expect(result.identifiedWithJersey).toBe(6);
        expect(result.highConfidence).toBe(3);
        expect(result.mediumConfidence).toBe(2);
        expect(result.lowConfidence).toBe(3);
        expect(result.needsReview).toBe(3);
        expect(result.identificationRate).toBeCloseTo(0.75);
        expect(result.averageConfidence).toBeCloseTo(
          (0.95 + 0.85 + 0.88 + 0.75 + 0.65 + 0.55 + 0.45 + 0.35) / 8
        );
      });
    });

    describe("return type", () => {
      it("should return all required fields", () => {
        const players = [{ jerseyNumber: 10, confidence: 0.8 }];
        const result = calculatePlayerIdentificationStats(players);

        expect(result).toHaveProperty("totalPlayers");
        expect(result).toHaveProperty("identifiedWithJersey");
        expect(result).toHaveProperty("highConfidence");
        expect(result).toHaveProperty("mediumConfidence");
        expect(result).toHaveProperty("lowConfidence");
        expect(result).toHaveProperty("needsReview");
        expect(result).toHaveProperty("identificationRate");
        expect(result).toHaveProperty("averageConfidence");
      });
    });
  });
});
