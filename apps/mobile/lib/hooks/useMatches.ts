import { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/firestore";
import { useDeviceId } from "./useDeviceId";
import { getDeviceId } from "../deviceId";
import type { MatchDoc } from "@soccer/shared";

type UseMatchesResult = {
  matches: MatchDoc[];
  loading: boolean;
  error: Error | null;
};

export function useMatches(): UseMatchesResult {
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { deviceId, loading: deviceIdLoading } = useDeviceId();

  useEffect(() => {
    // Wait for device ID to be ready
    if (deviceIdLoading) {
      return;
    }

    if (!deviceId) {
      setError(new Error("Failed to get device ID"));
      setLoading(false);
      return;
    }

    // Query matches by deviceId (persists across app restarts)
    const q = query(
      collection(db, "matches"),
      where("deviceId", "==", deviceId),
      orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({
          matchId: d.id,
          ...d.data(),
        })) as MatchDoc[];
        setMatches(docs);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [deviceId, deviceIdLoading]);

  return { matches, loading, error };
}

export async function createMatch(data: Omit<MatchDoc, "matchId">): Promise<string> {
  const deviceId = await getDeviceId();

  const matchRef = doc(collection(db, "matches"));
  await setDoc(matchRef, {
    ...data,
    deviceId, // Use deviceId for persistent ownership
    createdAt: serverTimestamp(),
  });
  return matchRef.id;
}

export async function updateMatch(
  matchId: string,
  data: Partial<Omit<MatchDoc, "matchId">>
): Promise<void> {
  const matchRef = doc(db, "matches", matchId);
  await updateDoc(matchRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}
