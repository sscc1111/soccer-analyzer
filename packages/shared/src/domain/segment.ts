/**
 * Video Segment Types for Multi-pass Analysis
 */

export type SegmentType =
  | "active_play"
  | "stoppage"
  | "set_piece"
  | "goal_moment"
  | "replay";

export type SetPieceSubtype =
  | "corner"
  | "free_kick"
  | "penalty"
  | "goal_kick"
  | "throw_in"
  | "kick_off";

export interface VideoSegment {
  segmentId: string;
  matchId: string;
  startSec: number;
  endSec: number;
  type: SegmentType;
  subtype?: SetPieceSubtype | string;
  description: string;
  attackingTeam?: "home" | "away" | null;
  importance: number; // 0.0-1.0
  confidence: number; // 0.0-1.0
  version: string;
  createdAt: string;
}

export interface AnalysisWindow {
  windowId: string;
  absoluteStart: number;
  absoluteEnd: number;
  overlap: {
    before: number;
    after: number;
  };
  targetFps: number;
  segmentType: SegmentType;
  segmentId?: string;
}

export interface WindowConfig {
  defaultWindowSizeSec: number;  // Default: 60
  overlapSec: number;            // Default: 15
  maxParallel: number;           // Default: 5
  fpsMap: Record<SegmentType, number>;
}

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  defaultWindowSizeSec: 60,
  overlapSec: 15,
  maxParallel: 5,
  fpsMap: {
    active_play: 3,
    set_piece: 2,
    goal_moment: 5,
    stoppage: 1,
    replay: 1,
  },
};
