/**
 * Half Merger: Merges results from first-half and second-half videos
 *
 * When both firstHalf and secondHalf videos have been analyzed independently,
 * this module merges their results into match-level collections:
 * - Events (passes, carries, turnovers, shots, setPieces)
 * - Clips
 * - Stats
 * - Tactical analysis
 * - Match summary
 *
 * Key operations:
 * 1. Read events from both video subcollections
 * 2. Adjust second-half timestamps by halfDuration (default: 2700s = 45 min)
 * 3. Merge and deduplicate events
 * 4. Aggregate stats (sum counts, average percentages)
 * 5. Create formationByHalf comparison
 * 6. Write merged results to match-level collections
 *
 * Usage:
 *   await mergeHalfResults({ matchId, halfDuration: 2700 });
 */

import { getDb } from "../firebase/admin";
import { defaultLogger as logger, type ILogger } from "./logger";
import type {
  PassEventDoc,
  CarryEventDoc,
  TurnoverEventDoc,
  ShotEventDoc,
  SetPieceEventDoc,
  TacticalAnalysisDoc,
  MatchSummaryDoc,
  FormationTimeline,
  FormationHalfComparison,
  FormationByPhase,
  KeyMoment,
} from "@soccer/shared";

// ============================================================================
// Constants
// ============================================================================

/**
 * P2修正: Firestore batch operation limit
 * Firestore has a 500 operation limit per batch. Using 450 as a safe margin.
 */
const FIRESTORE_BATCH_LIMIT = 450;

// ============================================================================
// Types
// ============================================================================

type MergeOptions = {
  matchId: string;
  /** Duration of first half in seconds (default: 2700 = 45 min) */
  halfDuration?: number;
  /** Version to use for merged results (defaults to latest from videos) */
  version?: string;
};

type VideoEventCollections = {
  passEvents: PassEventDoc[];
  carryEvents: CarryEventDoc[];
  turnoverEvents: TurnoverEventDoc[];
  shotEvents: ShotEventDoc[];
  setPieceEvents: SetPieceEventDoc[];
};

type ClipDoc = {
  clipId: string;
  shotId: string;
  t0: number;
  t1: number;
  reason: "motionPeak" | "audioPeak" | "manual" | "other";
  media: {
    clipPath: string;
    thumbPath?: string;
  };
  version?: string;
  videoId?: string;
  gemini?: {
    model: string;
    promptVersion: string;
    label: string;
    confidence: number;
    title?: string;
    summary?: string;
    tags?: string[];
    coachTips?: string[];
    rawResponse?: string;
    rawOriginalResponse?: string | null;
    createdAt: string;
  } | null;
};

type StatDoc = {
  statId: string;
  calculatorId: string;
  matchId: string;
  version: string;
  playerId?: string | null;
  teamId?: "home" | "away" | null;
  value: number;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
  computedAt: string;
  videoId?: string;
};

// ============================================================================
// Main Merge Function
// ============================================================================

/**
 * Merge results from firstHalf and secondHalf videos into match-level collections
 */
