/**
 * Step 04d: Summary and Tactics (Hybrid Pipeline Call 4)
 *
 * ハイブリッドパイプライン - Call 4
 * Call 1-3の結果を使用して戦術分析と試合サマリーを生成
 * テキストのみのAPI呼び出し（動画不要）
 */

import { getDb } from "../../firebase/admin";
import { callSummaryAndTactics } from "../../gemini/summaryAndTactics";
import type { ComprehensiveAnalysisResponse, EventStatsInput } from "../../gemini/schemas";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";
import type { CostTrackingContext } from "../../gemini/gemini3Client";
import type { TacticalAnalysisDoc, MatchSummaryDoc } from "@soccer/shared/src/domain/tactical";

// ============================================================
// Types
// ============================================================

export interface SummaryAndTacticsHybridOptions {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  version: string;
  logger?: ILogger;
}

export interface SummaryAndTacticsHybridResult {
  matchId: string;
  success: boolean;
  skipped?: boolean;
  headline?: string;
  homeFormation?: string;
  awayFormation?: string;
  keyMomentCount?: number;
  error?: string;
}

// ============================================================
// Helper Functions
// ============================================================

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

/**
 * Calculate event statistics from events
 */
function calculateEventStats(events: Array<Record<string, unknown>>): EventStatsInput {
  // Split events by team
  const homeEvents = events.filter((e) => {
    const team = e.team || (e.kicker as Record<string, unknown>)?.teamId;
    return team === "home";
  });
  const awayEvents = events.filter((e) => {
    const team = e.team || (e.kicker as Record<string, unknown>)?.teamId;
    return team === "away";
  });

  const calculateTeamStats = (teamEvents: Array<Record<string, unknown>>) => {
    const passEvents = teamEvents.filter((e) => e.type === "pass");
    const shotEvents = teamEvents.filter((e) => e.type === "shot");
    const turnoverEvents = teamEvents.filter((e) => e.type === "turnover");

    const completedPasses = passEvents.filter(
      (e) => e.outcome === "complete" || (e as Record<string, unknown>).outcomeConfidence
    );

    const shotsOnTarget = shotEvents.filter(
      (e) => e.result === "goal" || e.result === "saved"
    ).length;

    return {
      passes: passEvents.length,
      passesComplete: completedPasses.length,
      shots: shotEvents.length,
      shotsOnTarget,
      turnoversWon: turnoverEvents.length,
      turnoversLost: 0, // Not easily calculable without full context
    };
  };

  const homeStats = calculateTeamStats(homeEvents);
  const awayStats = calculateTeamStats(awayEvents);

  return {
    home: homeStats,
    away: awayStats,
    total: {
      passes: homeStats.passes + awayStats.passes,
      shots: homeStats.shots + awayStats.shots,
      turnovers: homeStats.turnoversWon + awayStats.turnoversWon,
    },
  };
}

// ============================================================
// Main Step
// ============================================================

