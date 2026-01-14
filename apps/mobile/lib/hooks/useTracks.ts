import { useState, useEffect, useCallback } from "react";
import { collection, query, onSnapshot, limit } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { TrackDoc, TrackPlayerMapping } from "@soccer/shared";

type UseTracksResult = {
  tracks: TrackDoc[];
  mappings: Map<string, TrackPlayerMapping>;
  loading: boolean;
  error: Error | null;
  confirmedCount: number;
  needsReviewCount: number;
  refetch: () => void;
};

/**
 * Hook to fetch player tracks and their jersey number mappings
 */
export function useTracks(matchId: string | null): UseTracksResult {
  const [tracks, setTracks] = useState<TrackDoc[]>([]);
  const [mappings, setMappings] = useState<Map<string, TrackPlayerMapping>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setError(null);
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!matchId) {
      setTracks([]);
      setMappings(new Map());
      setLoading(false);
      return;
    }

    // Track loading state for both subscriptions
    let tracksLoaded = false;
    let mappingsLoaded = false;

    const checkLoading = () => {
      if (tracksLoaded && mappingsLoaded) {
        setLoading(false);
      }
    };

    const tracksRef = collection(db, "matches", matchId, "tracks");
    const mappingsRef = collection(db, "matches", matchId, "trackMappings");

    // Limit tracks to prevent loading too much data (frames array can be large)
    const unsubscribeTracks = onSnapshot(
      query(tracksRef, limit(100)),
      (snapshot) => {
        const loadedTracks: TrackDoc[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Create track without frames to reduce memory usage
          loadedTracks.push({
            trackId: doc.id,
            matchId: data.matchId ?? matchId,
            frames: [], // Don't load frames in list view
            startFrame: data.startFrame ?? 0,
            endFrame: data.endFrame ?? 0,
            startTime: data.startTime ?? 0,
            endTime: data.endTime ?? 0,
            avgConfidence: data.avgConfidence ?? 0,
            entityType: data.entityType ?? "unknown",
            version: data.version ?? "",
            createdAt: data.createdAt ?? "",
            // Store frame count for display
            _frameCount: Array.isArray(data.frames) ? data.frames.length : 0,
          } as TrackDoc & { _frameCount: number });
        });
        // Sort by average confidence descending
        loadedTracks.sort((a, b) => (b.avgConfidence ?? 0) - (a.avgConfidence ?? 0));
        setTracks(loadedTracks);
        tracksLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error("Error loading tracks:", err);
        setError(err as Error);
        tracksLoaded = true;
        checkLoading();
      }
    );

    const unsubscribeMappings = onSnapshot(
      query(mappingsRef),
      (snapshot) => {
        const loadedMappings = new Map<string, TrackPlayerMapping>();
        snapshot.forEach((doc) => {
          const mapping = { trackId: doc.id, ...doc.data() } as TrackPlayerMapping;
          loadedMappings.set(doc.id, mapping);
        });
        setMappings(loadedMappings);
        mappingsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error("Error loading track mappings:", err);
        setError(err as Error);
        mappingsLoaded = true;
        checkLoading();
      }
    );

    return () => {
      unsubscribeTracks();
      unsubscribeMappings();
    };
  }, [matchId, refreshKey]);

  const confirmedCount = Array.from(mappings.values()).filter(
    (m) => m.source === "manual"
  ).length;

  const needsReviewCount = Array.from(mappings.values()).filter(
    (m) => m.needsReview
  ).length;

  return {
    tracks,
    mappings,
    loading,
    error,
    confirmedCount,
    needsReviewCount,
    refetch,
  };
}
