import { useState, useEffect } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../firebase/firestore";

export type LivePosition = {
  trackId: string;
  position: { x: number; y: number };
  teamId: "home" | "away" | "unknown";
  jerseyNumber?: number;
  isPredicted: boolean;
  confidence: number;
  timestamp: number;
};

export type BallPosition = {
  x: number;
  y: number;
  visible: boolean;
  timestamp: number;
};

export type LivePositionsData = {
  players: LivePosition[];
  ball: BallPosition | null;
  lastUpdate: number;
};

/**
 * Hook to get live/replay positions for tactical view
 *
 * @param matchId - Match ID
 * @param frameNumber - Optional frame number for replay mode
 * @returns Live positions data and loading state
 *
 * @example
 * ```tsx
 * const { positions, ball, loading } = useLivePositions(matchId);
 *
 * return (
 *   <TacticalView
 *     players={positions}
 *     ball={ball}
 *   />
 * );
 * ```
 */
export function useLivePositions(
  matchId: string | undefined,
  frameNumber?: number
) {
  const [data, setData] = useState<LivePositionsData>({
    players: [],
    ball: null,
    lastUpdate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to live positions collection
    // Firestore: matches/{matchId}/livePositions/{trackId}
    const positionsRef = collection(db, "matches", matchId, "livePositions");
    const positionsQuery = query(
      positionsRef,
      orderBy("timestamp", "desc"),
      limit(30) // Max 30 players (22 + refs + buffer)
    );

    const unsubscribePlayers = onSnapshot(
      positionsQuery,
      (snapshot) => {
        const players: LivePosition[] = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          players.push({
            trackId: doc.id,
            position: data.position ?? { x: 0, y: 0 },
            teamId: data.teamId ?? "unknown",
            jerseyNumber: data.jerseyNumber,
            isPredicted: data.isPredicted ?? false,
            confidence: data.confidence ?? 1,
            timestamp: data.timestamp ?? 0,
          });
        });

        setData((prev) => ({
          ...prev,
          players,
          lastUpdate: Date.now(),
        }));
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching live positions:", err);
        setError(err as Error);
        setLoading(false);
      }
    );

    // Subscribe to ball position
    // Firestore: matches/{matchId}/ballTrack/live
    const ballRef = doc(db, "matches", matchId, "ballTrack", "live");

    const unsubscribeBall = onSnapshot(
      ballRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setData((prev) => ({
            ...prev,
            ball: {
              x: data.position?.x ?? 0,
              y: data.position?.y ?? 0,
              visible: data.visible ?? false,
              timestamp: data.timestamp ?? 0,
            },
          }));
        } else {
          setData((prev) => ({ ...prev, ball: null }));
        }
      },
      (err) => {
        console.error("Error fetching ball position:", err);
        // Don't set error for ball - it's optional
      }
    );

    return () => {
      unsubscribePlayers();
      unsubscribeBall();
    };
  }, [matchId, frameNumber]);

  return {
    positions: data.players,
    ball: data.ball,
    lastUpdate: data.lastUpdate,
    loading,
    error,
  };
}

/**
 * Hook to get positions at a specific frame (for replay/scrubbing)
 */
export function usePositionsAtFrame(
  matchId: string | undefined,
  frameNumber: number
) {
  const [data, setData] = useState<LivePositionsData>({
    players: [],
    ball: null,
    lastUpdate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!matchId) {
      setLoading(false);
      return;
    }

    // For replay, we would fetch from track chunks based on frameNumber
    // This is a placeholder that would query the appropriate chunk

    setLoading(true);

    // Simulate fetching positions at specific frame
    // In production, this would query tracks/{trackId}/chunks/{chunkIndex}
    const fetchPositions = async () => {
      try {
        // Placeholder: Return empty data
        // Real implementation would:
        // 1. Calculate chunk index from frameNumber (chunkIndex = Math.floor(frameNumber / 900))
        // 2. Fetch relevant chunks from each track
        // 3. Find positions at specific frame

        setData({
          players: [],
          ball: null,
          lastUpdate: Date.now(),
        });
      } catch (err) {
        console.error("Error fetching positions at frame:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [matchId, frameNumber]);

  return {
    ...data,
    loading,
  };
}
