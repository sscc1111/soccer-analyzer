/**
 * Gemini-first Architecture: Scene extraction types
 *
 * 重要シーン抽出の型定義
 * Firestore: matches/{matchId}/importantScenes/{sceneId}
 */

/**
 * Scene types detected by Gemini
 */
export type SceneType =
  | "shot"
  | "chance"
  | "setPiece"
  | "dribble"
  | "defense"
  | "turnover"
  | "goal"
  | "save"
  | "other";

/**
 * Team identifier for scene attribution
 */
export type SceneTeam = "home" | "away" | "unknown";

/**
 * Important scene document extracted by Gemini
 * Firestore: matches/{matchId}/importantScenes/{sceneId}
 */
export type ImportantSceneDoc = {
  sceneId: string;
  matchId: string;
  /** Start time in seconds */
  startSec: number;
  /** End time in seconds */
  endSec: number;
  /** Scene type */
  type: SceneType;
  /** Importance score (0-1) */
  importance: number;
  /** Gemini-generated description */
  description: string;
  /** Which team is involved */
  team?: SceneTeam;
  /** Gemini confidence score (0-1) */
  confidence?: number;
  /** Additional tags */
  tags?: string[];
  /** Processing version */
  version: string;
  createdAt: string;
};

/**
 * Scene extraction result from Gemini
 */
export type SceneExtractionResult = {
  scenes: Array<{
    startSec: number;
    endSec: number;
    type: SceneType;
    importance: number;
    description: string;
    team?: SceneTeam;
    confidence?: number;
    tags?: string[];
  }>;
};