export async function mergeHalfResults({ matchId, halfDuration = 2700, version }: MergeOptions) {
  const mergeLogger = logger.child({ matchId, step: "merge_half_results" });

  // Validate halfDuration
  if (!isFinite(halfDuration) || isNaN(halfDuration)) {
    throw new Error(`halfDuration must be a finite number, got: ${halfDuration}`);
  }
  if (halfDuration < 0) {
    throw new Error(`halfDuration must be non-negative, got: ${halfDuration}`);
  }
  if (halfDuration === 0) {
    mergeLogger.warn("halfDuration is 0, second half timestamps will not be adjusted");
  }
  if (halfDuration > 7200) {
    // 2時間 = 7200秒を超える場合は警告（通常の試合では起こり得ない）
    mergeLogger.warn("halfDuration is unusually large, possible configuration error", { halfDuration });
  }

  mergeLogger.info("Starting half merger", { halfDuration });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // Get video documents to find IDs and versions
  const videosSnap = await matchRef.collection("videos").get();
  const videos = videosSnap.docs.map((doc) => doc.data() as { videoId: string; type: string; analysis?: { activeVersion?: string } });

  const firstHalfVideo = videos.find((v) => v.type === "firstHalf");
  const secondHalfVideo = videos.find((v) => v.type === "secondHalf");

  if (!firstHalfVideo || !secondHalfVideo) {
    throw new Error(`Both firstHalf and secondHalf videos must exist. Found: ${videos.map((v) => v.type).join(", ")}`);
  }

  const firstHalfVideoId = firstHalfVideo.videoId;
  const secondHalfVideoId = secondHalfVideo.videoId;

  // Determine version to use
  const mergeVersion =
    version ?? firstHalfVideo.analysis?.activeVersion ?? secondHalfVideo.analysis?.activeVersion ?? "v0.1.0";

  mergeLogger.info("Found videos to merge", {
    firstHalfVideoId,
    secondHalfVideoId,
    mergeVersion,
  });

  // ===== Step 1: Merge Events =====
  mergeLogger.info("Merging events...");
  const firstHalfEvents = await fetchVideoEvents(matchRef, firstHalfVideoId, mergeVersion);
  const secondHalfEvents = await fetchVideoEvents(matchRef, secondHalfVideoId, mergeVersion);

  const mergedEvents = mergeEvents(firstHalfEvents, secondHalfEvents, halfDuration, mergeLogger);
  await saveEvents(matchRef, mergedEvents, mergeVersion, mergeLogger);

  // ===== Step 2: Merge Clips =====
  mergeLogger.info("Merging clips...");
  const firstHalfClips = await fetchVideoClips(matchRef, firstHalfVideoId, mergeVersion);
  const secondHalfClips = await fetchVideoClips(matchRef, secondHalfVideoId, mergeVersion);

  const mergedClips = mergeClips(firstHalfClips, secondHalfClips, halfDuration);
  await saveClips(matchRef, mergedClips, mergeLogger);

  // ===== Step 3: Merge Stats =====
  mergeLogger.info("Merging stats...");
  const firstHalfStats = await fetchVideoStats(matchRef, firstHalfVideoId, mergeVersion);
  const secondHalfStats = await fetchVideoStats(matchRef, secondHalfVideoId, mergeVersion);

  const mergedStats = mergeStats(firstHalfStats, secondHalfStats, mergeLogger);
  await saveStats(matchRef, mergedStats, mergeLogger);

  // ===== Step 4: Merge Tactical Analysis =====
  mergeLogger.info("Merging tactical analysis...");
  const firstHalfTactical = await fetchVideoTactical(matchRef, firstHalfVideoId);
  const secondHalfTactical = await fetchVideoTactical(matchRef, secondHalfVideoId);

  if (firstHalfTactical && secondHalfTactical) {
    const mergedTactical = mergeTacticalAnalysis(firstHalfTactical, secondHalfTactical, matchId, mergeVersion, halfDuration);
    await saveTactical(matchRef, mergedTactical, mergeLogger);
  } else {
    mergeLogger.warn("Missing tactical analysis for one or both halves", {
      hasFirstHalf: !!firstHalfTactical,
      hasSecondHalf: !!secondHalfTactical,
    });
  }

  // ===== Step 5: Merge Match Summary =====
  mergeLogger.info("Merging match summary...");
  const firstHalfSummary = await fetchVideoSummary(matchRef, firstHalfVideoId);
  const secondHalfSummary = await fetchVideoSummary(matchRef, secondHalfVideoId);

  if (firstHalfSummary && secondHalfSummary) {
    const mergedSummary = mergeMatchSummary(firstHalfSummary, secondHalfSummary, matchId, mergeVersion, halfDuration);
    await saveSummary(matchRef, mergedSummary, mergeLogger);
  } else {
    mergeLogger.warn("Missing match summary for one or both halves", {
      hasFirstHalf: !!firstHalfSummary,
      hasSecondHalf: !!secondHalfSummary,
    });
  }

  // P0修正: マッチステータスを"done"に更新（マージ完了後）
  await matchRef.set(
    {
      analysis: {
        status: "done",
        activeVersion: mergeVersion,
        lastRunAt: new Date().toISOString(),
      },
    },
    { merge: true }
  );
  mergeLogger.info("Match analysis status updated to done");

  mergeLogger.info("Half merger complete", {
    eventCounts: {
      passes: mergedEvents.passEvents.length,
      carries: mergedEvents.carryEvents.length,
      turnovers: mergedEvents.turnoverEvents.length,
      shots: mergedEvents.shotEvents.length,
      setPieces: mergedEvents.setPieceEvents.length,
    },
    clipsCount: mergedClips.length,
    statsCount: mergedStats.length,
  });

  return {
    matchId,
    version: mergeVersion,
    counts: {
      passEvents: mergedEvents.passEvents.length,
      carryEvents: mergedEvents.carryEvents.length,
      turnoverEvents: mergedEvents.turnoverEvents.length,
      shotEvents: mergedEvents.shotEvents.length,
      setPieceEvents: mergedEvents.setPieceEvents.length,
      clips: mergedClips.length,
      stats: mergedStats.length,
    },
  };
}

// ============================================================================
// Event Fetching
// ============================================================================

