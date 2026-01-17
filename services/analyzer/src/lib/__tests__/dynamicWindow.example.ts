/**
 * Dynamic Window System - 使用例
 *
 * このファイルは動的ウィンドウ機能の実践的な使用例を示します。
 */

import { calculateDynamicWindow, type Event, type MatchContext } from "../clipEventMatcher";

// ============================================================================
// Example 1: 基本的なゴールシーン
// ============================================================================

function example1_basicGoal() {
  console.log("=== Example 1: 基本的なゴールシーン ===\n");

  const goalEvent: Event = {
    id: "goal_1",
    timestamp: 120, // 試合開始から2分
    type: "goal",
  };

  const window = calculateDynamicWindow(goalEvent, [goalEvent]);

  console.log("Goal Event:");
  console.log(`  Timestamp: ${goalEvent.timestamp}s`);
  console.log(`  Window: ${window.before}s before, ${window.after}s after`);
  console.log(`  Reason: ${window.reason}`);
  console.log(`  Clip range: [${goalEvent.timestamp - window.before}, ${goalEvent.timestamp + window.after}]`);
  console.log(); // 出力: Window: 10s before, 5s after
}

// ============================================================================
// Example 2: カウンターアタックからのゴール
// ============================================================================

function example2_counterAttackGoal() {
  console.log("=== Example 2: カウンターアタックからのゴール ===\n");

  const allEvents: Event[] = [
    {
      id: "turnover_1",
      timestamp: 180, // 3分
      type: "turnover",
      details: { turnoverType: "interception" },
    },
    {
      id: "pass_1",
      timestamp: 182,
      type: "pass",
    },
    {
      id: "carry_1",
      timestamp: 184,
      type: "carry",
    },
    {
      id: "pass_2",
      timestamp: 186,
      type: "pass",
    },
    {
      id: "goal_2",
      timestamp: 188, // ターンオーバーから8秒後
      type: "goal",
    },
  ];

  const goalEvent = allEvents[4];
  const window = calculateDynamicWindow(goalEvent, allEvents);

  console.log("Counter Attack Goal:");
  console.log(`  Timestamp: ${goalEvent.timestamp}s`);
  console.log(`  Window: ${window.before}s before, ${window.after}s after`);
  console.log(`  Reason: ${window.reason}`);
  console.log(`  Context Before: ${window.contextBefore?.length ?? 0} events`);
  if (window.contextBefore) {
    window.contextBefore.forEach((e) => {
      console.log(`    - ${e.type} at ${e.timestamp}s`);
    });
  }
  console.log(); // 出力: Window: 15s before (カウンター検出により拡張)
}

// ============================================================================
// Example 3: セットピースからのゴール
// ============================================================================

function example3_setPieceGoal() {
  console.log("=== Example 3: コーナーキックからのゴール ===\n");

  const allEvents: Event[] = [
    {
      id: "corner_1",
      timestamp: 300,
      type: "setPiece",
      details: { setPieceType: "corner" },
    },
    {
      id: "shot_1",
      timestamp: 303, // コーナーから3秒後
      type: "shot",
      details: { shotResult: "goal" },
    },
  ];

  const cornerEvent = allEvents[0];
  const window = calculateDynamicWindow(cornerEvent, allEvents);

  console.log("Corner Kick:");
  console.log(`  Timestamp: ${cornerEvent.timestamp}s`);
  console.log(`  Window: ${window.before}s before, ${window.after}s after`);
  console.log(`  Reason: ${window.reason}`);
  console.log(`  Context After: ${window.contextAfter?.length ?? 0} events`);
  if (window.contextAfter) {
    window.contextAfter.forEach((e) => {
      console.log(`    - ${e.type} at ${e.timestamp}s (${e.details?.shotResult || ""})`);
    });
  }
  console.log(); // 出力: before=2s, after=7s, context includes shot
}

// ============================================================================
// Example 4: 試合終盤の同点ゴール
// ============================================================================

