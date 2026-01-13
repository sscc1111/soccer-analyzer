/**
 * Placeholder detection implementations
 *
 * Used for testing the pipeline without actual ML models.
 * Returns mock/random data that follows the correct structure.
 */

import type { BoundingBox } from "@soccer/shared";
import type {
  PlayerDetector,
  BallDetector,
  ColorExtractor,
  Tracker,
  Detection,
} from "./types";

/**
 * Placeholder player detector
 * Returns random player-like detections for testing
 */
export class PlaceholderPlayerDetector implements PlayerDetector {
  readonly modelId = "placeholder-player-v1";

  async detectPlayers(
    _frameBuffer: Buffer,
    _width: number,
    _height: number
  ): Promise<Detection[]> {
    // Return empty array - no detections in placeholder mode
    // This ensures the pipeline runs but doesn't generate fake data
    return [];
  }
}

/**
 * Placeholder ball detector
 * Returns random ball position for testing
 */
export class PlaceholderBallDetector implements BallDetector {
  readonly modelId = "placeholder-ball-v1";

  async detectBall(
    _frameBuffer: Buffer,
    _width: number,
    _height: number
  ): Promise<Detection | null> {
    // Return null - no detection in placeholder mode
    return null;
  }
}

/**
 * Placeholder color extractor
 * Returns gray color for testing
 */
export class PlaceholderColorExtractor implements ColorExtractor {
  async extractDominantColor(
    _frameBuffer: Buffer,
    _width: number,
    _height: number,
    _bbox: BoundingBox
  ): Promise<string> {
    // Return neutral gray
    return "#808080";
  }

  async extractColorHistogram(
    _frameBuffer: Buffer,
    _width: number,
    _height: number,
    _bbox: BoundingBox
  ): Promise<number[]> {
    // Return empty histogram (8x8x8 bins = 512)
    return new Array(512).fill(0);
  }
}

/**
 * Simple IoU-based tracker placeholder
 * Uses simple nearest-neighbor matching for basic tracking
 */
export class PlaceholderTracker implements Tracker {
  readonly trackerId = "placeholder-tracker-v1";

  private tracks: Map<
    string,
    { lastBbox: BoundingBox; lastFrame: number; label: string }
  > = new Map();
  private nextTrackId = 0;
  private maxAge = 30; // frames

  update(
    frameNumber: number,
    _timestamp: number,
    detections: Detection[]
  ): Map<number, string> {
    const assignments = new Map<number, string>();

    // Remove stale tracks
    for (const [trackId, track] of this.tracks.entries()) {
      if (frameNumber - track.lastFrame > this.maxAge) {
        this.tracks.delete(trackId);
      }
    }

    // Simple nearest-neighbor matching (placeholder logic)
    const usedTracks = new Set<string>();

    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      let bestTrackId: string | null = null;
      let bestIou = 0;

      // Find best matching track
      for (const [trackId, track] of this.tracks.entries()) {
        if (usedTracks.has(trackId)) continue;
        if (track.label !== det.label) continue;

        const iou = computeIou(det.bbox, track.lastBbox);
        if (iou > bestIou && iou > 0.3) {
          bestIou = iou;
          bestTrackId = trackId;
        }
      }

      if (bestTrackId) {
        // Update existing track
        assignments.set(i, bestTrackId);
        usedTracks.add(bestTrackId);
        this.tracks.set(bestTrackId, {
          lastBbox: det.bbox,
          lastFrame: frameNumber,
          label: det.label,
        });
      } else {
        // Create new track
        const newTrackId = `track_${this.nextTrackId++}`;
        assignments.set(i, newTrackId);
        this.tracks.set(newTrackId, {
          lastBbox: det.bbox,
          lastFrame: frameNumber,
          label: det.label,
        });
      }
    }

    return assignments;
  }

  getActiveTrackIds(): string[] {
    return Array.from(this.tracks.keys());
  }

  reset(): void {
    this.tracks.clear();
    this.nextTrackId = 0;
  }
}

/**
 * Compute Intersection over Union between two bounding boxes
 */
function computeIou(a: BoundingBox, b: BoundingBox): number {
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;

  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  const aArea = a.w * a.h;
  const bArea = b.w * b.h;
  const unionArea = aArea + bArea - interArea;

  if (unionArea === 0) return 0;
  return interArea / unionArea;
}
