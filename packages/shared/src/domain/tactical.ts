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
 * Tactical analysis document
 * Firestore: matches/{matchId}/tactical/current
 */
export type TacticalAnalysisDoc = {
  matchId: string;
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
 */
export type MatchSummaryDoc = {
  matchId: string;
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
