/**
 * Comprehensive Analysis Schema
 *
 * 統合動画分析のZodスキーマ定義
 * Call 1: 1回のGemini API呼び出しで以下を全て取得
 * - segments（セグメント）
 * - events（イベント）
 * - scenes（重要シーン）
 * - players（選手識別）
 * - clipLabels（クリップラベル）
 */

import { z } from "zod";

// ============================================================
// 共通スキーマ
// ============================================================

/**
 * ビデオ品質
 */
export const VideoQualitySchema = z.enum(["good", "fair", "poor"]);

/**
 * チーム識別
 */
export const TeamSchema = z.enum(["home", "away"]);

/**
 * ゾーン識別
 */
export const ZoneSchema = z.enum(["defensive_third", "middle_third", "attacking_third"]);

/**
 * 攻撃方向
 */
export const AttackingDirectionSchema = z.enum(["left_to_right", "right_to_left"]);

// ============================================================
// メタデータ
// ============================================================

export const AnalysisMetadataSchema = z.object({
  totalDurationSec: z.number().min(0),
  videoQuality: VideoQualitySchema,
  qualityIssues: z.array(z.string()).optional(),
  analyzedFromSec: z.number().min(0).optional(),
  analyzedToSec: z.number().min(0).optional(),
});

// ============================================================
// チームカラー情報
// ============================================================

export const TeamColorsSchema = z.object({
  primaryColor: z.string().describe("Primary jersey color in hex format"),
  secondaryColor: z.string().optional().describe("Secondary color if applicable"),
  goalkeeperColor: z.string().optional().describe("Goalkeeper jersey color"),
});

export const TeamsInfoSchema = z.object({
  home: TeamColorsSchema.extend({
    attackingDirection: AttackingDirectionSchema.optional(),
  }),
  away: TeamColorsSchema.extend({
    attackingDirection: AttackingDirectionSchema.optional(),
  }),
});

// ============================================================
// セグメント（video segmentation）
// ============================================================

export const SegmentTypeSchema = z.enum([
  "active_play",
  "stoppage",
  "set_piece",
  "goal_moment",
  "replay",
]);

export const SegmentSubtypeSchema = z
  .enum([
    "corner",
    "free_kick",
    "penalty",
    "goal_kick",
    "throw_in",
    "kick_off",
    "foul",
    "injury",
    "substitution",
    "referee_decision",
    "other",
  ])
  .optional();

export const VideoSegmentSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  type: SegmentTypeSchema,
  subtype: SegmentSubtypeSchema,
  description: z.string(),
  attackingTeam: TeamSchema.optional().nullable(),
  importance: z.number().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1),
  visualEvidence: z.string().optional(),
});

// ============================================================
// イベント（event detection）
// ============================================================

export const EventTypeSchema = z.enum([
  "pass",
  "carry",
  "turnover",
  "shot",
  "setPiece",
]);

export const PassTypeSchema = z.enum(["short", "medium", "long", "through", "cross"]);

export const PassOutcomeSchema = z.enum(["complete", "incomplete", "intercepted"]);

export const ShotResultSchema = z.enum(["goal", "saved", "blocked", "missed", "post"]);

export const ShotTypeSchema = z.enum([
  "power",
  "placed",
  "header",
  "volley",
  "long_range",
  "chip",
]);

export const TurnoverTypeSchema = z.enum([
  "tackle",
  "interception",
  "bad_touch",
  "out_of_bounds",
  "other",
]);

export const SetPieceTypeSchema = z.enum([
  "corner",
  "free_kick",
  "penalty",
  "throw_in",
  "goal_kick",
  "kick_off",
]);

export const EventDetailsSchema = z
  .object({
    // Pass details
    passType: PassTypeSchema.optional(),
    outcome: PassOutcomeSchema.optional(),
    targetPlayer: z.string().optional(),
    distance: z.number().optional(),
    // Carry details
    endReason: z.enum(["pass", "shot", "dispossessed", "stopped"]).optional(),
    // Turnover details
    turnoverType: TurnoverTypeSchema.optional(),
    // Shot details
    shotResult: ShotResultSchema.optional(),
    shotType: ShotTypeSchema.optional(),
    // Set piece details
    setPieceType: SetPieceTypeSchema.optional(),
  })
  .optional();

