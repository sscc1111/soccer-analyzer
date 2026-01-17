/**
 * Integration Example: Clip-Event Matcher with Pipeline
 *
 * パイプラインでの実際の統合例
 */

import {
  rankClipsByImportance,
  filterClipsByImportance,
  type Clip,
  type Event,
  type MatchContext,
} from "./clipEventMatcher";
import type { ImportantSceneDoc } from "@soccer/shared/src/domain/scene";
import type { DeduplicatedEvent } from "@soccer/shared/src/domain/event";

// ============================================================
// Type Conversions
// ============================================================

/**
 * ImportantSceneDocからClipへの変換
 */
function sceneToClip(scene: ImportantSceneDoc): Clip {
  return {
    id: scene.sceneId,
    startTime: scene.startSec,
    endTime: scene.endSec,
  };
}

/**
 * DeduplicatedEventからEventへの変換
 */
function deduplicatedEventToEvent(event: DeduplicatedEvent): Event {
  return {
    id: event.eventId,
    timestamp: event.timestamp,
    type: mapEventType(event.type),
    details: mapEventDetails(event),
  };
}

/**
 * イベントタイプのマッピング
 */
function mapEventType(type: DeduplicatedEvent["type"]): Event["type"] {
  // DeduplicatedEventのtypeをClipEventMatcherのEventTypeにマッピング
  const typeMap: Record<DeduplicatedEvent["type"], Event["type"]> = {
    pass: "pass",
    carry: "carry",
    turnover: "turnover",
    shot: "shot",
    setPiece: "setPiece",
  };

  return typeMap[type] || "pass"; // デフォルトはpass
}

/**
 * イベント詳細のマッピング
 */
function mapEventDetails(event: DeduplicatedEvent): Event["details"] {
  const details = event.details || {};

  // shotの場合
  if (event.type === "shot" && typeof details === "object") {
    return {
      shotResult: (details as any).result || undefined,
      shotType: (details as any).shotType || undefined,
      isOnTarget: (details as any).onTarget || false,
    };
  }

  // turnoverの場合
  if (event.type === "turnover" && typeof details === "object") {
    return {
      turnoverType: (details as any).type || undefined,
    };
  }

  return details as Event["details"];
}

/**
 * 試合時間からMatchContextを生成
 */
function createMatchContext(
  timestamp: number,
  matchDurationMinutes: number,
  homeScore: number,
  awayScore: number,
  isHomeTeam: boolean
): MatchContext {
  return {
    matchMinute: Math.floor(timestamp / 60),
    totalMatchMinutes: matchDurationMinutes,
    scoreDifferential: isHomeTeam ? homeScore - awayScore : awayScore - homeScore,
    isHomeTeam,
  };
}

// ============================================================
// Integration Functions
// ============================================================

/**
 * パイプラインでの統合例: シーンのランキングとフィルタリング
 */
export async function rankAndFilterScenes(params: {
  scenes: ImportantSceneDoc[];
  events: DeduplicatedEvent[];
  matchDurationMinutes: number;
  currentHomeScore: number;
  currentAwayScore: number;
  isHomeTeam: boolean;
  minImportanceThreshold?: number;
  maxScenes?: number;
}): Promise<{
  rankedScenes: ImportantSceneDoc[];
  importanceScores: Record<string, number>;
  filteredCount: number;
}> {
  const {
    scenes,
    events,
    matchDurationMinutes,
    currentHomeScore,
    currentAwayScore,
    isHomeTeam,
    minImportanceThreshold = 0.5,
    maxScenes = 20,
  } = params;

  // 変換
  const clips = scenes.map(sceneToClip);
  const mappedEvents = events.map(deduplicatedEventToEvent);

  // コンテキスト生成（最新のイベント時刻を使用）
  const latestTimestamp = Math.max(...events.map((e) => e.timestamp), 0);
  const context = createMatchContext(
    latestTimestamp,
    matchDurationMinutes,
    currentHomeScore,
    currentAwayScore,
    isHomeTeam
  );

  // ランキング
  const ranked = rankClipsByImportance(clips, mappedEvents, context);

  // 重要度マップ作成
  const importanceScores: Record<string, number> = {};
  ranked.forEach((rc) => {
    importanceScores[rc.clip.id] = rc.importance.finalImportance;
  });

  // フィルタリング: 閾値以上 & 最大数以下
  const filtered = ranked.filter((rc) => rc.importance.finalImportance >= minImportanceThreshold);
  const topFiltered = filtered.slice(0, maxScenes);

  // 元のシーンに重要度スコアを追加してソート
  const rankedScenes = topFiltered
    .map((rc) => {
      const originalScene = scenes.find((s) => s.sceneId === rc.clip.id);
      if (!originalScene) return null;

      // 重要度スコアを更新
      return {
        ...originalScene,
        importance: rc.importance.finalImportance,
      };
    })
    .filter((s): s is ImportantSceneDoc => s !== null);

  return {
    rankedScenes,
    importanceScores,
    filteredCount: topFiltered.length,
  };
}

