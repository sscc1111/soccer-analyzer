/**
 * Step 07e: Detect Assists (新規追加)
 *
 * Phase 6: ゴールに繋がったパスをアシストとして検出・記録する
 *
 * 検出ロジック:
 * 1. shotEvents から result="goal" のイベントを取得
 * 2. ゴール直前（5秒以内）の passEvents を検索
 * 3. パスの outcome="complete" かつ同じチームのパスを特定
 * 4. アシストとして assistEvents コレクションに保存
 */

import type { AssistEventDoc, ShotEventDoc } from "@soccer/shared";
import { getDb } from "../../firebase/admin";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";

// アシスト検出の設定
const ASSIST_CONFIG = {
  /** ゴール前にパスを探す最大時間（秒） */
  maxTimeDeltaSec: 5.0,
  /** 最小信頼度 */
  minConfidence: 0.5,
};

export type DetectAssistsOptions = {
  matchId: string;
  version: string;
  logger?: ILogger;
};

export type DetectAssistsResult = {
  matchId: string;
  goalsProcessed: number;
  assistsDetected: number;
  skipped: boolean;
  error?: string;
};

/**
 * Gemini検出イベント用のパスイベント型
 * (07c で保存されるシンプルな形式)
 */
interface GeminiPassEvent {
  eventId: string;
  matchId: string;
  type: "pass";
  timestamp: number;
  team: "home" | "away";
  player?: string;
  zone?: string;
  position?: { x: number; y: number };
  details?: {
    passType?: string;
    outcome?: string;
    targetPlayer?: string;
  };
  confidence: number;
  version: string;
  createdAt: string;
}

/**
 * Step 07e: Detect assists from goals and passes
 */
export async function stepDetectAssists(
  options: DetectAssistsOptions
): Promise<DetectAssistsResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "detect_assists" }) : log;

  stepLogger.info("Starting assist detection", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Check for existing assists with same version
  const existingAssistsSnap = await matchRef
    .collection("assistEvents")
    .where("version", "==", version)
    .limit(1)
    .get();

  if (!existingAssistsSnap.empty) {
    stepLogger.info("Assists already detected for this version", { matchId, version });
    return {
      matchId,
      goalsProcessed: 0,
      assistsDetected: existingAssistsSnap.size,
      skipped: true,
    };
  }

  // Get all goal events (shots with result="goal")
  const goalsSnap = await matchRef
    .collection("shotEvents")
    .where("result", "==", "goal")
    .orderBy("timestamp", "asc")
    .get();

  if (goalsSnap.empty) {
    stepLogger.info("No goals found, skipping assist detection", { matchId });
    return {
      matchId,
      goalsProcessed: 0,
      assistsDetected: 0,
      skipped: false,
    };
  }

  const goals = goalsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as ShotEventDoc),
  }));

  stepLogger.info("Found goals to process", {
    matchId,
    goalCount: goals.length,
    goalTimestamps: goals.map((g) => g.timestamp),
  });

  // Get all completed passes
  const passesSnap = await matchRef
    .collection("passEvents")
    .orderBy("timestamp", "asc")
    .get();

  const passes = passesSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as GeminiPassEvent),
  }));

  stepLogger.info("Found passes to analyze", {
    matchId,
    passCount: passes.length,
  });

  // Detect assists for each goal
  const assists: AssistEventDoc[] = [];

  for (const goal of goals) {
    const assist = findAssistForGoal(goal, passes, matchId, version, stepLogger);
    if (assist) {
      assists.push(assist);
    }
  }

  // Save assists to Firestore
  if (assists.length > 0) {
    const batch = db.batch();
    const assistsCollection = matchRef.collection("assistEvents");

    for (const assist of assists) {
      const docRef = assistsCollection.doc(assist.eventId);
      batch.set(docRef, assist);
    }

    await batch.commit();

    stepLogger.info("Assists saved successfully", {
      matchId,
      assistCount: assists.length,
      assists: assists.map((a) => ({
        passEventId: a.passEventId,
        shotEventId: a.shotEventId,
        timeDelta: a.timeDelta,
        passType: a.passType,
      })),
    });
  }

  stepLogger.info("Assist detection complete", {
    matchId,
    goalsProcessed: goals.length,
    assistsDetected: assists.length,
  });

  return {
    matchId,
    goalsProcessed: goals.length,
    assistsDetected: assists.length,
    skipped: false,
  };
}

