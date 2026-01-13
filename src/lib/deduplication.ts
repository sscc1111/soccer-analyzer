/**
 * Phase 2.3: Event Deduplication Utilities
 *
 * Handles deduplication of events detected from overlapping time windows.
 * Events from the same actual occurrence but detected in multiple windows
 * are merged into a single representative event.
 */

import type { TeamId } from "@soccer/shared";

/**
 * Raw event from a single analysis window
 */
export interface RawEvent {
  /** ID of the time window this event was detected in */
  windowId: string;
  /** Timestamp relative to the window start (seconds) */
  relativeTimestamp: number;
  /** Absolute timestamp from video start (seconds) */
  absoluteTimestamp: number;
  /** Event type */
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece";
  /** Team performing the action */
  team: TeamId;
  /** Player identifier (jersey number or name) */
  player?: string;
  /** Field zone where event occurred */
  zone?: "defensive_third" | "middle_third" | "attacking_third";
  /** Type-specific event details */
  details: Record<string, unknown>;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Visual evidence description */
  visualEvidence?: string;
}

/**
 * Deduplicated event after merging clusters
 */
export interface DeduplicatedEvent extends Omit<RawEvent, "windowId" | "relativeTimestamp"> {
  /** List of window IDs this event was merged from */
  mergedFromWindows: string[];
  /** Adjusted confidence after merging */
  adjustedConfidence: number;
}

/**
 * Configuration for deduplication algorithm
 */
export interface DeduplicationConfig {
  /** Maximum time difference (seconds) for events to be considered duplicates */
  timeThreshold: number;
  /** Confidence boost per additional detection (capped at 1.0) */
  confidenceBoostPerDetection: number;
}

/**
 * Default deduplication configuration
 */
export const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  timeThreshold: 2.0, // 2 seconds
  confidenceBoostPerDetection: 0.1, // 10% boost per additional detection
};

/**
 * Group events into clusters based on temporal and semantic similarity.
 *
 * Events are clustered if they:
 * 1. Occur within `timeThreshold` seconds of each other
 * 2. Have the same event type
 * 3. Have the same team
 *
 * @param events - Array of raw events to cluster
 * @param config - Deduplication configuration
 * @returns Array of event clusters
 */
export function clusterEvents(
  events: RawEvent[],
  config: DeduplicationConfig = DEFAULT_DEDUPLICATION_CONFIG
): RawEvent[][] {
  if (events.length === 0) return [];

  // Sort by absolute timestamp for temporal clustering
  const sortedEvents = [...events].sort((a, b) => a.absoluteTimestamp - b.absoluteTimestamp);

  const clusters: RawEvent[][] = [];
  let currentCluster: RawEvent[] = [sortedEvents[0]];

  for (let i = 1; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const lastInCluster = currentCluster[currentCluster.length - 1];

    const timeDiff = Math.abs(event.absoluteTimestamp - lastInCluster.absoluteTimestamp);
    const sameType = event.type === lastInCluster.type;
    const sameTeam = event.team === lastInCluster.team;

    if (timeDiff <= config.timeThreshold && sameType && sameTeam) {
      // Add to current cluster
      currentCluster.push(event);
    } else {
      // Start new cluster
      clusters.push(currentCluster);
      currentCluster = [event];
    }
  }

  // Don't forget the last cluster
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  return clusters;
}

/**
 * Merge a cluster of duplicate events into a single representative event.
 *
 * Merging strategy:
 * 1. Select highest confidence event as the base
 * 2. Calculate weighted average timestamp (weighted by confidence)
 * 3. Merge details from all events (prioritizing high-confidence sources)
 * 4. Adjust confidence based on cluster size
 *
 * @param cluster - Array of events to merge
 * @param config - Deduplication configuration
 * @returns Merged event
 */
