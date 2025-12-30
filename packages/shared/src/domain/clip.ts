export type ClipDoc = {
  clipId: string;
  shotId: string;
  t0: number;
  t1: number;
  reason: "motionPeak" | "audioPeak" | "manual" | "other";
  media: { clipPath: string; thumbPath?: string };
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
};
