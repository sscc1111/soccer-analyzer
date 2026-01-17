/**
 * Usage Examples for Clip-Event Matcher
 *
 * クリップ-イベントマッチャーの使用例
 */

import {
  matchClipToEvents,
  calculateClipImportance,
  rankClipsByImportance,
  getTopClips,
  filterClipsByImportance,
  getMatchTypeLabel,
  getImportanceSummary,
  type Clip,
  type Event,
  type MatchContext,
} from "../clipEventMatcher";

// ============================================================
// Example 1: Basic Clip-Event Matching
// ============================================================

function example1_basicMatching() {
  console.log("=== Example 1: Basic Clip-Event Matching ===\n");

  // クリップデータ
  const clip: Clip = {
    id: "clip_001",
    startTime: 45.2,
    endTime: 52.8,
  };

  // イベントデータ
  const events: Event[] = [
    {
      id: "event_001",
      timestamp: 48.5,
      type: "shot",
      details: { isOnTarget: true, shotResult: "saved" },
    },
    {
      id: "event_002",
      timestamp: 50.2,
      type: "save",
    },
  ];

  // マッチング実行
  const matches = matchClipToEvents(clip, events);

  console.log(`Clip: ${clip.id} (${clip.startTime}s - ${clip.endTime}s)`);
  console.log(`Found ${matches.length} matching events:\n`);

  matches.forEach((match) => {
    console.log(`  Event: ${match.eventId}`);
    console.log(`  Match Type: ${getMatchTypeLabel(match.matchType)}`);
    console.log(`  Confidence: ${(match.confidence * 100).toFixed(1)}%`);
    console.log(`  Temporal Offset: ${match.temporalOffset.toFixed(2)}s`);
    console.log(`  Importance Boost: ${(match.importanceBoost * 100).toFixed(1)}%`);
    console.log();
  });
}

// ============================================================
// Example 2: Importance Calculation with Context
// ============================================================

function example2_importanceWithContext() {
  console.log("=== Example 2: Importance Calculation with Context ===\n");

  const clip: Clip = {
    id: "clip_goal",
    startTime: 82.5,
    endTime: 88.3,
  };

  const events: Event[] = [
    {
      id: "event_goal",
      timestamp: 85.2,
      type: "goal",
    },
  ];

  // コンテキスト: 試合終盤、1点ビハインド
  const context: MatchContext = {
    matchMinute: 85,
    totalMatchMinutes: 90,
    scoreDifferential: -1, // 1点負けている
    isHomeTeam: true,
  };

  const matches = matchClipToEvents(clip, events);
  const importance = calculateClipImportance(clip, matches, context);

  console.log(`Clip: ${clip.id}`);
  console.log(`Context: 試合85分、1点ビハインド\n`);
  console.log(getImportanceSummary(importance));
  console.log();
  console.log("Breakdown:");
  console.log(`  Base Importance: ${(importance.baseImportance * 100).toFixed(1)}%`);
  console.log(`  Event Type Boost: ${(importance.eventTypeBoost * 100).toFixed(1)}%`);
  console.log(`  Context Boost: ${(importance.contextBoost * 100).toFixed(1)}%`);
  console.log(`  Rarity Boost: ${(importance.rarityBoost * 100).toFixed(1)}%`);
  console.log(`  Final Importance: ${(importance.finalImportance * 100).toFixed(1)}%`);
  console.log();
}

// ============================================================
// Example 3: Ranking Multiple Clips
// ============================================================

function example3_rankingClips() {
  console.log("=== Example 3: Ranking Multiple Clips ===\n");

  const clips: Clip[] = [
    { id: "clip_001", startTime: 12.0, endTime: 18.0 },
    { id: "clip_002", startTime: 45.5, endTime: 52.0 },
    { id: "clip_003", startTime: 78.2, endTime: 84.5 },
    { id: "clip_004", startTime: 30.0, endTime: 35.0 },
  ];

  const events: Event[] = [
    { id: "goal_1", timestamp: 15.2, type: "goal" },
    { id: "shot_1", timestamp: 48.3, type: "shot", details: { isOnTarget: true } },
    { id: "tackle_1", timestamp: 32.1, type: "tackle", details: { wonTackle: true } },
    { id: "penalty_1", timestamp: 81.5, type: "penalty" },
  ];

  const ranked = rankClipsByImportance(clips, events);

  console.log("Clips ranked by importance:\n");

  ranked.forEach((rc) => {
    console.log(`Rank ${rc.rank}: ${rc.clip.id}`);
    console.log(`  Importance: ${(rc.importance.finalImportance * 100).toFixed(1)}%`);
    console.log(`  Matched Events: ${rc.matches.length}`);
    if (rc.matches.length > 0) {
      console.log(
        `  Top Event: ${rc.matches[0].eventId} (${getMatchTypeLabel(rc.matches[0].matchType)})`
      );
    }
    console.log();
  });
}

