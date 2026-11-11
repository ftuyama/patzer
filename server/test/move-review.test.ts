import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';

// moveReview imports engine.ts → db.ts, which opens the database on import.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'patzer-movereview-')), 'move-review.db');

type Module = typeof import('../src/chess/moveReview.js');
let moveReview: Module;

beforeAll(async () => {
  moveReview = await import('../src/chess/moveReview.js');
});

const fenAfter = (uci: string, fen = new Chess().fen()) => {
  const chess = new Chess(fen);
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
  return chess.fen();
};

describe('scoring a try against the solution', () => {
  it('counts a different move that is just as good as solved', () => {
    // Both positions are a black-to-move score of roughly half a pawn for
    // white: a third of a win-point between them.
    const want = moveReview.sideEvalFrom(-30, null, 'b', 'w');
    const alt = moveReview.sideEvalFrom(-20, null, 'b', 'w');
    const scored = moveReview.classifyAgainstSolution(want, alt);
    expect(scored).toMatchObject({ classification: 'excellent', cp_loss: 10 });
    expect(scored.win_drop).toBeLessThan(moveReview.ALT_MAX_DROP);
  });

  it('drops the eval when the move flips the position, and says how much', () => {
    const want = moveReview.sideEvalFrom(-30, null, 'b', 'w');
    const alt = moveReview.sideEvalFrom(400, null, 'b', 'w');
    const scored = moveReview.classifyAgainstSolution(want, alt);
    expect(scored.classification).toBe('blunder');
    expect(scored.cp_loss).toBe(430);
    expect(scored.win_drop).toBeGreaterThan(20);
  });

  it('reads the engine score from the mover’s side and keeps white for the bar', () => {
    // Black moved; the engine (to move: white) says +1.0 for white.
    const asBlack = moveReview.sideEvalFrom(100, null, 'w', 'b');
    expect(asBlack.cpForMover).toBe(-100);
    expect(asBlack.whiteCp).toBe(100);
    // …and the mate score flips with the side to move too.
    expect(moveReview.sideEvalFrom(null, 3, 'b', 'w').mate).toBe(-3);
    expect(moveReview.sideEvalFrom(null, 3, 'w', 'w').mate).toBe(3);
  });
});

describe('reviewTry', () => {
  it('returns the score and classification of a wrong try', async () => {
    const best = fenAfter('e2e4');
    const bad = fenAfter('a2a3');
    const review = await moveReview.reviewTry({
      fen: new Chess().fen(),
      uci: 'a2a3',
      bestUci: 'e2e4',
      // After white’s move it is black to move: these are black’s scores.
      evaluate: async (fen) => ({ cp: fen === best ? -30 : fen === bad ? 400 : 0, mate: null }),
    });
    expect(review).not.toBeNull();
    expect(review!.ok).toBe(false);
    expect(review!.evaluation).toMatchObject({ san: 'a3', cp: -400, cp_loss: 430, classification: 'blunder' });
  });

  it('leaves the evaluation off when the try is fine', async () => {
    const best = fenAfter('e2e4');
    const alt = fenAfter('d2d4');
    const review = await moveReview.reviewTry({
      fen: new Chess().fen(),
      uci: 'd2d4',
      bestUci: 'e2e4',
      evaluate: async (fen) => ({ cp: fen === best ? -25 : fen === alt ? -20 : 0, mate: null }),
    });
    expect(review).toEqual({ ok: true, evaluation: null });
  });

  it('scores a missed mate without asking the engine about a mate', async () => {
    // Scholar's mate is on the board: Qxf7#. Anything else throws the win away.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const review = await moveReview.reviewTry({
      fen,
      uci: 'a2a3',
      bestUci: 'f3f7',
      evaluate: async () => ({ cp: -50, mate: null }),
    });
    expect(review!.ok).toBe(false);
    expect(review!.evaluation).toMatchObject({ cp_loss: 1000, classification: 'blunder' });
  });

  it('accepts a different checkmate as the answer', async () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const review = await moveReview.reviewTry({
      fen,
      uci: 'f3f7',
      bestUci: 'f3f7',
      evaluate: async () => ({ cp: 0, mate: null }),
    });
    expect(review!.ok).toBe(true);
  });

  it('is null for a move that isn’t legal there', async () => {
    const review = await moveReview.reviewTry({
      fen: new Chess().fen(),
      uci: 'a1a8',
      bestUci: 'e2e4',
      evaluate: async () => ({ cp: 0, mate: null }),
    });
    expect(review).toBeNull();
  });
});
