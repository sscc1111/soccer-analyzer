/**
 * Default processing configurations per mode
 */
export const PROCESSING_CONFIGS = {
    quick: { fps: 1, gpuRequired: false, estimatedMultiplier: 0.1 },
    standard: { fps: 3, gpuRequired: true, estimatedMultiplier: 0.3 },
    detailed: { fps: 5, gpuRequired: true, estimatedMultiplier: 0.5 },
};
/**
 * Processing mode information for display
 */
export const PROCESSING_MODE_INFO = {
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
export function estimateProcessingTime(durationSec, mode) {
    const config = PROCESSING_CONFIGS[mode];
    return Math.ceil((durationSec / 60) * config.estimatedMultiplier);
}
/**
 * Format estimated time as human-readable string
 * @param minutes - Estimated time in minutes
 * @param locale - Language locale (ja or en)
 * @returns Formatted time string
 */
export function formatEstimatedTime(minutes, locale = "en") {
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
export const DEFAULT_FIELD_SIZES = {
    eleven: { length: 105, width: 68 },
    eight: { length: 68, width: 50 },
    five: { length: 40, width: 20 },
};
/**
 * Default match durations for each game format
 */
export const DEFAULT_MATCH_DURATIONS = {
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
export const FORMATIONS_BY_FORMAT = {
    eleven: ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2", "3-4-3", "4-1-4-1", "5-4-1"],
    eight: ["3-3-1", "2-3-2", "2-4-1", "3-2-2", "2-2-3", "1-3-3", "1-4-2"],
    five: ["2-2", "1-2-1", "2-1-1", "1-1-2", "3-1", "1-3"],
};
export const GAME_FORMAT_INFO = {
    eleven: { label: "11 vs 11", labelJa: "11人制", players: 22, outfieldPlayers: 10 },
    eight: { label: "8 vs 8", labelJa: "8人制", players: 16, outfieldPlayers: 7 },
    five: { label: "5 vs 5", labelJa: "5人制", players: 10, outfieldPlayers: 4 },
};
/**
 * Step display information
 */
export const ANALYSIS_STEP_INFO = {
    extract_meta: { label: "Extracting metadata", labelJa: "メタデータ抽出中" },
    detect_shots: { label: "Detecting shots", labelJa: "シーン検出中" },
    extract_clips: { label: "Extracting clips", labelJa: "クリップ抽出中" },
    label_clips: { label: "Labeling clips", labelJa: "クリップラベリング中" },
    build_events: { label: "Building events", labelJa: "イベント構築中" },
    detect_players: { label: "Detecting players", labelJa: "選手検出中" },
    classify_teams: { label: "Classifying teams", labelJa: "チーム分類中" },
    detect_ball: { label: "Detecting ball", labelJa: "ボール検出中" },
    detect_events: { label: "Detecting events", labelJa: "イベント検出中" },
    compute_stats: { label: "Computing stats", labelJa: "スタッツ計算中" },
    done: { label: "Done", labelJa: "完了" },
};
