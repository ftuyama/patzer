import { describe, expect, it } from 'vitest';
import { formatTryEval } from './moveVerdict';

describe('the score shown for a wrong try', () => {
  it('is signed pawns from the player’s side', () => {
    expect(formatTryEval(80, null, 'white')).toBe('+0.8');
    expect(formatTryEval(80, null, 'black')).toBe('−0.8');
    expect(formatTryEval(-125, null, 'black')).toBe('+1.3');
    expect(formatTryEval(0, null, 'white')).toBe('0.0');
  });

  it('shows mate from the player’s side too', () => {
    // White mates in 3: bad news for black, good news for white.
    expect(formatTryEval(9990, 3, 'white')).toBe('M3');
    expect(formatTryEval(9990, 3, 'black')).toBe('−M3');
    // Black mates in 2 (white-perspective −2).
    expect(formatTryEval(-9990, -2, 'black')).toBe('M2');
  });

  it('falls back to # when the mate count is unknown', () => {
    expect(formatTryEval(9990, null, 'white')).toBe('#');
    expect(formatTryEval(-9990, null, 'black')).toBe('#');
    expect(formatTryEval(-9990, null, 'white')).toBe('−#');
  });
});
