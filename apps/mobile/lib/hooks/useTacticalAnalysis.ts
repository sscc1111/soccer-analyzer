import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { TacticalAnalysisDoc } from "@soccer/shared";

type UseTacticalAnalysisResult = {
  analysis: TacticalAnalysisDoc | null;
  loading: boolean;
  error: Error | null;
};

/**
 * Hook to fetch tactical analysis data from Firestore
 * Data source: matches/{matchId}/tactical/current
 */
export function useTacticalAnalysis(matchId: string | null): UseTacticalAnalysisResult {
  const [analysis, setAnalysis] = useState<TacticalAnalysisDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setAnalysis(null);
      setLoading(false);
      return;
    }

    const analysisRef = doc(db, "matches", matchId, "tactical", "current");

    const unsubscribe = onSnapshot(
      analysisRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setAnalysis({
            matchId,
            ...snapshot.data(),
          } as TacticalAnalysisDoc);
        } else {
          setAnalysis(null);
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

  return { analysis, loading, error };
}
