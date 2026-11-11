// Types and helpers for "Your openings" (Openings → Trainer). The server
// aggregates the analysed games (server/src/chess/openingProfile.ts); this
// module only turns one leak into something the trainer can drill.

import type { DrillLine, Side } from './openingTrainer';

export interface OpeningLeak {
  /** SAN from the start up to (but not including) the costly move. */
  san_line: string[];
  ply: number;
  played_san: string;
  best_san: string | null;
  games: number;
  avg_cp_loss: number;
  /** The corrected line, already replayed server-side; empty when unusable. */
  drill: string[];
  example_game_id: number | null;
}

export interface OpeningProfileEntry {
  eco: string | null;
  name: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  accuracy: number | null;
  leaks: OpeningLeak[];
}

export interface OpeningProfile {
  games: number;
  openings: OpeningProfileEntry[];
}

export interface OpeningProfilePayload {
  window: number;
  white: OpeningProfile;
  black: OpeningProfile;
}

/** The drill for one leak, or null when the corrected line is not playable
 *  (an old analysis without a best move, or an engine move chess.js rejects). */
export function profileDrill(
  opening: OpeningProfileEntry,
  leak: OpeningLeak,
  color: Side,
  fallbackName: string,
): DrillLine | null {
  if (leak.drill.length === 0) return null;
  return {
    name: opening.name ?? fallbackName,
    eco: opening.eco,
    color,
    moves: leak.drill,
  };
}
