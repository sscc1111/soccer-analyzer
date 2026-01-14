/**
 * Gemini Schema Exports
 *
 * 統合分析のためのZodスキーマをエクスポート
 */

// Call 1: Comprehensive Analysis
export {
  // Common schemas
  VideoQualitySchema,
  TeamSchema,
  ZoneSchema,
  AttackingDirectionSchema,
  // Metadata
  AnalysisMetadataSchema,
  // Teams
  TeamColorsSchema,
  TeamsInfoSchema,
  // Segments
  SegmentTypeSchema,
  SegmentSubtypeSchema,
  VideoSegmentSchema,
  // Events
  EventTypeSchema,
  PassTypeSchema,
  PassOutcomeSchema,
  ShotResultSchema,
  ShotTypeSchema,
  TurnoverTypeSchema,
  SetPieceTypeSchema,
  EventDetailsSchema,
  EventSchema,
  // Scenes
  SceneTypeSchema,
  ImportantSceneSchema,
  // Players
  PlayerRoleSchema,
  IdentifiedPlayerSchema,
  RefereeRoleSchema,
  RefereeSchema,
  PlayersIdentificationSchema,
  // Clip Labels
  ClipLabelCategorySchema,
  ClipLabelSchema,
  // Main response
  ComprehensiveAnalysisResponseSchema,
  // Helpers
  normalizeEventFields,
  normalizeComprehensiveResponse,
} from "./comprehensiveAnalysis";

export type { ComprehensiveAnalysisResponse } from "./comprehensiveAnalysis";

// Call 2: Summary and Tactics
export {
  // Tactical
  FormationSchema,
  TempoSchema,
  PressingIntensitySchema,
  BuildUpStyleSchema,
  BuildUpStylesSchema,
  TacticalAnalysisSchema,
  // Summary
  NarrativeSchema,
  KeyMomentTypeSchema,
  KeyMomentSchema,
  PlayerHighlightSchema,
  ScoreSchema,
  MatchSummarySchema,
  // Main response
  SummaryAndTacticsResponseSchema,
  // Input helpers
  EventStatsInputSchema,
  calculateEventStats,
} from "./summaryAndTactics";

export type { SummaryAndTacticsResponse, EventStatsInput } from "./summaryAndTactics";
