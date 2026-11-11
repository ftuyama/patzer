// Hand-labelled detection fixtures for `detectGamePatterns`.
//
// Each fixture is a short analysed move list from ONE player's point of view.
// `expected` is the exact set of motifs the detector should emit for the
// fixture's moves — no more, no less. Negative fixtures have `expected: []`
// and must produce no events at all.
//
// Rules for adding a fixture:
//   * every `fen_before` must be a legal position and `san` must be legal in it
//     (the loader replays it through chess.js and throws otherwise);
//   * `ply` parity must match `user_color` (odd = White, even = Black);
//   * evals are white-perspective centipawns, exactly like the DB stores them;
//     mate scores use `mate_before` / `mate_after` (positive = White mates);
//   * keep eval swings realistic — they drive severity, and severity drives
//     the ranking assertions in summary.test.ts;
//   * a fixture belongs in this file only once its labels have been reviewed
//     by hand. Known detector bugs live in detection-quality.test.ts as
//     `it.fails`, not here.
//
// See docs/patterns-quality.md for the measured precision/recall table.

import type { Classification } from '../../../src/types.js';
import type { PatternKey } from '../../../src/chess/patterns.js';

export interface FixtureMove {
  /** Position before the move, white-perspective FEN. */
  fen_before: string;
  /** SAN as played by the analysed player. */
  san: string;
  /** 1-based ply in the game; parity must match `user_color`. */
  ply: number;
  classification: Classification;
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  mate_before?: number | null;
  mate_after?: number | null;
  /** Stored centipawn loss for the move (from the mover's point of view). */
  centipawn_loss: number;
  best_move_san?: string | null;
}

export interface Fixture {
  id: string;
  description: string;
  user_color: 'white' | 'black';
  end_time: string | null;
  expected: PatternKey[];
  moves: FixtureMove[];
  /** When true the loader verifies the moves form one continuous game. */
  continuous?: boolean;
}

