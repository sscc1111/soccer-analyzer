/**
 * Color Clustering Module
 *
 * K-means based color clustering for team classification.
 * Analyzes dominant colors from player bounding boxes to
 * automatically separate players into teams.
 *
 * Works without ML models - uses classical computer vision techniques.
 */

import type { Detection } from "./types";
import { hexToRgb, rgbToHsv, type RGB, type HSV } from "./filters";

// Re-export RGB type for consumers of this module
export type { RGB } from "./filters";

// ============================================================================
// Constants
// ============================================================================

/**
 * Jersey region extraction constants
 * Defines the portion of the bounding box to sample for jersey color
 */
export const JERSEY_REGION = {
  /** Offset from top of bbox (avoid head) */
  TOP_OFFSET: 0.15,
  /** Offset from bottom of bbox (jersey ends around mid-torso) */
  BOTTOM_OFFSET: 0.55,
  /** Offset from left edge (avoid arms) */
  LEFT_OFFSET: 0.25,
  /** Offset from right edge (avoid arms) */
  RIGHT_OFFSET: 0.75,
} as const;

/**
 * Default neutral color when color extraction fails
 */
export const DEFAULT_NEUTRAL_COLOR: RGB = { r: 128, g: 128, b: 128 };

/**
 * Image buffer format constants
 */
export const IMAGE_FORMAT = {
  /** RGB format - 3 bytes per pixel */
  RGB_BYTES_PER_PIXEL: 3,
  /** RGBA format - 4 bytes per pixel */
  RGBA_BYTES_PER_PIXEL: 4,
} as const;

// ============================================================================
// Types
// ============================================================================

export type ColorSample = {
  trackId: string;
  color: RGB;
  position: { x: number; y: number };
};

export type ClusterResult = {
  /** Cluster ID (0 or 1 for two teams, 2 for referees) */
  clusterId: number;
  /** Cluster centroid color */
  centroid: RGB;
  /** Members of this cluster */
  members: ColorSample[];
  /** Average distance from centroid (lower = more cohesive) */
  avgDistance: number;
};

export type TeamClassificationResult = {
  /** Track ID to team assignment */
  assignments: Map<string, "home" | "away" | "referee" | "unknown">;
  /** Cluster information */
  clusters: ClusterResult[];
  /** Overall confidence of the classification */
  confidence: number;
  /** Detected team colors (hex) */
  detectedColors: {
    home: string;
    away: string;
    referee?: string;
  };
};

export type KMeansConfig = {
  /** Number of clusters (typically 2 for teams, 3 if including refs) */
  k: number;
  /** Maximum iterations */
  maxIterations: number;
  /** Convergence threshold */
  convergenceThreshold: number;
  /** Use HSV space for clustering (better for jerseys) */
  useHsvSpace: boolean;
  /** Minimum samples required for reliable clustering */
  minSamples: number;
};

// ============================================================================
// Configuration
// ============================================================================

export const DEFAULT_KMEANS_CONFIG: KMeansConfig = {
  k: 2,
  maxIterations: 100,
  convergenceThreshold: 0.001,
  useHsvSpace: true,
  minSamples: 6, // At least 3 players per team
};

// ============================================================================
// Color Distance Functions
// ============================================================================

/**
 * Euclidean distance in RGB space
 */
export function rgbDistance(c1: RGB, c2: RGB): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Distance in HSV space (weighted for jersey colors)
 * Hue is circular, so we handle wraparound
 */
export function hsvDistance(c1: RGB, c2: RGB): number {
  const hsv1 = rgbToHsv(c1);
  const hsv2 = rgbToHsv(c2);

  // Hue distance (circular)
  const hueDiff = Math.min(
    Math.abs(hsv1.h - hsv2.h),
    360 - Math.abs(hsv1.h - hsv2.h)
  );
  const hueDistance = hueDiff / 180; // Normalize to 0-1

  // Saturation and value distance
  const satDistance = Math.abs(hsv1.s - hsv2.s);
  const valDistance = Math.abs(hsv1.v - hsv2.v);

  // Weighted combination
  // Hue is most important for distinguishing jerseys
  // Value matters less (shadows, lighting)
  return Math.sqrt(
    hueDistance * hueDistance * 4 +
      satDistance * satDistance * 2 +
      valDistance * valDistance
  );
}