/**
 * Find the assist pass for a goal
 */
function findAssistForGoal(
  goal: ShotEventDoc & { id: string },
  passes: (GeminiPassEvent & { id: string })[],
  matchId: string,
  version: string,
  log: ILogger
): AssistEventDoc | null {
  const goalTimestamp = goal.timestamp;
  const goalTeam = goal.team;

  // Find passes within time window before the goal
  const candidatePasses = passes.filter((pass) => {
    const timeDelta = goalTimestamp - pass.timestamp;
    const isWithinTimeWindow = timeDelta > 0 && timeDelta <= ASSIST_CONFIG.maxTimeDeltaSec;
    const isSameTeam = pass.team === goalTeam;
    const isCompletePass = pass.details?.outcome === "complete" || !pass.details?.outcome;
    const hasMinConfidence = pass.confidence >= ASSIST_CONFIG.minConfidence;

    return isWithinTimeWindow && isSameTeam && isCompletePass && hasMinConfidence;
  });

  if (candidatePasses.length === 0) {
    log.info("No assist candidate found for goal", {
      goalId: goal.id,
      goalTimestamp,
      goalTeam,
    });
    return null;
  }

  // Select the pass closest to the goal (last pass before goal)
  const assistPass = candidatePasses.reduce((closest, current) => {
    const closestDelta = goalTimestamp - closest.timestamp;
    const currentDelta = goalTimestamp - current.timestamp;
    return currentDelta < closestDelta ? current : closest;
  });

  const timeDelta = goalTimestamp - assistPass.timestamp;

  // Calculate assist confidence based on pass confidence and time proximity
  // Closer passes (smaller time delta) get higher confidence boost
  const timeProximityBonus = Math.max(0, 1 - timeDelta / ASSIST_CONFIG.maxTimeDeltaSec) * 0.1;
  const assistConfidence = Math.min(1, assistPass.confidence + timeProximityBonus);

  const assist: AssistEventDoc = {
    eventId: `${matchId}_assist_${goal.id}`,
    matchId,
    type: "assist",
    passEventId: assistPass.id,
    shotEventId: goal.id,
    assistPlayer: {
      teamId: assistPass.team,
      player: assistPass.player,
      position: assistPass.position,
    },
    scorerPlayer: {
      teamId: goal.team,
      player: goal.player,
      trackId: goal.trackId,
      playerId: goal.playerId,
      position: goal.position,
    },
    timestamp: assistPass.timestamp,
    goalTimestamp: goal.timestamp,
    passType: assistPass.details?.passType as AssistEventDoc["passType"],
    timeDelta,
    confidence: assistConfidence,
    source: "auto",
    version,
    createdAt: new Date().toISOString(),
  };

  log.info("Assist detected", {
    goalId: goal.id,
    passId: assistPass.id,
    timeDelta: timeDelta.toFixed(2),
    passType: assist.passType,
    confidence: assistConfidence.toFixed(2),
  });

  return assist;
}

/**
 * Get assists for a match (for use by subsequent steps)
 */
export async function getMatchAssists(matchId: string): Promise<AssistEventDoc[]> {
  const db = getDb();
  const assistsSnap = await db
    .collection("matches")
    .doc(matchId)
    .collection("assistEvents")
    .orderBy("timestamp", "asc")
    .get();

  return assistsSnap.docs.map((doc) => doc.data() as AssistEventDoc);
}
