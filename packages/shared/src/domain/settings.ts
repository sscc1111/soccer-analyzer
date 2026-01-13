import type { GameFormat } from "./match";

/**
 * Default settings stored in AsyncStorage (and optionally Firestore)
 * Used to pre-populate new matches with team defaults
 */
export type DefaultSettings = {
  /** Default game format (11v11, 8v8, 5v5) */
  gameFormat?: GameFormat;
  teamColors?: {
    home?: string;
    away?: string;
  };
  formation?: {
    shape?: string;
  };
  roster?: Array<{
    jerseyNo: number;
    name?: string;
  }>;
};

/**
 * Roster item for player registration
 */
export type RosterItem = {
  jerseyNo: number;
  name?: string;
};
