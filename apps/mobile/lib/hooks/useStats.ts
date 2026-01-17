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
    // P1修正: アンマウント後のstate更新を防ぐフラグ
    let mounted = true;

    if (!matchId) {
      setStats([]);
      setLoading(false);
      setError(null);
      return () => { mounted = false; };
    }

    const statsRef = collection(db, "matches", matchId, "stats");
    const q = query(statsRef, orderBy("computedAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!mounted) return;
        const docs = snapshot.docs.map((d) => ({
          statId: d.id,
          ...d.data(),
        })) as StatsDoc[];
        setStats(docs);
        setLoading(false);
      },
      (err) => {
        if (!mounted) return;
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [matchId]);

  const matchStats = stats.find((s) => s.scope === "match") ?? null;
  const playerStats = stats.filter((s) => s.scope === "player");

  return { stats, matchStats, playerStats, loading, error };
}
