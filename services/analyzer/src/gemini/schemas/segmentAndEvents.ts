/**
 * Segment and Events Schema
 *
 * Hybrid 4-Call Pipeline - Call 1
 * セグメント分割 + イベント検出の統合スキーマ
 */

import { z } from "zod";

// ============================================================
// 共通スキーマ (from comprehensiveAnalysis.ts)
// ============================================================

export const VideoQualitySchema = z.enum(["good", "fair", "poor"]);
export const TeamSchema = z.enum(["home", "away"]);
export const ZoneSchema = z.enum(["defensive_third", "middle_third", "attacking_third"]);
export const AttackingDirectionSchema = z.enum(["left_to_right", "right_to_left"]);

// ============================================================
// メタデータ
// ============================================================

export const SegmentAndEventsMetadataSchema = z.object({
  totalDurationSec: z.number().min(0),
  videoQuality: VideoQualitySchema,
  qualityIssues: z
    .array(z.enum(["occlusion", "camera_shake", "low_resolution", "fast_movement", "none"]))
    .optional(),
  analyzedFromSec: z.number().min(0).optional(),
  analyzedToSec: z.number().min(0).optional(),
});

// ============================================================
// チーム情報
// ============================================================

export const TeamInfoSchema = z.object({
  primaryColor: z.string().describe("Primary jersey color in hex format #RRGGBB or description"),
  attackingDirection: AttackingDirectionSchema.optional(),
});

export const TeamsSchema = z.object({
  home: TeamInfoSchema,
  away: TeamInfoSchema,
});

// ============================================================
// セグメント
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

export const SegmentSchema = z.object({
  startSec: z.number().min(0).describe("Start time in seconds (1 decimal)"),
  endSec: z.number().min(0).describe("End time in seconds (1 decimal)"),
  type: SegmentTypeSchema,
  subtype: SegmentSubtypeSchema,
  description: z.string(),
  attackingTeam: TeamSchema.optional().nullable(),
  importance: z.number().min(1).max(5).optional().describe("Required for active_play (1-5)"),
  confidence: z.number().min(0.5).max(1),
  visualEvidence: z.string().optional(),
});

// ============================================================
// イベント
// ============================================================

export const EventTypeSchema = z.enum(["pass", "carry", "turnover", "shot", "setPiece"]);

export const PassTypeSchema = z.enum(["short", "medium", "long", "through", "cross"]);
export const PassOutcomeSchema = z.enum(["complete", "incomplete", "intercepted"]);

export const ShotResultSchema = z.enum(["goal", "saved", "blocked", "missed", "post"]);
export const ShotTypeSchema = z.enum(["power", "placed", "header", "volley", "long_range", "chip"]);

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

export const CarryEndReasonSchema = z.enum(["pass", "shot", "dispossessed", "stopped"]);

export const EventDetailsSchema = z
  .object({
    // Pass details
    passType: PassTypeSchema.optional(),
    outcome: PassOutcomeSchema.optional(),
    targetPlayer: z.string().optional(),
    // Carry details
    distance: z.number().optional(),
    endReason: CarryEndReasonSchema.optional(),
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
  timestamp: z.number().min(0).describe("Timestamp in seconds (1 decimal)"),
  type: EventTypeSchema,
  team: TeamSchema,
  player: z.string().optional().describe("Player identifier like '#10'"),
  zone: ZoneSchema.optional(),
  details: EventDetailsSchema,
  confidence: z.number().min(0.3).max(1).describe("0.3-1.0 for shots, 0.5-1.0 for others"),
  visualEvidence: z.string().optional(),
});

// ============================================================
// 統合レスポンススキーマ
// ============================================================

export const SegmentAndEventsResponseSchema = z.object({
  metadata: SegmentAndEventsMetadataSchema,
  teams: TeamsSchema,
  segments: z.array(SegmentSchema),
  events: z.array(EventSchema),
});

export type SegmentAndEventsResponse = z.infer<typeof SegmentAndEventsResponseSchema>;

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * Geminiレスポンスのフィールド名を正規化
 */
export function normalizeEventFields(event: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...event };

  // timestamp正規化 (time -> timestamp)
  if ("time" in normalized && !("timestamp" in normalized)) {
    normalized.timestamp = normalized.time;
    delete normalized.time;
  }

  // type正規化 (eventType -> type)
  if ("eventType" in normalized && !("type" in normalized)) {
    normalized.type = normalized.eventType;
    delete normalized.eventType;
  }

  return normalized;
}

/**
 * レスポンス全体を正規化
 */
export function normalizeSegmentAndEventsResponse(
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

/**
 * バリデーションとパース
 */
export function parseSegmentAndEventsResponse(
  data: unknown
): { success: true; data: SegmentAndEventsResponse } | { success: false; error: z.ZodError } {
  // まず正規化
  const normalized =
    typeof data === "object" && data !== null
      ? normalizeSegmentAndEventsResponse(data as Record<string, unknown>)
      : data;

  const result = SegmentAndEventsResponseSchema.safeParse(normalized);
  return result;
}
