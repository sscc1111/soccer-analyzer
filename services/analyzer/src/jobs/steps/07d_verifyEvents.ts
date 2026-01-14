/**
 * Step 07d: Verify Low-Confidence Events (Phase 4)
 *
 * Uses Gemini with cached video content to re-verify events that were:
 * - Detected with low confidence (0.5-0.7)
 * - Merged from multiple windows during deduplication
 *
 * This step provides a second pass of verification to:
 * - Confirm or reject uncertain events
 * - Update confidence scores based on focused analysis
 * - Remove false positives to improve overall accuracy
 */

import { z } from "zod";
import type {
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  ShotEventDoc,
  SetPieceEventDoc,
  TrackedEvent,
} from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { getValidCacheOrFallback, getCacheManager, type GeminiCacheDoc } from "../../gemini/cacheManager";
import { callGeminiApiWithCache, extractTextFromResponse } from "../../gemini/gemini3Client";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import { withRetry } from "../../lib/retry";
import { FieldValue } from "firebase-admin/firestore";

export type VerifyEventsOptions = {
  matchId: string;
  version: string;
  /** Maximum number of events to verify per run (cost control) */
  maxVerifications?: number;
  logger?: ILogger;
};

export type VerifyEventsResult = {
  matchId: string;
  totalVerified: number;
  confirmed: number;
  rejected: number;
  modified: number;
  skipped: boolean;
  error?: string;
};

// Verification response schema
const VerificationResponseSchema = z.object({
  verified: z.boolean(),
  confidence: z.number().min(0).max(1),
  corrections: z.object({
    type: z.enum(["pass", "carry", "turnover", "shot", "setPiece"]).optional(),
    team: z.enum(["home", "away"]).optional(),
    player: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  }).optional(),
  reasoning: z.string(),
});

type VerificationResponse = z.infer<typeof VerificationResponseSchema>;

type EventWithMetadata = {
  eventId: string;
  collection: string;
  event: TrackedEvent;
  needsVerification: boolean;
  verificationReason: string;
};

const DEFAULT_MAX_VERIFICATIONS = 20;

/**
 * Verify low-confidence events using cached video content
 */
