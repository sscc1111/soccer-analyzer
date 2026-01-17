import { useState, useEffect } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
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
  version?: string;
};

export function useClips(matchId: string | null, filter?: ClipsFilter): UseClipsResult {
  const [clips, setClips] = useState<ClipDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // P1修正: アンマウント後のstate更新を防ぐフラグ
    let mounted = true;

    if (!matchId) {
      setClips([]);
      setLoading(false);
      setError(null);
      return () => { mounted = false; };
    }

    const clipsRef = collection(db, "matches", matchId, "clips");
    // Query all clips and filter client-side to avoid composite index requirements
    const q = query(clipsRef, orderBy("t0", "asc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!mounted) return;

        let docs = snapshot.docs.map((d) => ({
          clipId: d.id,
          ...d.data(),
        })) as ClipDoc[];

        // Client-side filtering for version (avoids composite index requirement)
        if (filter?.version) {
          docs = docs.filter((c) => c.version === filter.version);
        }

        // Client-side filtering for label
        if (filter?.label) {
          docs = docs.filter((c) => c.gemini?.label === filter.label);
        }

        // Client-side filtering for minConfidence
        if (filter?.minConfidence !== undefined) {
          docs = docs.filter(
            (c) => (c.gemini?.confidence ?? 0) >= (filter.minConfidence ?? 0)
          );
        }

        setClips(docs);
        setLoading(false);
      },
      (err) => {
        if (!mounted) return;
        console.error("Error loading clips:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [matchId, filter?.label, filter?.minConfidence, filter?.version]);

  return { clips, loading, error };
}