// ============================================================================
// K-Means Implementation
// ============================================================================

/**
 * Initialize centroids using K-means++ algorithm
 * This provides better initial centroids than random selection
 */
function initializeCentroids(
  samples: ColorSample[],
  k: number,
  distanceFn: (c1: RGB, c2: RGB) => number
): RGB[] {
  if (samples.length < k) {
    // Not enough samples, return sample colors
    return samples.map((s) => ({ ...s.color }));
  }

  const centroids: RGB[] = [];

  // Choose first centroid randomly
  const firstIndex = Math.floor(Math.random() * samples.length);
  centroids.push({ ...samples[firstIndex].color });

  // Choose remaining centroids with probability proportional to distance
  for (let i = 1; i < k; i++) {
    const distances: number[] = [];
    let totalDistance = 0;

    for (const sample of samples) {
      // Find minimum distance to existing centroids
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = distanceFn(sample.color, centroid);
        minDist = Math.min(minDist, dist);
      }
      distances.push(minDist * minDist); // Square for weighted probability
      totalDistance += minDist * minDist;
    }

    // Choose next centroid with weighted probability
    let random = Math.random() * totalDistance;
    for (let j = 0; j < samples.length; j++) {
      random -= distances[j];
      if (random <= 0) {
        centroids.push({ ...samples[j].color });
        break;
      }
    }

    // Fallback if we didn't select (floating point issues)
    if (centroids.length === i) {
      centroids.push({ ...samples[samples.length - 1].color });
    }
  }

  return centroids;
}

/**
 * Assign samples to nearest centroid
 */
function assignToClusters(
  samples: ColorSample[],
  centroids: RGB[],
  distanceFn: (c1: RGB, c2: RGB) => number
): number[] {
  return samples.map((sample) => {
    let minDist = Infinity;
    let minIndex = 0;

    for (let i = 0; i < centroids.length; i++) {
      const dist = distanceFn(sample.color, centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        minIndex = i;
      }
    }

    return minIndex;
  });
}

/**
 * Update centroids based on cluster assignments
 */
function updateCentroids(
  samples: ColorSample[],
  assignments: number[],
  k: number
): RGB[] {
  const sums: { r: number; g: number; b: number; count: number }[] = [];

  for (let i = 0; i < k; i++) {
    sums.push({ r: 0, g: 0, b: 0, count: 0 });
  }

  for (let i = 0; i < samples.length; i++) {
    const cluster = assignments[i];
    const color = samples[i].color;
    sums[cluster].r += color.r;
    sums[cluster].g += color.g;
    sums[cluster].b += color.b;
    sums[cluster].count++;
  }

  return sums.map((sum) => {
    if (sum.count === 0) {
      // Empty cluster, return neutral gray
      return { r: 128, g: 128, b: 128 };
    }
    return {
      r: Math.round(sum.r / sum.count),
      g: Math.round(sum.g / sum.count),
      b: Math.round(sum.b / sum.count),
    };
  });
}

/**
 * Check if centroids have converged
 */
function hasConverged(
  oldCentroids: RGB[],
  newCentroids: RGB[],
  threshold: number
): boolean {
  for (let i = 0; i < oldCentroids.length; i++) {
    const dist = rgbDistance(oldCentroids[i], newCentroids[i]);
    if (dist > threshold * 255) {
      // Scale threshold by color range
      return false;
    }
  }
  return true;
}

/**
 * Run K-means clustering on color samples
 */
