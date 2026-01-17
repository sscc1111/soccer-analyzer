/**
 * Clip-Event Matching and Importance Scoring
 *
 * クリップとイベントのマッチング、重要度スコアリングロジック
 *
 * Features:
 * - Type-specific importance boosting
 * - Timestamp matching with confidence scoring
 * - Context-aware boosters (late goals, equalizers, etc.)
 * - Rarity-based scoring (red cards, own goals, etc.)
 * - Dynamic window calculation based on event type and context
 */

// ============================================================
// Types
// ============================================================

/**
 * クリップとイベントのマッチング結果
 */
export interface ClipEventMatch {
  /** マッチしたクリップID */
  clipId: string;
  /** マッチしたイベントID */
  eventId: string;
  /** マッチタイプ */
  matchType: "exact" | "overlap" | "proximity";
  /** マッチの信頼度 (0-1) */
  confidence: number;
  /** 時間的オフセット（秒） - イベントタイムスタンプとクリップ中心時刻の差 */
  temporalOffset: number;
  /** このマッチによる重要度ブースト (0-1) */
  importanceBoost: number;
}

/**
 * クリップの重要度計算の内訳
 */
export interface ClipImportanceFactors {
  /** ベース重要度（イベントタイプから） */
  baseImportance: number;
  /** イベントタイプブースト */
  eventTypeBoost: number;
  /** コンテキストブースト（試合状況） */
  contextBoost: number;
  /** 希少性ブースト（レアイベント） */
  rarityBoost: number;
  /** 最終的な重要度スコア (0-1) */
  finalImportance: number;
}

/**
 * クリップの基本情報
 */
export interface Clip {
  id: string;
  startTime: number;
  endTime: number;
}

/**
 * イベントの基本情報
 */
export interface Event {
  id: string;
  timestamp: number;
  type: EventType;
  /** イベント詳細（ショットの結果、ターンオーバーのタイプなど） */
  details?: EventDetails;
}

/**
 * イベントタイプ
 */
export type EventType =
  | "goal"
  | "penalty"
  | "red_card"
  | "yellow_card"
  | "own_goal"
  | "shot"
  | "key_pass"
  | "tackle"
  | "foul"
  | "save"
  | "chance"
  | "setPiece"
  | "pass"
  | "carry"
  | "turnover";

/**
 * イベント詳細
 */
export interface EventDetails {
  shotResult?: "goal" | "saved" | "blocked" | "missed" | "post";
  shotType?: "power" | "placed" | "header" | "volley" | "long_range" | "chip";
  outcome?: "complete" | "incomplete" | "intercepted";
  turnoverType?: "tackle" | "interception" | "bad_touch" | "out_of_bounds" | "other";
  setPieceType?: "corner" | "free_kick" | "penalty" | "throw_in" | "goal_kick" | "kick_off";
  isOnTarget?: boolean;
  wonTackle?: boolean;
}

/**
 * 試合コンテキスト情報
 */
export interface MatchContext {
  /** 試合時間（分） */
  matchMinute?: number;
  /** スコア差（自チーム視点） */
  scoreDifferential?: number;
  /** ホームチームかどうか */
  isHomeTeam?: boolean;
  /** 試合の総時間（分） */
  totalMatchMinutes?: number;
}

/**
 * 動的ウィンドウの計算結果
 */
export interface DynamicWindow {
  /** イベント前のウィンドウ時間（秒） */
  before: number;
  /** イベント後のウィンドウ時間（秒） */
  after: number;
  /** ウィンドウ計算の理由 */
  reason: string;
  /** 関連する前のイベント（コンテキスト検出用） */
  contextBefore?: Event[];
  /** 関連する後のイベント（コンテキスト検出用） */
  contextAfter?: Event[];
}

/**
 * ランク付けされたクリップ
 */
export interface RankedClip {
  clip: Clip;
  matches: ClipEventMatch[];
  importance: ClipImportanceFactors;
  rank: number;
}

// ============================================================
// Event Type Importance Weights
// ============================================================

/**
 * イベントタイプごとの基本重要度ウェイト
 *
 * 1.0 = 最高重要度（ゴール）
 * 0.0 = 最低重要度
 */
