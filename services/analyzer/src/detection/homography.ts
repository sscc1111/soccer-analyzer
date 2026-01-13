/**
 * Homography estimation and coordinate transformation utilities
 *
 * Provides functions for:
 * - Computing homography matrix from keypoint correspondences
 * - Transforming screen coordinates to field coordinates and vice versa
 * - Validating and refining homography estimates
 */

import type {
  Point2D,
  HomographyData,
  HomographyKeypoint,
} from "@soccer/shared";

/**
 * Standard soccer field dimensions in meters
 */
export const FIELD_DIMENSIONS = {
  eleven: { length: 105, width: 68 },
  eight: { length: 68, width: 50 },
  five: { length: 40, width: 20 },
} as const;

/**
 * Standard pitch keypoint labels and their field coordinates (11v11)
 * Coordinates are in meters from the center of the field
 */
export const PITCH_KEYPOINTS = {
  // Corners
  corner_tl: { x: -52.5, y: 34 }, // top-left corner
  corner_tr: { x: 52.5, y: 34 }, // top-right corner
  corner_bl: { x: -52.5, y: -34 }, // bottom-left corner
  corner_br: { x: 52.5, y: -34 }, // bottom-right corner

  // Center line
  center: { x: 0, y: 0 },
  center_top: { x: 0, y: 34 },
  center_bottom: { x: 0, y: -34 },

  // Penalty areas (left side)
  penalty_tl: { x: -52.5, y: 20.15 },
  penalty_bl: { x: -52.5, y: -20.15 },
  penalty_front_l: { x: -36, y: 20.15 },
  penalty_front_bl: { x: -36, y: -20.15 },

  // Penalty areas (right side)
  penalty_tr: { x: 52.5, y: 20.15 },
  penalty_br: { x: 52.5, y: -20.15 },
  penalty_front_r: { x: 36, y: 20.15 },
  penalty_front_br: { x: 36, y: -20.15 },

  // Goals
  goal_l_top: { x: -52.5, y: 3.66 },
  goal_l_bottom: { x: -52.5, y: -3.66 },
  goal_r_top: { x: 52.5, y: 3.66 },
  goal_r_bottom: { x: 52.5, y: -3.66 },

  // Center circle
  center_circle_top: { x: 0, y: 9.15 },
  center_circle_bottom: { x: 0, y: -9.15 },
  center_circle_left: { x: -9.15, y: 0 },
  center_circle_right: { x: 9.15, y: 0 },
} as const;

/**
 * Interface for homography estimator
 * Allows swapping implementations (placeholder vs. actual CV model)
 */
export interface HomographyEstimator {
  /**
   * Estimate homography from detected keypoints
   * @param keypoints Detected pitch keypoints
   * @returns Homography matrix (3x3) or null if estimation failed
   */
  estimate(keypoints: HomographyKeypoint[]): number[][] | null;

  /**
   * Detect pitch keypoints from a video frame
   * @param frameBuffer Image buffer of the frame
   * @returns Detected keypoints with confidence scores
   */
  detectKeypoints(frameBuffer: Buffer): Promise<HomographyKeypoint[]>;
}

/**
 * Multiply 3x3 matrices
 */
function multiplyMatrix3x3(a: number[][], b: number[][]): number[][] {
  const result: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }

  return result;
}

/**
 * Compute inverse of 3x3 matrix
 */
function invertMatrix3x3(m: number[][]): number[][] | null {
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  if (Math.abs(det) < 1e-10) {
    return null; // Singular matrix
  }

  const invDet = 1 / det;

  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * invDet,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invDet,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * invDet,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * invDet,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invDet,
    ],
  ];
}

/**
 * Transform a point using homography matrix
 * @param H 3x3 homography matrix
 * @param point Source point
 * @returns Transformed point
 */
export function transformPoint(H: number[][], point: Point2D): Point2D {
  const x = point.x;
  const y = point.y;

  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-10) {
    return { x: 0, y: 0 };
  }

  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  };
}

/**
 * Convert screen coordinates (0-1 normalized) to field coordinates (meters)
 * @param homography Homography data
 * @param screenPoint Screen point (normalized 0-1)
 * @returns Field coordinates in meters, or null if transformation failed
 */
export function screenToField(
  homography: HomographyData,
  screenPoint: Point2D
): Point2D | null {
  try {
    return transformPoint(homography.matrix, screenPoint);
  } catch {
    return null;
  }
}

/**
 * Convert field coordinates (meters) to screen coordinates (0-1 normalized)
 * @param homography Homography data
 * @param fieldPoint Field point in meters
 * @returns Screen coordinates (normalized 0-1), or null if transformation failed
 */
export function fieldToScreen(
  homography: HomographyData,
  fieldPoint: Point2D
): Point2D | null {
  try {
    const inverseMatrix = invertMatrix3x3(homography.matrix);
    if (!inverseMatrix) {
      return null;
    }
    return transformPoint(inverseMatrix, fieldPoint);
  } catch {
    return null;
  }
}

/**
 * Calculate distance between two field points in meters
 * @param p1 First field point
 * @param p2 Second field point
 * @returns Distance in meters
 */
export function fieldDistance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a field point is inside the pitch boundaries
 * @param point Field coordinates in meters
 * @param fieldSize Field dimensions
 * @returns True if point is on the pitch
 */
