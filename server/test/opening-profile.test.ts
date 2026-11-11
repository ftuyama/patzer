import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { SCORING_VERSION } from '../src/chess/classifier.js';

// openingProfile.ts opens the real database on import, so point it at a
// throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-opening-profile-'));
process.env.DB_PATH = join(dir, 'profile.db');

type ProfileModule = typeof import('../src/chess/openingProfile.js');
type DbModule = typeof import('../src/db.js');
let profile: ProfileModule;
let db: DbModule['db'];

const ME = 1;
const OTHER = 2;

interface Flaw { classification: 'mistake' | 'blunder' | 'miss'; cp: number; best: string }

/** A moves_json that agrees with the PGN, with the engine's verdict on the
 *  plies the test names (1-based, like `ply`). */
function analysed(pgn: string, flaws: Record<number, Flaw> = {}): string {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const replay = new Chess();
  const moves = chess.history({ verbose: true }).map((m, i) => {
    const ply = i + 1;
    const fenBefore = replay.fen();
    replay.move(m.san);
    const flaw = flaws[ply];
    return {
      ply,
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      fen_before: fenBefore,
      fen_after: replay.fen(),
      eval_before_cp: 0,
      eval_after_cp: 0,
      mate_before: null,
      mate_after: null,
      best_move_uci: null,
      best_move_san: flaw?.best ?? null,
      best_pv: [],
      centipawn_loss: flaw?.cp ?? 0,
      classification: flaw?.classification ?? 'good',
    };
  });
  return JSON.stringify(moves);
}

function insertGame(opts: {
  pgn: string;
  color: 'white' | 'black';
  moves: string;
  result?: 'win' | 'draw' | 'loss';
  eco?: string | null;
  name?: string | null;
  accuracy?: number;
  phaseSplit?: string | null;
  startFen?: string | null;
  user?: number;
}): number {
  const info = db.prepare(
    `INSERT INTO games (user_id, source, external_id, pgn, white, black, result, end_time, user_color, eco, opening_name, start_fen)
     VALUES (?, 'imported', ?, ?, 'me', 'them', ?, datetime('now'), ?, ?, ?, ?)`,
  ).run(
    opts.user ?? ME, `${Math.random()}`, opts.pgn, opts.result ?? 'win', opts.color,
    opts.eco ?? null, opts.name ?? null, opts.startFen ?? null,
  );
  const gameId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO analyses (game_id, depth, moves_json, scoring_version, accuracy_white, accuracy_black, phase_split_json)
     VALUES (?, 18, ?, ?, ?, ?, ?)`,
  ).run(gameId, opts.moves, SCORING_VERSION, opts.accuracy ?? 80, opts.accuracy ?? 80, opts.phaseSplit ?? null);
  return gameId;
}

// 2.Na3 is a move the engine dislikes; Nf3 is the move.
const WHITE_NA3 = '1. e4 e5 2. Na3 Nc6 3. Bc4 Bc5';
// Black's 3...a6 is the weak one; Nf6 is the move.
const BLACK_A6 = '1. e4 e5 2. Nf3 Nc6 3. Bc4 a6';

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  profile = await import('../src/chess/openingProfile.js');
  const add = db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`);
  add.run(ME, 'me');
  add.run(OTHER, 'other');
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.prepare('DELETE FROM analyses').run();
  db.prepare('DELETE FROM games').run();
});

describe('clampProfileWindow', () => {
  it('defaults to 100 and clamps to 10–300', () => {
    expect(profile.clampProfileWindow(undefined)).toBe(100);
    expect(profile.clampProfileWindow('nope')).toBe(100);
    expect(profile.clampProfileWindow('1')).toBe(10);
    expect(profile.clampProfileWindow(9999)).toBe(300);
    expect(profile.clampProfileWindow('50.9')).toBe(50);
  });
});