export function mergeCluster(
  cluster: RawEvent[],
  config: DeduplicationConfig = DEFAULT_DEDUPLICATION_CONFIG
): DeduplicatedEvent {
  if (cluster.length === 0) {
    throw new Error("Cannot merge empty cluster");
  }

  if (cluster.length === 1) {
    // Single event - no merging needed
    const event = cluster[0];
    const { windowId, relativeTimestamp, ...rest } = event;
    return {
      ...rest,
      mergedFromWindows: [windowId],
      adjustedConfidence: event.confidence,
    };
  }

  // Select base event (highest confidence)
  const baseEvent = cluster.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  );

  // Calculate weighted average timestamp
  const totalConfidence = cluster.reduce((sum, e) => sum + e.confidence, 0);
  const weightedTimestamp =
    cluster.reduce((sum, e) => sum + e.absoluteTimestamp * e.confidence, 0) / totalConfidence;

  // Merge details (prioritize high-confidence events)
  const mergedDetails: Record<string, unknown> = {};
  const sortedByConfidence = [...cluster].sort((a, b) => b.confidence - a.confidence);

  for (const event of sortedByConfidence) {
    for (const [key, value] of Object.entries(event.details)) {
      if (!(key in mergedDetails) && value !== undefined && value !== null) {
        mergedDetails[key] = value;
      }
    }
  }

  // Calculate adjusted confidence
  // Boost confidence for multiple detections, but cap at 1.0
  const baseConfidence = baseEvent.confidence;
  const confidenceBoost = config.confidenceBoostPerDetection * (cluster.length - 1);
  const adjustedConfidence = Math.min(1.0, baseConfidence * (1 + confidenceBoost));

  // Merge visual evidence (collect from all events)
  const visualEvidences = cluster
    .map((e) => e.visualEvidence)
    .filter((v): v is string => !!v);
  const mergedVisualEvidence =
    visualEvidences.length > 0 ? visualEvidences.join("; ") : undefined;

  // Merge player info (prefer from highest confidence)
  const player = baseEvent.player || cluster.find((e) => e.player)?.player;

  // Merge zone info (prefer from highest confidence)
  const zone = baseEvent.zone || cluster.find((e) => e.zone)?.zone;

  const { windowId, relativeTimestamp, ...baseRest } = baseEvent;

  return {
    ...baseRest,
    absoluteTimestamp: weightedTimestamp,
    player,
    zone,
    details: mergedDetails,
    mergedFromWindows: cluster.map((e) => e.windowId),
    adjustedConfidence,
    visualEvidence: mergedVisualEvidence,
  };
}

/**
 * Deduplicate an array of raw events.
 *
 * This is the main entry point for deduplication. It:
 * 1. Clusters events by time, type, and team
 * 2. Merges each cluster into a single event
 * 3. Returns the deduplicated event list
 *
 * @param events - Array of raw events to deduplicate
 * @param config - Deduplication configuration
 * @returns Array of deduplicated events
 */
export function deduplicateEvents(
  events: RawEvent[],
  config: DeduplicationConfig = DEFAULT_DEDUPLICATION_CONFIG
): DeduplicatedEvent[] {
  if (events.length === 0) return [];

  const clusters = clusterEvents(events, config);
  return clusters.map((cluster) => mergeCluster(cluster, config));
}

/**
 * Statistics about deduplication results
 */
export interface DeduplicationStats {
  /** Total raw events before deduplication */
  totalRawEvents: number;
  /** Total deduplicated events */
  totalDeduplicatedEvents: number;
  /** Number of events that were merged */
  mergedCount: number;
  /** Number of events that were unique (not merged) */
  uniqueCount: number;
  /** Average cluster size for merged events */
  averageClusterSize: number;
  /** Breakdown by event type */
  byType: Record<string, { raw: number; deduplicated: number; mergedCount: number }>;
}

/**
 * Calculate statistics about deduplication results.
 *
 * @param rawEvents - Original raw events
 * @param deduplicatedEvents - Results after deduplication
 * @returns Statistics object
 */
export function calculateDeduplicationStats(
  rawEvents: RawEvent[],
  deduplicatedEvents: DeduplicatedEvent[]
): DeduplicationStats {
  const mergedEvents = deduplicatedEvents.filter((e) => e.mergedFromWindows.length > 1);
  const uniqueEvents = deduplicatedEvents.filter((e) => e.mergedFromWindows.length === 1);

  const totalClusterSize = mergedEvents.reduce((sum, e) => sum + e.mergedFromWindows.length, 0);
  const averageClusterSize = mergedEvents.length > 0 ? totalClusterSize / mergedEvents.length : 0;

  // Calculate by-type breakdown
  const byType: Record<string, { raw: number; deduplicated: number; mergedCount: number }> = {};

  for (const event of rawEvents) {
    if (!byType[event.type]) {
      byType[event.type] = { raw: 0, deduplicated: 0, mergedCount: 0 };
    }
    byType[event.type].raw++;
  }

  for (const event of deduplicatedEvents) {
    if (!byType[event.type]) {
      byType[event.type] = { raw: 0, deduplicated: 0, mergedCount: 0 };
    }
    byType[event.type].deduplicated++;
    if (event.mergedFromWindows.length > 1) {
      byType[event.type].mergedCount++;
    }
  }

  return {
    totalRawEvents: rawEvents.length,
    totalDeduplicatedEvents: deduplicatedEvents.length,
    mergedCount: mergedEvents.length,
    uniqueCount: uniqueEvents.length,
    averageClusterSize,
    byType,
  };
}