// ============================================================
// Example 4: Getting Top N Important Clips
// ============================================================

function example4_topClips() {
  console.log("=== Example 4: Getting Top 3 Important Clips ===\n");

  const clips: Clip[] = [
    { id: "clip_A", startTime: 10, endTime: 15 },
    { id: "clip_B", startTime: 25, endTime: 30 },
    { id: "clip_C", startTime: 40, endTime: 45 },
    { id: "clip_D", startTime: 55, endTime: 60 },
    { id: "clip_E", startTime: 70, endTime: 75 },
  ];

  const events: Event[] = [
    { id: "e1", timestamp: 12, type: "goal" },
    { id: "e2", timestamp: 27, type: "shot", details: { isOnTarget: true } },
    { id: "e3", timestamp: 42, type: "pass" },
    { id: "e4", timestamp: 57, type: "red_card" },
    { id: "e5", timestamp: 72, type: "save" },
  ];

  const top3 = getTopClips(clips, events, 3);

  console.log("Top 3 clips:\n");

  top3.forEach((rc) => {
    console.log(`${rc.rank}. ${rc.clip.id}`);
    console.log(`   Importance: ${(rc.importance.finalImportance * 100).toFixed(1)}%`);
    console.log(`   ${getImportanceSummary(rc.importance)}`);
    console.log();
  });
}

// ============================================================
// Example 5: Filtering Clips by Importance Threshold
// ============================================================

function example5_filterClips() {
  console.log("=== Example 5: Filtering Clips by Importance ===\n");

  const clips: Clip[] = [
    { id: "clip_1", startTime: 10, endTime: 15 },
    { id: "clip_2", startTime: 25, endTime: 30 },
    { id: "clip_3", startTime: 40, endTime: 45 },
    { id: "clip_4", startTime: 55, endTime: 60 },
    { id: "clip_5", startTime: 70, endTime: 75 },
  ];

  const events: Event[] = [
    { id: "e1", timestamp: 12, type: "goal" },
    { id: "e2", timestamp: 27, type: "key_pass" },
    { id: "e3", timestamp: 42, type: "pass" },
    { id: "e4", timestamp: 57, type: "shot", details: { isOnTarget: true } },
    { id: "e5", timestamp: 72, type: "carry" },
  ];

  const threshold = 0.5;
  const filtered = filterClipsByImportance(clips, events, threshold);

  console.log(`Clips with importance >= ${threshold * 100}%:\n`);

  filtered.forEach((rc) => {
    console.log(`${rc.clip.id}: ${(rc.importance.finalImportance * 100).toFixed(1)}%`);
  });

  console.log(`\nTotal: ${filtered.length} / ${clips.length} clips`);
  console.log();
}

// ============================================================
// Example 6: Complex Scenario with Multiple Events
// ============================================================

function example6_complexScenario() {
  console.log("=== Example 6: Complex Scenario - Multiple Events in One Clip ===\n");

  const clip: Clip = {
    id: "clip_highlight",
    startTime: 60.0,
    endTime: 70.0,
  };

  const events: Event[] = [
    {
      id: "e1_tackle",
      timestamp: 62.5,
      type: "tackle",
      details: { wonTackle: true },
    },
    {
      id: "e2_carry",
      timestamp: 63.2,
      type: "carry",
    },
    {
      id: "e3_pass",
      timestamp: 65.8,
      type: "key_pass",
    },
    {
      id: "e4_shot",
      timestamp: 67.5,
      type: "shot",
      details: { isOnTarget: true, shotResult: "goal" },
    },
  ];

  const context: MatchContext = {
    matchMinute: 67,
    totalMatchMinutes: 90,
    scoreDifferential: 0, // 同点
  };

  const matches = matchClipToEvents(clip, events);
  const importance = calculateClipImportance(clip, matches, context);

  console.log(`Clip: ${clip.id} (${clip.startTime}s - ${clip.endTime}s)`);
  console.log(`Matched ${matches.length} events:\n`);

  matches.forEach((match) => {
    console.log(`  - ${match.eventId}: ${getMatchTypeLabel(match.matchType)}`);
    console.log(`    Confidence: ${(match.confidence * 100).toFixed(1)}%`);
    console.log(`    Importance Boost: ${(match.importanceBoost * 100).toFixed(1)}%`);
  });

  console.log(`\n${getImportanceSummary(importance)}`);
  console.log();
  console.log("Analysis:");
  console.log(
    "  このクリップは複数のイベント（タックル→キャリー→キーパス→ゴール）を含む"
  );
  console.log("  ハイライトシーンです。ゴールを含むため高い重要度となります。");
  console.log("  また、同点の状況でのゴールなので、コンテキストブーストも適用されています。");
  console.log();
}