export function kMeansClustering(
  samples: ColorSample[],
  config: Partial<KMeansConfig> = {}
): ClusterResult[] {
  const cfg: KMeansConfig = { ...DEFAULT_KMEANS_CONFIG, ...config };

  if (samples.length < cfg.minSamples) {
    // Not enough samples for reliable clustering
    return [];
  }

  const distanceFn = cfg.useHsvSpace ? hsvDistance : rgbDistance;

  // Initialize centroids using K-means++
  let centroids = initializeCentroids(samples, cfg.k, distanceFn);
  let assignments = assignToClusters(samples, centroids, distanceFn);

  // Iterate until convergence
  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    const newCentroids = updateCentroids(samples, assignments, cfg.k);

    if (hasConverged(centroids, newCentroids, cfg.convergenceThreshold)) {
      break;
    }

    centroids = newCentroids;
    assignments = assignToClusters(samples, centroids, distanceFn);
  }

  // Build cluster results
  const clusters: ClusterResult[] = [];

  for (let i = 0; i < cfg.k; i++) {
    const members: ColorSample[] = [];
    let totalDistance = 0;

    for (let j = 0; j < samples.length; j++) {
      if (assignments[j] === i) {
        members.push(samples[j]);
        totalDistance += distanceFn(samples[j].color, centroids[i]);
      }
    }

    clusters.push({
      clusterId: i,
      centroid: centroids[i],
      members,
      avgDistance: members.length > 0 ? totalDistance / members.length : 0,
    });
  }

  // Sort clusters by size (largest first)
  clusters.sort((a, b) => b.members.length - a.members.length);

  // Reassign cluster IDs after sorting
  clusters.forEach((c, i) => {
    c.clusterId = i;
  });

  return clusters;
}

// ============================================================================
// Team Classification
// ============================================================================

