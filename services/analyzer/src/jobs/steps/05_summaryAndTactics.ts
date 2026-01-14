/**
 * Step 05: Summary and Tactics
 *
 * サマリー・戦術分析ステップ（Call 2）
 * Call 1（Comprehensive Analysis）の結果を使用して:
 * - tactical（戦術分析）
 * - summary（試合サマリー）
 *
 * このAPI呼び出しは動画なしでテキストのみで実行される
 */

import { getDb } from "../../firebase/admin";
import { callSummaryAndTactics } from "../../gemini/summaryAndTactics";
import type { ComprehensiveAnalysisResponse, EventStatsInput } from "../../gemini/schemas";
import {
  VideoSegmentSchema,
  EventSchema,
  ImportantSceneSchema,
  PlayersIdentificationSchema,
} from "../../gemini/schemas";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import type { CostTrackingContext } from "../../gemini/gemini3Client";
import type { TacticalAnalysisDoc } from "@soccer/shared/src/domain/tactical";
import type { MatchSummaryDoc } from "@soccer/shared/src/domain/tactical";
import { z } from "zod";

export const SUMMARY_TACTICS_VERSION = "summary_tactics_v1";

export type SummaryAndTacticsStepOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type SummaryAndTacticsStepResult = {
  matchId: string;
  success: boolean;
  skipped?: boolean;
  headline?: string;
  homeFormation?: string;
  awayFormation?: string;
  error?: string;
};

/**
 * Run summary and tactics step
 */
