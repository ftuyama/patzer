// Bot tiers, kept out of the play socket so the setup cards and the in-game
// clock bars can show the same numbers the engine is configured with.
//
// `Skill Level` alone produces tiers that don't match their labels — at
// `Skill 3 / depth 4`, "Beginner" already plays around 1400 Elo, so a
// chess.com 800-rated kid picking "Easy" gets crushed. We drive tiers through
// `UCI_LimitStrength` + `UCI_Elo`, which targets a real rating instead of a
// search shape. The top two tiers turn the limiter off and play full strength.

import type { Difficulty } from '../types.js';
import type { StockfishEngine } from './stockfish.js';

export interface DifficultyConfig {
  /** When set, enables UCI_LimitStrength + UCI_Elo at this rating. */
  uciElo: number | null;
  /** Search depth — kept low for fast bot moves on weak tiers. */
  depth: number;
  /** Move time cap; combines with depth so a long search doesn't stall play. */
  movetimeMs: number;
  /**
   * The rating the UI shows next to the tier, or null for "maximum".
   * Stockfish's UCI_Elo floor is 1320, so tiers below it are weakened by the
   * depth cap rather than by the limiter — their number is a label for what
   * the depth-capped engine feels like, not the value sent to UCI.
   */
  elo: number | null;
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  kid:        { uciElo:  196, depth: 2,  movetimeMs: 192, elo:  196 },  // at the floor + depth 2 = many hung pieces, deliberately
  beginner:   { uciElo:  428, depth: 3,  movetimeMs: 294, elo:  428 },
  easy:       { uciElo:  724, depth: 5,  movetimeMs: 348, elo:  724 },
  medium:     { uciElo: 1240, depth: 8,  movetimeMs: 412, elo: 1240 },
  hard:       { uciElo: 1720, depth: 12, movetimeMs: 648, elo: 1720 },
  master:     { uciElo: 2480, depth: 16, movetimeMs: 924, elo: 2480 },
  stockfish:  { uciElo: null, depth: 22, movetimeMs: 1280, elo: null }, // full strength, no rating cap
};

/** Display order of the tiers, weak to strong. */
export const DIFFICULTY_ORDER: Difficulty[] = ['kid', 'beginner', 'easy', 'medium', 'hard', 'master', 'stockfish'];

/** What GET /api/play/bots returns, and what the setup cards render. */
export const BOT_LEVELS = DIFFICULTY_ORDER.map((difficulty) => ({
  difficulty,
  elo: DIFFICULTY[difficulty].elo,
}));

export async function applyDifficulty(engine: StockfishEngine, conf: DifficultyConfig): Promise<void> {
  if (conf.uciElo !== null) {
    await engine.setOption('UCI_LimitStrength', 'true');
    await engine.setOption('UCI_Elo', conf.uciElo);
  } else {
    await engine.setOption('UCI_LimitStrength', 'false');
  }
}
