import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, DIFFICULTY, DIFFICULTY_ORDER, applyDifficulty } from '../src/chess/botLevels.js';
import type { Difficulty } from '../src/types.js';

const ALL: Difficulty[] = ['kid', 'beginner', 'easy', 'medium', 'hard', 'master', 'stockfish'];

describe('bot levels', () => {
  it('lists every tier, once, weakest first', () => {
    expect(DIFFICULTY_ORDER).toEqual(ALL);
    expect(BOT_LEVELS.map((b) => b.difficulty)).toEqual(ALL);
  });

  it('shows a rising rating up to the uncapped tier', () => {
    const rated = BOT_LEVELS.filter((b): b is { difficulty: Difficulty; elo: number } => b.elo !== null);
    expect(rated).toHaveLength(ALL.length - 1);
    expect(rated.map((b) => b.elo)).toEqual([...rated.map((b) => b.elo)].sort((a, b) => a - b));
    // Only Stockfish (max) plays without a rating target.
    expect(BOT_LEVELS.at(-1)).toEqual({ difficulty: 'stockfish', elo: null });
  });

  it('caps every tier but the top one, and lets the top one play full strength', async () => {
    const calls: [string, string | number][] = [];
    const fake = { setOption: async (name: string, value: string | number) => { calls.push([name, value]); } };

    await applyDifficulty(fake as never, DIFFICULTY.medium);
    expect(calls).toEqual([['UCI_LimitStrength', 'true'], ['UCI_Elo', 1240]]);

    calls.length = 0;
    await applyDifficulty(fake as never, DIFFICULTY.stockfish);
    expect(calls).toEqual([['UCI_LimitStrength', 'false']]);
  });

  it('labels the tiers whose target sits below Stockfish’s UCI floor', () => {
    // UCI_Elo cannot go below 1320; the depth cap weakens those tiers, so the
    // label is what the player should trust, not the value sent to the engine.
    for (const d of ['kid', 'beginner', 'easy'] as const) {
      expect(DIFFICULTY[d].uciElo).toBeLessThan(1320);
      expect(DIFFICULTY[d].elo).toBe(DIFFICULTY[d].uciElo);
    }
  });
});