async function fetchVideoEvents(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId: string,
  version: string
): Promise<VideoEventCollections> {
  const [passSnap, carrySnap, turnoverSnap, shotSnap, setPieceSnap] = await Promise.all([
    matchRef
      .collection("passEvents")
      .where("version", "==", version)
      .where("videoId", "==", videoId)
      .get(),
    matchRef
      .collection("carryEvents")
      .where("version", "==", version)
      .where("videoId", "==", videoId)
      .get(),
    matchRef
      .collection("turnoverEvents")
      .where("version", "==", version)
      .where("videoId", "==", videoId)
      .get(),
    matchRef
      .collection("shotEvents")
      .where("version", "==", version)
      .where("videoId", "==", videoId)
      .get(),
    matchRef
      .collection("setPieceEvents")
      .where("version", "==", version)
      .where("videoId", "==", videoId)
      .get(),
  ]);

  return {
    passEvents: passSnap.docs.map((doc) => doc.data() as PassEventDoc),
    carryEvents: carrySnap.docs.map((doc) => doc.data() as CarryEventDoc),
    turnoverEvents: turnoverSnap.docs.map((doc) => doc.data() as TurnoverEventDoc),
    shotEvents: shotSnap.docs.map((doc) => doc.data() as ShotEventDoc),
    setPieceEvents: setPieceSnap.docs.map((doc) => doc.data() as SetPieceEventDoc),
  };
}

// ============================================================================
// Event Merging
// ============================================================================

function mergeEvents(
  firstHalf: VideoEventCollections,
  secondHalf: VideoEventCollections,
  halfDuration: number,
  logger: ILogger
): VideoEventCollections {
  // Adjust second half timestamps
  const adjustedSecondHalf = {
    passEvents: secondHalf.passEvents.map((e) => adjustPassEventTimestamp(e, halfDuration)),
    carryEvents: secondHalf.carryEvents.map((e) => adjustCarryEventTimestamp(e, halfDuration)),
    turnoverEvents: secondHalf.turnoverEvents.map((e) => adjustTurnoverEventTimestamp(e, halfDuration)),
    shotEvents: secondHalf.shotEvents.map((e) => adjustShotEventTimestamp(e, halfDuration)),
    setPieceEvents: secondHalf.setPieceEvents.map((e) => adjustSetPieceEventTimestamp(e, halfDuration)),
  };

  // Concatenate arrays (no deduplication needed since they're from different halves)
  const merged: VideoEventCollections = {
    passEvents: [...firstHalf.passEvents, ...adjustedSecondHalf.passEvents],
    carryEvents: [...firstHalf.carryEvents, ...adjustedSecondHalf.carryEvents],
    turnoverEvents: [...firstHalf.turnoverEvents, ...adjustedSecondHalf.turnoverEvents],
    shotEvents: [...firstHalf.shotEvents, ...adjustedSecondHalf.shotEvents],
    setPieceEvents: [...firstHalf.setPieceEvents, ...adjustedSecondHalf.setPieceEvents],
  };

  logger.info("Events merged", {
    firstHalf: {
      passes: firstHalf.passEvents.length,
      carries: firstHalf.carryEvents.length,
      turnovers: firstHalf.turnoverEvents.length,
      shots: firstHalf.shotEvents.length,
      setPieces: firstHalf.setPieceEvents.length,
    },
    secondHalf: {
      passes: secondHalf.passEvents.length,
      carries: secondHalf.carryEvents.length,
      turnovers: secondHalf.turnoverEvents.length,
      shots: secondHalf.shotEvents.length,
      setPieces: secondHalf.setPieceEvents.length,
    },
    merged: {
      passes: merged.passEvents.length,
      carries: merged.carryEvents.length,
      turnovers: merged.turnoverEvents.length,
      shots: merged.shotEvents.length,
      setPieces: merged.setPieceEvents.length,
    },
  });

  return merged;
}

// Timestamp adjustment functions
function adjustPassEventTimestamp(event: PassEventDoc, offset: number): PassEventDoc {
  // NaN/undefined防御: タイムスタンプが無効な場合は0として扱う
  const timestamp = event.timestamp ?? 0;
  if (!isFinite(timestamp)) {
    throw new Error(`Invalid timestamp for pass event ${event.eventId}: ${event.timestamp}`);
  }

  return {
    ...event,
    timestamp: timestamp + offset,
    frameNumber: event.frameNumber, // Frame numbers are relative to video, keep as-is
  };
}

function adjustCarryEventTimestamp(event: CarryEventDoc, offset: number): CarryEventDoc {
  // NaN/undefined防御: タイムスタンプが無効な場合は0として扱う
  const startTime = event.startTime ?? 0;
  const endTime = event.endTime ?? 0;
  if (!isFinite(startTime) || !isFinite(endTime)) {
    throw new Error(`Invalid timestamps for carry event ${event.eventId}: start=${event.startTime}, end=${event.endTime}`);
  }

  return {
    ...event,
    startTime: startTime + offset,
    endTime: endTime + offset,
    startFrame: event.startFrame, // Frames are relative to video
    endFrame: event.endFrame,
  };
}

function adjustTurnoverEventTimestamp(event: TurnoverEventDoc, offset: number): TurnoverEventDoc {
  // NaN/undefined防御: タイムスタンプが無効な場合は0として扱う
  const timestamp = event.timestamp ?? 0;
  if (!isFinite(timestamp)) {
    throw new Error(`Invalid timestamp for turnover event ${event.eventId}: ${event.timestamp}`);
  }

  return {
    ...event,
    timestamp: timestamp + offset,
    frameNumber: event.frameNumber, // Frames are relative to video
  };
}

