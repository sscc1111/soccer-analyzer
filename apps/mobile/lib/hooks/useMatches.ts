import { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase/firestore";
import { useDeviceId } from "./useDeviceId";
import { getDeviceId } from "../deviceId";
import type { MatchDoc } from "@soccer/shared";

/**
 * Convert Firestore Timestamp to ISO string
 */
function toISOString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  // Handle Firestore Timestamp-like objects with seconds and nanoseconds
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const ts = value as { seconds: number; nanoseconds?: number };
    return new Date(ts.seconds * 1000).toISOString();
  }
  return null;
}

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
    // Note: orderBy with where requires a composite index in Firestore
    const q = query(
      collection(db, "matches"),
      where("deviceId", "==", deviceId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            matchId: d.id,
            ...data,
            // Convert Firestore Timestamps to ISO strings
            date: toISOString(data.date),
            createdAt: toISOString(data.createdAt),
            updatedAt: toISOString(data.updatedAt),
            analysis: data.analysis
              ? {
                  ...data.analysis,
                  lastRunAt: toISOString(data.analysis.lastRunAt),
                }
              : data.analysis,
          } as MatchDoc;
        });

        // Client-side sort by lastRunAt (newest analysis first)
        // Fallback to createdAt for matches that haven't been analyzed
        docs.sort((a, b) => {
          const lastRunA = a.analysis?.lastRunAt ? new Date(a.analysis.lastRunAt).getTime() : 0;
          const lastRunB = b.analysis?.lastRunAt ? new Date(b.analysis.lastRunAt).getTime() : 0;
          // If both have lastRunAt, sort by it
          if (lastRunA && lastRunB) {
            return lastRunB - lastRunA;
          }
          // Matches with analysis come first
          if (lastRunA && !lastRunB) return -1;
          if (!lastRunA && lastRunB) return 1;
          // For matches without analysis, sort by createdAt
          const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return createdAtB - createdAtA;
        });

        setMatches(docs);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading matches:", err);
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