const EVENT_TYPE_WEIGHTS: Record<EventType, number> = {
  // 最重要イベント
  goal: 1.0,
  penalty: 0.95,
  red_card: 0.9,
  own_goal: 0.85,

  // 高重要度イベント
  shot: 0.7, // ベース、詳細で調整
  save: 0.75,
  chance: 0.65,

  // 中重要度イベント
  key_pass: 0.6,
  foul: 0.55,
  yellow_card: 0.55,
  setPiece: 0.5,

  // 低重要度イベント
  tackle: 0.5, // ベース、詳細で調整
  turnover: 0.45,
  pass: 0.3,
  carry: 0.25,
};

/**
 * イベントタイプごとのデフォルトウィンドウ設定（秒）
 *
 * 各イベントの性質に応じて前後のコンテキスト時間を設定
 */
const DEFAULT_WINDOW_CONFIG: Record<
  EventType,
  { before: number; after: number; description: string }
> = {
  // ゴール: ビルドアップから得点後の喜びまで長めに
  goal: { before: 10, after: 5, description: "ゴールまでのビルドアップと祝福" },

  // ペナルティ: 反則からキック、結果まで
  penalty: { before: 5, after: 5, description: "反則からPK実施まで" },

  // レッドカード: 反則の瞬間から退場まで
  red_card: { before: 7, after: 4, description: "反則と退場処理" },

  // オウンゴール: ビルドアップから
  own_goal: { before: 8, after: 5, description: "オウンゴールの経緯" },

  // シュート: ビルドアップからシュート、結果まで
  shot: { before: 7, after: 3, description: "シュートまでの展開" },

  // セーブ: シュートからセーブの瞬間
  save: { before: 5, after: 2, description: "シュートとセーブ" },

  // チャンス: ビルドアップから決定機まで
  chance: { before: 6, after: 3, description: "決定機の創出" },

  // キーパス: パスの前後の展開
  key_pass: { before: 5, after: 4, description: "キーパスと結果" },

  // ファール: 反則の瞬間
  foul: { before: 3, after: 2, description: "反則の瞬間" },

  // イエローカード: 反則からカード提示
  yellow_card: { before: 4, after: 2, description: "反則とカード提示" },

  // セットピース: セットアップから展開まで
  setPiece: { before: 3, after: 5, description: "セットピースの展開" },

  // タックル: タックルの前後
  tackle: { before: 2, after: 2, description: "タックルの瞬間" },

  // ターンオーバー: ボール奪取とその後
  turnover: { before: 2, after: 3, description: "ターンオーバーとカウンター" },

  // パス: 短いコンテキスト
  pass: { before: 2, after: 1, description: "パスの前後" },

  // キャリー: ドリブルの前後
  carry: { before: 2, after: 2, description: "キャリーの前後" },
};

/**
 * 希少性ウェイト（発生頻度が低いほど高い）
 */
const RARITY_WEIGHTS: Partial<Record<EventType, number>> = {
  own_goal: 0.9,
  red_card: 0.85,
  penalty: 0.8,
  goal: 0.7,
  yellow_card: 0.4,
  save: 0.6,
};

// ============================================================
// Dynamic Window Calculation
// ============================================================

/**
 * イベントタイプとコンテキストに基づいて動的にウィンドウ時間を計算
 *
 * @param event - 対象イベント
 * @param allEvents - 全イベント（コンテキスト検出用）
 * @param matchContext - 試合コンテキスト（オプション）
 * @returns 動的ウィンドウ情報
 */
