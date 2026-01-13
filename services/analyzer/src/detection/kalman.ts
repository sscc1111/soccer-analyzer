/**
 * Kalman Filter implementation for player trajectory prediction
 *
 * Used to:
 * - Smooth noisy position data from detection
 * - Predict player positions when they leave the camera frame
 * - Re-associate tracks when players re-enter the frame
 */

import type {
  Point2D,
  Velocity2D,
  PredictedPosition,
  PredictionConfig,
} from "@soccer/shared";

/**
 * Default prediction configuration
 */
export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  processNoise: 0.1,
  measurementNoise: 0.5,
  confidenceDecayRate: 0.2, // 20% decay per second
  maxPredictionTime: 5, // Maximum 5 seconds of prediction
};

/**
 * State vector for 2D position tracking
 * [x, y, vx, vy] - position and velocity
 */
type StateVector = [number, number, number, number];

/**
 * 4x4 matrix type for state covariance
 */
type Matrix4x4 = number[][];

/**
 * Create identity 4x4 matrix
 */
function identity4x4(): Matrix4x4 {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

/**
 * Create zero 4x4 matrix
 */
function zeros4x4(): Matrix4x4 {
  return [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
}

/**
 * Matrix addition
 */
function addMatrix(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}

/**
 * Matrix subtraction
 */
function subMatrix(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
  return a.map((row, i) => row.map((val, j) => val - b[i][j]));
}

/**
 * Matrix multiplication (4x4 * 4x4)
 */
function multiplyMatrix(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
  const result = zeros4x4();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}

/**
 * Matrix transpose
 */
function transposeMatrix(m: Matrix4x4): Matrix4x4 {
  return m[0].map((_, i) => m.map((row) => row[i]));
}

/**
 * Matrix-vector multiplication (4x4 * 4x1)
 */
function multiplyMatrixVector(m: Matrix4x4, v: StateVector): StateVector {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3] * v[3],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3] * v[3],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3] * v[3],
    m[3][0] * v[0] + m[3][1] * v[1] + m[3][2] * v[2] + m[3][3] * v[3],
  ];
}

/**
 * Scalar multiplication of matrix
 */
function scaleMatrix(m: Matrix4x4, s: number): Matrix4x4 {
  return m.map((row) => row.map((val) => val * s));
}

/**
 * Invert 4x4 matrix using Gauss-Jordan elimination
 * Returns null if matrix is singular
 */
function invertMatrix4x4(m: Matrix4x4): Matrix4x4 | null {
  // Create augmented matrix [m | I]
  const aug: number[][] = m.map((row, i) => [
    ...row,
    ...[0, 0, 0, 0].map((_, j) => (i === j ? 1 : 0)),
  ]);

  // Gauss-Jordan elimination
  for (let i = 0; i < 4; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < 4; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
        maxRow = k;
      }
    }

    // Swap rows
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

    // Check for singularity
    if (Math.abs(aug[i][i]) < 1e-10) {
      return null;
    }

    // Scale pivot row
    const scale = aug[i][i];
    for (let j = 0; j < 8; j++) {
      aug[i][j] /= scale;
    }

    // Eliminate column
    for (let k = 0; k < 4; k++) {
      if (k !== i) {
        const factor = aug[k][i];
        for (let j = 0; j < 8; j++) {
          aug[k][j] -= factor * aug[i][j];
        }
      }
    }
  }

  // Extract inverse matrix
  return aug.map((row) => row.slice(4));
}

/**
 * Create state transition matrix F for given time delta
 * Assumes constant velocity model
 */