function example4_lateEqualizer() {
  console.log("=== Example 4: 試合終盤の同点ゴール ===\n");

  const goalEvent: Event = {
    id: "goal_equalizer",
    timestamp: 5280, // 88分
    type: "goal",
  };

  const matchContext: MatchContext = {
    matchMinute: 88,
    totalMatchMinutes: 90,
    scoreDifferential: -1, // 1点ビハインド
  };

  const window = calculateDynamicWindow(goalEvent, [goalEvent], matchContext);

  console.log("Late Equalizer:");
  console.log(`  Timestamp: ${goalEvent.timestamp}s (${matchContext.matchMinute} min)`);
  console.log(`  Score: Behind by 1`);
  console.log(`  Window: ${window.before}s before, ${window.after}s after`);
  console.log(`  Reason: ${window.reason}`);
  console.log(`  Extensions applied: Late game + Close game`);
  console.log(); // 出力: Window拡張 (試合終盤 + 接戦)
}

// ============================================================================
// Example 5: 枠内シュート vs ロングレンジシュート
// ============================================================================

function example5_shotTypes() {
  console.log("=== Example 5: シュートタイプによる違い ===\n");

  const onTargetShot: Event = {
    id: "shot_on_target",
    timestamp: 600,
    type: "shot",
    details: {
      isOnTarget: true,
      shotType: "placed",
    },
  };

  const longRangeShot: Event = {
    id: "shot_long_range",
    timestamp: 700,
    type: "shot",
    details: {
      shotType: "long_range",
    },
  };

  const window1 = calculateDynamicWindow(onTargetShot, [onTargetShot]);
  const window2 = calculateDynamicWindow(longRangeShot, [longRangeShot]);

  console.log("On-Target Shot:");
  console.log(`  Window: ${window1.before}s before, ${window1.after}s after`);
  console.log(`  Reason: ${window1.reason}\n`);

  console.log("Long-Range Shot:");
  console.log(`  Window: ${window2.before}s before, ${window2.after}s after`);
  console.log(`  Reason: ${window2.reason}`);
  console.log(); // 枠内: after拡張, ロング: before短縮
}

// ============================================================================
// Example 6: 密集したビルドアップからのゴール
// ============================================================================

function example6_denseBuildUp() {
  console.log("=== Example 6: 密集したビルドアップ ===\n");

  const allEvents: Event[] = [
    { id: "pass_1", timestamp: 800, type: "pass" },
    { id: "pass_2", timestamp: 802, type: "pass" },
    { id: "carry_1", timestamp: 804, type: "carry" },
    { id: "pass_3", timestamp: 806, type: "pass" },
    { id: "pass_4", timestamp: 808, type: "pass" },
    { id: "key_pass", timestamp: 809, type: "key_pass" },
    { id: "shot_goal", timestamp: 810, type: "shot", details: { shotResult: "goal" } },
  ];

  const goalEvent = allEvents[6];
  const window = calculateDynamicWindow(goalEvent, allEvents);

  console.log("Goal with Dense Build-Up:");
  console.log(`  Timestamp: ${goalEvent.timestamp}s`);
  console.log(`  Window: ${window.before}s before, ${window.after}s after`);
  console.log(`  Reason: ${window.reason}`);
  console.log(`  Events in window: ${allEvents.filter((e) => e.timestamp >= goalEvent.timestamp - window.before && e.timestamp <= goalEvent.timestamp).length}`);
  console.log(); // 出力: 前方密集により拡張
}

// ============================================================================
// Example 7: クリップ生成への実践的適用
// ============================================================================

interface ClipMetadata {
  clipId: string;
  t0: number;
  t1: number;
  duration: number;
  windowConfig: {
    before: number;
    after: number;
    reason: string;
    isDynamic: boolean;
  };
  contextEvents: string[];
}