export function calculateDynamicWindow(
  event: Event,
  allEvents: Event[],
  matchContext?: MatchContext
): DynamicWindow {
  // デフォルトウィンドウを取得
  const defaultWindow = DEFAULT_WINDOW_CONFIG[event.type] ?? { before: 5, after: 3, description: "デフォルト" };

  let before = defaultWindow.before;
  let after = defaultWindow.after;
  let reason = defaultWindow.description;

  // コンテキストイベントの検出
  const contextBefore: Event[] = [];
  const contextAfter: Event[] = [];

  // ============================================
  // 1. イベントタイプごとの調整
  // ============================================

  if (event.type === "goal") {
    // ゴール: カウンターアタックか確認
    const isCounterAttack = detectCounterAttack(event, allEvents);
    if (isCounterAttack) {
      before = 15; // カウンターの起点から
      reason = "カウンター攻撃からのゴール";
    }

    // ゴール直前のキーパスやチャンスを含める
    const preGoalEvents = findEventsInWindow(allEvents, event.timestamp - before, event.timestamp, [
      "key_pass",
      "chance",
      "pass",
    ]);
    contextBefore.push(...preGoalEvents);
  } else if (event.type === "shot") {
    // シュート: 枠内シュートは結果を見せる時間を長めに
    if (event.details?.isOnTarget) {
      after = 4;
      reason = "枠内シュート - セーブまで";
    }

    // ロングレンジシュートはビルドアップ短め
    if (event.details?.shotType === "long_range") {
      before = 4;
      reason = "ロングレンジシュート";
    }

    // シュート前のパス連鎖を検出
    const preShot = findEventsInWindow(allEvents, event.timestamp - before, event.timestamp, ["pass", "carry"]);
    contextBefore.push(...preShot);
  } else if (event.type === "setPiece") {
    // セットピース: タイプに応じて調整
    if (event.details?.setPieceType === "corner") {
      before = 2; // コーナーキックは準備短め
      after = 7; // 展開は長め（クリア、シュート含む）
      reason = "コーナーキック - セットから展開まで";
    } else if (event.details?.setPieceType === "free_kick") {
      before = 3;
      after = 6;
      reason = "フリーキック - セットから展開まで";
    }

    // セットピース後のシュートやクリアを含める
    const postSetPiece = findEventsInWindow(allEvents, event.timestamp, event.timestamp + after, [
      "shot",
      "goal",
      "turnover",
    ]);
    contextAfter.push(...postSetPiece);
  } else if (event.type === "turnover") {
    // ターンオーバー: インターセプトはカウンターを含める
    if (event.details?.turnoverType === "interception") {
      after = 5; // カウンターアタック展開
      reason = "インターセプト - カウンター展開";

      // カウンター中のパス、キャリーを検出
      const counterEvents = findEventsInWindow(allEvents, event.timestamp, event.timestamp + after, [
        "pass",
        "carry",
        "shot",
      ]);
      contextAfter.push(...counterEvents);
    }
  } else if (event.type === "penalty") {
    // ペナルティ: 反則の瞬間を含める
    const foulEvent = findEventsInWindow(allEvents, event.timestamp - before, event.timestamp, ["foul"]);
    contextBefore.push(...foulEvent);
  }

  // ============================================
  // 2. 試合状況による調整
  // ============================================

  if (matchContext) {
    // 試合終盤の重要イベントは長めに
    if (matchContext.matchMinute !== undefined && matchContext.totalMatchMinutes !== undefined) {
      const matchProgress = matchContext.matchMinute / matchContext.totalMatchMinutes;
      if (matchProgress > 0.85 && (event.type === "goal" || event.type === "shot" || event.type === "chance")) {
        before *= 1.2;
        after *= 1.3;
        reason += " (試合終盤)";
      }
    }

    // 接戦時のゴールは前後長めに
    if (
      matchContext.scoreDifferential !== undefined &&
      Math.abs(matchContext.scoreDifferential) <= 1 &&
      event.type === "goal"
    ) {
      before *= 1.1;
      after *= 1.2;
      reason += " (接戦)";
    }
  }

  // ============================================
  // 3. 前後のイベント密度による調整
  // ============================================

  // 前後のイベント密度が高い場合は、ウィンドウを拡張してコンテキストを含める
  const denseBefore = detectEventDensity(allEvents, event.timestamp - before, event.timestamp);
  const denseAfter = detectEventDensity(allEvents, event.timestamp, event.timestamp + after);

  if (denseBefore > 3) {
    // 前に複数のイベントがある場合は拡張
    before *= 1.3;
    reason += " (前方密集)";
  }

  if (denseAfter > 3) {
    // 後に複数のイベントがある場合は拡張
    after *= 1.3;
    reason += " (後方密集)";
  }

  return {
    before: Math.round(before * 10) / 10, // 小数第1位まで
    after: Math.round(after * 10) / 10,
    reason,
    contextBefore: contextBefore.length > 0 ? contextBefore : undefined,
    contextAfter: contextAfter.length > 0 ? contextAfter : undefined,
  };
}

/**
 * カウンターアタックを検出
 *
 * ターンオーバー後、短時間でゴールまで到達したか
 */
