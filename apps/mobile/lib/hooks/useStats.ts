import { useState, useEffect } from "react";
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { StatsDoc } from "@soccer/shared";

type UseStatsResult = {
  stats: StatsDoc[];
  matchStats: StatsDoc | null;
  playerStats: StatsDoc[];
  loading: boolean;
  error: Error | null;
};

export function useStats(matchId: string | null): UseStatsResult {
  const [stats, setStats] = useState<StatsDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setStats([]);
      setLoading(false);
      return;
    }

    const statsRef = collection(db, "matches", matchId, "stats");
    const q = query(statsRef, orderBy("computedAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({
          statId: d.id,
          ...d.data(),
        })) as StatsDoc[];
        setStats(docs);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [matchId]);

  const matchStats = stats.find((s) => s.scope === "match") ?? null;
  const playerStats = stats.filter((s) => s.scope === "player");

  return { stats, matchStats, playerStats, loading, error };
}
