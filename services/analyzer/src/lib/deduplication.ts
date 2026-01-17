/**
 * Phase 2.3: Event Deduplication Utilities
 *
 * Handles deduplication of events detected from overlapping time windows.
 * Events from the same actual occurrence but detected in multiple windows
 * are merged into a single representative event.
 */

import type { TeamId, Point2D } from "@soccer/shared";
import type { PositionSource } from "./zoneToCoordinate";

/**
 * Raw event from a single analysis window
 */
export interface RawEvent {
  /** Match ID this event belongs to */
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
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
  /** Position from Gemini output (normalized 0-1 coordinates) */
  position?: Point2D;
  /** Position confidence from Gemini (0-1) */
  positionConfidence?: number;
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
  /** Final merged position (normalized 0-1 coordinates) */
  mergedPosition?: Point2D;
  /** Source of the position data */
  positionSource?: PositionSource;
  /** Final position confidence after merging */
  mergedPositionConfidence?: number;
}

/**
 * Configuration for deduplication algorithm
 */
export interface DeduplicationConfig {
  /** Maximum time difference (seconds) for events to be considered duplicates (fallback) */
  timeThreshold: number;
  /** Phase 2.7: イベントタイプ別の時間閾値 */
  timeThresholdByType?: Record<string, number>;
  /** Confidence boost per additional detection (capped at 1.0) */
  confidenceBoostPerDetection: number;
}

/**
 * Phase 2.7: イベントタイプ別の時間閾値
 * - shot: 1.0秒（瞬間的なイベント）
 * - pass: 2.0秒（標準）
 * - carry: 3.0秒（継続的なイベント）
 * - turnover: 2.0秒
 * - setPiece: 2.5秒
 */
export const TYPE_SPECIFIC_THRESHOLDS: Record<string, number> = {
  shot: 1.0,
  pass: 2.0,
  carry: 3.0,
  turnover: 2.0,
  setPiece: 2.5,
};

/**
 * Default deduplication configuration
 */
export const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  timeThreshold: 2.0, // 2 seconds (fallback)
  timeThresholdByType: TYPE_SPECIFIC_THRESHOLDS, // Phase 2.7: タイプ別閾値
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

    // Phase 2.7: イベントタイプ別の時間閾値を使用
    const threshold = config.timeThresholdByType?.[event.type] ?? config.timeThreshold;

    if (timeDiff <= threshold && sameType && sameTeam) {
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
      // Position fields from single event
      mergedPosition: event.position,
      positionSource: event.position ? "gemini_output" : undefined,
      mergedPositionConfidence: event.positionConfidence,
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

  // Merge details (prioritize high-confidence events, but ALWAYS preserve goals)
  const mergedDetails: Record<string, unknown> = {};
  const sortedByConfidence = [...cluster].sort((a, b) => b.confidence - a.confidence);

  // Phase 2.8: ゴール検出を最優先
  // shotResult="goal" のイベントがあれば、それを最優先で保持
  const goalEvent = cluster.find((e) => e.type === "shot" && e.details?.shotResult === "goal");
  if (goalEvent) {
    mergedDetails.shotResult = "goal";
    if (goalEvent.details?.shotType) {
      mergedDetails.shotType = goalEvent.details.shotType;
    }
  }

  for (const event of sortedByConfidence) {
    for (const [key, value] of Object.entries(event.details)) {
      // ゴール情報が既にマージされている場合はshotResultをスキップ
      if (key === "shotResult" && mergedDetails.shotResult === "goal") {
        continue;
      }
      if (!(key in mergedDetails) && value !== undefined && value !== null) {
        mergedDetails[key] = value;
      }
    }
  }

  // Phase 2.3: 信頼度計算を平均化ベースに変更
  // 旧方式: baseConfidence * (1 + confidenceBoost) - 乗算で1.0に近づきすぎる問題
  // 新方式: 加算ベースの平均化（クラスタサイズで緩やかにブースト）
  const baseConfidence = baseEvent.confidence;
  const clusterBonus = config.confidenceBoostPerDetection * (cluster.length - 1);
  // 加算ブースト + 正規化で1.0を超えないように
  const adjustedConfidence = Math.min(1.0, baseConfidence + clusterBonus * (1 - baseConfidence));

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

  // Phase 4: Merge position info (weighted average by position confidence)
  let mergedPosition: Point2D | undefined;
  let mergedPositionConfidence: number | undefined;
  let positionSource: PositionSource | undefined;

  const eventsWithPosition = cluster.filter(
    (e) => e.position && e.positionConfidence !== undefined && e.positionConfidence > 0
  );

  if (eventsWithPosition.length > 0) {
    // Calculate weighted average position
    const totalPosConfidence = eventsWithPosition.reduce(
      (sum, e) => sum + (e.positionConfidence ?? 0),
      0
    );

    if (totalPosConfidence > 0) {
      const weightedX = eventsWithPosition.reduce(
        (sum, e) => sum + (e.position?.x ?? 0) * (e.positionConfidence ?? 0),
        0
      ) / totalPosConfidence;

      const weightedY = eventsWithPosition.reduce(
        (sum, e) => sum + (e.position?.y ?? 0) * (e.positionConfidence ?? 0),
        0
      ) / totalPosConfidence;

      mergedPosition = { x: weightedX, y: weightedY };

      // Average confidence with cluster bonus
      const avgPosConfidence = totalPosConfidence / eventsWithPosition.length;
      const clusterPosBonus = 0.05 * (eventsWithPosition.length - 1); // 5% per additional detection
      mergedPositionConfidence = Math.min(1.0, avgPosConfidence + clusterPosBonus);

      positionSource = eventsWithPosition.length > 1 ? "merged" : "gemini_output";
    }
  }

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
    // Position fields from merged cluster
    mergedPosition,
    positionSource,
    mergedPositionConfidence,
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
