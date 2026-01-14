/**
 * Summary and Tactics Schema
 *
 * Call 2: サマリー・戦術分析のZodスキーマ定義
 * Call 1の結果を使用して、動画なしでテキストのみで分析
 * - tactical（戦術分析）
 * - summary（試合サマリー）
 */

import { z } from "zod";
import { TeamSchema } from "./comprehensiveAnalysis";

// ============================================================
// 戦術分析（tactical analysis）
// ============================================================

export const FormationSchema = z.object({
  home: z.string().describe("Formation like '4-3-3', '4-4-2'"),
  away: z.string(),
});

export const TempoSchema = z.object({
  home: z.number().describe("Passes per minute"),
  away: z.number(),
});

export const PressingIntensitySchema = z
  .object({
    home: z.number().min(0).max(100).describe("Pressing intensity 0-100"),
    away: z.number().min(0).max(100),
  })
  .optional();

export const BuildUpStyleSchema = z.enum(["short", "long", "mixed"]);

export const BuildUpStylesSchema = z
  .object({
    home: BuildUpStyleSchema,
    away: BuildUpStyleSchema,
  })
  .optional();

export const TacticalAnalysisSchema = z.object({
  formation: FormationSchema,
  tempo: TempoSchema,
  attackPatterns: z.array(z.string()).describe("2-4 attack patterns"),
  defensivePatterns: z.array(z.string()).describe("2-3 defensive patterns"),
  keyInsights: z.array(z.string()).describe("3-5 tactical observations"),
  pressingIntensity: PressingIntensitySchema,
  buildUpStyle: BuildUpStylesSchema,
});

// ============================================================
// 試合サマリー（match summary）
// ============================================================

export const NarrativeSchema = z.object({
  firstHalf: z.string().describe("100-200 characters"),
  secondHalf: z.string().describe("100-200 characters"),
  overall: z.string().optional().describe("50-100 characters overall summary"),
});

export const KeyMomentTypeSchema = z.enum([
  "goal",
  "chance",
  "save",
  "foul",
  "substitution",
  "tactical_change",
  "other",
]);

export const KeyMomentSchema = z.object({
  timestamp: z.number().min(0),
  description: z.string(),
  importance: z.number().min(0).max(1),
  type: KeyMomentTypeSchema.optional(),
  clipId: z.string().nullable().optional(),
});

export const PlayerHighlightSchema = z.object({
  player: z.string(),
  jerseyNumber: z.number().optional(),
  team: TeamSchema,
  achievement: z.string(),
  metric: z
    .object({
      name: z.string(),
      value: z.union([z.number(), z.string()]),
    })
    .optional(),
});

export const ScoreSchema = z
  .object({
    home: z.number().min(0),
    away: z.number().min(0),
  })
  .optional();

export const MatchSummarySchema = z.object({
  headline: z.string().describe("15-30 characters"),
  narrative: NarrativeSchema,
  keyMoments: z.array(KeyMomentSchema),
  playerHighlights: z.array(PlayerHighlightSchema),
  score: ScoreSchema,
  mvp: PlayerHighlightSchema.optional(),
  tags: z.array(z.string()).optional(),
});

// ============================================================
// 統合レスポンススキーマ（Call 2）
// ============================================================

export const SummaryAndTacticsResponseSchema = z.object({
  tactical: TacticalAnalysisSchema,
  summary: MatchSummarySchema,
});

export type SummaryAndTacticsResponse = z.infer<typeof SummaryAndTacticsResponseSchema>;

// ============================================================
// 入力スキーマ（Call 1結果からの派生）
// ============================================================

/**
 * Call 2に渡すイベント統計情報
 */
export const EventStatsInputSchema = z.object({
  home: z.object({
    passes: z.number(),
    passesComplete: z.number(),
    shots: z.number(),
    shotsOnTarget: z.number(),
    turnoversWon: z.number(),
    turnoversLost: z.number(),
  }),
  away: z.object({
    passes: z.number(),
    passesComplete: z.number(),
    shots: z.number(),
    shotsOnTarget: z.number(),
    turnoversWon: z.number(),
    turnoversLost: z.number(),
  }),
  total: z.object({
    passes: z.number(),
    shots: z.number(),
    turnovers: z.number(),
  }),
});

export type EventStatsInput = z.infer<typeof EventStatsInputSchema>;

/**
 * Call 1結果から統計を計算
 */
export function calculateEventStats(
  events: Array<{
    type: string;
    team: string;
    details?: {
      outcome?: string;
      shotResult?: string;
    };
  }>
): EventStatsInput {
  const stats: EventStatsInput = {
    home: {
      passes: 0,
      passesComplete: 0,
      shots: 0,
      shotsOnTarget: 0,
      turnoversWon: 0,
      turnoversLost: 0,
    },
    away: {
      passes: 0,
      passesComplete: 0,
      shots: 0,
      shotsOnTarget: 0,
      turnoversWon: 0,
      turnoversLost: 0,
    },
    total: {
      passes: 0,
      shots: 0,
      turnovers: 0,
    },
  };

  for (const event of events) {
    const team = event.team === "home" ? "home" : "away";
    const oppositeTeam = team === "home" ? "away" : "home";

    switch (event.type) {
      case "pass":
        stats[team].passes++;
        stats.total.passes++;
        if (event.details?.outcome === "complete") {
          stats[team].passesComplete++;
        }
        break;

      case "shot":
        stats[team].shots++;
        stats.total.shots++;
        if (
          event.details?.shotResult === "goal" ||
          event.details?.shotResult === "saved"
        ) {
          stats[team].shotsOnTarget++;
        }
        break;

      case "turnover":
        stats[oppositeTeam].turnoversWon++;
        stats[team].turnoversLost++;
        stats.total.turnovers++;
        break;
    }
  }

  return stats;
}
