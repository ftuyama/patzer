import { describe, expect, it } from 'vitest';
import { whitePovEval } from './positionEval';

const WHITE_TO_MOVE = '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 12';
const BLACK_TO_MOVE = '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 b - - 0 12';

describe('the eval bar’s score', () => {
  it('is white’s own score when White is to move', () => {
    expect(whitePovEval(WHITE_TO_MOVE, { cp: 125, mate: null })).toEqual({ cp: 125, mate: null });
  });

  it('flips the engine’s score when Black is to move', () => {
    // Stockfish says +120 for Black: that is −120 for White.
    expect(whitePovEval(BLACK_TO_MOVE, { cp: 120, mate: null })).toEqual({ cp: -120, mate: null });
  });

  it('flips mate-in-N the same way', () => {
    expect(whitePovEval(BLACK_TO_MOVE, { cp: null, mate: 3 })).toEqual({ cp: null, mate: -3 });
    expect(whitePovEval(WHITE_TO_MOVE, { cp: null, mate: 2 })).toEqual({ cp: null, mate: 2 });
  });

  it('shows nothing before the engine answers', () => {
    expect(whitePovEval(WHITE_TO_MOVE, null)).toBeNull();
    expect(whitePovEval(WHITE_TO_MOVE, undefined)).toBeNull();
  });

  it('shows nothing for a line without a score, or a FEN it cannot read', () => {
    expect(whitePovEval(WHITE_TO_MOVE, { cp: null, mate: null })).toBeNull();
    expect(whitePovEval('not a fen', { cp: 10, mate: null })).toBeNull();
  });
});
