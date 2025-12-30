import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { MatchDoc } from "@soccer/shared";

type UseMatchResult = {
  match: MatchDoc | null;
  loading: boolean;
  error: Error | null;
};

export function useMatch(matchId: string | null): UseMatchResult {
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setMatch(null);
      setLoading(false);
      return;
    }

    const matchRef = doc(db, "matches", matchId);

    const unsubscribe = onSnapshot(
      matchRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setMatch({
            matchId: snapshot.id,
            ...snapshot.data(),
          } as MatchDoc);
        } else {
          setMatch(null);
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

  return { match, loading, error };
}
