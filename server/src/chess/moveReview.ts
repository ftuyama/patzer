// "That wasn't the move — here is what it was worth."
//
// Both trainers (Train → From your games and Train → Puzzles) check a try
// against the solution, and when it isn't the answer they tell the player how
// good it actually was instead of only saying "no": the eval after the move
// plus the chess.com-style classification. A move is scored exactly like Game
// Review scores one — win-percentage drop against the move the puzzle wanted,
// with the same centipawn-loss guard (classifier.ts).
//
// The engine only ever *evaluates*; the maths is the classifier's, so a
// trainer verdict and the review of the same move agree.

import { Chess } from 'chess.js';
import { z } from 'zod';
import { classifyByWpDrop, cpLossForPly, cpToWinPct, normalizeEval } from './classifier.js';
import { createAnalysisEngine } from './engine.js';
import type { Classification } from '../types.js';

/** Within this many winning-chance points of the solution a different move
 *  counts as just as good — nobody is told a good move is wrong. */
export const ALT_MAX_DROP = 2;
export const REVIEW_DEPTH = 14;

/** A UCI move as the board sends it (a promotion may leave out its piece). */
export const uciSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/i);

/** What one move did to the position, next to the mover's view of it. */
interface SideEval {
  /** White-perspective centipawns after the move (±~10000 for a mate). */
  whiteCp: number;
  /** Mate-in-N after the move, white perspective (positive = white mates). */
  mate: number | null;
  /** The same score from the side that played the move. */
  cpForMover: number;
  /** The mover's winning chances, 0–100. */
  winForMover: number;
}

export interface TriedMoveEval {
  /** The move you tried, in SAN ("Nd5"). */
  san: string;
  /** White-perspective eval after it (cp; ±~10000 when it is mate). */
  cp: number;
  /** Mate-in-N after it, white perspective. */
  mate: number | null;
  /** Centipawns given up against the solution's move. */
  cp_loss: number;
  /** Winning chances given up against the solution's move (0–100 points). */
  win_drop: number;
  classification: Classification;
}

export interface TryReview {
  /** The try is (as good as) the solution. */
  ok: boolean;
  /** Only when it isn't: what the move was worth. */
  evaluation: TriedMoveEval | null;
}

/** An engine score as the mover saw it. `sideToMove` is the side to move in
 *  the position the score belongs to — i.e. the opponent, after the try. */
export function sideEvalFrom(
  cp: number | null,
  mate: number | null,
  sideToMove: 'w' | 'b',
  mover: 'w' | 'b',
): SideEval {
  const whiteCp = normalizeEval(cp, mate, sideToMove);
  const cpForMover = mover === 'w' ? whiteCp : -whiteCp;
  return {
    whiteCp,
    // Stockfish's mate score is for the side to move; flip it for white.
    mate: mate === null ? null : sideToMove === 'w' ? mate : -mate,
    cpForMover,
    winForMover: cpToWinPct(cpForMover),
  };
}

/** Terminal positions have no engine score to wait for: a mate delivered is
 *  worth everything, a stalemate/draw nothing. */
function terminalSide(chess: Chess, mover: 'w' | 'b'): SideEval | null {
  if (!chess.isGameOver()) return null;
  const matedIsWhite = chess.isCheckmate() && chess.turn() === 'w';
  const whiteCp = chess.isCheckmate() ? (matedIsWhite ? -9990 : 9990) : 0;
  const cpForMover = mover === 'w' ? whiteCp : -whiteCp;
  return {
    whiteCp,
    mate: chess.isCheckmate() ? (matedIsWhite ? -1 : 1) : null,
    cpForMover,
    winForMover: cpToWinPct(cpForMover),
  };
}

/** Score a try against the move the puzzle wanted. Pure — the route passes in
 *  the two engine scores (or the test passes fakes). */
export function classifyAgainstSolution(want: SideEval, alt: SideEval): { cp_loss: number; win_drop: number; classification: Classification } {
  const winDrop = Math.max(0, want.winForMover - alt.winForMover);
  const cpLoss = cpLossForPly(want.cpForMover, alt.cpForMover);
  return { cp_loss: cpLoss, win_drop: winDrop, classification: classifyByWpDrop(winDrop, cpLoss, false) };
}

/**
 * Evaluate `uci` in `fen`, where `bestUci` was the answer. `null` when one of
 * the moves isn't legal there. Throws when no engine is available.
 */
export async function reviewTry(args: {
  fen: string;
  uci: string;
  bestUci: string;
  depth?: number;
  /** Test seam: stands in for Stockfish. */
  evaluate?: (fen: string) => Promise<{ cp: number | null; mate: number | null }>;
}): Promise<TryReview | null> {
  const start = new Chess(args.fen);
  const mover = start.turn();
  const play = (chess: Chess, uci: string) =>
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });

  const want = new Chess(start.fen());
  const alt = new Chess(start.fen());
  let altMove;
  try {
    play(want, args.bestUci);
    altMove = play(alt, args.uci);
  } catch {
    return null;
  }

  const depth = args.depth ?? REVIEW_DEPTH;
  const engine = args.evaluate ? null : createAnalysisEngine();
  const evaluate = args.evaluate ?? (async (fen: string) => {
    const e = await engine!.evaluateMulti(fen, depth, 1);
    return { cp: e.cp, mate: e.mate };
  });

  try {
    if (engine) {
      await engine.start();
      await engine.setOption('Threads', '2');
      await engine.setOption('Hash', '64');
    }
    const score = async (chess: Chess): Promise<SideEval> => {
      const terminal = terminalSide(chess, mover);
      if (terminal) return terminal;
      const e = await evaluate(chess.fen());
      return sideEvalFrom(e.cp, e.mate, chess.turn(), mover);
    };
    // The wanted move first: it is the yardstick the try is measured against.
    const wantSide = await score(want);
    const altSide = await score(alt);
    const { cp_loss, win_drop, classification } = classifyAgainstSolution(wantSide, altSide);
    const ok = win_drop < ALT_MAX_DROP;
    return {
      ok,
      evaluation: ok ? null : {
        san: altMove.san,
        cp: altSide.whiteCp,
        mate: altSide.mate,
        cp_loss,
        win_drop,
        classification,
      },
    };
  } finally {
    if (engine) await engine.quit().catch(() => { /* nothing left to save */ });
  }
}