export async function stepVerifyEvents(
  options: VerifyEventsOptions
): Promise<VerifyEventsResult> {
  const { matchId, version } = options;
  const maxVerifications = options.maxVerifications ?? DEFAULT_MAX_VERIFICATIONS;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "verify_events" }) : log;

  stepLogger.info("Starting event verification", { matchId, version, maxVerifications });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check if cache is available - verification requires actual context cache, not fallback
  // Phase 3.1: Pass step name for cache hit/miss tracking
  const cache = await getValidCacheOrFallback(matchId, "verify_events");
  if (!cache) {
    stepLogger.error("No valid cache or file URI found, cannot verify events", { matchId });
    return {
      matchId,
      totalVerified: 0,
      confirmed: 0,
      rejected: 0,
      modified: 0,
      skipped: true,
      error: "No video file URI available",
    };
  }

  // Skip verification if using fallback (no actual context cache)
  // Verification requires context caching for efficient re-analysis
  if (cache.version === "fallback") {
    stepLogger.info("Skipping event verification - no context cache available (fallback mode)", { matchId });
    return {
      matchId,
      totalVerified: 0,
      confirmed: 0,
      rejected: 0,
      modified: 0,
      skipped: true,
      error: "Context caching not available for verification",
    };
  }

  // Get events needing verification
  const eventsToVerify = await selectEventsForVerification(
    matchRef,
    version,
    maxVerifications,
    stepLogger
  );

  if (eventsToVerify.length === 0) {
    stepLogger.info("No events need verification", { matchId });
    return {
      matchId,
      totalVerified: 0,
      confirmed: 0,
      rejected: 0,
      modified: 0,
      skipped: true,
    };
  }

  stepLogger.info("Selected events for verification", {
    count: eventsToVerify.length,
    byReason: eventsToVerify.reduce((acc, e) => {
      acc[e.verificationReason] = (acc[e.verificationReason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });

  // Verify each event
  let confirmed = 0;
  let rejected = 0;
  let modified = 0;

  for (const { eventId, collection, event, verificationReason } of eventsToVerify) {
    try {
      const verificationResult = await verifyEvent(
        cache,
        event,
        verificationReason,
        matchId,
        stepLogger
      );

      if (verificationResult.verified && verificationResult.confidence >= 0.7) {
        // Confirmed: Update with new confidence and mark as verified
        await updateVerifiedEvent(
          matchRef,
          collection,
          eventId,
          event,
          verificationResult,
          stepLogger
        );
        confirmed++;
      } else if (!verificationResult.verified || verificationResult.confidence < 0.5) {
        // Phase 2.8: ゴールイベントは特別扱い - 0.3以上なら保持
        const isGoalShot = event.type === "shot" && (event as ShotEventDoc).result === "goal";
        if (isGoalShot && verificationResult.confidence >= 0.3) {
          // ゴールは低信頼度でも保持（手動レビュー用にフラグを立てる）
          stepLogger.info("Preserving low-confidence goal event for manual review", {
            eventId,
            confidence: verificationResult.confidence,
          });
          await updateVerifiedEvent(
            matchRef,
            collection,
            eventId,
            event,
            { ...verificationResult, verified: true },
            stepLogger
          );
          modified++;
        } else {
          // Rejected: Delete the event
          await deleteEvent(matchRef, collection, eventId, stepLogger);
          rejected++;
        }
      } else {
        // Modified: Update with corrections but keep confidence in 0.5-0.7 range
        await updateVerifiedEvent(
          matchRef,
          collection,
          eventId,
          event,
          verificationResult,
          stepLogger
        );
        modified++;
      }

      stepLogger.debug("Verified event", {
        eventId,
        verified: verificationResult.verified,
        confidence: verificationResult.confidence,
        action: verificationResult.verified && verificationResult.confidence >= 0.7
          ? "confirmed"
          : !verificationResult.verified || verificationResult.confidence < 0.5
          ? "rejected"
          : "modified",
      });
    } catch (error) {
      stepLogger.warn("Failed to verify event", {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with other events
    }
  }

  // Update cache usage if using actual cache (not fallback)
  if (cache.version !== "fallback") {
    await getCacheManager().updateCacheUsage(matchId);
  }

  stepLogger.info("Event verification complete", {
    matchId,
    totalVerified: eventsToVerify.length,
    confirmed,
    rejected,
    modified,
  });

  return {
    matchId,
    totalVerified: eventsToVerify.length,
    confirmed,
    rejected,
    modified,
    skipped: false,
  };
}

/**
 * Select events that need verification based on criteria
 */
async function selectEventsForVerification(
  matchRef: FirebaseFirestore.DocumentReference,
  version: string,
  maxCount: number,
  log: ILogger
): Promise<EventWithMetadata[]> {
  const eventsToVerify: EventWithMetadata[] = [];

  // Query each collection for events needing verification
  const collections = [
    "passEvents",
    "carryEvents",
    "turnoverEvents",
    "shotEvents",
    "setPieceEvents",
  ];

  for (const collection of collections) {
    if (eventsToVerify.length >= maxCount) break;

    const remainingSlots = maxCount - eventsToVerify.length;

    // Query for low-confidence events that haven't been verified yet
    // We'll check for both confidence and any metadata indicating merged events
    const snapshot = await matchRef
      .collection(collection)
      .where("version", "==", version)
      .orderBy("confidence", "asc")
      .limit(remainingSlots * 2) // Get more than needed to filter
      .get();

    for (const doc of snapshot.docs) {
      if (eventsToVerify.length >= maxCount) break;

      const event = doc.data() as TrackedEvent;

      // Skip if already verified
      if ((event as any).verified === true) {
        continue;
      }

      // Check if event needs verification
      const needsVerification = event.confidence >= 0.5 && event.confidence <= 0.7;

      // Check for merged events (pass and turnover events have needsReview flag)
      const isMergedOrReview =
        ("needsReview" in event && event.needsReview === true);

      if (needsVerification || isMergedOrReview) {
        const reason = needsVerification
          ? "low_confidence"
          : "needs_review";

        eventsToVerify.push({
          eventId: doc.id,
          collection,
          event,
          needsVerification: true,
          verificationReason: reason,
        });
      }
    }
  }

  log.debug("Selected events for verification", {
    total: eventsToVerify.length,
    byCollection: eventsToVerify.reduce((acc, e) => {
      acc[e.collection] = (acc[e.collection] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });

  return eventsToVerify.slice(0, maxCount);
}

/**
 * Verify a single event using Gemini with cached video
 */
async function verifyEvent(
  cache: GeminiCacheDoc,
  event: TrackedEvent,
  reason: string,
  matchId: string,
  log: ILogger
): Promise<VerificationResponse> {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  // Build verification prompt
  const prompt = buildVerificationPrompt(event, reason);

  return withRetry(
    async () => {
      const response = await callGeminiApiWithCache(
        projectId,
        modelId,
        cache.cacheId,
        prompt,
        {
          temperature: 0.1, // Lower temperature for verification
          responseMimeType: "application/json",
        },
        { matchId, step: "verify_events" }
      );

      const text = extractTextFromResponse(response);
      if (!text) {
        throw new Error("Empty response from Gemini during verification");
      }

      const parsed = JSON.parse(text);
      return VerificationResponseSchema.parse(parsed);
    },
    {
      maxRetries: 2,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      timeoutMs: 30000, // 30 seconds per verification
      onRetry: (attempt, error) => {
        log.warn("Retrying event verification", {
          attempt,
          eventId: (event as any).eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }
  );
}

/**
 * Build verification prompt for an event
 */
function buildVerificationPrompt(event: TrackedEvent, reason: string): string {
  // Get timestamp - CarryEventDoc uses startTime, others use timestamp
  const timestamp = event.type === "carry"
    ? (event as CarryEventDoc).startTime
    : (event as PassEventDoc | TurnoverEventDoc | ShotEventDoc | SetPieceEventDoc).timestamp;

  const team = (event as any).team || (event as any).teamId || "unknown";
  const player = (event as any).player || (event as any).playerId || "unknown";

  let eventDescription = "";
  switch (event.type) {
    case "pass":
      const passEvent = event as PassEventDoc;
      eventDescription = `a pass by ${team} team${player !== "unknown" ? ` (player ${player})` : ""}, outcome: ${passEvent.outcome}`;
      break;
    case "carry":
      const carryEvent = event as CarryEventDoc;
      eventDescription = `a ball carry by ${team} team${player !== "unknown" ? ` (player ${player})` : ""}`;
      break;
    case "turnover":
      const turnoverEvent = event as TurnoverEventDoc;
      eventDescription = `a turnover by ${team} team${player !== "unknown" ? ` (player ${player})` : ""}${turnoverEvent.context ? ` (${turnoverEvent.context})` : ""}`;
      break;
    case "shot":
      const shotEvent = event as ShotEventDoc;
      eventDescription = `a shot by ${team} team${player !== "unknown" ? ` (player ${player})` : ""}, result: ${shotEvent.result}`;
      break;
    case "setPiece":
      const setPieceEvent = event as SetPieceEventDoc;
      eventDescription = `a set piece (${setPieceEvent.setPieceType}) by ${team} team${player !== "unknown" ? ` (player ${player})` : ""}`;
      break;
  }

  const verificationReasonText = reason === "low_confidence"
    ? `This event was detected with low confidence (${event.confidence.toFixed(2)}).`
    : `This event needs review due to ambiguity or merging.`;

  const promptTemplate = `
# Event Verification Task

At timestamp **${timestamp.toFixed(2)}** seconds in the video, verify the following event:

**Event Type**: ${event.type}
**Description**: ${eventDescription}
**Original Confidence**: ${event.confidence.toFixed(2)}

${verificationReasonText}

## Instructions

1. **Watch the video at the specified timestamp** (±2 seconds window)
2. **Verify if the event actually occurred** as described
3. **Assess the confidence** in the event detection (0.0 to 1.0)
4. **Provide corrections** if any details are incorrect (team, player, type, outcome)
5. **Explain your reasoning** briefly

## Output Format (JSON)

{
  "verified": boolean,
  "confidence": number (0.0 to 1.0),
  "corrections": {
    "type": "pass" | "carry" | "turnover" | "shot" | "setPiece" (optional),
    "team": "home" | "away" (optional),
    "player": "string" (optional),
    "details": {
      "outcome": "complete" | "incomplete" | "intercepted" (for passes),
      "shotResult": "goal" | "saved" | "blocked" | "missed" (for shots),
      ... other relevant details
    } (optional)
  },
  "reasoning": "Brief explanation of your verification"
}

## Guidelines

- **verified: true** if the event clearly occurred as described
- **verified: false** if the event did not occur or was misidentified
- **confidence >= 0.7**: Event is clear and certain
- **confidence 0.5-0.7**: Event is somewhat uncertain
- **confidence < 0.5**: Event is very uncertain or likely wrong
- **corrections**: Only provide if specific details need updating

Return JSON only.
`;

  return promptTemplate.trim();
}

/**
 * Update event with verification results
 */
async function updateVerifiedEvent(
  matchRef: FirebaseFirestore.DocumentReference,
  collection: string,
  eventId: string,
  originalEvent: TrackedEvent,
  verification: VerificationResponse,
  log: ILogger
): Promise<void> {
  const updates: Record<string, any> = {
    verified: true,
    verifiedAt: new Date().toISOString(),
    originalConfidence: originalEvent.confidence,
    confidence: verification.confidence,
    verificationReasoning: verification.reasoning,
  };

  // Apply corrections if provided
  if (verification.corrections) {
    const { type, team, player, details } = verification.corrections;

    if (type && type !== originalEvent.type) {
      log.warn("Event type correction detected - updating", {
        eventId,
        oldType: originalEvent.type,
        newType: type,
      });
      updates.type = type;
    }

    if (team) {
      updates.team = team;
    }

    if (player) {
      if ("player" in originalEvent) {
        updates.player = player;
      } else if ("playerId" in originalEvent) {
        updates.playerId = player;
      }
    }

    if (details) {
      // Merge details with existing details
      const existingDetails = (originalEvent as any).details || {};
      updates.details = { ...existingDetails, ...details };

      // For pass events, update outcome fields
      if (originalEvent.type === "pass" && details.outcome) {
        updates.outcome = details.outcome;
        updates.outcomeConfidence = verification.confidence;
      }

      // For shot events, update result
      if (originalEvent.type === "shot" && details.shotResult) {
        updates.result = details.shotResult;
      }
    }
  }

  // Update needsReview flag if event is now confident
  if (verification.confidence >= 0.7 && "needsReview" in originalEvent) {
    updates.needsReview = false;
  }

  updates.updatedAt = new Date().toISOString();

  await matchRef.collection(collection).doc(eventId).update(updates);

  log.debug("Updated verified event", {
    eventId,
    collection,
    updates: Object.keys(updates),
    newConfidence: verification.confidence,
  });
}

/**
 * Delete an event that failed verification
 */
async function deleteEvent(
  matchRef: FirebaseFirestore.DocumentReference,
  collection: string,
  eventId: string,
  log: ILogger
): Promise<void> {
  await matchRef.collection(collection).doc(eventId).delete();

  log.debug("Deleted rejected event", {
    eventId,
    collection,
  });
}
