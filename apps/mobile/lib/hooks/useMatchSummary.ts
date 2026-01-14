import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { MatchSummaryDoc } from "@soccer/shared";

type UseMatchSummaryResult = {
  summary: MatchSummaryDoc | null;
  loading: boolean;
  error: Error | null;
};

/**
 * Hook to fetch match summary data from Firestore
 * Data source: matches/{matchId}/summary/current
 */
export function useMatchSummary(matchId: string | null): UseMatchSummaryResult {
  const [summary, setSummary] = useState<MatchSummaryDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setSummary(null);
      setLoading(false);
      return;
    }

    const summaryRef = doc(db, "matches", matchId, "summary", "current");

    const unsubscribe = onSnapshot(
      summaryRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setSummary({
            matchId,
            ...snapshot.data(),
          } as MatchSummaryDoc);
        } else {
          setSummary(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [matchId]);

  return { summary, loading, error };
}
