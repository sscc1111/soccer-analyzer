/**
 * Gemini-first Architecture: Tactical analysis types
 *
 * タクティカル分析と試合サマリーの型定義
 * Firestore: matches/{matchId}/tactical/current
 * Firestore: matches/{matchId}/summary/current
 */

/**
 * Formation string (e.g., "4-3-3", "4-4-2", "3-5-2")
 */
export type Formation = string;

/**
 * Formation state at a specific time
 */
export type FormationState = {
  formation: string;
  timestamp: number;
  confidence: number;
  phase: 'attacking' | 'defending' | 'transition' | 'set_piece';
};

/**
 * Formation change event
 */
export type FormationChange = {
  fromFormation: string;
  toFormation: string;
  timestamp: number;
  trigger: 'tactical_switch' | 'substitution' | 'game_state' | 'opponent_pressure';
  confidence: number;
};

/**
 * Formation timeline for a period
 */
export type FormationTimeline = {
  states: FormationState[];
  changes: FormationChange[];
  dominantFormation: string;
  formationVariability: number;
};

/**
 * Half-by-half formation comparison
 */
export type FormationHalfComparison = {
  firstHalf: FormationTimeline;
  secondHalf: FormationTimeline;
  comparison: {
    formationChanged: boolean;
    firstHalfDominant: string;
    secondHalfDominant: string;
    variabilityChange: number;
  };
};

/**
 * Phase-based formation analysis (attacking/defending/transition/set_piece)
 */
export type FormationByPhase = {
  /** Formation timeline during attacking phases */
  attacking: FormationTimeline;
  /** Formation timeline during defending phases */
  defending: FormationTimeline;
  /** Formation timeline during transition phases */
  transition: FormationTimeline;
  /** Formation timeline during set piece phases */
  setPiece: FormationTimeline;
  /** Comparison between phases */
  comparison: {
    /** Whether formation changes between attack and defense */
    hasPhaseVariation: boolean;
    /** Dominant formation during attacking */
    attackingDominant: string;
    /** Dominant formation during defending */
    defendingDominant: string;
    /** Dominant formation during transition */
    transitionDominant: string;
    /** Phase adaptability score (0-1) */
    phaseAdaptability: number;
  };
};

/**
 * Tactical analysis document
 * Firestore: matches/{matchId}/tactical/current
 * For half-based analysis: matches/{matchId}/tactical/{videoId}_current
 */
export type TacticalAnalysisDoc = {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  /** Processing version */
  version: string;
  /** Detected formations */
  formation: {
    home: Formation;
    away: Formation;
  };
  /** Team tempo (passes per minute) */
  tempo: {
    home: number;
    away: number;
  };
  /** Identified attack patterns */
  attackPatterns: string[];
  /** Identified defensive patterns */
  defensivePatterns: string[];
  /** Key tactical insights */
  keyInsights: string[];
  /** Pressing intensity (0-100) */
  pressingIntensity?: {
    home: number;
    away: number;
  };
  /** Build-up style */
  buildUpStyle?: {
    home: "short" | "long" | "mixed";
    away: "short" | "long" | "mixed";
  };
  /** Formation timeline over the match (optional) */
  formationTimeline?: FormationTimeline;
  /** Half-by-half formation analysis (optional) */
  formationByHalf?: FormationHalfComparison;
  /** Phase-based formation analysis (attacking/defending/transition) (optional) */
  formationByPhase?: FormationByPhase;
  createdAt: string;
};

/**
 * Key moment in the match
 */
export type KeyMoment = {
  timestamp: number;
  description: string;
  importance: number;
  type?: "goal" | "chance" | "save" | "foul" | "substitution" | "tactical_change" | "other";
  /** Reference to clip document for video playback */
  clipId?: string | null;
};

/**
 * Player highlight
 */
export type PlayerHighlight = {
  player: string;
  jerseyNumber?: number;
  team: "home" | "away";
  achievement: string;
  metric?: {
    name: string;
    value: number | string;
  };
};

/**
 * Match summary document
 * Firestore: matches/{matchId}/summary/current
 * For half-based analysis: matches/{matchId}/summary/{videoId}_current
 */
export type MatchSummaryDoc = {
  matchId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  /** Processing version */
  version: string;
  /** Main headline */
  headline: string;
  /** Match narrative */
  narrative: {
    firstHalf: string;
    secondHalf: string;
    overall?: string;
  };
  /** Key moments in the match */
  keyMoments: KeyMoment[];
  /** Outstanding player performances */
  playerHighlights: PlayerHighlight[];
  /** Final score (if detected) */
  score?: {
    home: number;
    away: number;
  };
  /** Match MVP suggestion */
  mvp?: PlayerHighlight;
  /** Tags for the match */
  tags?: string[];
  createdAt: string;
};

/**
 * Gemini tactical analysis response schema
 */
export type GeminiTacticalResponse = {
  formation: {
    home: string;
    away: string;
  };
  tempo: {
    home: number;
    away: number;
  };
  attackPatterns: string[];
  defensivePatterns: string[];
  keyInsights: string[];
  pressingIntensity?: {
    home: number;
    away: number;
  };
  buildUpStyle?: {
    home: "short" | "long" | "mixed";
    away: "short" | "long" | "mixed";
  };
};

/**
 * Gemini match summary response schema
 */
export type GeminiSummaryResponse = {
  headline: string;
  narrative: {
    firstHalf: string;
    secondHalf: string;
    overall?: string;
  };
  keyMoments: Array<{
    timestamp: number;
    description: string;
    importance: number;
    type?: string;
  }>;
  playerHighlights: Array<{
    player: string;
    jerseyNumber?: number;
    team: "home" | "away";
    achievement: string;
  }>;
  score?: {
    home: number;
    away: number;
  };
  mvp?: {
    player: string;
    team: "home" | "away";
    achievement: string;
  };
};
