export type ClipDoc = {
  clipId: string;
  shotId: string;
  /** Video ID for split video support (firstHalf/secondHalf/single) */
  videoId?: string;
  t0: number;
  t1: number;
  reason: "motionPeak" | "audioPeak" | "manual" | "other";
  media: { clipPath: string; thumbPath?: string };
  /** Analysis version this clip belongs to */
  version?: string;
  gemini?: {
    model: string;
    promptVersion: string;
    label: string;
    confidence: number;
    title?: string;
    summary?: string;
    tags?: string[];
    coachTips?: string[];
    rawResponse?: string;
    rawOriginalResponse?: string | null;
    createdAt: string;
  } | null;
  /** Whether this clip was merged from first and second half */
  mergedFromHalves?: boolean;
};