/**
 * パイプラインステップ例: シーン抽出後のフィルタリング
 */
export async function filterExtractedScenes(params: {
  scenes: ImportantSceneDoc[];
  events: DeduplicatedEvent[];
  matchId: string;
  matchDurationMinutes: number;
  homeScore: number;
  awayScore: number;
  teamSide: "home" | "away";
}): Promise<ImportantSceneDoc[]> {
  console.log(`[filterExtractedScenes] Processing ${params.scenes.length} scenes`);

  const result = await rankAndFilterScenes({
    scenes: params.scenes,
    events: params.events,
    matchDurationMinutes: params.matchDurationMinutes,
    currentHomeScore: params.homeScore,
    currentAwayScore: params.awayScore,
    isHomeTeam: params.teamSide === "home",
    minImportanceThreshold: 0.5, // 50%以上の重要度
    maxScenes: 20, // 最大20シーン
  });

  console.log(
    `[filterExtractedScenes] Filtered to ${result.filteredCount} important scenes`
  );
  console.log("[filterExtractedScenes] Top 5 scenes:");
  result.rankedScenes.slice(0, 5).forEach((scene, i) => {
    const score = result.importanceScores[scene.sceneId];
    console.log(`  ${i + 1}. ${scene.sceneId}: ${(score * 100).toFixed(1)}% - ${scene.type}`);
  });

  return result.rankedScenes;
}

/**
 * Firestore保存前の前処理例
 */
export async function prepareScenesFoStorage(params: {
  scenes: ImportantSceneDoc[];
  events: DeduplicatedEvent[];
  matchMetadata: {
    durationMinutes: number;
    homeScore: number;
    awayScore: number;
    userTeamSide: "home" | "away";
  };
}): Promise<{
  scenes: ImportantSceneDoc[];
  metadata: {
    totalScenes: number;
    averageImportance: number;
    highImportanceCount: number;
  };
}> {
  const { scenes, events, matchMetadata } = params;

  // ランキングとフィルタリング
  const result = await rankAndFilterScenes({
    scenes,
    events,
    matchDurationMinutes: matchMetadata.durationMinutes,
    currentHomeScore: matchMetadata.homeScore,
    currentAwayScore: matchMetadata.awayScore,
    isHomeTeam: matchMetadata.userTeamSide === "home",
    minImportanceThreshold: 0.4, // 40%以上
    maxScenes: 30,
  });

  // メタデータ計算
  const importanceValues = Object.values(result.importanceScores);
  const averageImportance =
    importanceValues.reduce((sum, val) => sum + val, 0) / importanceValues.length || 0;
  const highImportanceCount = importanceValues.filter((val) => val >= 0.7).length;

  return {
    scenes: result.rankedScenes,
    metadata: {
      totalScenes: result.rankedScenes.length,
      averageImportance,
      highImportanceCount,
    },
  };
}

/**
 * リアルタイム更新時のシーン再評価例
 */