function createTransitionMatrix(dt: number): Matrix4x4 {
  return [
    [1, 0, dt, 0],
    [0, 1, 0, dt],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

/**
 * Create process noise matrix Q
 * Models uncertainty in the motion model
 */
function createProcessNoiseMatrix(dt: number, noise: number): Matrix4x4 {
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt3 * dt;

  const q = noise * noise;

  return [
    [(dt4 * q) / 4, 0, (dt3 * q) / 2, 0],
    [0, (dt4 * q) / 4, 0, (dt3 * q) / 2],
    [(dt3 * q) / 2, 0, dt2 * q, 0],
    [0, (dt3 * q) / 2, 0, dt2 * q],
  ];
}

/**
 * Measurement matrix H (observes only position, not velocity)
 */
const MEASUREMENT_MATRIX: number[][] = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
];

/**
 * Kalman Filter for 2D position tracking with velocity estimation
 */
export class KalmanFilter2D {
  private state: StateVector;
  private covariance: Matrix4x4;
  private readonly config: PredictionConfig;
  private lastUpdateTime: number;
  private lastObservationFrame: number;

  constructor(
    initialPosition: Point2D,
    initialVelocity: Velocity2D = { vx: 0, vy: 0 },
    config: PredictionConfig = DEFAULT_PREDICTION_CONFIG
  ) {
    this.state = [
      initialPosition.x,
      initialPosition.y,
      initialVelocity.vx,
      initialVelocity.vy,
    ];

    // Initial covariance - high uncertainty
    this.covariance = scaleMatrix(identity4x4(), 1);

    this.config = config;
    this.lastUpdateTime = 0;
    this.lastObservationFrame = 0;
  }

  /**
   * Predict state forward in time
   * @param dt Time delta in seconds
   */
  predict(dt: number): void {
    if (dt <= 0) return;

    // State transition matrix
    const F = createTransitionMatrix(dt);

    // Process noise
    const Q = createProcessNoiseMatrix(dt, this.config.processNoise);

    // Predict state: x' = F * x
    this.state = multiplyMatrixVector(F, this.state);

    // Predict covariance: P' = F * P * F^T + Q
    const FT = transposeMatrix(F);
    this.covariance = addMatrix(
      multiplyMatrix(multiplyMatrix(F, this.covariance), FT),
      Q
    );
  }

  /**
   * Update state with new observation
   * @param position Observed position
   * @param frameNumber Frame number of observation
   * @param timestamp Timestamp of observation
   */
  update(position: Point2D, frameNumber: number, timestamp: number): void {
    const measurement = [position.x, position.y];

    // Measurement matrix (2x4)
    const H = MEASUREMENT_MATRIX;

    // Measurement noise (2x2)
    const R: number[][] = [
      [this.config.measurementNoise * this.config.measurementNoise, 0],
      [0, this.config.measurementNoise * this.config.measurementNoise],
    ];

    // Innovation: y = z - H * x
    const predicted = [
      H[0][0] * this.state[0] + H[0][2] * this.state[2],
      H[1][1] * this.state[1] + H[1][3] * this.state[3],
    ];
    const innovation = [
      measurement[0] - predicted[0],
      measurement[1] - predicted[1],
    ];

    // Innovation covariance: S = H * P * H^T + R
    const HP: number[][] = [
      [
        this.covariance[0][0],
        this.covariance[0][1],
        this.covariance[0][2],
        this.covariance[0][3],
      ],
      [
        this.covariance[1][0],
        this.covariance[1][1],
        this.covariance[1][2],
        this.covariance[1][3],
      ],
    ];
    const S: number[][] = [
      [HP[0][0] + R[0][0], HP[0][1]],
      [HP[1][0], HP[1][1] + R[1][1]],
    ];

    // Kalman gain: K = P * H^T * S^(-1)
    const detS = S[0][0] * S[1][1] - S[0][1] * S[1][0];
    if (Math.abs(detS) < 1e-10) return;

    const SInv: number[][] = [
      [S[1][1] / detS, -S[0][1] / detS],
      [-S[1][0] / detS, S[0][0] / detS],
    ];

    // Simplified Kalman gain calculation
    const K: number[][] = [
      [
        this.covariance[0][0] * SInv[0][0] + this.covariance[0][1] * SInv[1][0],
        this.covariance[0][0] * SInv[0][1] + this.covariance[0][1] * SInv[1][1],
      ],
      [
        this.covariance[1][0] * SInv[0][0] + this.covariance[1][1] * SInv[1][0],
        this.covariance[1][0] * SInv[0][1] + this.covariance[1][1] * SInv[1][1],
      ],
      [
        this.covariance[2][0] * SInv[0][0] + this.covariance[2][1] * SInv[1][0],
        this.covariance[2][0] * SInv[0][1] + this.covariance[2][1] * SInv[1][1],
      ],
      [
        this.covariance[3][0] * SInv[0][0] + this.covariance[3][1] * SInv[1][0],
        this.covariance[3][0] * SInv[0][1] + this.covariance[3][1] * SInv[1][1],
      ],
    ];

    // Update state: x = x + K * y
    this.state = [
      this.state[0] + K[0][0] * innovation[0] + K[0][1] * innovation[1],
      this.state[1] + K[1][0] * innovation[0] + K[1][1] * innovation[1],
      this.state[2] + K[2][0] * innovation[0] + K[2][1] * innovation[1],
      this.state[3] + K[3][0] * innovation[0] + K[3][1] * innovation[1],
    ];

    // Update covariance: P = (I - K * H) * P
    const KH: Matrix4x4 = [
      [K[0][0], K[0][1], 0, 0],
      [K[1][0], K[1][1], 0, 0],
      [K[2][0], K[2][1], 0, 0],
      [K[3][0], K[3][1], 0, 0],
    ];
    const IminusKH = subMatrix(identity4x4(), KH);
    this.covariance = multiplyMatrix(IminusKH, this.covariance);

    this.lastUpdateTime = timestamp;
    this.lastObservationFrame = frameNumber;
  }

  /**
   * Get current position estimate
   */
  getPosition(): Point2D {
    return { x: this.state[0], y: this.state[1] };
  }

  /**
   * Get current velocity estimate
   */
  getVelocity(): Velocity2D {
    return { vx: this.state[2], vy: this.state[3] };
  }

  /**
   * Get prediction confidence (decays with time since last observation)
   */
  getConfidence(currentTime: number): number {
    const timeSinceObservation = currentTime - this.lastUpdateTime;
    const decay = Math.exp(
      -this.config.confidenceDecayRate * timeSinceObservation
    );
    return Math.max(0, decay);
  }

  /**
   * Check if prediction is still valid
   */
  isPredictionValid(currentTime: number): boolean {
    const timeSinceObservation = currentTime - this.lastUpdateTime;
    return timeSinceObservation <= this.config.maxPredictionTime;
  }

  /**
   * Create PredictedPosition object
   */
  toPredictedPosition(
    trackId: string,
    frameNumber: number,
    currentTime: number
  ): PredictedPosition {
    return {
      trackId,
      frameNumber,
      position: this.getPosition(),
      velocity: this.getVelocity(),
      isPredicted: true,
      confidence: this.getConfidence(currentTime),
      lastObservedFrame: this.lastObservationFrame,
      timeSinceObservation: currentTime - this.lastUpdateTime,
    };
  }
}

/**
 * Manager for multiple Kalman filters (one per track)
 */
export class TrackPredictor {
  private readonly filters: Map<string, KalmanFilter2D>;
  private readonly config: PredictionConfig;

  constructor(config: PredictionConfig = DEFAULT_PREDICTION_CONFIG) {
    this.filters = new Map();
    this.config = config;
  }

  /**
   * Initialize filter for a new track
   */
  initTrack(
    trackId: string,
    position: Point2D,
    velocity?: Velocity2D
  ): void {
    this.filters.set(
      trackId,
      new KalmanFilter2D(position, velocity, this.config)
    );
  }

  /**
   * Update track with new observation
   */
  updateTrack(
    trackId: string,
    position: Point2D,
    frameNumber: number,
    timestamp: number
  ): void {
    let filter = this.filters.get(trackId);
    if (!filter) {
      filter = new KalmanFilter2D(position, undefined, this.config);
      this.filters.set(trackId, filter);
    }
    filter.update(position, frameNumber, timestamp);
  }

  /**
   * Predict all tracks forward in time
   */
  predictAll(dt: number): void {
    for (const filter of this.filters.values()) {
      filter.predict(dt);
    }
  }

  /**
   * Get prediction for a specific track
   */
  getPrediction(
    trackId: string,
    frameNumber: number,
    currentTime: number
  ): PredictedPosition | null {
    const filter = this.filters.get(trackId);
    if (!filter || !filter.isPredictionValid(currentTime)) {
      return null;
    }
    return filter.toPredictedPosition(trackId, frameNumber, currentTime);
  }

  /**
   * Get all valid predictions
   */
  getAllPredictions(
    frameNumber: number,
    currentTime: number
  ): PredictedPosition[] {
    const predictions: PredictedPosition[] = [];

    for (const [trackId, filter] of this.filters) {
      if (filter.isPredictionValid(currentTime)) {
        predictions.push(
          filter.toPredictedPosition(trackId, frameNumber, currentTime)
        );
      }
    }

    return predictions;
  }

  /**
   * Remove stale tracks
   */
  pruneStale(currentTime: number): string[] {
    const removed: string[] = [];

    for (const [trackId, filter] of this.filters) {
      if (!filter.isPredictionValid(currentTime)) {
        this.filters.delete(trackId);
        removed.push(trackId);
      }
    }

    return removed;
  }

  /**
   * Check if track exists
   */
  hasTrack(trackId: string): boolean {
    return this.filters.has(trackId);
  }

  /**
   * Get number of active tracks
   */
  get trackCount(): number {
    return this.filters.size;
  }
}

/**
 * Calculate distance between predicted position and observation
 * Used for track re-association
 */
export function predictionDistance(
  prediction: PredictedPosition,
  observation: Point2D
): number {
  const dx = prediction.position.x - observation.x;
  const dy = prediction.position.y - observation.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find best matching track for a new observation
 * @param predictions Available predictions
 * @param observation New observation
 * @param maxDistance Maximum distance for matching
 * @returns Best matching track ID or null
 */
export function findBestMatch(
  predictions: PredictedPosition[],
  observation: Point2D,
  maxDistance: number = 0.1
): string | null {
  let bestMatch: string | null = null;
  let bestDistance = maxDistance;

  for (const pred of predictions) {
    const dist = predictionDistance(pred, observation);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = pred.trackId;
    }
  }

  return bestMatch;
}