describe('buildOpeningProfile', () => {
  it('groups the games by opening with score, accuracy and the costly move', () => {
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      moves: analysed(WHITE_NA3, { 3: { classification: 'mistake', cp: 150, best: 'Nf3' } }),
      eco: 'C20', name: "King's Pawn Game", accuracy: 72.5,
    });
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      moves: analysed(WHITE_NA3, { 3: { classification: 'blunder', cp: 250, best: 'Nf3' } }),
      result: 'loss', eco: 'C20', name: "King's Pawn Game", accuracy: 67.5,
    });

    const white = profile.buildOpeningProfile(ME, 'white');

    expect(white.games).toBe(2);
    expect(white.openings).toHaveLength(1);
    const [opening] = white.openings;
    expect(opening!.eco).toBe('C20');
    expect(opening!.games).toBe(2);
    expect(opening!.wins).toBe(1);
    expect(opening!.losses).toBe(1);
    expect(opening!.score).toBe(50);
    expect(opening!.accuracy).toBe(70);

    // Same position + move in both games: one habit, two games.
    expect(opening!.leaks).toHaveLength(1);
    const [leak] = opening!.leaks;
    expect(leak!.played_san).toBe('Na3');
    expect(leak!.best_san).toBe('Nf3');
    expect(leak!.games).toBe(2);
    expect(leak!.avg_cp_loss).toBe(200);
    expect(leak!.san_line).toEqual(['e4', 'e5']);
    expect(leak!.ply).toBe(3);
    // The drill replays the line with the engine's move instead of the mistake.
    expect(leak!.drill).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('keeps each colour’s games and leaks apart', () => {
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      moves: analysed(WHITE_NA3, { 3: { classification: 'blunder', cp: 200, best: 'Nf3' } }),
      eco: 'C20', name: 'KP',
    });
    insertGame({
      pgn: BLACK_A6, color: 'black',
      moves: analysed(BLACK_A6, { 6: { classification: 'mistake', cp: 120, best: 'Nf6' } }),
      eco: 'C50', name: 'Italian', result: 'loss',
    });

    const white = profile.buildOpeningProfile(ME, 'white');
    const black = profile.buildOpeningProfile(ME, 'black');

    expect(white.games).toBe(1);
    expect(white.openings[0]!.leaks[0]!.played_san).toBe('Na3');

    expect(black.games).toBe(1);
    const leak = black.openings[0]!.leaks[0]!;
    expect(leak.played_san).toBe('a6');
    expect(leak.best_san).toBe('Nf6');
    expect(leak.drill).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']);
  });

  it('ignores mistakes outside the opening phase and cheap inaccuracies', () => {
    const split = JSON.stringify({
      opening: { from_ply: 1, to_ply: 4, accuracy_white: 80, accuracy_black: 80, acpl_white: 10, acpl_black: 10 },
      middlegame: { from_ply: 5, to_ply: 8, accuracy_white: 80, accuracy_black: 80, acpl_white: 10, acpl_black: 10 },
      endgame: null,
    });
    insertGame({
      pgn: BLACK_A6, color: 'black',
      // 3...a6 is ply 6 — middlegame under this split, so no leak.
      moves: analysed(BLACK_A6, { 6: { classification: 'blunder', cp: 300, best: 'Nf6' } }),
      eco: 'C50', name: 'Italian', phaseSplit: split,
    });
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      // Under MIN_LEAK_CP: a mistake, but too cheap to relearn.
      moves: analysedCheap(),
      eco: 'C20', name: 'KP',
    });

    expect(profile.buildOpeningProfile(ME, 'white').openings[0]!.leaks).toHaveLength(0);
    expect(profile.buildOpeningProfile(ME, 'black').openings[0]!.leaks).toHaveLength(0);
  });

  it('leaves out games from a custom position and other users’ games', () => {
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      moves: analysed(WHITE_NA3, { 3: { classification: 'blunder', cp: 200, best: 'Nf3' } }),
      eco: 'C20', name: 'KP', startFen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    });
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      moves: analysed(WHITE_NA3, { 3: { classification: 'blunder', cp: 200, best: 'Nf3' } }),
      eco: 'C20', name: 'KP', user: OTHER,
    });

    expect(profile.buildOpeningProfile(ME, 'white').games).toBe(0);
  });

  it('still reads a game whose phase split is corrupt', () => {
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      moves: analysed(WHITE_NA3, { 3: { classification: 'blunder', cp: 200, best: 'Nf3' } }),
      eco: 'C20', name: 'KP', phaseSplit: '{oops',
    });

    // With no usable split the ply-based fallback still calls ply 3 opening,
    // so the profile keeps its leak instead of failing the whole panel.
    const opening = profile.buildOpeningProfile(ME, 'white').openings[0]!;
    expect(opening.games).toBe(1);
    expect(opening.leaks[0]!.drill).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('drops a leak whose corrected line chess.js will not replay', () => {
    insertGame({
      pgn: WHITE_NA3, color: 'white',
      // The engine's "best" does not exist in this position.
      moves: analysed(WHITE_NA3, { 3: { classification: 'blunder', cp: 300, best: 'Qh8' } }),
      eco: 'C20', name: 'KP',
    });

    const leak = profile.buildOpeningProfile(ME, 'white').openings[0]!.leaks[0]!;
    expect(leak.best_san).toBe('Qh8');
    expect(leak.drill).toEqual([]);
  });

  it('sorts the phase by games and keeps the worst leaks first', () => {
    for (let i = 0; i < 3; i++) {
      insertGame({ pgn: WHITE_NA3, color: 'white', moves: analysed(WHITE_NA3), eco: 'C20', name: 'KP' });
    }
    insertGame({ pgn: BLACK_A6, color: 'white', moves: analysed(BLACK_A6), eco: 'C50', name: 'Italian' });

    const white = profile.buildOpeningProfile(ME, 'white');
    expect(white.openings.map((o) => o.eco)).toEqual(['C20', 'C50']);
  });
});

/** 2.Na3, but the engine only loses 40cp — under MIN_LEAK_CP. */
function analysedCheap(): string {
  return analysed(WHITE_NA3, { 3: { classification: 'mistake', cp: 40, best: 'Nf3' } });
}