export async function stepSummaryAndTacticsHybrid(
  options: SummaryAndTacticsHybridOptions
): Promise<SummaryAndTacticsHybridResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child
    ? log.child({ step: "summary_and_tactics_hybrid" })
    : log;

  stepLogger.info("Starting hybrid summary and tactics analysis", {
    matchId,
    version,
  });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing analysis (idempotency)
  const [existingTactical, existingSummary] = await Promise.all([
    matchRef.collection("tactical").doc("current").get(),
    matchRef.collection("summary").doc("current").get(),
  ]);

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
    return {
      matchId,
      success: true,
      skipped: true,
      headline: existingSummary.data()?.headline,
    };
  }

  // Get all data from hybrid pipeline collections
  const [
    matchDoc,
    segmentsSnap,
    scenesSnap,
    eventsData,
    playersDoc,
  ] = await Promise.all([
    matchRef.get(),
    matchRef.collection("segments").where("version", "==", version).get(),
    matchRef.collection("importantScenes").where("version", "==", version).get(),
    getAllEvents(matchRef, version),
    matchRef.get(), // Get player data from match document (geminiPlayerData)
  ]);

  const matchData = matchDoc.data();
  const durationSec = matchData?.video?.durationSec || matchData?.segmentationMetadata?.totalDurationSec;
  const teamInfo = matchData?.teamInfo;
  const geminiPlayerData = matchData?.geminiPlayerData;

  // Validate minimum required data
  if (segmentsSnap.empty && eventsData.length === 0) {
    stepLogger.error("No data available from hybrid pipeline", { matchId });
    return {
      matchId,
      success: false,
      error: "No segments or events available - verify hybrid pipeline Calls 1-3 completed",
    };
  }

  // Build analysis result from hybrid pipeline data
  const analysisResult: ComprehensiveAnalysisResponse = {
    metadata: {
      totalDurationSec: durationSec || 0,
      videoQuality: matchData?.segmentationMetadata?.videoQuality || ("fair" as const),
    },
    teams: {
      home: {
        primaryColor: teamInfo?.home?.colors || geminiPlayerData?.teams?.home?.primaryColor || "#000000",
        attackingDirection: teamInfo?.home?.attackingDirection,
      },
      away: {
        primaryColor: teamInfo?.away?.colors || geminiPlayerData?.teams?.away?.primaryColor || "#FFFFFF",
        attackingDirection: teamInfo?.away?.attackingDirection,
      },
    },
    segments: segmentsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        startSec: data.startSec ?? 0,
        endSec: data.endSec ?? 0,
        type: data.type || ("active_play" as const),
        subtype: data.subtype,
        description: data.description ?? "",
        attackingTeam: data.attackingTeam,
        importance: data.importance,
        confidence: data.confidence ?? 0.5,
        visualEvidence: data.visualEvidence,
      };
    }),
    events: eventsData.map((data) => ({
      timestamp: data.timestamp as number || 0,
      type: (data.type as "pass" | "carry" | "turnover" | "shot" | "setPiece") || "pass",
      team: (data.team as "home" | "away") || (data.kicker as Record<string, unknown>)?.teamId as "home" | "away" || "home",
      player: data.player as string || (data.kicker as Record<string, unknown>)?.playerId as string,
      zone: data.zone as "defensive_third" | "middle_third" | "attacking_third" | undefined,
      details: data.details as Record<string, unknown> || {},
      confidence: data.confidence as number || 0.5,
      visualEvidence: data.visualEvidence as string,
    })),
    scenes: scenesSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        startSec: data.startSec ?? 0,
        endSec: data.endSec,
        type: data.type || ("other" as const),
        team: data.team,
        description: data.description ?? "",
        importance: data.importance ?? 0.5,
        confidence: data.confidence,
        suggestedClip: data.suggestedClip,
      };
    }),
    players: {
      teams: {
        home: {
          primaryColor: geminiPlayerData?.teams?.home?.primaryColor || teamInfo?.home?.colors || "#000000",
          secondaryColor: geminiPlayerData?.teams?.home?.secondaryColor,
          goalkeeperColor: geminiPlayerData?.teams?.home?.goalkeeperColor,
          attackingDirection: geminiPlayerData?.teams?.home?.attackingDirection,
        },
        away: {
          primaryColor: geminiPlayerData?.teams?.away?.primaryColor || teamInfo?.away?.colors || "#FFFFFF",
          secondaryColor: geminiPlayerData?.teams?.away?.secondaryColor,
          goalkeeperColor: geminiPlayerData?.teams?.away?.goalkeeperColor,
          attackingDirection: geminiPlayerData?.teams?.away?.attackingDirection,
        },
      },
      players: [], // Player array not stored in match document in hybrid pipeline
    },
  };

  // Calculate event statistics
  const eventStats = calculateEventStats(eventsData);

  stepLogger.info("Prepared data for summary and tactics", {
    matchId,
    segmentCount: analysisResult.segments.length,
    eventCount: analysisResult.events.length,
    sceneCount: analysisResult.scenes.length,
    eventStats,
  });

  // Get project config
  const projectId = process.env.GCP_PROJECT_ID;
  const modelId = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  if (!projectId) {
    throw new Error("GCP_PROJECT_ID environment variable is required");
  }

  // Cost tracking context
  const costContext: CostTrackingContext = {
    matchId,
    step: "summary_and_tactics_hybrid",
  };

  try {
    // Call summary and tactics (text-only, no video)
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

    stepLogger.info("Hybrid summary and tactics analysis complete", {
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
      keyMomentCount: summary.keyMoments.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    stepLogger.error("Hybrid summary and tactics analysis failed", error, {
      matchId,
    });
    return {
      matchId,
      success: false,
      error: errorMessage,
    };
  }
}