function detectCounterAttack(goalEvent: Event, allEvents: Event[]): boolean {
  // ゴール10秒前のターンオーバーを探す
  const turnoverEvents = allEvents.filter(
    (e) =>
      e.type === "turnover" &&
      e.timestamp < goalEvent.timestamp &&
      goalEvent.timestamp - e.timestamp <= 10 // 10秒以内
  );

  return turnoverEvents.length > 0;
}

/**
 * 時間ウィンドウ内の特定タイプのイベントを検出
 */
function findEventsInWindow(
  allEvents: Event[],
  startTime: number,
  endTime: number,
  eventTypes: EventType[]
): Event[] {
  return allEvents.filter(
    (e) => e.timestamp >= startTime && e.timestamp <= endTime && eventTypes.includes(e.type)
  );
}

/**
 * 時間ウィンドウ内のイベント密度を計算
 *
 * @returns イベント数
 */
function detectEventDensity(allEvents: Event[], startTime: number, endTime: number): number {
  return allEvents.filter((e) => e.timestamp >= startTime && e.timestamp <= endTime).length;
}

// ============================================================
// Matching Functions
// ============================================================

/**
 * クリップとイベントをマッチング
 *
 * @param clip - マッチング対象のクリップ
 * @param events - すべてのイベント
 * @param tolerance - 近接判定の許容時間（秒）デフォルト: 2.0秒
 * @returns マッチング結果の配列（信頼度降順）
 */
