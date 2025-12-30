import { useState, useEffect } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { ClipDoc } from "@soccer/shared";

type UseClipsResult = {
  clips: ClipDoc[];
  loading: boolean;
  error: Error | null;
};

type ClipsFilter = {
  label?: string;
  minConfidence?: number;
};

export function useClips(matchId: string | null, filter?: ClipsFilter): UseClipsResult {
  const [clips, setClips] = useState<ClipDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setClips([]);
      setLoading(false);
      return;
    }

    const clipsRef = collection(db, "matches", matchId, "clips");
    const q = query(clipsRef, orderBy("t0", "asc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let docs = snapshot.docs.map((d) => ({
          clipId: d.id,
          ...d.data(),
        })) as ClipDoc[];

        // Client-side filtering
        if (filter?.label) {
          docs = docs.filter((c) => c.gemini?.label === filter.label);
        }
        if (filter?.minConfidence !== undefined) {
          docs = docs.filter(
            (c) => (c.gemini?.confidence ?? 0) >= (filter.minConfidence ?? 0)
          );
        }

        setClips(docs);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [matchId, filter?.label, filter?.minConfidence]);

  return { clips, loading, error };
}