/**
 * Convert RGB to hex string
 */
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => {
    const hex = Math.round(n).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Classify players into teams based on color clustering
 *
 * @param samples Color samples extracted from player bounding boxes
 * @param userTeamColors Optional user-provided team colors for alignment
 * @returns Team classification result
 */
export function classifyTeamsByColor(
  samples: ColorSample[],
  userTeamColors?: { home: string; away: string } | null,
  config: Partial<KMeansConfig> = {}
): TeamClassificationResult {
  const assignments = new Map<string, "home" | "away" | "referee" | "unknown">();

  if (samples.length < (config.minSamples ?? DEFAULT_KMEANS_CONFIG.minSamples)) {
    // Not enough samples
    for (const sample of samples) {
      assignments.set(sample.trackId, "unknown");
    }
    return {
      assignments,
      clusters: [],
      confidence: 0,
      detectedColors: { home: "#808080", away: "#808080" },
    };
  }

  // Run K-means clustering
  const clusters = kMeansClustering(samples, config);

  if (clusters.length < 2) {
    // Clustering failed
    for (const sample of samples) {
      assignments.set(sample.trackId, "unknown");
    }
    return {
      assignments,
      clusters,
      confidence: 0,
      detectedColors: { home: "#808080", away: "#808080" },
    };
  }

  // Determine which cluster is home vs away
  let homeClusterId = 0;
  let awayClusterId = 1;

  if (userTeamColors) {
    // Match clusters to user-specified colors
    const homeRgb = hexToRgb(userTeamColors.home);
    const awayRgb = hexToRgb(userTeamColors.away);

    const distanceFn = config.useHsvSpace ?? DEFAULT_KMEANS_CONFIG.useHsvSpace
      ? hsvDistance
      : rgbDistance;

    // Calculate distances from each cluster to user colors
    const cluster0ToHome = distanceFn(clusters[0].centroid, homeRgb);
    const cluster0ToAway = distanceFn(clusters[0].centroid, awayRgb);
    const cluster1ToHome = distanceFn(clusters[1].centroid, homeRgb);
    const cluster1ToAway = distanceFn(clusters[1].centroid, awayRgb);

    // Assign based on minimum total distance
    const assignment1 = cluster0ToHome + cluster1ToAway;
    const assignment2 = cluster0ToAway + cluster1ToHome;

    if (assignment2 < assignment1) {
      homeClusterId = 1;
      awayClusterId = 0;
    }
  }

  // Assign team labels
  for (const sample of samples) {
    const cluster = clusters.find((c) =>
      c.members.some((m) => m.trackId === sample.trackId)
    );

    if (!cluster) {
      assignments.set(sample.trackId, "unknown");
    } else if (cluster.clusterId === homeClusterId) {
      assignments.set(sample.trackId, "home");
    } else if (cluster.clusterId === awayClusterId) {
      assignments.set(sample.trackId, "away");
    } else {
      // Third cluster could be referees
      assignments.set(sample.trackId, "referee");
    }
  }

  // Calculate confidence based on cluster separation
  const distanceFn = config.useHsvSpace ?? DEFAULT_KMEANS_CONFIG.useHsvSpace
    ? hsvDistance
    : rgbDistance;

  const clusterSeparation = distanceFn(
    clusters[0].centroid,
    clusters[1].centroid
  );
  const avgIntraClusterDistance =
    (clusters[0].avgDistance + clusters[1].avgDistance) / 2;

  // Confidence is higher when clusters are well-separated and cohesive
  // silhouette-like score
  const confidence = Math.min(
    1,
    Math.max(0, clusterSeparation / (avgIntraClusterDistance + 0.001) - 1) / 2
  );

  return {
    assignments,
    clusters,
    confidence,
    detectedColors: {
      home: rgbToHex(clusters[homeClusterId].centroid),
      away: rgbToHex(clusters[awayClusterId].centroid),
      referee: clusters.length > 2 ? rgbToHex(clusters[2].centroid) : undefined,
    },
  };
}

// ============================================================================
// Color Extraction Helpers
// ============================================================================

/**
 * Extract dominant color from a region of an image buffer
 * This is a simplified implementation - real implementation would
 * analyze the actual pixel data from the image
 *
 * @param buffer Image buffer (RGB format)
 * @param width Image width
 * @param height Image height
 * @param bbox Bounding box region to analyze
 * @returns Dominant RGB color
 */
export function extractDominantColor(
  buffer: Buffer,
  width: number,
  height: number,
  bbox: { x: number; y: number; w: number; h: number },
  bytesPerPixel: number = IMAGE_FORMAT.RGB_BYTES_PER_PIXEL
): RGB {
  // Ensure bbox is within bounds
  const x1 = Math.max(0, Math.floor(bbox.x));
  const y1 = Math.max(0, Math.floor(bbox.y));
  const x2 = Math.min(width - 1, Math.floor(bbox.x + bbox.w));
  const y2 = Math.min(height - 1, Math.floor(bbox.y + bbox.h));

  if (x2 <= x1 || y2 <= y1) {
    return DEFAULT_NEUTRAL_COLOR;
  }

  // Validate buffer size
  const expectedSize = width * height * bytesPerPixel;
  if (buffer.length < expectedSize) {
    console.warn(`Buffer size mismatch: got ${buffer.length}, expected ${expectedSize}`);
    return DEFAULT_NEUTRAL_COLOR;
  }

  // Sample the upper-middle portion of the bbox (jersey area)
  // This avoids legs and shoes which have different colors
  const jerseyY1 = y1 + Math.floor((y2 - y1) * JERSEY_REGION.TOP_OFFSET);
  const jerseyY2 = y1 + Math.floor((y2 - y1) * JERSEY_REGION.BOTTOM_OFFSET);
  const jerseyX1 = x1 + Math.floor((x2 - x1) * JERSEY_REGION.LEFT_OFFSET);
  const jerseyX2 = x1 + Math.floor((x2 - x1) * JERSEY_REGION.RIGHT_OFFSET);

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let y = jerseyY1; y <= jerseyY2; y++) {
    for (let x = jerseyX1; x <= jerseyX2; x++) {
      const idx = (y * width + x) * bytesPerPixel;

      if (idx + 2 < buffer.length) {
        totalR += buffer[idx];
        totalG += buffer[idx + 1];
        totalB += buffer[idx + 2];
        count++;
      }
    }
  }

  if (count === 0) {
    return DEFAULT_NEUTRAL_COLOR;
  }

  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
  };
}

/**
 * Create color samples from detections and an image buffer
 */
export function createColorSamples(
  detections: Detection[],
  buffer: Buffer,
  width: number,
  height: number
): ColorSample[] {
  return detections
    .filter((d) => d.label) // Must have trackId
    .map((d) => ({
      trackId: d.label!,
      color: extractDominantColor(buffer, width, height, d.bbox),
      position: d.center,
    }));
}
