/**
 * Game format (number of players per team)
 */
export type GameFormat = "eleven" | "eight" | "five";

/**
 * Match duration configuration
 */
export type MatchDuration = {
  /** Duration of each half in minutes */
  halfDuration: number;
  /** Number of halves (typically 2, could be 4 with extra time) */
  numberOfHalves: number;
  /** Whether extra time is included */
  extraTime?: boolean;
};

/**
 * Field size in meters
 */
export type FieldSize = {
  /** Length of the field in meters */
  length: number;
  /** Width of the field in meters */
  width: number;
};

/**
 * Processing mode for analysis pipeline
 */
export type ProcessingMode = "quick" | "standard" | "detailed";

/**
 * Processing configuration for each mode
 */
export type ProcessingConfig = {
  /** Frames per second to analyze */
  fps: number;
  /** Whether GPU is required */
  gpuRequired: boolean;
  /** Estimated processing time in minutes based on video duration */
  estimatedMinutes: (durationSec: number) => number;
};

/**
 * Processing mode display information
 */
export type ProcessingModeInfo = {
  label: string;
  labelJa: string;
  description: string;
  descriptionJa: string;
  fps: number;
  accuracy: string;
  accuracyJa: string;
  estimatedMultiplier: number;
  gpuRequired: boolean;
};

/**
 * Default processing configurations per mode
 */
export const PROCESSING_CONFIGS: Record<ProcessingMode, Omit<ProcessingConfig, "estimatedMinutes"> & { estimatedMultiplier: number }> = {
  quick: { fps: 1, gpuRequired: false, estimatedMultiplier: 0.1 },
  standard: { fps: 3, gpuRequired: true, estimatedMultiplier: 0.3 },
  detailed: { fps: 5, gpuRequired: true, estimatedMultiplier: 0.5 },
};

/**
 * Processing mode information for display
 */
export const PROCESSING_MODE_INFO: Record<ProcessingMode, ProcessingModeInfo> = {
  quick: {
    label: "Quick",
    labelJa: "クイック",
    description: "Fast analysis for quick reviews",
    descriptionJa: "試合直後の速報確認向け",
    fps: 1,
    accuracy: "~70% accuracy",
    accuracyJa: "約70%精度",
    estimatedMultiplier: 0.1,
    gpuRequired: false,
  },
  standard: {
    label: "Standard",
    labelJa: "標準",
    description: "Balanced speed and accuracy",
    descriptionJa: "通常の振り返り向け",
    fps: 3,
    accuracy: "~85% accuracy",
    accuracyJa: "約85%精度",
    estimatedMultiplier: 0.3,
    gpuRequired: true,
  },
  detailed: {
    label: "Detailed",
    labelJa: "詳細",
    description: "High accuracy for in-depth analysis",
    descriptionJa: "詳細分析向け",
    fps: 5,
    accuracy: "~95% accuracy",
    accuracyJa: "約95%精度",
    estimatedMultiplier: 0.5,
    gpuRequired: true,
  },
};

/**
 * Calculate estimated processing time in minutes
 * @param durationSec - Video duration in seconds
 * @param mode - Processing mode
 * @returns Estimated processing time in minutes
 */
export function estimateProcessingTime(durationSec: number, mode: ProcessingMode): number {
  const config = PROCESSING_CONFIGS[mode];
  return Math.ceil((durationSec / 60) * config.estimatedMultiplier);
}

/**
 * Format estimated time as human-readable string
 * @param minutes - Estimated time in minutes
 * @param locale - Language locale (ja or en)
 * @returns Formatted time string
 */
