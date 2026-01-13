import { useState, useEffect } from "react";
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { TrackDoc, TrackPlayerMapping } from "@soccer/shared";

type UseTracksResult = {
  tracks: TrackDoc[];
  mappings: Map<string, TrackPlayerMapping>;
  loading: boolean;
  error: Error | null;
  confirmedCount: number;
  needsReviewCount: number;
};

/**
 * Hook to fetch player tracks and their jersey number mappings
 */
export function useTracks(matchId: string | null): UseTracksResult {
  const [tracks, setTracks] = useState<TrackDoc[]>([]);
  const [mappings, setMappings] = useState<Map<string, TrackPlayerMapping>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setTracks([]);
      setMappings(new Map());
      setLoading(false);
      return;
    }

    const tracksRef = collection(db, "matches", matchId, "tracks");
    const mappingsRef = collection(db, "matches", matchId, "trackMappings");

    const unsubscribeTracks = onSnapshot(
      query(tracksRef),
      (snapshot) => {
        const loadedTracks: TrackDoc[] = [];
        snapshot.forEach((doc) => {
          loadedTracks.push({ trackId: doc.id, ...doc.data() } as TrackDoc);
        });
        // Sort by average confidence descending
        loadedTracks.sort((a, b) => b.avgConfidence - a.avgConfidence);
        setTracks(loadedTracks);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
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
        setLoading(false);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribeTracks();
      unsubscribeMappings();
    };
  }, [matchId]);

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
  };
}
