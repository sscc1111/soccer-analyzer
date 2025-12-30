export type EventLabel = "shot" | "chance" | "setPiece" | "dribble" | "defense" | "other";

export type EventDoc = {
  eventId: string;
  clipId: string;
  label: EventLabel;
  confidence: number;
  title?: string;
  summary?: string;
  involved?: {
    players?: { playerId: string; confidence: number }[];
  };
  source: "gemini" | "manual" | "hybrid";
  createdAt: string;
};