export function matchClipToEvents(
  clip: Clip,
  events: Event[],
  tolerance: number = 2.0
): ClipEventMatch[] {
  const matches: ClipEventMatch[] = [];
  const clipCenter = (clip.startTime + clip.endTime) / 2;
  const clipDuration = clip.endTime - clip.startTime;

  // P1修正: 無効なクリップを明示的にチェック（startTime >= endTime または duration無効）
  if (clip.startTime >= clip.endTime || clipDuration <= 0 || !isFinite(clipDuration)) {
    return [];
  }

  for (const event of events) {
    const temporalOffset = Math.abs(event.timestamp - clipCenter);

    // マッチタイプの判定
    let matchType: ClipEventMatch["matchType"];
    let confidence: number;

    if (event.timestamp >= clip.startTime && event.timestamp <= clip.endTime) {
      // イベントがクリップ内に完全に含まれる
      matchType = "exact";
      // クリップの中心に近いほど高信頼度
      const normalizedOffset = temporalOffset / (clipDuration / 2);
      confidence = Math.max(0.7, 1.0 - normalizedOffset * 0.3);
    } else if (temporalOffset <= clipDuration / 2) {
      // イベントがクリップに部分的に重なる
      matchType = "overlap";
      const normalizedOffset = temporalOffset / (clipDuration / 2);
      confidence = Math.max(0.4, 0.7 - normalizedOffset * 0.3);
    } else if (temporalOffset <= tolerance) {
      // イベントがクリップに近接
      matchType = "proximity";
      const normalizedOffset = temporalOffset / tolerance;
      confidence = Math.max(0.2, 0.4 - normalizedOffset * 0.2);
    } else {
      // マッチしない
      continue;
    }

    // イベントタイプに基づく重要度ブースト
    const importanceBoost = calculateEventImportanceBoost(event);

    matches.push({
      clipId: clip.id,
      eventId: event.id,
      matchType,
      confidence,
      temporalOffset,
      importanceBoost,
    });
  }

  // 信頼度でソート（降順）
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * イベントの重要度ブーストを計算
 *
 * @param event - イベント
 * @returns 重要度ブースト値 (0-1)
 */
function calculateEventImportanceBoost(event: Event): number {
  let boost = EVENT_TYPE_WEIGHTS[event.type] ?? 0.3;

  // ショットの詳細による調整
  if (event.type === "shot" && event.details) {
    if (event.details.shotResult === "goal") {
      boost = EVENT_TYPE_WEIGHTS.goal; // ゴールとして扱う
    } else if (event.details.isOnTarget) {
      boost *= 1.2; // 枠内シュートはブースト
    }

    // ロングレンジシュートは希少性で追加ブースト
    if (event.details.shotType === "long_range") {
      boost *= 1.1;
    }
  }

  // タックルの詳細による調整
  if (event.type === "tackle" && event.details) {
    if (event.details.wonTackle) {
      boost *= 1.3; // 成功タックルはブースト
    }
  }

  // ターンオーバーの詳細による調整
  if (event.type === "turnover" && event.details) {
    if (event.details.turnoverType === "interception") {
      boost *= 1.2; // インターセプトはブースト
    }
  }

  return Math.min(1.0, boost);
}

// ============================================================
// Importance Calculation
// ============================================================

/**
 * クリップの重要度を計算
 *
 * @param clip - クリップ
 * @param matchedEvents - マッチしたイベント
 * @param matchContext - 試合コンテキスト（オプション）
 * @returns 重要度計算の内訳
 */
export function calculateClipImportance(
  clip: Clip,
  matchedEvents: ClipEventMatch[],
  matchContext?: MatchContext
): ClipImportanceFactors {
  if (matchedEvents.length === 0) {
    // マッチするイベントがない場合は最低重要度
    return {
      baseImportance: 0.1,
      eventTypeBoost: 0,
      contextBoost: 0,
      rarityBoost: 0,
      finalImportance: 0.1,
    };
  }

  // ベース重要度: 最も重要度の高いマッチから計算
  const topMatch = matchedEvents[0];
  const baseImportance = topMatch.importanceBoost * topMatch.confidence;

  // イベントタイプブースト: 複数のイベントがある場合は追加ブースト
  let eventTypeBoost = 0;
  if (matchedEvents.length > 1) {
    // 2番目以降のマッチも考慮（減衰させながら加算）
    for (let i = 1; i < Math.min(3, matchedEvents.length); i++) {
      const decayFactor = 0.5 ** i; // 指数減衰
      eventTypeBoost += matchedEvents[i].importanceBoost * matchedEvents[i].confidence * decayFactor;
    }
    eventTypeBoost *= 0.3; // 全体の影響を30%に制限
  }

  // コンテキストブースト
  const contextBoost = matchContext
    ? calculateContextBoost(matchedEvents, matchContext)
    : 0;

  // 希少性ブースト
  const rarityBoost = calculateRarityBoost(matchedEvents);

  // 最終重要度を計算（各要素を合算して正規化）
  const rawImportance = baseImportance + eventTypeBoost + contextBoost + rarityBoost;
  const finalImportance = Math.min(1.0, rawImportance);

  return {
    baseImportance,
    eventTypeBoost,
    contextBoost,
    rarityBoost,
    finalImportance,
  };
}

/**
 * コンテキストに基づくブーストを計算
 *
 * 試合の状況（時間帯、スコア差など）を考慮
 */
function calculateContextBoost(
  matchedEvents: ClipEventMatch[],
  context: MatchContext
): number {
  let boost = 0;

  // 試合終盤のイベントはブースト
  if (context.matchMinute !== undefined && context.totalMatchMinutes !== undefined) {
    const matchProgress = context.matchMinute / context.totalMatchMinutes;
    if (matchProgress > 0.8) {
      // 試合の80%以降
      boost += 0.15 * (matchProgress - 0.8) / 0.2; // 0.8-1.0を0-0.15にマッピング
    }
  }

  // スコア差に基づくブースト
  if (context.scoreDifferential !== undefined) {
    // 同点または1点差の場合はブースト（重要な局面）
    const scoreDiff = Math.abs(context.scoreDifferential);
    if (scoreDiff <= 1) {
      boost += 0.1;
    }

    // ビハインド時のゴールは特に重要
    if (context.scoreDifferential < 0) {
      // 負けている状態でのゴール
      const hasGoal = matchedEvents.some((m) => m.importanceBoost >= EVENT_TYPE_WEIGHTS.goal);
      if (hasGoal) {
        boost += 0.15;
      }
    }
  }

  return Math.min(0.3, boost); // 最大30%のブースト
}

/**
 * 希少性に基づくブーストを計算
 *
 * レアなイベントほど高いブースト
 */
function calculateRarityBoost(matchedEvents: ClipEventMatch[]): number {
  let maxRarity = 0;

  for (const match of matchedEvents) {
    // イベントタイプから希少性を取得（不明な場合は0）
    const eventType = extractEventTypeFromBoost(match.importanceBoost);
    const rarity = eventType ? (RARITY_WEIGHTS[eventType] ?? 0) : 0;
    maxRarity = Math.max(maxRarity, rarity * match.confidence);
  }

  return maxRarity * 0.2; // 希少性の影響を20%に制限
}

/**
 * importanceBoostから元のイベントタイプを推定
 *
 * NOTE: 完全な逆引きは不可能だが、近似的に判定
 */
function extractEventTypeFromBoost(boost: number): EventType | null {
  // 閾値ベースで判定
  if (boost >= 0.95) return "goal";
  if (boost >= 0.9) return "penalty";
  if (boost >= 0.85) return "red_card";
  if (boost >= 0.8) return "own_goal";
  if (boost >= 0.7) return "shot";
  if (boost >= 0.6) return "key_pass";
  if (boost >= 0.5) return "tackle";
  return null;
}

// ============================================================
// Ranking Functions
// ============================================================

/**
 * すべてのクリップをイベントとマッチングし重要度順にランク付け
 *
 * @param clips - すべてのクリップ
 * @param allEvents - すべてのイベント
 * @param matchContext - 試合コンテキスト（オプション）
 * @param tolerance - マッチング許容時間（秒）
 * @returns 重要度順にソートされたランク付きクリップ
 */
export function rankClipsByImportance(
  clips: Clip[],
  allEvents: Event[],
  matchContext?: MatchContext,
  tolerance?: number
): RankedClip[] {
  const rankedClips: RankedClip[] = [];

  for (const clip of clips) {
    const matches = matchClipToEvents(clip, allEvents, tolerance);
    const importance = calculateClipImportance(clip, matches, matchContext);

    rankedClips.push({
      clip,
      matches,
      importance,
      rank: 0, // 後で設定
    });
  }

  // 重要度でソート（降順）
  rankedClips.sort((a, b) => b.importance.finalImportance - a.importance.finalImportance);

  // ランクを設定
  rankedClips.forEach((rc, index) => {
    rc.rank = index + 1;
  });

  return rankedClips;
}

/**
 * トップN個の最重要クリップを取得
 *
 * @param clips - すべてのクリップ
 * @param allEvents - すべてのイベント
 * @param topN - 取得する上位N個
 * @param matchContext - 試合コンテキスト（オプション）
 * @returns 上位N個のクリップ
 */
export function getTopClips(
  clips: Clip[],
  allEvents: Event[],
  topN: number,
  matchContext?: MatchContext
): RankedClip[] {
  const ranked = rankClipsByImportance(clips, allEvents, matchContext);
  return ranked.slice(0, topN);
}

/**
 * 重要度の閾値以上のクリップをフィルタリング
 *
 * @param clips - すべてのクリップ
 * @param allEvents - すべてのイベント
 * @param threshold - 重要度の閾値 (0-1)
 * @param matchContext - 試合コンテキスト（オプション）
 * @returns 閾値以上のクリップ
 */
export function filterClipsByImportance(
  clips: Clip[],
  allEvents: Event[],
  threshold: number,
  matchContext?: MatchContext
): RankedClip[] {
  const ranked = rankClipsByImportance(clips, allEvents, matchContext);
  return ranked.filter((rc) => rc.importance.finalImportance >= threshold);
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * マッチタイプを日本語で取得
 */
export function getMatchTypeLabel(matchType: ClipEventMatch["matchType"]): string {
  switch (matchType) {
    case "exact":
      return "完全一致";
    case "overlap":
      return "部分一致";
    case "proximity":
      return "近接";
  }
}

/**
 * クリップの重要度サマリーを文字列で取得
 */
export function getImportanceSummary(importance: ClipImportanceFactors): string {
  const { finalImportance, baseImportance, eventTypeBoost, contextBoost, rarityBoost } = importance;

  const parts: string[] = [
    `最終重要度: ${(finalImportance * 100).toFixed(1)}%`,
    `ベース: ${(baseImportance * 100).toFixed(1)}%`,
  ];

  if (eventTypeBoost > 0) {
    parts.push(`イベント: +${(eventTypeBoost * 100).toFixed(1)}%`);
  }
  if (contextBoost > 0) {
    parts.push(`コンテキスト: +${(contextBoost * 100).toFixed(1)}%`);
  }
  if (rarityBoost > 0) {
    parts.push(`希少性: +${(rarityBoost * 100).toFixed(1)}%`);
  }

  return parts.join(", ");
}