export async function reevaluateScenesAfterEventUpdate(params: {
  existingScenes: ImportantSceneDoc[];
  newEvents: DeduplicatedEvent[];
  currentMatchState: {
    minute: number;
    homeScore: number;
    awayScore: number;
    totalMinutes: number;
  };
  userTeamSide: "home" | "away";
}): Promise<ImportantSceneDoc[]> {
  const { existingScenes, newEvents, currentMatchState, userTeamSide } = params;

  console.log(`[reevaluateScenesAfterEventUpdate] Reevaluating ${existingScenes.length} scenes`);

  // クリップとイベントに変換
  const clips = existingScenes.map(sceneToClip);
  const mappedEvents = newEvents.map(deduplicatedEventToEvent);

  // 現在の試合状況でコンテキスト作成
  const context: MatchContext = {
    matchMinute: currentMatchState.minute,
    totalMatchMinutes: currentMatchState.totalMinutes,
    scoreDifferential:
      userTeamSide === "home"
        ? currentMatchState.homeScore - currentMatchState.awayScore
        : currentMatchState.awayScore - currentMatchState.homeScore,
    isHomeTeam: userTeamSide === "home",
  };

  // 再ランキング
  const ranked = rankClipsByImportance(clips, mappedEvents, context);

  // 重要度が変わったシーンを更新
  const updatedScenes = ranked.map((rc) => {
    const originalScene = existingScenes.find((s) => s.sceneId === rc.clip.id)!;
    return {
      ...originalScene,
      importance: rc.importance.finalImportance,
    };
  });

  // 重要度でソート
  updatedScenes.sort((a, b) => b.importance - a.importance);

  console.log("[reevaluateScenesAfterEventUpdate] Reevaluation complete");
  return updatedScenes;
}

// ============================================================
// Usage Example in Pipeline Step
// ============================================================

/**
 * パイプラインステップ内での使用例
 */
export async function examplePipelineStep() {
  // 仮のデータ（実際はFirestoreやGeminiから取得）
  const scenes: ImportantSceneDoc[] = [
    {
      sceneId: "scene_001",
      matchId: "match_123",
      startSec: 45.2,
      endSec: 52.8,
      type: "shot",
      importance: 0.5, // Geminiからの初期スコア
      description: "シュートシーン",
      version: "v1",
      createdAt: new Date().toISOString(),
    },
    // ... more scenes
  ];

  const events: DeduplicatedEvent[] = [
    {
      eventId: "event_001",
      matchId: "match_123",
      type: "shot",
      timestamp: 48.5,
      team: "home",
      zone: "attacking_third",
      confidence: 0.85,
      mergedFromWindows: ["window_1"],
      originalTimestamps: [48.5],
      adjustedConfidence: 0.85,
      version: "v1",
    },
    // ... more events
  ];

  // クリップ-イベントマッチャーで重要度を再計算
  const filtered = await filterExtractedScenes({
    scenes,
    events,
    matchId: "match_123",
    matchDurationMinutes: 90,
    homeScore: 2,
    awayScore: 1,
    teamSide: "home",
  });

  console.log(`Filtered scenes: ${filtered.length}`);
  filtered.forEach((scene) => {
    console.log(`  ${scene.sceneId}: importance=${scene.importance.toFixed(3)}`);
  });

  return filtered;
}

/**
 * 高度な使用例: 動的閾値調整
 */
export async function dynamicThresholdFiltering(params: {
  scenes: ImportantSceneDoc[];
  events: DeduplicatedEvent[];
  targetSceneCount: number;
  matchContext: MatchContext;
}): Promise<{
  scenes: ImportantSceneDoc[];
  appliedThreshold: number;
}> {
  const { scenes, events, targetSceneCount, matchContext } = params;

  const clips = scenes.map(sceneToClip);
  const mappedEvents = events.map(deduplicatedEventToEvent);

  // まずランキング
  const ranked = rankClipsByImportance(clips, mappedEvents, matchContext);

  // 目標シーン数に達するまで閾値を調整
  let threshold = 0.7; // 初期閾値
  let filtered = ranked.filter((rc) => rc.importance.finalImportance >= threshold);

  while (filtered.length < targetSceneCount && threshold > 0.1) {
    threshold -= 0.05;
    filtered = ranked.filter((rc) => rc.importance.finalImportance >= threshold);
  }

  // 最大でも目標数まで
  const finalFiltered = filtered.slice(0, targetSceneCount);

  // 元のシーンに変換
  const resultScenes = finalFiltered
    .map((rc) => {
      const originalScene = scenes.find((s) => s.sceneId === rc.clip.id);
      if (!originalScene) return null;
      return {
        ...originalScene,
        importance: rc.importance.finalImportance,
      };
    })
    .filter((s): s is ImportantSceneDoc => s !== null);

  console.log(
    `[dynamicThresholdFiltering] Applied threshold: ${threshold.toFixed(2)} ` +
      `-> ${resultScenes.length} scenes`
  );

  return {
    scenes: resultScenes,
    appliedThreshold: threshold,
  };
}
