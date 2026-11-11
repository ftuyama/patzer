// The score of one position, the way the eval bar draws it.
//
// /api/analyze/position returns Stockfish's score from the side to move's
// point of view (its own convention). The bar, and every eval stored in an
// analysis (`eval_before_cp`), is white's point of view — so Black to move
// flips the sign. Keeping the flip in one place stops the bar from pointing
// the wrong way when you train as Black.

import { Chess } from 'chess.js';

/** One line of POST /api/analyze/position. */
export interface EngineLine {
  cp: number | null;
  mate: number | null;
}

/** A score in white's point of view: mate-in-N, or centipawns. */
export interface WhiteEval {
  cp: number | null;
  mate: number | null;
}

/** `line` from an engine answer for `fen`, as white's score. Null when there is
 *  nothing to show (no answer yet, or a FEN chess.js cannot read). */
export function whitePovEval(fen: string, line: EngineLine | null | undefined): WhiteEval | null {
  if (!line) return null;
  let turn: 'w' | 'b';
  try {
    turn = new Chess(fen).turn();
  } catch {
    return null;
  }
  const sign = turn === 'w' ? 1 : -1;
  if (line.mate != null) return { cp: null, mate: sign * line.mate };
  if (line.cp == null) return null;
  return { cp: sign * line.cp, mate: null };
}
