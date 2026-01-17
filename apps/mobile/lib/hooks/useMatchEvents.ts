/**
 * Hook to fetch match events for tactical view display
 *
 * Phase 8: イベント位置→UI反映
 *
 * Fetches events from multiple collections:
 * - passEvents
 * - shotEvents
 * - turnoverEvents
 * - setPieceEvents
 *
 * Transforms them to a unified EventMarker format for TacticalView
 */

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, getDocs, where } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type {
  PassEventDoc,
  ShotEventDoc,
  TurnoverEventDoc,
  SetPieceEventDoc,
} from "@soccer/shared";

/**
 * Event marker for tactical view display
 */
export type EventMarker = {
  /** Unique event ID */
  id: string;
  /** Field X position in meters (0 = center) */
  x: number;
  /** Field Y position in meters (0 = center) */
  y: number;
  /** Event type */
  type: "pass" | "shot" | "turnover" | "setPiece";
  /** Team that performed the action */
  team: "home" | "away";
  /** Event-specific result */
  result?: string;
  /** Timestamp in seconds */
  timestamp: number;
  /** Confidence score (0-1) */
  confidence: number;
};

/**
 * Filter options for event markers
 */
export type EventFilter = {
  /** Event types to include (empty = all) */
  types?: Array<EventMarker["type"]>;
  /** Teams to include (empty = all) */
  teams?: Array<"home" | "away">;
  /** Minimum confidence threshold */
  confidenceThreshold?: number;
  /** Time range in seconds [start, end] */
  timeRange?: [number, number];
};

type UseMatchEventsResult = {
  events: EventMarker[];
  loading: boolean;
  error: Error | null;
  /** Filtered events based on current filter */
  filteredEvents: EventMarker[];
  /** Current filter */
  filter: EventFilter;
  /** Update filter */
  setFilter: (filter: EventFilter) => void;
};

/**
 * Normalize 0-100 coordinates to field meters
 *
 * The analyzer stores positions as normalized 0-100 coordinates where:
 * - x: 0 = home goal, 100 = away goal
 * - y: 0 = top touchline, 100 = bottom touchline
 *
 * TacticalView expects field coordinates in meters from center:
 * - x: -52.5 to +52.5 (for 105m pitch)
 * - y: -34 to +34 (for 68m pitch)
 */
function normalizedToFieldMeters(
  normalizedX: number,
  normalizedY: number,
  fieldLength: number = 105,
  fieldWidth: number = 68
): { x: number; y: number } {
  // Convert 0-100 to -halfLength to +halfLength
  const x = ((normalizedX / 100) * fieldLength) - (fieldLength / 2);
  // Convert 0-100 to +halfWidth to -halfWidth (inverted Y)
  const y = (fieldWidth / 2) - ((normalizedY / 100) * fieldWidth);
  return { x, y };
}

/**
 * Check if position is in field coordinate format (meters) vs normalized (0-100)
 * Field coordinates have values outside 0-100 range
 */
function isFieldCoordinates(x: number, y: number): boolean {
  return Math.abs(x) > 100 || Math.abs(y) > 100 || x < 0 || y < 0;
}

/**
 * Convert event position to field meters
 */
function convertPosition(
  position: { x: number; y: number } | undefined,
  fieldLength: number = 105,
  fieldWidth: number = 68
): { x: number; y: number } | null {
  if (!position) return null;

  // Check if already in field coordinates (meters from center)
  if (isFieldCoordinates(position.x, position.y)) {
    return position;
  }

  // Convert from 0-100 normalized to field meters
  return normalizedToFieldMeters(position.x, position.y, fieldLength, fieldWidth);
}