export function isOnPitch(
  point: Point2D,
  fieldSize: { length: number; width: number }
): boolean {
  const halfLength = fieldSize.length / 2;
  const halfWidth = fieldSize.width / 2;
  return (
    point.x >= -halfLength &&
    point.x <= halfLength &&
    point.y >= -halfWidth &&
    point.y <= halfWidth
  );
}

/**
 * Compute reprojection error for homography validation
 * @param H Homography matrix
 * @param keypoints Source keypoints
 * @returns Average reprojection error in screen units
 */
export function computeReprojectionError(
  H: number[][],
  keypoints: HomographyKeypoint[]
): number {
  if (keypoints.length === 0) return Infinity;

  let totalError = 0;

  for (const kp of keypoints) {
    const projected = transformPoint(H, kp.field);
    const dx = projected.x - kp.screen.x;
    const dy = projected.y - kp.screen.y;
    totalError += Math.sqrt(dx * dx + dy * dy);
  }

  return totalError / keypoints.length;
}

/**
 * Simple homography estimation using Direct Linear Transform (DLT)
 * Requires at least 4 point correspondences
 *
 * Note: This is a simplified implementation. Production use should
 * leverage OpenCV or similar for robust estimation with RANSAC.
 */
export function estimateHomographyDLT(
  srcPoints: Point2D[],
  dstPoints: Point2D[]
): number[][] | null {
  if (srcPoints.length < 4 || srcPoints.length !== dstPoints.length) {
    return null;
  }

  const n = srcPoints.length;

  // Build matrix A for DLT
  const A: number[][] = [];

  for (let i = 0; i < n; i++) {
    const x = srcPoints[i].x;
    const y = srcPoints[i].y;
    const xp = dstPoints[i].x;
    const yp = dstPoints[i].y;

    A.push([-x, -y, -1, 0, 0, 0, x * xp, y * xp, xp]);
    A.push([0, 0, 0, -x, -y, -1, x * yp, y * yp, yp]);
  }

  // Solve using SVD (simplified - in production use proper SVD library)
  // For now, return identity matrix as placeholder
  // Real implementation would solve Ah = 0 using SVD

  // Placeholder: return identity matrix
  // TODO: Implement proper SVD-based solution or use external library
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/**
 * Placeholder homography estimator
 * Returns mock data for development/testing
 */
export class PlaceholderHomographyEstimator implements HomographyEstimator {
  private readonly fieldSize: { length: number; width: number };

  constructor(fieldSize: { length: number; width: number } = FIELD_DIMENSIONS.eleven) {
    this.fieldSize = fieldSize;
  }

  estimate(keypoints: HomographyKeypoint[]): number[][] | null {
    if (keypoints.length < 4) {
      return null;
    }

    // Placeholder: Return mock homography matrix
    // In production, this would compute actual homography from keypoints
    const srcPoints = keypoints.map((kp) => kp.screen);
    const dstPoints = keypoints.map((kp) => kp.field);

    return estimateHomographyDLT(srcPoints, dstPoints);
  }

  async detectKeypoints(_frameBuffer: Buffer): Promise<HomographyKeypoint[]> {
    // Placeholder: Return mock keypoints
    // In production, this would use a ML model to detect pitch lines/corners
    return [
      {
        screen: { x: 0.1, y: 0.1 },
        field: { x: -this.fieldSize.length / 2, y: this.fieldSize.width / 2 },
        label: "corner_tl",
        confidence: 0.8,
      },
      {
        screen: { x: 0.9, y: 0.1 },
        field: { x: this.fieldSize.length / 2, y: this.fieldSize.width / 2 },
        label: "corner_tr",
        confidence: 0.8,
      },
      {
        screen: { x: 0.1, y: 0.9 },
        field: { x: -this.fieldSize.length / 2, y: -this.fieldSize.width / 2 },
        label: "corner_bl",
        confidence: 0.8,
      },
      {
        screen: { x: 0.9, y: 0.9 },
        field: { x: this.fieldSize.length / 2, y: -this.fieldSize.width / 2 },
        label: "corner_br",
        confidence: 0.8,
      },
    ];
  }
}

/**
 * Create HomographyData from keypoints
 */
export function createHomographyData(
  matchId: string,
  frameNumber: number,
  keypoints: HomographyKeypoint[],
  estimator: HomographyEstimator,
  fieldSize?: { length: number; width: number }
): HomographyData | null {
  const matrix = estimator.estimate(keypoints);
  if (!matrix) {
    return null;
  }

  const avgConfidence =
    keypoints.reduce((sum, kp) => sum + kp.confidence, 0) / keypoints.length;

  return {
    matchId,
    frameNumber,
    matrix,
    keypoints,
    confidence: avgConfidence,
    fieldSize,
    version: "1.0.0",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Interpolate homography between two frames
 * Useful when homography is only computed periodically
 */
export function interpolateHomography(
  h1: HomographyData,
  h2: HomographyData,
  targetFrame: number
): HomographyData {
  if (h1.frameNumber === h2.frameNumber) {
    return h1;
  }

  const t =
    (targetFrame - h1.frameNumber) / (h2.frameNumber - h1.frameNumber);
  const clampedT = Math.max(0, Math.min(1, t));

  // Linear interpolation of matrix elements
  const interpolatedMatrix = h1.matrix.map((row, i) =>
    row.map((val, j) => val + clampedT * (h2.matrix[i][j] - val))
  );

  return {
    ...h1,
    frameNumber: targetFrame,
    matrix: interpolatedMatrix,
    confidence: h1.confidence + clampedT * (h2.confidence - h1.confidence),
    cameraMoving: true,
  };
}
