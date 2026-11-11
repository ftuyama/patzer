// Fixture loader: turns the hand-written positions into `AnalyzedMove[]` the
// way the analyzer would store them, and validates that every fixture is legal
// chess. Test files should import from here rather than touching `labelled.ts`
// directly.

import { Chess } from 'chess.js';
import type { AnalyzedMove } from '../../../src/types.js';
import type { GameMeta } from '../../../src/chess/patterns.js';
import { ALL_FIXTURES, NEGATIVE_FIXTURES, POSITIVE_FIXTURES, type Fixture, type FixtureMove } from './labelled.js';

export { ALL_FIXTURES, NEGATIVE_FIXTURES, POSITIVE_FIXTURES };
export type { Fixture, FixtureMove };

function sideForPly(ply: number): 'white' | 'black' {
  return ply % 2 === 1 ? 'white' : 'black';
}

/** Replay one fixture move, returning the AnalyzedMove plus its after-FEN. */
export function toAnalyzedMove(move: FixtureMove, fixture: Fixture): AnalyzedMove {
  const chess = new Chess(move.fen_before);
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  if (turn !== sideForPly(move.ply)) {
    throw new Error(
      `[${fixture.id}] ply ${move.ply} belongs to ${sideForPly(move.ply)} but `
      + `${move.fen_before} has ${turn} to move`,
    );
  }
  let played;
  try {
    played = chess.move(move.san, { strict: false });
  } catch {
    throw new Error(`[${fixture.id}] illegal SAN "${move.san}" in ${move.fen_before}`);
  }
  if (!played) throw new Error(`[${fixture.id}] illegal SAN "${move.san}" in ${move.fen_before}`);

  return {
    ply: move.ply,
    san: played.san,
    uci: played.from + played.to + (played.promotion ?? ''),
    fen_before: new Chess(move.fen_before).fen(),
    fen_after: chess.fen(),
    eval_before_cp: move.eval_before_cp,
    eval_after_cp: move.eval_after_cp,
    mate_before: move.mate_before ?? null,
    mate_after: move.mate_after ?? null,
    best_move_uci: null,
    best_move_san: move.best_move_san ?? null,
    best_pv: [],
    centipawn_loss: move.centipawn_loss,
    classification: move.classification,
  };
}

/** Replay every move in a fixture and validate continuity when requested. */
export function toAnalyzedMoves(fixture: Fixture): AnalyzedMove[] {
  const out: AnalyzedMove[] = [];
  let previousAfter: string | null = null;
  for (const move of fixture.moves) {
    const analysed = toAnalyzedMove(move, fixture);
    if (fixture.continuous && previousAfter !== null) {
      const before = new Chess(move.fen_before).fen();
      if (before !== previousAfter) {
        throw new Error(
          `[${fixture.id}] ply ${move.ply} starts from ${before} but the previous move ended at ${previousAfter}`,
        );
      }
    }
    previousAfter = analysed.fen_after;
    out.push(analysed);
  }
  return out;
}

export function metaFor(fixture: Fixture, gameId = 1): GameMeta {
  return {
    game_id: gameId,
    user_color: fixture.user_color,
    end_time: fixture.end_time,
    eco: null,
    opening_name: null,
    opponent: 'Fixture Rival',
    result: '1-0',
  };
}

/** Distinct motif set the detector emits for a fixture. */
export function predictedMotifs(events: { motif: string }[]): Set<string> {
  return new Set(events.map((e) => e.motif));
}