function adjustShotEventTimestamp(event: ShotEventDoc, offset: number): ShotEventDoc {
  // NaN/undefined防御: タイムスタンプが無効な場合は0として扱う
  const timestamp = event.timestamp ?? 0;
  if (!isFinite(timestamp)) {
    throw new Error(`Invalid timestamp for shot event ${event.eventId}: ${event.timestamp}`);
  }

  return {
    ...event,
    timestamp: timestamp + offset,
    // P0修正: frameNumberはoptionalなので、undefinedの場合はプロパティを含めない
    ...(event.frameNumber !== undefined && { frameNumber: event.frameNumber }),
  };
}

function adjustSetPieceEventTimestamp(event: SetPieceEventDoc, offset: number): SetPieceEventDoc {
  // NaN/undefined防御: タイムスタンプが無効な場合は0として扱う
  const timestamp = event.timestamp ?? 0;
  if (!isFinite(timestamp)) {
    throw new Error(`Invalid timestamp for set piece event ${event.eventId}: ${event.timestamp}`);
  }

  return {
    ...event,
    timestamp: timestamp + offset,
    // P0修正: frameNumberはoptionalなので、undefinedの場合はプロパティを含めない
    ...(event.frameNumber !== undefined && { frameNumber: event.frameNumber }),
  };
}

// ============================================================================
// Event Saving
// ============================================================================

