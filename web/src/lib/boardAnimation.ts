// Piece-slide speed, as stored on the profile. The profile keeps the *name*
// ('off' | 'fast' | 'medium' | 'slow') rather than a duration so the values
// below can be tuned without touching the database or the settings schema.
import type { BoardAnimation } from '../state/auth';

export type { BoardAnimation };

export const BOARD_ANIMATIONS = ['off', 'fast', 'medium', 'slow'] as const;

// chessground silently drops animations shorter than 70ms, so 'fast' has to
// stay comfortably above that.
const MS: Record<BoardAnimation, number> = {
  off: 0,
  fast: 120,
  medium: 200,
  slow: 350,
};

/** Milliseconds to slide a moved piece for, or 0 to snap it into place. */
export function boardAnimationMs(pref: BoardAnimation | string | null | undefined): number {
  return pref && pref in MS ? MS[pref as BoardAnimation] : 0;
}
