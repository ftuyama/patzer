// Reading a player's Glicko rating for display. The play socket needs the
// same defaults and provisional rule the /api/ratings/me route uses; keeping
// them here means the in-game badge and the ratings page can't disagree.

import { db } from '../db.js';
import {
  GLICKO_DEFAULTS,
  PROVISIONAL_GAMES,
  PROVISIONAL_RD_THRESHOLD,
} from './glicko.js';
import type { TimeClass } from './timeClass.js';

export interface RatingRowDb {
  rating: number;
  rd: number;
  games_played: number;
  last_played_at: string | null;
}

/** The stored row, or the pool defaults for a player with no rated games. */
export function loadOrInitRating(userId: number, tc: TimeClass): RatingRowDb {
  const row = db.prepare(`SELECT rating, rd, games_played, last_played_at
                          FROM ratings WHERE user_id = ? AND time_class = ?`)
    .get(userId, tc) as RatingRowDb | undefined;
  if (row) return row;
  return { rating: GLICKO_DEFAULTS.rating, rd: GLICKO_DEFAULTS.rd, games_played: 0, last_played_at: null };
}

export interface RatingSnapshot {
  rating: number;
  /** True while the number is still an estimate: shown with a question mark. */
  provisional: boolean;
}

export function ratingSnapshot(userId: number, tc: TimeClass): RatingSnapshot {
  const row = loadOrInitRating(userId, tc);
  return {
    rating: Math.round(row.rating),
    provisional: row.rd >= PROVISIONAL_RD_THRESHOLD || row.games_played < PROVISIONAL_GAMES,
  };
}
