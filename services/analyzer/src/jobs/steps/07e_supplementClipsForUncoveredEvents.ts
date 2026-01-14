/**
 * Step 07e: Supplement Clips for Uncovered Events
 *
 * Phase 2.2a: イベントベースのクリップ補完
 *
 * 検出されたイベントのうち、既存クリップに含まれないものを特定し、
 * 追加クリップを生成する。主にショットとセットピースを対象とする。
 */

import { getDb } from "../../firebase/admin";
import { defaultLogger as logger, type ILogger } from "../../lib/logger";

// ============================================================================
// Types
// ============================================================================

interface EventDoc {
  eventId: string;
  type: string;
  timestamp: number;
  team: "home" | "away";
  confidence: number;
  version: string;
}

interface ClipDoc {
  clipId: string;
  t0: number;
  t1: number;
  version: string;
  reason?: string;
}

export interface SupplementClipsOptions {
  matchId: string;
  version: string;
  videoDuration?: number;
  logger?: ILogger;
}

export interface SupplementClipsResult {
  matchId: string;
  ok: boolean;
  existingClipCount: number;
  highPriorityEventCount: number;
  uncoveredEventCount: number;
  supplementaryClipCount: number;
  skipped: boolean;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const SUPPLEMENT_CONFIG = {
  // イベント前後のクリップ時間幅（秒）
  windowBefore: 5,
  windowAfter: 3,

  // 既存クリップとの重複判定の許容範囲（秒）
  overlapTolerance: 5,

  // 高優先度イベントタイプ（クリップ補完対象）
  priorityEventTypes: ["shot", "setPiece"] as const,

  // 最小信頼度閾値
  minConfidence: 0.5,

  // 最大補完クリップ数（コスト管理）
  maxSupplementaryClips: 20,
};

// ============================================================================
// Main Function
// ============================================================================

export async function stepSupplementClipsForUncoveredEvents(
  options: SupplementClipsOptions
): Promise<SupplementClipsResult> {
  const { matchId, version } = options;
  const log = options.logger ?? logger;
  const stepLogger = log.child ? log.child({ step: "supplement_clips" }) : log;

  stepLogger.info("Starting clip supplementation for uncovered events", { matchId, version });

  const db = getDb();
  const matchRef = db.collection("matches").doc(matchId);

  // 冪等性チェック: 既に補完クリップが存在するかを確認
  const existingSupplementary = await matchRef
    .collection("clips")
    .where("reason", "==", "event_supplement")
    .where("version", "==", version)
    .limit(1)
    .get();

  if (!existingSupplementary.empty) {
    stepLogger.info("Supplementary clips already exist, skipping", { matchId, version });
    return {
      matchId,
      ok: true,
      existingClipCount: 0,
      highPriorityEventCount: 0,
      uncoveredEventCount: 0,
      supplementaryClipCount: 0,
      skipped: true,
    };
  }

  // 既存クリップを取得
  const clipsSnap = await matchRef.collection("clips").where("version", "==", version).get();
  const clips: ClipDoc[] = clipsSnap.docs.map((doc) => ({
    clipId: doc.id,
    t0: doc.data().t0 as number,
    t1: doc.data().t1 as number,
    version: doc.data().version as string,
    reason: doc.data().reason as string | undefined,
  }));

  // 高優先度イベントを取得（ショット、セットピース）
  const [shotEventsSnap, setPieceEventsSnap] = await Promise.all([
    matchRef.collection("shotEvents").where("version", "==", version).get(),
    matchRef.collection("setPieceEvents").where("version", "==", version).get(),
  ]);

  const shotEvents: EventDoc[] = shotEventsSnap.docs.map((doc) => ({
    eventId: doc.id,
    type: "shot",
    timestamp: doc.data().timestamp as number,
    team: doc.data().team as "home" | "away",
    confidence: doc.data().confidence as number,
    version: doc.data().version as string,
  }));

  const setPieceEvents: EventDoc[] = setPieceEventsSnap.docs.map((doc) => ({
    eventId: doc.id,
    type: "setPiece",
    timestamp: doc.data().timestamp as number,
    team: doc.data().team as "home" | "away",
    confidence: doc.data().confidence as number,
    version: doc.data().version as string,
  }));

  const highPriorityEvents = [...shotEvents, ...setPieceEvents].filter(
    (e) => e.confidence >= SUPPLEMENT_CONFIG.minConfidence
  );

  stepLogger.info("Event and clip counts", {
    matchId,
    existingClips: clips.length,
    shotEvents: shotEvents.length,
    setPieceEvents: setPieceEvents.length,
    highPriorityEvents: highPriorityEvents.length,
  });

  // 未カバーイベントを特定
  const uncoveredEvents = findUncoveredEvents(highPriorityEvents, clips, SUPPLEMENT_CONFIG.overlapTolerance);

  stepLogger.info("Uncovered events identified", {
    matchId,
    uncoveredCount: uncoveredEvents.length,
    uncoveredTypes: uncoveredEvents.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  });

  // 補完クリップ数を制限
  const eventsToSupplement = uncoveredEvents
    .sort((a, b) => b.confidence - a.confidence) // 高信頼度優先
    .slice(0, SUPPLEMENT_CONFIG.maxSupplementaryClips);

  if (eventsToSupplement.length === 0) {
    stepLogger.info("All high-priority events are already covered by clips", { matchId });
    return {
      matchId,
      ok: true,
      existingClipCount: clips.length,
      highPriorityEventCount: highPriorityEvents.length,
      uncoveredEventCount: 0,
      supplementaryClipCount: 0,
      skipped: false,
    };
  }

  // 動画の長さを取得（メタデータから）
  const matchSnap = await matchRef.get();
  const matchData = matchSnap.data();
  const videoDuration = options.videoDuration ?? matchData?.meta?.duration ?? 7200; // デフォルト2時間

  // 補完クリップのメタデータを作成
  const supplementaryClips = eventsToSupplement.map((event, idx) => {
    const t0 = Math.max(0, event.timestamp - SUPPLEMENT_CONFIG.windowBefore);
    const t1 = Math.min(videoDuration, event.timestamp + SUPPLEMENT_CONFIG.windowAfter);
    const safeVersion = version.replace(/[^a-zA-Z0-9_-]/g, "_");

    return {
      clipId: `clip_supp_${safeVersion}_${idx + 1}`,
      t0,
      t1,
      reason: "event_supplement" as const,
      version,
      sourceEvent: {
        eventId: event.eventId,
        eventType: event.type,
        timestamp: event.timestamp,
        confidence: event.confidence,
        team: event.team,
      },
      // media は後で実際のクリップ抽出時に設定
      createdAt: new Date().toISOString(),
    };
  });

  // Firestoreにバッチ保存（クリップのメタデータのみ、実際のビデオ抽出は別ステップで実施可能）
  const batch = db.batch();
  for (const clip of supplementaryClips) {
    batch.set(matchRef.collection("clips").doc(clip.clipId), clip);
  }
  await batch.commit();

  stepLogger.info("Supplementary clip metadata saved", {
    matchId,
    supplementaryClipCount: supplementaryClips.length,
    clipIds: supplementaryClips.map((c) => c.clipId),
  });

  return {
    matchId,
    ok: true,
    existingClipCount: clips.length,
    highPriorityEventCount: highPriorityEvents.length,
    uncoveredEventCount: uncoveredEvents.length,
    supplementaryClipCount: supplementaryClips.length,
    skipped: false,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 既存クリップに含まれない（カバーされていない）イベントを特定
 */
function findUncoveredEvents(
  events: EventDoc[],
  clips: ClipDoc[],
  tolerance: number
): EventDoc[] {
  return events.filter((event) => {
    // イベントが既存クリップのいずれかにカバーされているかチェック
    const isCovered = clips.some((clip) => {
      // クリップの時間範囲 ± tolerance 内にイベントが含まれるか
      return event.timestamp >= clip.t0 - tolerance && event.timestamp <= clip.t1 + tolerance;
    });
    return !isCovered;
  });
}