// ============================================================
// Example 7: Rare Events (Red Card, Own Goal)
// ============================================================

function example7_rareEvents() {
  console.log("=== Example 7: Rare Events ===\n");

  const clips: Clip[] = [
    { id: "red_card_clip", startTime: 30, endTime: 35 },
    { id: "own_goal_clip", startTime: 50, endTime: 55 },
    { id: "regular_goal_clip", startTime: 70, endTime: 75 },
  ];

  const events: Event[] = [
    { id: "red_card_event", timestamp: 32, type: "red_card" },
    { id: "own_goal_event", timestamp: 52, type: "own_goal" },
    { id: "goal_event", timestamp: 72, type: "goal" },
  ];

  const ranked = rankClipsByImportance(clips, events);

  console.log("Rare events receive rarity boost:\n");

  ranked.forEach((rc) => {
    console.log(`${rc.clip.id}:`);
    console.log(`  Final Importance: ${(rc.importance.finalImportance * 100).toFixed(1)}%`);
    console.log(`  Rarity Boost: ${(rc.importance.rarityBoost * 100).toFixed(1)}%`);
    console.log();
  });

  console.log("Note: レッドカードやオウンゴールは発生頻度が低いため、");
  console.log("希少性ブーストが適用され、重要度が高くなります。");
  console.log();
}

// ============================================================
// Example 8: Late Game Importance Boost
// ============================================================

function example8_lateGameBoost() {
  console.log("=== Example 8: Late Game Importance Boost ===\n");

  const clip: Clip = { id: "late_goal", startTime: 85, endTime: 90 };
  const event: Event = { id: "goal", timestamp: 87, type: "goal" };

  const contexts: MatchContext[] = [
    { matchMinute: 10, totalMatchMinutes: 90 }, // 前半
    { matchMinute: 45, totalMatchMinutes: 90 }, // 前半終了間際
    { matchMinute: 87, totalMatchMinutes: 90 }, // 終盤
  ];

  const matches = matchClipToEvents(clip, [event]);

  console.log("Same goal at different match times:\n");

  contexts.forEach((context) => {
    const importance = calculateClipImportance(clip, matches, context);
    const progress = ((context.matchMinute! / context.totalMatchMinutes!) * 100).toFixed(0);

    console.log(`${context.matchMinute}分 (試合進行率: ${progress}%):`);
    console.log(`  Context Boost: ${(importance.contextBoost * 100).toFixed(1)}%`);
    console.log(`  Final Importance: ${(importance.finalImportance * 100).toFixed(1)}%`);
    console.log();
  });

  console.log("Note: 試合終盤（80%以降）のイベントには");
  console.log("コンテキストブーストが適用され、重要度が上がります。");
  console.log();
}

// ============================================================
// Run All Examples
// ============================================================

export function runAllExamples() {
  console.log("\n");
  console.log("=".repeat(60));
  console.log("Clip-Event Matcher Usage Examples");
  console.log("=".repeat(60));
  console.log("\n");

  example1_basicMatching();
  example2_importanceWithContext();
  example3_rankingClips();
  example4_topClips();
  example5_filterClips();
  example6_complexScenario();
  example7_rareEvents();
  example8_lateGameBoost();

  console.log("=".repeat(60));
  console.log("Examples completed!");
  console.log("=".repeat(60));
  console.log("\n");
}

// Uncomment to run examples:
// runAllExamples();
