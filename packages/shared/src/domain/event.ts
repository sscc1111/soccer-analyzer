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

// Multi-pass analysis types

export type EventZone = "defensive_third" | "middle_third" | "attacking_third";

export interface RawEvent {
  eventId: string;
  matchId: string;
  windowId: string;
  type: "pass" | "carry" | "turnover" | "shot" | "setPiece";
  timestamp: number;
  team: "home" | "away";
  player?: string;
  zone?: EventZone;
  details?: Record<string, unknown>;
  confidence: number;
  visualEvidence?: string;
  version: string;
}

export interface DeduplicatedEvent extends Omit<RawEvent, 'windowId'> {
  mergedFromWindows: string[];
  originalTimestamps: number[];
  adjustedConfidence: number;
  verified?: boolean;
  verifiedAt?: string;
}

// Extend existing event types with new fields
export interface EventVerificationInfo {
  verified: boolean;
  verifiedAt: string;
  originalConfidence: number;
  verificationReasoning?: string;
}