export function formatEstimatedTime(minutes: number, locale: "ja" | "en" = "en"): string {
  if (minutes < 1) {
    return locale === "ja" ? "1分未満" : "< 1 min";
  }
  if (minutes < 60) {
    return locale === "ja" ? `約${minutes}分` : `~${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return locale === "ja" ? `約${hours}時間` : `~${hours} hr`;
  }
  return locale === "ja" ? `約${hours}時間${mins}分` : `~${hours}h ${mins}m`;
}

/**
 * Default field sizes for each game format
 */
export const DEFAULT_FIELD_SIZES: Record<GameFormat, FieldSize> = {
  eleven: { length: 105, width: 68 },
  eight: { length: 68, width: 50 },
  five: { length: 40, width: 20 },
};

/**
 * Default match durations for each game format
 */
export const DEFAULT_MATCH_DURATIONS: Record<GameFormat, MatchDuration> = {
  eleven: { halfDuration: 45, numberOfHalves: 2 },
  eight: { halfDuration: 15, numberOfHalves: 2 },
  five: { halfDuration: 10, numberOfHalves: 2 },
};

/**
 * Formation options for each game format
 * 11v11: 10 outfield players (excludes GK)
 * 8v8: 7 outfield players
 * 5v5: 4 outfield players
 */
export const FORMATIONS_BY_FORMAT: Record<GameFormat, string[]> = {
  eleven: ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2", "3-4-3", "4-1-4-1", "5-4-1"],
  eight: ["3-3-1", "2-3-2", "2-4-1", "3-2-2", "2-2-3", "1-3-3", "1-4-2"],
  five: ["2-2", "1-2-1", "2-1-1", "1-1-2", "3-1", "1-3"],
};

/**
 * Game format display information
 */
export type GameFormatInfo = {
  label: string;
  labelJa: string;
  players: number;
  outfieldPlayers: number;
};

export const GAME_FORMAT_INFO: Record<GameFormat, GameFormatInfo> = {
  eleven: { label: "11 vs 11", labelJa: "11人制", players: 22, outfieldPlayers: 10 },
  eight: { label: "8 vs 8", labelJa: "8人制", players: 16, outfieldPlayers: 7 },
  five: { label: "5 vs 5", labelJa: "5人制", players: 10, outfieldPlayers: 4 },
};

/** Attack direction setting */
export type AttackDirection = "LTR" | "RTL";

export type MatchSettings = {
  attackDirection?: AttackDirection | null;
  relabelOnChange?: boolean;
  camera?: {
    position?: "sideline" | "goalLine" | "corner" | "other" | null;
    x?: number; // 0..1
    y?: number; // 0..1
    headingDeg?: number; // 0..360
    zoomHint?: "near" | "mid" | "far" | null;
  } | null;
  teamColors?: { home?: string | null; away?: string | null } | null;
  formation?: {
    shape?: string | null;
    assignments?: { jerseyNo: number; role?: string; slot?: { x: number; y: number } }[];
  } | null;
  /** Game format (11v11, 8v8, 5v5) */
  gameFormat?: GameFormat | null;
  /** Match duration configuration */
  matchDuration?: MatchDuration | null;
  /** Field size (auto-set based on gameFormat, or custom) */
  fieldSize?: FieldSize | null;
  /** Processing mode for analysis */
  processingMode?: ProcessingMode | null;
};

/**
 * Analysis step identifiers
 */
export type AnalysisStep =
  | "extract_meta"
  | "detect_shots"
  | "upload_video_to_gemini"
  | "extract_clips"
  | "extract_important_scenes"
  | "label_clips"
  | "build_events"
  | "detect_events_gemini"
  | "identify_players_gemini"
  | "detect_players"
  | "classify_teams"
  | "detect_ball"
  | "detect_events"
  | "compute_stats"
  | "generate_tactical_insights"
  | "generate_match_summary"
  | "done";

/**
 * Step display information
 */
export const ANALYSIS_STEP_INFO: Record<AnalysisStep, { label: string; labelJa: string }> = {
  extract_meta: { label: "Extracting metadata", labelJa: "メタデータ抽出中" },
  detect_shots: { label: "Detecting shots", labelJa: "シーン検出中" },
  upload_video_to_gemini: { label: "Uploading video to Gemini", labelJa: "動画をGeminiにアップロード中" },
  extract_clips: { label: "Extracting clips", labelJa: "クリップ抽出中" },
  extract_important_scenes: { label: "Extracting important scenes", labelJa: "重要シーン抽出中" },
  label_clips: { label: "Labeling clips", labelJa: "クリップラベリング中" },
  build_events: { label: "Building events", labelJa: "イベント構築中" },
  detect_events_gemini: { label: "Detecting events with Gemini", labelJa: "Geminiでイベント検出中" },
  identify_players_gemini: { label: "Identifying players with Gemini", labelJa: "Geminiで選手識別中" },
  detect_players: { label: "Detecting players", labelJa: "選手検出中" },
  classify_teams: { label: "Classifying teams", labelJa: "チーム分類中" },
  detect_ball: { label: "Detecting ball", labelJa: "ボール検出中" },
  detect_events: { label: "Detecting events", labelJa: "イベント検出中" },
  compute_stats: { label: "Computing stats", labelJa: "スタッツ計算中" },
  generate_tactical_insights: { label: "Generating tactical insights", labelJa: "タクティカル分析生成中" },
  generate_match_summary: { label: "Generating match summary", labelJa: "試合サマリー生成中" },
  done: { label: "Done", labelJa: "完了" },
};

/**
 * Detailed progress information for analysis
 */
export type AnalysisProgress = {
  /** Current step being processed */
  currentStep: AnalysisStep;
  /** Overall progress (0-100) */
  overallProgress: number;
  /** Progress within current step (0-100) */
  stepProgress: number;
  /** Estimated seconds remaining (-1 if unknown) */
  estimatedSecondsRemaining: number;
  /** Timestamp when step started */
  stepStartedAt?: string;
  /** Additional step-specific details */
  stepDetails?: Record<string, unknown>;
};

export type MatchDoc = {
  matchId: string;
  ownerUid: string;
  teamId?: string | null;
  title?: string | null;
  date?: string | null; // ISO
  video?: {
    storagePath: string;
    durationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
    uploadedAt?: string;
  };
  settings?: MatchSettings;
  analysis?: {
    status: "idle" | "queued" | "running" | "partial" | "done" | "error";
    activeVersion?: string;
    lastRunAt?: string;
    /** Detailed progress information (only present during running status) */
    progress?: AnalysisProgress;
    /** Error message if status is "error" */
    errorMessage?: string;
    /** Flag to request stats recalculation after user corrections */
    needsRecalculation?: boolean;
    /** Timestamp when recalculation was requested */
    recalculationRequestedAt?: string;
    cost?: {
      estimatedUsd?: number;
      geminiCalls?: number;
      perClipUsd?: number;
      updatedAt?: string;
    };
  };
};