function example7_practicalClipGeneration() {
  console.log("=== Example 7: クリップ生成への適用 ===\n");

  const videoDuration = 5400; // 90分

  const allEvents: Event[] = [
    { id: "turnover_1", timestamp: 1200, type: "turnover" },
    { id: "pass_1", timestamp: 1203, type: "pass" },
    { id: "shot_1", timestamp: 1207, type: "shot", details: { shotResult: "goal" } },
  ];

  const clips: ClipMetadata[] = allEvents.map((event, idx) => {
    const window = calculateDynamicWindow(event, allEvents);

    const t0 = Math.max(0, event.timestamp - window.before);
    const t1 = Math.min(videoDuration, event.timestamp + window.after);

    return {
      clipId: `clip_${idx + 1}`,
      t0,
      t1,
      duration: t1 - t0,
      windowConfig: {
        before: window.before,
        after: window.after,
        reason: window.reason,
        isDynamic: true,
      },
      contextEvents: [
        ...(window.contextBefore?.map((e) => e.id) ?? []),
        ...(window.contextAfter?.map((e) => e.id) ?? []),
      ],
    };
  });

  console.log("Generated Clips:");
  clips.forEach((clip) => {
    console.log(`\n${clip.clipId}:`);
    console.log(`  Time Range: [${clip.t0}, ${clip.t1}]s (${clip.duration}s)`);
    console.log(`  Window: ${clip.windowConfig.before}s before, ${clip.windowConfig.after}s after`);
    console.log(`  Reason: ${clip.windowConfig.reason}`);
    console.log(`  Context Events: ${clip.contextEvents.length}`);
  });
  console.log();
}

// ============================================================================
// Example 8: 動的ウィンドウのオン/オフ比較
// ============================================================================

function example8_dynamicVsStatic() {
  console.log("=== Example 8: 動的 vs 固定ウィンドウ ===\n");

  const goalEvent: Event = {
    id: "goal_1",
    timestamp: 1500,
    type: "goal",
  };

  const allEvents: Event[] = [
    { id: "turnover", timestamp: 1492, type: "turnover" },
    goalEvent,
  ];

  const matchContext: MatchContext = {
    matchMinute: 25,
    totalMatchMinutes: 90,
  };

  // 動的ウィンドウ
  const dynamicWindow = calculateDynamicWindow(goalEvent, allEvents, matchContext);

  // 固定ウィンドウ（仮想）
  const staticWindow = { before: 5, after: 3, reason: "固定ウィンドウ" };

  console.log("Dynamic Window:");
  console.log(`  Before: ${dynamicWindow.before}s`);
  console.log(`  After: ${dynamicWindow.after}s`);
  console.log(`  Total Duration: ${dynamicWindow.before + dynamicWindow.after}s`);
  console.log(`  Reason: ${dynamicWindow.reason}`);
  console.log(`  Context: ${(dynamicWindow.contextBefore?.length ?? 0) + (dynamicWindow.contextAfter?.length ?? 0)} events\n`);

  console.log("Static Window:");
  console.log(`  Before: ${staticWindow.before}s`);
  console.log(`  After: ${staticWindow.after}s`);
  console.log(`  Total Duration: ${staticWindow.before + staticWindow.after}s`);
  console.log(`  Reason: ${staticWindow.reason}`);
  console.log(`  Context: 0 events\n`);

  console.log("Difference:");
  console.log(`  Duration: +${dynamicWindow.before + dynamicWindow.after - (staticWindow.before + staticWindow.after)}s`);
  console.log(`  Context captured: ${dynamicWindow.contextBefore?.length ?? 0} additional events`);
  console.log();
}

// ============================================================================
// メイン実行
// ============================================================================

if (require.main === module) {
  console.log("Dynamic Window System - Usage Examples\n");
  console.log("=".repeat(70));
  console.log();

  example1_basicGoal();
  example2_counterAttackGoal();
  example3_setPieceGoal();
  example4_lateEqualizer();
  example5_shotTypes();
  example6_denseBuildUp();
  example7_practicalClipGeneration();
  example8_dynamicVsStatic();

  console.log("=".repeat(70));
  console.log("\nAll examples completed!");
}

export {
  example1_basicGoal,
  example2_counterAttackGoal,
  example3_setPieceGoal,
  example4_lateEqualizer,
  example5_shotTypes,
  example6_denseBuildUp,
  example7_practicalClipGeneration,
  example8_dynamicVsStatic,
};