export function useMatchEvents(
  matchId: string | null,
  initialFilter: EventFilter = {}
): UseMatchEventsResult {
  const [events, setEvents] = useState<EventMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<EventFilter>(initialFilter);

  useEffect(() => {
    if (!matchId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    const fetchEvents = async () => {
      setLoading(true);
      setError(null);

      try {
        const markers: EventMarker[] = [];

        // Helper to convert TeamId to valid EventMarker team
        const toEventTeam = (teamId: "home" | "away" | "unknown" | undefined): "home" | "away" => {
          if (teamId === "home" || teamId === "away") return teamId;
          return "home"; // Default to home for unknown
        };

        // Fetch pass events
        const passEventsRef = collection(db, "matches", matchId, "passEvents");
        const passQuery = query(passEventsRef, orderBy("timestamp", "asc"));
        const passSnap = await getDocs(passQuery);

        for (const doc of passSnap.docs) {
          const data = doc.data() as PassEventDoc;
          const pos = convertPosition(data.kicker?.position);
          if (pos) {
            markers.push({
              id: doc.id,
              x: pos.x,
              y: pos.y,
              type: "pass",
              team: toEventTeam(data.kicker?.teamId),
              result: data.outcome,
              timestamp: data.timestamp,
              confidence: data.confidence,
            });
          }
        }

        // Fetch shot events
        const shotEventsRef = collection(db, "matches", matchId, "shotEvents");
        const shotQuery = query(shotEventsRef, orderBy("timestamp", "asc"));
        const shotSnap = await getDocs(shotQuery);

        for (const doc of shotSnap.docs) {
          const data = doc.data() as ShotEventDoc;
          const pos = convertPosition(data.position);
          if (pos) {
            markers.push({
              id: doc.id,
              x: pos.x,
              y: pos.y,
              type: "shot",
              team: toEventTeam(data.team),
              result: data.result,
              timestamp: data.timestamp,
              confidence: data.confidence,
            });
          }
        }

        // Fetch turnover events
        const turnoverEventsRef = collection(db, "matches", matchId, "turnoverEvents");
        const turnoverQuery = query(turnoverEventsRef, orderBy("timestamp", "asc"));
        const turnoverSnap = await getDocs(turnoverQuery);

        for (const doc of turnoverSnap.docs) {
          const data = doc.data() as TurnoverEventDoc;
          const pos = convertPosition(data.player?.position);
          if (pos) {
            markers.push({
              id: doc.id,
              x: pos.x,
              y: pos.y,
              type: "turnover",
              team: toEventTeam(data.player?.teamId),
              result: data.turnoverType,
              timestamp: data.timestamp,
              confidence: data.confidence,
            });
          }
        }

        // Fetch set piece events
        const setPieceEventsRef = collection(db, "matches", matchId, "setPieceEvents");
        const setPieceQuery = query(setPieceEventsRef, orderBy("timestamp", "asc"));
        const setPieceSnap = await getDocs(setPieceQuery);

        for (const doc of setPieceSnap.docs) {
          const data = doc.data() as SetPieceEventDoc;
          const pos = convertPosition(data.position);
          if (pos) {
            markers.push({
              id: doc.id,
              x: pos.x,
              y: pos.y,
              type: "setPiece",
              team: toEventTeam(data.team),
              result: data.setPieceType,
              timestamp: data.timestamp,
              confidence: data.confidence,
            });
          }
        }

        // Sort all events by timestamp
        markers.sort((a, b) => a.timestamp - b.timestamp);
        setEvents(markers);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [matchId]);

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Type filter
      if (filter.types && filter.types.length > 0) {
        if (!filter.types.includes(event.type)) return false;
      }

      // Team filter
      if (filter.teams && filter.teams.length > 0) {
        if (!filter.teams.includes(event.team)) return false;
      }

      // Confidence threshold
      if (filter.confidenceThreshold !== undefined) {
        if (event.confidence < filter.confidenceThreshold) return false;
      }

      // Time range
      if (filter.timeRange) {
        const [start, end] = filter.timeRange;
        if (event.timestamp < start || event.timestamp > end) return false;
      }

      return true;
    });
  }, [events, filter]);

  return {
    events,
    loading,
    error,
    filteredEvents,
    filter,
    setFilter,
  };
}

/**
 * Event marker visual configuration
 */
export const EVENT_MARKER_CONFIG = {
  pass: {
    icon: "→",
    colorComplete: "#4CAF50",
    colorIncomplete: "#FF9800",
    size: 16,
  },
  shot: {
    icon: "⚽",
    colorGoal: "#FFD700",
    colorMissed: "#FF5722",
    colorSaved: "#2196F3",
    size: 20,
  },
  turnover: {
    icon: "⚠",
    colorLost: "#F44336",
    colorWon: "#4CAF50",
    size: 16,
  },
  setPiece: {
    icon: "🚩",
    color: "#9C27B0",
    size: 18,
  },
} as const;
