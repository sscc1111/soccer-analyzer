import { useState, useEffect } from "react";
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { EventDoc } from "@soccer/shared";

type UseEventsResult = {
  events: EventDoc[];
  loading: boolean;
  error: Error | null;
};

export function useEvents(matchId: string | null): UseEventsResult {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // P1修正: アンマウント後のstate更新を防ぐフラグ
    let mounted = true;

    if (!matchId) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return () => { mounted = false; };
    }

    const eventsRef = collection(db, "matches", matchId, "events");
    const q = query(eventsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!mounted) return;
        const docs = snapshot.docs.map((d) => ({
          eventId: d.id,
          ...d.data(),
        })) as EventDoc[];
        setEvents(docs);
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

  return { events, loading, error };
}

export async function tagPlayerToEvent(
  matchId: string,
  eventId: string,
  playerId: string,
  confidence: number = 1.0
): Promise<void> {
  const eventRef = doc(db, "matches", matchId, "events", eventId);
  await updateDoc(eventRef, {
    "involved.players": [{ playerId, confidence }],
    source: "hybrid",
  });
}
