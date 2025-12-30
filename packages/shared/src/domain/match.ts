export type MatchSettings = {
  attackDirection?: "LTR" | "RTL" | null;
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
    cost?: {
      estimatedUsd?: number;
      geminiCalls?: number;
      perClipUsd?: number;
      updatedAt?: string;
    };
  };
};