export const EventSchema = z.object({
  timestamp: z.number().min(0),
  type: EventTypeSchema,
  team: TeamSchema,
  player: z.string().optional().describe("Player identifier like '#10'"),
  zone: ZoneSchema.optional(),
  details: EventDetailsSchema,
  confidence: z.number().min(0).max(1),
  visualEvidence: z.string().optional(),
});

// ============================================================
// 重要シーン（important scenes）
// ============================================================

export const SceneTypeSchema = z.enum([
  "goal",
  "shot",
  "save",
  "chance",
  "turnover",
  "foul",
  "card",
  "setPiece",
  "dribble",
  "defense",
  "other",
]);

export const ImportantSceneSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0).optional(),
  type: SceneTypeSchema,
  team: TeamSchema.optional(),
  description: z.string(),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
  suggestedClip: z
    .object({
      t0: z.number().min(0),
      t1: z.number().min(0),
    })
    .optional(),
});

// ============================================================
// 選手識別（player identification）
// ============================================================

export const PlayerRoleSchema = z.enum(["player", "goalkeeper"]);

export const IdentifiedPlayerSchema = z.object({
  team: TeamSchema,
  jerseyNumber: z.number().nullable(),
  role: PlayerRoleSchema,
  confidence: z.number().min(0).max(1),
});

export const RefereeRoleSchema = z.enum(["main_referee", "linesman", "fourth_official"]);

export const RefereeSchema = z.object({
  role: RefereeRoleSchema,
  uniformColor: z.string().optional(),
});

export const PlayersIdentificationSchema = z.object({
  teams: TeamsInfoSchema,
  players: z.array(IdentifiedPlayerSchema),
  referees: z.array(RefereeSchema).optional(),
});

// ============================================================
// クリップラベル（clip labeling）
// ============================================================

export const ClipLabelCategorySchema = z.enum([
  "shot",
  "chance",
  "setPiece",
  "dribble",
  "defense",
  "other",
]);

export const ClipLabelSchema = z.object({
  clipId: z.string().optional(),
  timestamp: z.number().min(0).optional().describe("Reference timestamp for the clip"),
  label: ClipLabelCategorySchema,
  confidence: z.number().min(0).max(1),
  title: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  coachTips: z.array(z.string()).optional(),
});

// ============================================================
// 統合レスポンススキーマ（Call 1）
// ============================================================

export const ComprehensiveAnalysisResponseSchema = z.object({
  metadata: AnalysisMetadataSchema,
  teams: TeamsInfoSchema,
  segments: z.array(VideoSegmentSchema),
  events: z.array(EventSchema),
  scenes: z.array(ImportantSceneSchema),
  players: PlayersIdentificationSchema,
  clipLabels: z.array(ClipLabelSchema).optional(),
});

export type ComprehensiveAnalysisResponse = z.infer<typeof ComprehensiveAnalysisResponseSchema>;

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * Geminiレスポンスのフィールド名を正規化
 * Geminiは time/timestamp, type/eventType など異なるフィールド名を返す可能性がある
 */
export function normalizeEventFields(event: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...event };

  // timestamp正規化
  if ("time" in normalized && !("timestamp" in normalized)) {
    normalized.timestamp = normalized.time;
    delete normalized.time;
  }

  // type正規化
  if ("eventType" in normalized && !("type" in normalized)) {
    normalized.type = normalized.eventType;
    delete normalized.eventType;
  }

  return normalized;
}

/**
 * レスポンス全体のイベントを正規化
 */
export function normalizeComprehensiveResponse(
  response: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...response };

  if (Array.isArray(normalized.events)) {
    normalized.events = normalized.events.map((event) =>
      typeof event === "object" && event !== null
        ? normalizeEventFields(event as Record<string, unknown>)
        : event
    );
  }

  return normalized;
}
