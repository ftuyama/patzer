// The score of a wrong try in the trainer, the way the card shows it: the
// engine's eval from the player's own side, plus what the move gave up.

export interface TriedMoveEval {
  /** The move you tried, in SAN ("Nd5"). */
  san: string;
  /** White-perspective centipawns after it (±~10000 when it is mate). */
  cp: number;
  /** Mate-in-N after it, white perspective (positive = white mates). */
  mate: number | null;
  /** Centipawns given up against the solution's move. */
  cp_loss: number;
  /** Winning chances given up against the solution's move (0–100 points). */
  win_drop: number;
  classification: string;
}

/** Stockfish's mate threshold (see server/src/chess/classifier.ts). */
const MATE_CP = 9000;

/** "+0.8" / "−1.2" / "M3" / "−M2", from `side`'s point of view — the trainer
 *  shows the score the player cares about, not white's. */
export function formatTryEval(cp: number, mate: number | null, side: 'white' | 'black'): string {
  const sign = side === 'white' ? 1 : -1;
  if (mate != null) {
    const m = mate * sign;
    return m >= 0 ? `M${m}` : `−M${-m}`;
  }
  const value = cp * sign;
  if (Math.abs(value) >= MATE_CP) return value > 0 ? '#' : '−#';
  const pawns = Math.abs(value) / 100;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${pawns.toFixed(1)}`;
}