function mv(
  fen_before: string,
  san: string,
  ply: number,
  classification: Classification,
  eval_before_cp: number | null,
  eval_after_cp: number | null,
  centipawn_loss: number,
  mates: { mate_before?: number | null; mate_after?: number | null; best_move_san?: string | null } = {},
): FixtureMove {
  return {
    fen_before,
    san,
    ply,
    classification,
    eval_before_cp,
    eval_after_cp,
    centipawn_loss,
    ...mates,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Positive fixtures — one group per motif, at least two each.
// ─────────────────────────────────────────────────────────────────────────────

export const POSITIVE_FIXTURES: Fixture[] = [
  // ── hung_piece ─────────────────────────────────────────────────────────────
  {
    id: 'hung_piece_white_knight_to_pawn',
    description: 'White puts the d4 knight on b5 where the a6 pawn wins it.',
    user_color: 'white',
    end_time: '2026-10-01T10:00:00Z',
    expected: ['hung_piece'],
    moves: [mv('6k1/5ppp/p7/8/3N4/8/5PPP/1R4K1 w - - 0 1', 'Nb5', 21, 'mistake', 50, -200, 250)],
  },
  {
    id: 'hung_piece_black_knight_to_pawn',
    description: 'Black jumps the b5 knight to d4, where the c3 pawn wins it.',
    user_color: 'black',
    end_time: '2026-10-02T10:00:00Z',
    expected: ['hung_piece'],
    moves: [mv('1r4k1/5ppp/8/1n6/8/2P5/5PPP/R5K1 b - - 0 1', 'Nd4', 22, 'mistake', -50, 250, 300)],
  },
  {
    id: 'hung_piece_white_queen_to_knight',
    description: 'White walks the queen to d4 in front of the f5 knight.',
    user_color: 'white',
    end_time: '2026-10-03T10:00:00Z',
    expected: ['hung_piece'],
    moves: [mv('1r4k1/5ppp/8/5n2/8/8/5PPP/R2Q2K1 w - - 0 1', 'Qd4', 21, 'mistake', 100, -200, 300)],
  },

  // ── fork_exposed ───────────────────────────────────────────────────────────
  {
    id: 'fork_exposed_white_bishop_leaves_two_knights',
    description: 'The e3 bishop stops defending both c5 and g5; both fall.',
    user_color: 'white',
    end_time: '2026-10-04T10:00:00Z',
    expected: ['fork_exposed'],
    moves: [mv('6k1/5npp/8/2N3N1/1b6/4B3/5PPP/1R4K1 w - - 0 1', 'Bd2', 21, 'blunder', 100, -300, 300)],
  },
  {
    id: 'fork_exposed_black_bishop_leaves_two_knights',
    description: 'The e6 bishop abandons c4 and g4; both knights hang.',
    user_color: 'black',
    end_time: '2026-10-05T10:00:00Z',
    expected: ['fork_exposed'],
    moves: [mv('1r4k1/5ppp/4b3/1B6/2n3n1/8/PPPP1NPP/R5K1 b - - 0 1', 'Bd7', 22, 'blunder', -100, 200, 300)],
  },
  {
    id: 'fork_exposed_white_queen_leaves_rook_and_knight',
    description: 'Qa4 leaves the b1 rook and the h5 knight both en prise.',
    user_color: 'white',
    end_time: '2026-10-06T10:00:00Z',
    expected: ['fork_exposed'],
    moves: [mv('1r4k1/5ppp/5n2/5n1N/3N4/8/5PPP/1R1Q2K1 w - - 0 1', 'Qa4', 21, 'blunder', 100, -300, 300)],
  },

  // ── allowed_mate + back_rank ───────────────────────────────────────────────
  {
    id: 'allowed_mate_white_back_rank',
    description: 'White moves the b1 knight and allows Re1# on the empty back rank.',
    user_color: 'white',
    end_time: '2026-10-07T10:00:00Z',
    expected: ['allowed_mate', 'back_rank'],
    moves: [mv('4r1k1/5ppp/8/8/8/8/5PPP/1N4K1 w - - 0 1', 'Na3', 21, 'blunder', 0, null, 1000, { mate_after: -1, best_move_san: 'h3' })],
  },
  {
    id: 'allowed_mate_black_scholar',
    description: 'Black plays ...h6 and walks into Qxf7#.',
    user_color: 'black',
    end_time: '2026-10-08T10:00:00Z',
    expected: ['allowed_mate'],
    moves: [mv('3qk3/5ppp/8/7Q/2B5/8/PPPP1PPP/R5K1 b - - 0 1', 'h6', 22, 'blunder', 400, null, 1000, { mate_after: 1, best_move_san: 'g6' })],
  },
  {
    id: 'back_rank_black_rook_leaves_rank',
    description: 'Black moves the b8 rook to b7 and allows Re8# on the empty eighth rank.',
    user_color: 'black',
    end_time: '2026-10-09T10:00:00Z',
    expected: ['allowed_mate', 'back_rank'],
    moves: [mv('1r4k1/5ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1', 'Rb7', 22, 'blunder', 0, null, 1000, { mate_after: 1, best_move_san: 'h6' })],
  },

  // ── missed_win ─────────────────────────────────────────────────────────────
  {
    id: 'missed_win_white_queen_trade',
    description: 'White had +2 but trades into a drawn queen ending instead of pressing.',
    user_color: 'white',
    end_time: '2026-10-10T10:00:00Z',
    expected: ['missed_win'],
    moves: [mv('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'Qd3', 21, 'miss', 200, 20, 180, { best_move_san: 'Qd5' })],
  },
  {
    id: 'missed_win_black_queen_trade',
    description: 'Black had a winning game and lets the queen leave the active square.',
    user_color: 'black',
    end_time: '2026-10-11T10:00:00Z',
    expected: ['missed_win'],
    moves: [mv('3qk3/8/8/8/8/8/8/4K3 b - - 0 1', 'Qd6', 22, 'miss', -200, -20, 180, { best_move_san: 'Qh4' })],
  },
  {
    id: 'missed_win_back_rank_tactic',
    description: 'White had mate in two on the back rank and plays Qd3 instead.',
    user_color: 'white',
    end_time: '2026-10-12T10:00:00Z',
    expected: ['missed_win'],
    moves: [mv('3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 1', 'Qd3', 21, 'miss', 2000, 0, 900, { mate_before: 2, best_move_san: 'Qxd8+' })],
  },

  // ── opening_leak ───────────────────────────────────────────────────────────
  {
    id: 'opening_leak_white_h3',
    description: 'A slow h3 in the Italian, already a measurable concession.',
    user_color: 'white',
    end_time: '2026-10-13T10:00:00Z',
    expected: ['opening_leak'],
    moves: [mv('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 3', 'h3', 5, 'mistake', 30, -90, 120)],
  },
  {
    id: 'opening_leak_black_d6',
    description: 'Black plays a passive ...d6 in the Spanish and drops the initiative.',
    user_color: 'black',
    end_time: '2026-10-14T10:00:00Z',
    expected: ['opening_leak'],
    moves: [mv('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', 'd6', 6, 'mistake', 30, 150, 120)],
  },

  // ── endgame_drift ──────────────────────────────────────────────────────────
  {
    id: 'endgame_drift_white_king',
    description: 'White king steps to f3 and lets the black king in.',
    user_color: 'white',
    end_time: '2026-10-15T10:00:00Z',
    expected: ['endgame_drift'],
    moves: [mv('8/8/4k3/8/4P3/8/4K3/8 w - - 0 1', 'Kf3', 41, 'inaccuracy', 150, 0, 150)],
  },
  {
    id: 'endgame_drift_black_king',
    description: 'Black king steps to f6 and lets the white king in.',
    user_color: 'black',
    end_time: '2026-10-16T10:00:00Z',
    expected: ['endgame_drift'],
    moves: [mv('8/8/4k3/8/4P3/8/4K3/8 b - - 0 1', 'Kf6', 42, 'inaccuracy', -150, 0, 150)],
  },

  // ── promising_to_losing ────────────────────────────────────────────────────
  {
    id: 'promising_to_losing_white',
    description: 'White was clearly better and walks the queen into a losing ending.',
    user_color: 'white',
    end_time: '2026-10-17T10:00:00Z',
    expected: ['promising_to_losing'],
    moves: [mv('4k3/8/8/8/8/8/8/1R1QK3 w - - 0 1', 'Qd5', 21, 'blunder', 150, -60, 210)],
  },
  {
    id: 'promising_to_losing_black',
    description: 'Black was better, puts the knight on b3 and loses it: the eval flips.',
    user_color: 'black',
    end_time: '2026-10-18T10:00:00Z',
    expected: ['hung_piece', 'promising_to_losing'],
    moves: [mv('1r4k1/5ppp/8/8/3n4/8/P4PPP/R5K1 b - - 0 1', 'Nb3', 22, 'blunder', -150, 250, 300)],
  },

  // ── queen_sortie ───────────────────────────────────────────────────────────
  {
    id: 'queen_sortie_white_h5',
    description: 'White plays the early Qh5 sortie instead of developing.',
    user_color: 'white',
    end_time: '2026-10-19T10:00:00Z',
    expected: ['queen_sortie'],
    moves: [mv('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2', 'Qh5', 3, 'inaccuracy', 20, -80, 100)],
  },
  {
    id: 'queen_sortie_black_f6',
    description: 'Black brings the queen to f6 on move two and concedes the opening.',
    user_color: 'black',
    end_time: '2026-10-20T10:00:00Z',
    expected: ['opening_leak', 'queen_sortie'],
    moves: [mv('rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2', 'Qf6', 4, 'mistake', 25, 145, 120)],
  },

  // ── full miniature ─────────────────────────────────────────────────────────
  {
    id: 'miniature_scholars_mate',
    description:
      'Three moves each: Black answers 3.Qh5 with 3...Nf6?? and allows Qxf7# — '
      + 'an opening leak that is also a mate blunder.',
    user_color: 'black',
    end_time: '2026-10-21T10:00:00Z',
    continuous: true,
    expected: ['allowed_mate', 'opening_leak'],
    moves: [
      mv('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e4', 1, 'book', 20, 25, 0),
      mv('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'e5', 2, 'book', 25, 25, 0),
      mv('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'Bc4', 3, 'good', 25, 35, 0),
      mv('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2', 'Nc6', 4, 'book', 35, 35, 0),
      mv('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3', 'Qh5', 5, 'excellent', 35, 50, 0),
      mv('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', 'Nf6', 6, 'blunder', 50, null, 1000, { mate_after: 1, best_move_san: 'g6' }),
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Negative fixtures — must produce ZERO events.
// ─────────────────────────────────────────────────────────────────────────────

export const NEGATIVE_FIXTURES: Fixture[] = [
  {
    id: 'negative_quiet_move',
    description: 'A quiet, fine queen move classified `good`: nothing to report.',
    user_color: 'white',
    end_time: '2026-10-22T10:00:00Z',
    expected: [],
    moves: [mv('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'Qd3', 21, 'good', 20, 20, 0)],
  },
  {
    id: 'negative_good_sacrifice',
    description: 'A sound sacrifice classified `brilliant` must never become hung_piece.',
    user_color: 'white',
    end_time: '2026-10-23T10:00:00Z',
    expected: [],
    moves: [mv('6k1/5ppp/8/8/3N4/8/5PPP/1R4K1 w - - 0 1', 'Nb5', 21, 'brilliant', 100, 80, 10)],
  },
  {
    id: 'negative_forced_recapture',
    description: 'A forced recapture is not the player’s choice and must not fire.',
    user_color: 'white',
    end_time: '2026-10-24T10:00:00Z',
    expected: [],
    moves: [mv('4k3/8/8/8/8/8/4r3/4RK2 w - - 0 1', 'Rxe2', 21, 'forced', 0, 0, 0)],
  },
  {
    id: 'negative_book_move',
    description: 'A book move, even with a non-zero engine delta, fires nothing.',
    user_color: 'white',
    end_time: '2026-10-25T10:00:00Z',
    expected: [],
    moves: [mv('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e4', 1, 'book', 20, 25, 0)],
  },
  {
    id: 'negative_low_cp_loss',
    description: 'A 30 cp mistake is below the detector’s 40 cp floor: no event.',
    user_color: 'white',
    end_time: '2026-10-26T10:00:00Z',
    expected: [],
    moves: [mv('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'Qd3', 21, 'mistake', 20, -10, 30)],
  },
  {
    id: 'negative_positional_no_motif',
    description: 'A real but structural mistake with no hanging piece, mate, or eval flip.',
    user_color: 'white',
    end_time: '2026-10-27T10:00:00Z',
    expected: [],
    moves: [mv('1r4k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1', 'h3', 21, 'mistake', 20, -100, 120)],
  },
];

export const ALL_FIXTURES: Fixture[] = [...POSITIVE_FIXTURES, ...NEGATIVE_FIXTURES];