async function saveEvents(
  matchRef: FirebaseFirestore.DocumentReference,
  events: VideoEventCollections,
  version: string,
  logger: ILogger
) {
  const db = matchRef.firestore;
  const BATCH_LIMIT = FIRESTORE_BATCH_LIMIT;

  // Early return if no events to save
  const totalEventCount =
    events.passEvents.length +
    events.carryEvents.length +
    events.turnoverEvents.length +
    events.shotEvents.length +
    events.setPieceEvents.length;

  if (totalEventCount === 0) {
    logger.info("No events to save");
    return;
  }

  // Collect all events with their collection names
  const allDocs: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];

  // Save pass events
  for (const event of events.passEvents) {
    allDocs.push({
      collection: "passEvents",
      id: event.eventId,
      data: { ...event, mergedFromHalves: true },
    });
  }

  // Save carry events
  for (const event of events.carryEvents) {
    allDocs.push({
      collection: "carryEvents",
      id: event.eventId,
      data: { ...event, mergedFromHalves: true },
    });
  }

  // Save turnover events
  for (const event of events.turnoverEvents) {
    allDocs.push({
      collection: "turnoverEvents",
      id: event.eventId,
      data: { ...event, mergedFromHalves: true },
    });
  }

  // Save shot events
  for (const event of events.shotEvents) {
    allDocs.push({
      collection: "shotEvents",
      id: event.eventId,
      data: { ...event, mergedFromHalves: true },
    });
  }

  // Save set piece events
  for (const event of events.setPieceEvents) {
    allDocs.push({
      collection: "setPieceEvents",
      id: event.eventId,
      data: { ...event, mergedFromHalves: true },
    });
  }

  // Commit in batches to respect Firestore 500 operation limit
  const totalBatches = Math.ceil(allDocs.length / BATCH_LIMIT);
  logger.info("Writing merged events to Firestore", {
    totalDocs: allDocs.length,
    totalBatches,
    batchLimit: BATCH_LIMIT,
  });

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, allDocs.length);

    for (let i = startIdx; i < endIdx; i++) {
      const doc = allDocs[i];
      const docRef = matchRef.collection(doc.collection).doc(doc.id);
      batch.set(docRef, doc.data, { merge: true });
    }

    try {
      await batch.commit();
      logger.debug("Batch committed", {
        batchIdx: batchIdx + 1,
        totalBatches,
        docsInBatch: endIdx - startIdx,
      });
    } catch (error) {
      // P1修正: バッチエラーメッセージを詳細化
      const failedDocs = allDocs.slice(startIdx, endIdx);
      const failedDocIds = failedDocs.slice(0, 5).map(d => d.id);
      const affectedCollections = [...new Set(failedDocs.map(d => d.collection))];

      logger.error("Failed to commit batch", {
        batchIdx: batchIdx + 1,
        totalBatches,
        startIdx,
        endIdx,
        failedDocIds,
        affectedCollections,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Batch commit failed at batch ${batchIdx + 1}/${totalBatches} ` +
        `(docs ${startIdx}-${endIdx}, collections: ${affectedCollections.join(", ")}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  logger.info("Events saved to Firestore", {
    passEvents: events.passEvents.length,
    carryEvents: events.carryEvents.length,
    turnoverEvents: events.turnoverEvents.length,
    shotEvents: events.shotEvents.length,
    setPieceEvents: events.setPieceEvents.length,
  });
}

// ============================================================================
// Clips Merging
// ============================================================================

async function fetchVideoClips(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId: string,
  version: string
): Promise<ClipDoc[]> {
  const clipsSnap = await matchRef
    .collection("clips")
    .where("version", "==", version)
    .where("videoId", "==", videoId)
    .get();
  return clipsSnap.docs.map((doc) => doc.data() as ClipDoc);
}

function mergeClips(firstHalf: ClipDoc[], secondHalf: ClipDoc[], halfDuration: number): ClipDoc[] {
  // Adjust second half timestamps with NaN/undefined defense
  const adjustedSecondHalf = secondHalf.map((clip) => {
    const t0 = clip.t0 ?? 0;
    const t1 = clip.t1 ?? 0;
    
    if (!isFinite(t0) || !isFinite(t1)) {
      throw new Error(`Invalid timestamps for clip ${clip.clipId}: t0=${clip.t0}, t1=${clip.t1}`);
    }
    
    return {
      ...clip,
      t0: t0 + halfDuration,
      t1: t1 + halfDuration,
    };
  });

  return [...firstHalf, ...adjustedSecondHalf];
}

async function saveClips(
  matchRef: FirebaseFirestore.DocumentReference,
  clips: ClipDoc[],
  logger: ILogger
) {
  const db = matchRef.firestore;
  const BATCH_LIMIT = FIRESTORE_BATCH_LIMIT;

  // Handle empty array case
  if (clips.length === 0) {
    logger.info("No clips to save");
    return;
  }

  // Process in batches to respect Firestore limit
  const totalBatches = Math.ceil(clips.length / BATCH_LIMIT);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, clips.length);

    for (let i = startIdx; i < endIdx; i++) {
      const clip = clips[i];
      const docRef = matchRef.collection("clips").doc(clip.clipId);
      batch.set(docRef, { ...clip, mergedFromHalves: true }, { merge: true });
    }

    try {
      await batch.commit();
      logger.debug("Clips batch committed", {
        batchIdx: batchIdx + 1,
        totalBatches,
        docsInBatch: endIdx - startIdx,
      });
    } catch (error) {
      logger.error("Failed to commit clips batch", {
        batchIdx: batchIdx + 1,
        totalBatches,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Clips batch commit failed at batch ${batchIdx + 1}/${totalBatches}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  logger.info("Clips saved to Firestore", { count: clips.length, batchCount: totalBatches });
}

// ============================================================================
// Stats Merging
// ============================================================================

async function fetchVideoStats(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId: string,
  version: string
): Promise<StatDoc[]> {
  const statsSnap = await matchRef
    .collection("stats")
    .where("version", "==", version)
    .where("videoId", "==", videoId)
    .get();
  return statsSnap.docs.map((doc) => doc.data() as StatDoc);
}

function mergeStats(
  firstHalf: StatDoc[],
  secondHalf: StatDoc[],
  logger: ILogger
): StatDoc[] {
  // Group stats by calculatorId + playerId + teamId
  const statGroups = new Map<string, StatDoc[]>();

  for (const stat of [...firstHalf, ...secondHalf]) {
    const key = `${stat.calculatorId}_${stat.playerId ?? "match"}_${stat.teamId ?? "none"}`;
    if (!statGroups.has(key)) {
      statGroups.set(key, []);
    }
    statGroups.get(key)!.push(stat);
  }

  const merged: StatDoc[] = [];

  for (const [key, stats] of statGroups.entries()) {
    if (stats.length === 1) {
      // Only one half has this stat, keep it as-is
      merged.push({ ...stats[0], mergedFromHalves: true } as StatDoc);
    } else if (stats.length === 2) {
      // Merge stats from both halves
      const mergedStat = mergeStatPair(stats[0], stats[1]);
      merged.push(mergedStat);
    } else {
      // stats.length > 2: 異常ケース - すべてを順次マージ
      // P1修正: 最初の2つだけでなく、すべての統計を順次マージ
      logger.warn("Unexpected stat count for key, merging all sequentially", {
        key,
        count: stats.length,
        calculatorId: stats[0].calculatorId,
      });
      const mergedStat = stats.reduce((acc, stat) => mergeStatPair(acc, stat));
      merged.push(mergedStat);
    }
  }

  logger.info("Stats merged", {
    firstHalfCount: firstHalf.length,
    secondHalfCount: secondHalf.length,
    mergedCount: merged.length,
  });

  return merged;
}

function mergeStatPair(stat1: StatDoc, stat2: StatDoc): StatDoc {
  // P1修正: calculatorIdが一致することを検証
  if (stat1.calculatorId !== stat2.calculatorId) {
    throw new Error(
      `Cannot merge stats with different calculatorIds: ${stat1.calculatorId} vs ${stat2.calculatorId}`
    );
  }

  // P1修正: playerId/teamIdが一致することを検証（異なるスコープのスタッツを誤ってマージするのを防ぐ）
  if (stat1.playerId !== stat2.playerId || stat1.teamId !== stat2.teamId) {
    throw new Error(
      `Cannot merge stats with different player/team: ` +
      `(playerId: ${stat1.playerId}, teamId: ${stat1.teamId}) vs ` +
      `(playerId: ${stat2.playerId}, teamId: ${stat2.teamId})`
    );
  }

  const calculatorId = stat1.calculatorId;

  // Validate stat values with NaN/undefined defense
  const value1 = stat1.value ?? 0;
  const value2 = stat2.value ?? 0;
  
  if (!isFinite(value1) || !isFinite(value2)) {
    throw new Error(
      `Invalid stat values for ${calculatorId}: stat1=${stat1.value}, stat2=${stat2.value}`
    );
  }

  // Determine if this is a count (sum) or percentage/rate (average)
  // P0修正: \bは文字クラス内でbackspaceに解釈されるため、正規表現を修正
  // Examples of count metrics: shot_count, pass_total, goal_number, pass_count_first_half
  // Examples of absolute stats: goals, shots, passes (末尾がこれらで終わる場合も合計)
  // Examples of percentage metrics: pass_accuracy, shot_accuracy, possession_rate
  const isCountMetric =
    // 単語としてcount/total/numberを含む（アンダースコアまたは文字列境界で区切られる）
    (/(?:^|_)(count|total|number)(?:_|$)/i.test(calculatorId) ||
      // または末尾がgoals/shots/passes等の絶対数統計
      /_(goals|shots|passes|tackles|clearances|blocks|fouls|corners|offsides)$/i.test(calculatorId)) &&
    // パーセンテージ・レート系を明示的に除外
    !/(?:^|_)(accuracy|rate|percentage|ratio|average)(?:_|$)/i.test(calculatorId);

  // Count metrics are summed, percentage/rate metrics are averaged
  const mergedValue = isCountMetric ? value1 + value2 : (value1 + value2) / 2;

  return {
    ...stat1,
    value: mergedValue,
    mergedFromHalves: true,
    metadata: {
      ...stat1.metadata,
      firstHalfValue: stat1.value,
      secondHalfValue: stat2.value,
    },
  } as StatDoc;
}

async function saveStats(
  matchRef: FirebaseFirestore.DocumentReference,
  stats: StatDoc[],
  logger: ILogger
) {
  const db = matchRef.firestore;
  const BATCH_LIMIT = FIRESTORE_BATCH_LIMIT;

  // Handle empty array case
  if (stats.length === 0) {
    logger.info("No stats to save");
    return;
  }

  // Process in batches to respect Firestore limit
  const totalBatches = Math.ceil(stats.length / BATCH_LIMIT);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = db.batch();
    const startIdx = batchIdx * BATCH_LIMIT;
    const endIdx = Math.min(startIdx + BATCH_LIMIT, stats.length);

    for (let i = startIdx; i < endIdx; i++) {
      const stat = stats[i];
      const docRef = matchRef.collection("stats").doc(stat.statId);
      batch.set(docRef, stat, { merge: true });
    }

    try {
      await batch.commit();
      logger.debug("Stats batch committed", {
        batchIdx: batchIdx + 1,
        totalBatches,
        docsInBatch: endIdx - startIdx,
      });
    } catch (error) {
      logger.error("Failed to commit stats batch", {
        batchIdx: batchIdx + 1,
        totalBatches,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Stats batch commit failed at batch ${batchIdx + 1}/${totalBatches}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  logger.info("Stats saved to Firestore", { count: stats.length, batchCount: totalBatches });
}

// ============================================================================
// Tactical Analysis Merging
// ============================================================================

async function fetchVideoTactical(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId: string
): Promise<TacticalAnalysisDoc | null> {
  const tacticalDoc = await matchRef.collection("tactical").doc(`${videoId}_current`).get();
  if (!tacticalDoc.exists) return null;
  return tacticalDoc.data() as TacticalAnalysisDoc;
}

function mergeTacticalAnalysis(
  firstHalf: TacticalAnalysisDoc,
  secondHalf: TacticalAnalysisDoc,
  matchId: string,
  version: string,
  halfDuration: number
): TacticalAnalysisDoc {
  // Adjust second half FormationTimeline timestamps
  const adjustedSecondHalfTimeline = secondHalf.formationTimeline
    ? adjustFormationTimelineTimestamps(secondHalf.formationTimeline, halfDuration)
    : createDefaultFormationTimeline(secondHalf.formation.home, secondHalf.formation.away);

  // Create formation by half comparison
  const formationByHalf: FormationHalfComparison = {
    firstHalf: firstHalf.formationTimeline ?? createDefaultFormationTimeline(firstHalf.formation.home, firstHalf.formation.away),
    secondHalf: adjustedSecondHalfTimeline,
    comparison: {
      formationChanged: firstHalf.formation.home !== secondHalf.formation.home || firstHalf.formation.away !== secondHalf.formation.away,
      firstHalfDominant: firstHalf.formation.home,
      secondHalfDominant: secondHalf.formation.home,
      variabilityChange:
        (secondHalf.formationTimeline?.formationVariability ?? 0) - (firstHalf.formationTimeline?.formationVariability ?? 0),
    },
  };

  // Merge formationByPhase (handle cases where one or both halves have it)
  let formationByPhase: FormationByPhase | undefined;
  if (firstHalf.formationByPhase && secondHalf.formationByPhase) {
    // Both halves have formationByPhase - merge them
    formationByPhase = {
      attacking: mergeFormationTimelines(
        firstHalf.formationByPhase.attacking,
        secondHalf.formationByPhase.attacking,
        halfDuration
      ),
      defending: mergeFormationTimelines(
        firstHalf.formationByPhase.defending,
        secondHalf.formationByPhase.defending,
        halfDuration
      ),
      transition: mergeFormationTimelines(
        firstHalf.formationByPhase.transition,
        secondHalf.formationByPhase.transition,
        halfDuration
      ),
      setPiece: mergeFormationTimelines(
        firstHalf.formationByPhase.setPiece,
        secondHalf.formationByPhase.setPiece,
        halfDuration
      ),
      comparison: {
        hasPhaseVariation:
          firstHalf.formationByPhase.comparison.hasPhaseVariation ||
          secondHalf.formationByPhase.comparison.hasPhaseVariation,
        attackingDominant: secondHalf.formationByPhase.comparison.attackingDominant,
        defendingDominant: secondHalf.formationByPhase.comparison.defendingDominant,
        transitionDominant: secondHalf.formationByPhase.comparison.transitionDominant,
        phaseAdaptability:
          (firstHalf.formationByPhase.comparison.phaseAdaptability +
            secondHalf.formationByPhase.comparison.phaseAdaptability) / 2,
      },
    };
  } else if (secondHalf.formationByPhase) {
    // Only second half has formationByPhase - adjust timestamps and use it
    formationByPhase = {
      attacking: adjustFormationTimelineTimestamps(secondHalf.formationByPhase.attacking, halfDuration),
      defending: adjustFormationTimelineTimestamps(secondHalf.formationByPhase.defending, halfDuration),
      transition: adjustFormationTimelineTimestamps(secondHalf.formationByPhase.transition, halfDuration),
      setPiece: adjustFormationTimelineTimestamps(secondHalf.formationByPhase.setPiece, halfDuration),
      comparison: secondHalf.formationByPhase.comparison,
    };
  } else if (firstHalf.formationByPhase) {
    // Only first half has formationByPhase - use it as is
    formationByPhase = firstHalf.formationByPhase;
  }

  // Merge tactical insights
  return {
    matchId,
    version,
    formation: {
      home: secondHalf.formation.home, // Use second half as "current" formation
      away: secondHalf.formation.away,
    },
    tempo: {
      home: (firstHalf.tempo.home + secondHalf.tempo.home) / 2,
      away: (firstHalf.tempo.away + secondHalf.tempo.away) / 2,
    },
    attackPatterns: [...new Set([...firstHalf.attackPatterns, ...secondHalf.attackPatterns])],
    defensivePatterns: [...new Set([...firstHalf.defensivePatterns, ...secondHalf.defensivePatterns])],
    keyInsights: [...firstHalf.keyInsights, ...secondHalf.keyInsights],
    pressingIntensity: firstHalf.pressingIntensity && secondHalf.pressingIntensity
      ? {
          home: (firstHalf.pressingIntensity.home + secondHalf.pressingIntensity.home) / 2,
          away: (firstHalf.pressingIntensity.away + secondHalf.pressingIntensity.away) / 2,
        }
      : undefined,
    buildUpStyle: {
      home: secondHalf.buildUpStyle?.home ?? firstHalf.buildUpStyle?.home ?? "mixed",
      away: secondHalf.buildUpStyle?.away ?? firstHalf.buildUpStyle?.away ?? "mixed",
    },
    formationByHalf,
    ...(formationByPhase && { formationByPhase }),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Adjust timestamps in a FormationTimeline by adding an offset
 */
function adjustFormationTimelineTimestamps(timeline: FormationTimeline, offset: number): FormationTimeline {
  // Handle null/undefined safely with defensive programming
  const states = timeline?.states ?? [];
  const changes = timeline?.changes ?? [];

  return {
    states: states.map(state => ({
      ...state,
      // P0修正: isFinite()でNaN/undefined/Infinityすべてを防御
      timestamp: (isFinite(state.timestamp) ? state.timestamp : 0) + offset,
    })),
    changes: changes.map(change => ({
      ...change,
      // P0修正: isFinite()でNaN/undefined/Infinityすべてを防御
      timestamp: (isFinite(change.timestamp) ? change.timestamp : 0) + offset,
    })),
    // P1修正: 空文字ではなく"unknown"をデフォルト（下流でのfalsy判定を防ぐ）
    dominantFormation: timeline?.dominantFormation || "unknown",
    formationVariability: timeline?.formationVariability ?? 0,
  };
}

/**
 * Merge two FormationTimelines, adjusting second half timestamps
 */
function mergeFormationTimelines(
  first: FormationTimeline,
  second: FormationTimeline,
  halfDuration: number
): FormationTimeline {
  const adjustedSecond = adjustFormationTimelineTimestamps(second, halfDuration);

  // Use nullish coalescing for array safety
  const firstStates = first.states ?? [];
  const firstChanges = first.changes ?? [];
  const secondStates = adjustedSecond.states ?? [];
  const secondChanges = adjustedSecond.changes ?? [];

  // Sort with timestamp guards to prevent NaN comparison issues
  // P0修正: nullish coalescingはNaNを0に変換しないため、isFinite()を使用
  const sortByTimestamp = <T extends { timestamp: number }>(a: T, b: T) => {
    const tsA = isFinite(a.timestamp) ? a.timestamp : 0;
    const tsB = isFinite(b.timestamp) ? b.timestamp : 0;
    return tsA - tsB;
  };

  return {
    states: [...firstStates, ...secondStates].sort(sortByTimestamp),
    changes: [...firstChanges, ...secondChanges].sort(sortByTimestamp),
    // Use second half as current, with fallback to first half or default
    dominantFormation: adjustedSecond.dominantFormation || first.dominantFormation || "4-4-2",
    formationVariability: ((first.formationVariability ?? 0) + (adjustedSecond.formationVariability ?? 0)) / 2,
  };
}

function createDefaultFormationTimeline(homeFormation: string, awayFormation: string): FormationTimeline {
  return {
    states: [],
    changes: [],
    dominantFormation: homeFormation,
    formationVariability: 0,
  };
}

async function saveTactical(
  matchRef: FirebaseFirestore.DocumentReference,
  tactical: TacticalAnalysisDoc,
  logger: ILogger
) {
  try {
    await matchRef.collection("tactical").doc("current").set(tactical, { merge: true });
    logger.info("Tactical analysis saved to Firestore");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to save tactical analysis", { error: message });
    throw new Error(`Failed to save tactical analysis: ${message}`);
  }
}

// ============================================================================
// Match Summary Merging
// ============================================================================

async function fetchVideoSummary(
  matchRef: FirebaseFirestore.DocumentReference,
  videoId: string
): Promise<MatchSummaryDoc | null> {
  const summaryDoc = await matchRef.collection("summary").doc(`${videoId}_current`).get();
  if (!summaryDoc.exists) return null;
  return summaryDoc.data() as MatchSummaryDoc;
}

function mergeMatchSummary(
  firstHalf: MatchSummaryDoc,
  secondHalf: MatchSummaryDoc,
  matchId: string,
  version: string,
  halfDuration: number
): MatchSummaryDoc {
  // Adjust second half key moments timestamps with NaN/undefined defense
  const adjustedSecondHalfMoments = secondHalf.keyMoments.map((moment) => {
    const timestamp = moment.timestamp ?? 0;
    if (!isFinite(timestamp)) {
      throw new Error(`Invalid timestamp in key moment: ${moment.timestamp}`);
    }
    return {
      ...moment,
      timestamp: timestamp + halfDuration,
    };
  });

  // Merge key moments and sort by timestamp with NaN-safe comparison
  const allKeyMoments = [...firstHalf.keyMoments, ...adjustedSecondHalfMoments].sort((a, b) => {
    const tsA = a.timestamp ?? 0;
    const tsB = b.timestamp ?? 0;
    return tsA - tsB;
  });

  return {
    matchId,
    version,
    headline: secondHalf.headline || firstHalf.headline, // Prefer second half headline as match conclusion
    narrative: {
      firstHalf: firstHalf.narrative.firstHalf || "",
      secondHalf: secondHalf.narrative.secondHalf || secondHalf.narrative.firstHalf || "",
      overall: `${firstHalf.narrative.firstHalf || ""}\n\n${secondHalf.narrative.secondHalf || secondHalf.narrative.firstHalf || ""}`.trim(),
    },
    keyMoments: allKeyMoments,
    playerHighlights: [...firstHalf.playerHighlights, ...secondHalf.playerHighlights],
    score: secondHalf.score || firstHalf.score,
    mvp: secondHalf.mvp || firstHalf.mvp,
    tags: [...new Set([...(firstHalf.tags ?? []), ...(secondHalf.tags ?? [])])],
    createdAt: new Date().toISOString(),
  };
}

async function saveSummary(
  matchRef: FirebaseFirestore.DocumentReference,
  summary: MatchSummaryDoc,
  logger: ILogger
) {
  try {
    await matchRef.collection("summary").doc("current").set(summary, { merge: true });
    logger.info("Match summary saved to Firestore");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to save match summary", { error: message });
    throw new Error(`Failed to save match summary: ${message}`);
  }
}
