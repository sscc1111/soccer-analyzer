import { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { PendingReviewDoc, PassEventDoc } from "@soccer/shared";

export type PendingReviewWithEvent = {
  review: PendingReviewDoc;
  event: PassEventDoc | null;
};

/**
 * Hook to fetch pending reviews and their associated events
 */
export function usePendingReviews(matchId: string) {
  const [reviews, setReviews] = useState<PendingReviewWithEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!matchId) {
      setReviews([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to unresolved pending reviews
    const reviewsRef = collection(db, "matches", matchId, "pendingReviews");
    const q = query(reviewsRef, where("resolved", "==", false));

    const unsubscribeReviews = onSnapshot(
      q,
      (snapshot) => {
        const reviewDocs = snapshot.docs.map((doc) => ({
          eventId: doc.id,
          ...doc.data(),
        })) as PendingReviewDoc[];

        // Fetch associated events
        if (reviewDocs.length === 0) {
          setReviews([]);
          setLoading(false);
          return;
        }

        // Subscribe to events for each review
        const unsubscribeEvents: (() => void)[] = [];
        const reviewsWithEvents: Map<string, PendingReviewWithEvent> = new Map();

        reviewDocs.forEach((review) => {
          const eventRef = doc(db, "matches", matchId, "passEvents", review.eventId);
          const unsubEvent = onSnapshot(
            eventRef,
            (eventSnap) => {
              const event = eventSnap.exists()
                ? ({ eventId: eventSnap.id, ...eventSnap.data() } as PassEventDoc)
                : null;

              reviewsWithEvents.set(review.eventId, {
                review,
                event,
              });

              // Update state when all events are loaded
              if (reviewsWithEvents.size === reviewDocs.length) {
                setReviews(Array.from(reviewsWithEvents.values()));
                setLoading(false);
              }
            },
            (err) => {
              console.error(`Error fetching event ${review.eventId}:`, err);
            }
          );
          unsubscribeEvents.push(unsubEvent);
        });

        return () => {
          unsubscribeEvents.forEach((unsub) => unsub());
        };
      },
      (err) => {
        console.error("Error fetching pending reviews:", err);
        setError(err as Error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribeReviews();
    };
  }, [matchId]);

  return { reviews, loading, error, needsReviewCount: reviews.length };
}

/**
 * Resolve a pending review with corrections
 */
export async function resolveReview(
  matchId: string,
  eventId: string,
  resolution: {
    selectedTrackId?: string;
    correctedOutcome?: "complete" | "incomplete" | "intercepted";
  }
) {
  const reviewRef = doc(db, "matches", matchId, "pendingReviews", eventId);
  await updateDoc(reviewRef, {
    resolved: true,
    "resolution.selectedTrackId": resolution.selectedTrackId,
    "resolution.correctedOutcome": resolution.correctedOutcome,
    "resolution.resolvedBy": "user",
    "resolution.resolvedAt": serverTimestamp(),
  });
}

/**
 * Correct a pass event with user selections
 */
export async function correctPassEvent(
  matchId: string,
  eventId: string,
  corrections: {
    kickerTrackId?: string;
    receiverTrackId?: string | null;
    outcome?: "complete" | "incomplete" | "intercepted";
  }
) {
  const eventRef = doc(db, "matches", matchId, "passEvents", eventId);
  const updates: any = {
    source: "corrected",
    needsReview: false,
    updatedAt: serverTimestamp(),
  };

  if (corrections.kickerTrackId !== undefined) {
    updates["kicker.trackId"] = corrections.kickerTrackId;
    updates["kicker.confidence"] = 1.0;
  }

  if (corrections.receiverTrackId !== undefined) {
    if (corrections.receiverTrackId === null) {
      updates["receiver"] = null;
    } else {
      updates["receiver.trackId"] = corrections.receiverTrackId;
      updates["receiver.confidence"] = 1.0;
    }
  }

  if (corrections.outcome !== undefined) {
    updates["outcome"] = corrections.outcome;
    updates["outcomeConfidence"] = 1.0;
  }

  await updateDoc(eventRef, updates);
}

/**
 * Trigger stats recalculation after corrections
 * Sets a flag that backend Cloud Functions will detect and process
 */
export async function triggerStatsRecalculation(matchId: string) {
  const matchRef = doc(db, "matches", matchId);
  await updateDoc(matchRef, {
    "analysis.needsRecalculation": true,
    "analysis.recalculationRequestedAt": serverTimestamp(),
  });
}