export async function stepSummaryAndTactics(
  options: SummaryAndTacticsStepOptions
): Promise<SummaryAndTacticsStepResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "summary_and_tactics" }) : log;

  stepLogger.info("Starting summary and tactics analysis", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing analysis with same version
  const existingTactical = await matchRef.collection("tactical").doc("current").get();
  const existingSummary = await matchRef.collection("summary").doc("current").get();

  if (
    existingTactical.exists &&
    existingTactical.data()?.version === version &&
    existingSummary.exists &&
    existingSummary.data()?.version === version
  ) {
    stepLogger.info("Summary and tactics already exist for this version", {
      matchId,
      version,
    });
    return { matchId, success: true, skipped: true };
  }

  // Get comprehensive analysis results from Call 1
  const comprehensiveDoc = await matchRef.collection("comprehensiveAnalysis").doc("current").get();

  if (!comprehensiveDoc.exists) {
    stepLogger.error("Comprehensive analysis not found, cannot generate summary", { matchId });
    return {
      matchId,
      success: false,
      error: "Comprehensive analysis not found - run comprehensive analysis first",
    };
  }

  const comprehensiveData = comprehensiveDoc.data();
  const eventStats = comprehensiveData?.eventStats as EventStatsInput;
  const metadata = comprehensiveData?.metadata;
  const teams = comprehensiveData?.teams;

  if (!eventStats) {
    stepLogger.error("Event stats not found in comprehensive analysis", { matchId });
    return {
      matchId,
      success: false,
      error: "Event stats not available from comprehensive analysis",
    };
  }

  // Reconstruct the comprehensive analysis response for Call 2
  // We need to fetch the individual collections that were saved by Call 1
  const [segmentsSnap, scenesSnap, eventsSnap, playersDoc] = await Promise.all([
    matchRef.collection("segments").where("version", "==", version).get(),
    matchRef.collection("importantScenes").where("version", "==", version).get(),
    getAllEvents(matchRef, version),
    matchRef.collection("players").doc("current").get(),
  ]);

  // Get match data for duration
  const matchSnap = await matchRef.get();
  const durationSec = matchSnap.data()?.video?.durationSec;

  // Data integrity check - ensure we have minimum required data from Call 1
  const dataIntegrityIssues: string[] = [];

  if (segmentsSnap.empty) {
    dataIntegrityIssues.push("No segments found from comprehensive analysis");
  }

  if (eventsSnap.length === 0) {
    dataIntegrityIssues.push("No events found from comprehensive analysis");
  }

  if (!playersDoc.exists) {
    dataIntegrityIssues.push("No player identification found from comprehensive analysis");
  }

  // Log warnings but don't fail - scenes and events might legitimately be empty for short/uneventful videos
  if (dataIntegrityIssues.length > 0) {
    stepLogger.warn("Data integrity issues detected from Call 1", {
      matchId,
      issues: dataIntegrityIssues,
      segmentCount: segmentsSnap.size,
      eventCount: eventsSnap.length,
      sceneCount: scenesSnap.size,
      hasPlayers: playersDoc.exists,
    });
  }

  // Critical failure: if we have no events AND no segments, something went wrong
  if (segmentsSnap.empty && eventsSnap.length === 0) {
    stepLogger.error("No data available from comprehensive analysis", { matchId });
    return {
      matchId,
      success: false,
      error:
        "No segments or events available from comprehensive analysis - verify Call 1 completed successfully",
    };
  }

  // Reconstruct the analysis response with Zod validation
  const analysisResult: ComprehensiveAnalysisResponse = {
    metadata: metadata || {
      totalDurationSec: durationSec || 0,
      videoQuality: "fair" as const,
    },
    teams: teams || {
      home: { primaryColor: "#000000" },
      away: { primaryColor: "#FFFFFF" },
    },
    segments: segmentsSnap.docs.map((doc) => {
      const data = doc.data();
      try {
        return VideoSegmentSchema.parse(data);
      } catch (error) {
        stepLogger.warn("Invalid segment data from Firestore", {
          matchId,
          segmentId: doc.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Return minimal valid segment as fallback
        return {
          startSec: data.startSec ?? 0,
          endSec: data.endSec ?? 0,
          type: "active_play" as const,
          description: data.description ?? "Unknown segment",
          confidence: data.confidence ?? 0.5,
        };
      }
    }),
    events: eventsSnap
      .map((data) => {
        try {
          return EventSchema.parse(data);
        } catch (error) {
          stepLogger.warn("Invalid event data from Firestore", {
            matchId,
            timestamp: data.timestamp,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
      .filter((event): event is z.infer<typeof EventSchema> => event !== null),
    scenes: scenesSnap.docs.map((doc) => {
      const data = doc.data();
      try {
        return ImportantSceneSchema.parse(data);
      } catch (error) {
        stepLogger.warn("Invalid scene data from Firestore", {
          matchId,
          sceneId: doc.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Return minimal valid scene as fallback
        return {
          startSec: data.startSec ?? 0,
          type: "other" as const,
          description: data.description ?? "Unknown scene",
          importance: data.importance ?? 0.5,
        };
      }
    }),
    players: playersDoc.exists
      ? (() => {
          try {
            return PlayersIdentificationSchema.parse(playersDoc.data());
          } catch (error) {
            stepLogger.warn("Invalid players data from Firestore", {
              matchId,
              error: error instanceof Error ? error.message : String(error),
            });
            return {
              teams: {
                home: { primaryColor: "#000000" },
                away: { primaryColor: "#FFFFFF" },
              },
              players: [],
            };
          }
        })()
      : {
          teams: {
            home: { primaryColor: "#000000" },
            away: { primaryColor: "#FFFFFF" },
          },
          players: [],
        },
  };

  // Get project config
  const projectId = process.env.GCP_PROJECT_ID;
  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  if (!projectId) {
    throw new Error("GCP_PROJECT_ID environment variable is required");
  }

  // Cost tracking context
  const costContext: CostTrackingContext = {
    matchId,
    step: "summary_and_tactics",
  };

  try {
    // Call summary and tactics (Call 2 - no video)
    const result = await callSummaryAndTactics({
      projectId,
      modelId,
      analysisResult,
      eventStats,
      durationSec,
      matchId,
      costContext,
    });

    const { tactical, summary } = result.response;

    // Save tactical analysis
    const tacticalDoc: TacticalAnalysisDoc = {
      matchId,
      version,
      formation: tactical.formation,
      tempo: tactical.tempo,
      attackPatterns: tactical.attackPatterns,
      defensivePatterns: tactical.defensivePatterns,
      keyInsights: tactical.keyInsights,
      pressingIntensity: tactical.pressingIntensity,
      buildUpStyle: tactical.buildUpStyle,
      createdAt: new Date().toISOString(),
    };

    await matchRef.collection("tactical").doc("current").set(tacticalDoc);

    // Save match summary
    const summaryDoc: MatchSummaryDoc = {
      matchId,
      version,
      headline: summary.headline,
      narrative: summary.narrative,
      keyMoments: summary.keyMoments,
      playerHighlights: summary.playerHighlights,
      score: summary.score,
      mvp: summary.mvp,
      createdAt: new Date().toISOString(),
    };

    await matchRef.collection("summary").doc("current").set(summaryDoc);

    stepLogger.info("Summary and tactics analysis complete", {
      matchId,
      headline: summary.headline,
      homeFormation: tactical.formation.home,
      awayFormation: tactical.formation.away,
      keyMomentCount: summary.keyMoments.length,
    });

    return {
      matchId,
      success: true,
      headline: summary.headline,
      homeFormation: tactical.formation.home,
      awayFormation: tactical.formation.away,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    stepLogger.error("Summary and tactics analysis failed", error, { matchId });
    return {
      matchId,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Get all events from all event collections
 */
async function getAllEvents(
  matchRef: FirebaseFirestore.DocumentReference,
  version: string
): Promise<Array<Record<string, unknown>>> {
  const eventCollections = [
    "passEvents",
    "carryEvents",
    "turnoverEvents",
    "shotEvents",
    "setPieceEvents",
  ];

  const snapshots = await Promise.all(
    eventCollections.map((collection) =>
      matchRef.collection(collection).where("version", "==", version).get()
    )
  );

  const allEvents: Array<Record<string, unknown>> = [];

  for (let i = 0; i < eventCollections.length; i++) {
    const collectionName = eventCollections[i];
    const snap = snapshots[i];
    const eventType = collectionName.replace("Events", "");

    for (const doc of snap.docs) {
      const data = doc.data();
      allEvents.push({
        ...data,
        type: eventType,
      });
    }
  }

  // Sort by timestamp
  return allEvents.sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
}
