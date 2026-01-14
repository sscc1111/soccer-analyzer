/**
 * Scenes and Players Schema
 *
 * Hybrid 4-Call Pipeline - Call 2
 * シーン抽出 + 選手識別の統合スキーマ
 */

import { z } from "zod";

// ============================================================
// 共通スキーマ
// ============================================================

export const TeamSchema = z.enum(["home", "away"]);
export const AttackingDirectionSchema = z.enum(["left_to_right", "right_to_left"]);

// ============================================================
// シーン
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

export const SuggestedClipSchema = z.object({
  t0: z.number().min(0).describe("Clip start time in seconds"),
  t1: z.number().min(0).describe("Clip end time in seconds"),
});

export const SceneSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0).optional(),
  type: SceneTypeSchema,
  team: TeamSchema.optional(),
  description: z.string(),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
  suggestedClip: SuggestedClipSchema.optional(),
});

// ============================================================
// 選手
// ============================================================

export const PlayerRoleSchema = z.enum(["player", "goalkeeper"]);

export const IdentifiedPlayerSchema = z.object({
  team: TeamSchema,
  jerseyNumber: z.number().nullable(),
  role: PlayerRoleSchema,
  confidence: z.number().min(0.5).max(1),
});

export const RefereeRoleSchema = z.enum(["main_referee", "linesman", "fourth_official"]);

export const RefereeSchema = z.object({
  role: RefereeRoleSchema,
  uniformColor: z.string().optional(),
});

// ============================================================
// チームカラー
// ============================================================

export const TeamColorsSchema = z.object({
  primaryColor: z.string().describe("Primary jersey color in hex format #RRGGBB"),
  secondaryColor: z.string().optional(),
  goalkeeperColor: z.string().optional(),
  attackingDirection: AttackingDirectionSchema.optional(),
});

export const TeamsColorsSchema = z.object({
  home: TeamColorsSchema,
  away: TeamColorsSchema,
});

// ============================================================
// 選手識別結果
// ============================================================

export const PlayersIdentificationSchema = z.object({
  teams: TeamsColorsSchema,
  identified: z.array(IdentifiedPlayerSchema),
  referees: z.array(RefereeSchema).optional(),
});

// ============================================================
// 統合レスポンススキーマ
// ============================================================

export const ScenesAndPlayersResponseSchema = z.object({
  scenes: z.array(SceneSchema),
  players: PlayersIdentificationSchema,
});

export type ScenesAndPlayersResponse = z.infer<typeof ScenesAndPlayersResponseSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type IdentifiedPlayer = z.infer<typeof IdentifiedPlayerSchema>;
export type Referee = z.infer<typeof RefereeSchema>;
export type TeamColors = z.infer<typeof TeamColorsSchema>;

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * レスポンスの正規化（フィールド名の揺れを吸収）
 */
export function normalizeScenesAndPlayersResponse(
  response: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...response };

  // scenes内のフィールド正規化
  if (Array.isArray(normalized.scenes)) {
    normalized.scenes = normalized.scenes.map((scene) => {
      if (typeof scene !== "object" || scene === null) return scene;
      const s = scene as Record<string, unknown>;

      // start -> startSec
      if ("start" in s && !("startSec" in s)) {
        s.startSec = s.start;
        delete s.start;
      }

      // end -> endSec
      if ("end" in s && !("endSec" in s)) {
        s.endSec = s.end;
        delete s.end;
      }

      // clip -> suggestedClip
      if ("clip" in s && !("suggestedClip" in s)) {
        s.suggestedClip = s.clip;
        delete s.clip;
      }

      return s;
    });
  }

  // players.identified内のフィールド正規化
  if (
    typeof normalized.players === "object" &&
    normalized.players !== null
  ) {
    const players = normalized.players as Record<string, unknown>;

    // playersが配列の場合（別形式）
    if (Array.isArray(players)) {
      normalized.players = {
        teams: { home: {}, away: {} },
        identified: players,
        referees: [],
      };
    }
  }

  return normalized;
}

/**
 * バリデーションとパース
 */
export function parseScenesAndPlayersResponse(
  data: unknown
): { success: true; data: ScenesAndPlayersResponse } | { success: false; error: z.ZodError } {
  // まず正規化
  const normalized =
    typeof data === "object" && data !== null
      ? normalizeScenesAndPlayersResponse(data as Record<string, unknown>)
      : data;

  const result = ScenesAndPlayersResponseSchema.safeParse(normalized);
  return result;
}

/**
 * シーンを重要度でソート
 */
export function sortScenesByImportance(scenes: Scene[]): Scene[] {
  return [...scenes].sort((a, b) => b.importance - a.importance);
}

/**
 * シーンを時系列でソート
 */
export function sortScenesByTime(scenes: Scene[]): Scene[] {
  return [...scenes].sort((a, b) => a.startSec - b.startSec);
}
