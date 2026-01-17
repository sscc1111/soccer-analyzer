/**
 * Library exports for soccer-analyzer
 */

// Re-export clip-event matcher
export {
  // Types
  type Clip,
  type Event,
  type EventType,
  type EventDetails,
  type ClipEventMatch,
  type ClipImportanceFactors,
  type MatchContext,
  type RankedClip,
  type DynamicWindow,

  // Main functions
  matchClipToEvents,
  calculateClipImportance,
  rankClipsByImportance,
  getTopClips,
  filterClipsByImportance,
  calculateDynamicWindow,

  // Utility functions
  getMatchTypeLabel,
  getImportanceSummary,
} from './clipEventMatcher';

// Re-export formation tracking
export {
  // Types
  type MatchEvent,
  type FormationState,
  type FormationChange,
  type FormationTimeline,
  type PlayerPosition,
  type FormationHalfComparison,

  // Main functions
  trackFormationChanges,
  analyzeFormationByHalf,
  detectFormationTrigger,
  calculateFormationVariability,
} from './formationTracking';

// Re-export tactical patterns
export {
  // Types
  type AttackZone,
  type PressHeight,
  type BuildUpSpeed,
  type AttackPattern,
  type RecoveryZone,
  type CounterAttackEvent,
  type AttackPatternResult,
  type DefensePatternResult,
  type TeamTacticalPatterns,

  // Main functions
  classifyAttackZone,
  classifyFieldThird,
  detectCounterAttacks,
  calculatePressHeight,
  detectAttackPatterns,
  detectDefensivePatterns,
  analyzeTeamTacticalPatterns,
  generateTacticalSummary,
} from './tacticalPatterns';

// Re-export set piece outcome analysis (Section 3.2.2)
export {
  // Types
  type SetPieceOutcomeAnalysis,

  // Main functions
  analyzeSetPieceOutcomes,
} from './setPieceOutcomeAnalysis';

// Re-export player track matcher (Section 5.1.2)
export {
  // Types
  type RawPlayerDetection,
  type MergedPlayerInfo,
  type PlayerMatchingResult,

  // Main functions
  mergePlayerDetections,
  recalculatePlayerConfidence,
  deduplicatePlayers,
  validateJerseyNumberConsistency,
} from './playerTrackMatcher';
