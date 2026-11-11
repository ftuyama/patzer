import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCORING_VERSION } from '../src/chess/classifier.js';
import type { FetchLike } from '../src/openings/theory.js';

// theory.ts opens the real database on import, so point it at a throwaway file
// before the dynamic import below.
const dir = mkdtempSync(join(tmpdir(), 'patzer-theory-'));
process.env.DB_PATH = join(dir, 'theory.db');

type TheoryModule = typeof import('../src/openings/theory.js');
type DbModule = typeof import('../src/db.js');
let theory: TheoryModule;
let db: DbModule['db'];

const ME = 1;
const OTHER = 2;

// A short real line: White follows the book with 1.e4, then leaves it with
// 2.Na3 (the explorer only sees Nf3 / Bc4 there).
const WHITE_GAP_PGN = '1. e4 e5 2. Na3 Nc6 3. Bc4 Bc5';
const BLACK_PGN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 a6';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

/** Explorer bodies keyed by the position before the move. */
const BODIES: Record<string, unknown> = {
  // 1.e4 is the overwhelming main move → the user followed theory here.
  [START_FEN]: {
    white: 600, draws: 300, black: 100,
    moves: [
      { san: 'e4', uci: 'e2e4', white: 400, draws: 150, black: 50 },
      { san: 'd4', uci: 'd2d4', white: 150, draws: 100, black: 50 },
    ],
    opening: { eco: 'A00', name: 'Starting position' },
  },
  // After 1.e4 e5 the book move is Nf3; Na3 is not even in the top 8.
  [AFTER_E4_E5]: {
    white: 500, draws: 300, black: 200,
    moves: [
      { san: 'Nf3', uci: 'g1f3', white: 250, draws: 120, black: 30 },
      { san: 'Bc4', uci: 'f1c4', white: 100, draws: 80, black: 40 },
    ],
    opening: { eco: 'C20', name: "King's Pawn Game" },
  },
  // Black's 1...e5 is the main move — White never sees a gap on this side.
  [AFTER_E4]: {
    white: 500, draws: 300, black: 200,
    moves: [
      { san: 'e5', uci: 'e7e5', white: 250, draws: 120, black: 30 },
      { san: 'c5', uci: 'c7c5', white: 100, draws: 80, black: 40 },
    ],
    opening: { eco: 'B00', name: "King's Pawn Game" },
  },
};

const GENERIC_BODY = {
  white: 500, draws: 300, black: 200,
  moves: [
    { san: 'Nf6', uci: 'g8f6', white: 250, draws: 120, black: 30 },
    { san: 'd6', uci: 'd7d6', white: 100, draws: 80, black: 40 },
  ],
  opening: null,
};

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  respond: (fen: string) => { status: number; body?: unknown } | Error,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const decoded = decodeURIComponent(url);
    const fen = /[?&]fen=([^&]+)/.exec(decoded)?.[1] ?? '';
    const r = respond(fen);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch: fetchImpl, calls };
}

function bodyFor(fen: string) {
  return BODIES[fen] ?? GENERIC_BODY;
}

function insertGame(opts: {
  userId?: number;
  pgn: string;
  color: 'white' | 'black';
  moves: unknown;
  eco?: string | null;
  name?: string | null;
}): number {
  const userId = opts.userId ?? ME;
  const info = db.prepare(
    `INSERT INTO games (user_id, source, external_id, pgn, white, black, result, end_time, user_color, eco, opening_name)
     VALUES (?, 'imported', ?, ?, 'me', 'them', 'win', datetime('now'), ?, ?, ?)`,
  ).run(userId, `${Math.random()}`, opts.pgn, opts.color, opts.eco ?? null, opts.name ?? null);
  const gameId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO analyses (game_id, depth, moves_json, scoring_version, accuracy_white, accuracy_black)
     VALUES (?, 18, ?, ?, 90, 88)`,
  ).run(gameId, JSON.stringify(opts.moves), SCORING_VERSION);
  return gameId;
}

/** Minimal moves_json entries for the user's plies. */
function movesFor(moves: Array<{ ply: number; san: string; before?: number | null; after?: number | null }>) {
  return moves.map((m) => ({
    ply: m.ply,
    san: m.san,
    uci: '0000',
    fen_before: START_FEN,
    fen_after: START_FEN,
    eval_before_cp: m.before ?? 0,
    eval_after_cp: m.after ?? 0,
    mate_before: null,
    mate_after: null,
    best_move_uci: null,
    best_move_san: null,
    best_pv: [],
    centipawn_loss: 0,
    classification: 'good',
  }));
}

const WHITE_MOVES = movesFor([
  { ply: 1, san: 'e4', before: 20, after: 25 },
  { ply: 3, san: 'Na3', before: 30, after: -60 }, // loses ~8 win%
  { ply: 5, san: 'Bc4', before: 0, after: 0 },
]);

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  theory = await import('../src/openings/theory.js');
  const add = db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`);
  add.run(ME, 'me');
  add.run(OTHER, 'other');
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.prepare('DELETE FROM theory_cache').run();
  db.prepare('DELETE FROM analyses').run();
  db.prepare('DELETE FROM games').run();
  theory.resetTheoryState();
});

describe('clampGames', () => {
  it('defaults to 100 and clamps to the 20–200 window', () => {
    expect(theory.clampGames(undefined)).toBe(100);
    expect(theory.clampGames('nope')).toBe(100);
    expect(theory.clampGames('5')).toBe(20);
    expect(theory.clampGames(500)).toBe(200);
    expect(theory.clampGames(50)).toBe(50);
    expect(theory.clampGames(50.9)).toBe(50);
  });
});

describe('scanTheoryGaps', () => {
  it('detects a rare move and reports the explorer alternative, line and eval loss', async () => {
    const gameId = insertGame({ pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    const f = fakeFetch((fen) => ({ status: 200, body: bodyFor(fen) }));

    const payload = await theory.scanTheoryGaps(ME, { color: 'white', games: 100, fetchImpl: f.fetch, minIntervalMs: 0 });

    expect(payload.source).toBe('lichess-explorer');
    expect(payload.scanned_games).toBe(1);
    expect(payload.color).toBe('white');

    const gap = payload.gaps.find((g) => g.move_san === 'Na3');
    expect(gap).toBeDefined();
    expect(gap).toMatchObject({
      ply: 3,
      san_line: ['e4', 'e5', 'Na3'],
      eco: 'C20',
      name: "King's Pawn Game",
      games: 1,
      share: 1,
      example_game_id: gameId,
    });
    expect(gap!.eval_loss).toBeGreaterThan(0);
    expect(gap!.explorer[0]).toMatchObject({ san: 'Nf3', uci: 'g1f3' });

    // 1.e4 is the main move: following it must never be reported as a gap.
    expect(payload.gaps.some((g) => g.move_san === 'e4')).toBe(false);
  });

  it('aggregates identical gaps across games', async () => {
    insertGame({ pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    insertGame({ pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    const f = fakeFetch((fen) => ({ status: 200, body: bodyFor(fen) }));

    const payload = await theory.scanTheoryGaps(ME, { color: 'both', fetchImpl: f.fetch, minIntervalMs: 0 });
    const na3 = payload.gaps.filter((g) => g.move_san === 'Na3');
    expect(na3).toHaveLength(1);
    expect(na3[0]!.games).toBe(2);
    expect(na3[0]!.share).toBe(1);
    expect(payload.scanned_games).toBe(2);
  });

  it('honours the colour filter', async () => {
    insertGame({ pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    insertGame({
      pgn: BLACK_PGN,
      color: 'black',
      moves: movesFor([{ ply: 2, san: 'e5' }, { ply: 6, san: 'a6' }]),
    });
    const f = fakeFetch((fen) => ({ status: 200, body: bodyFor(fen) }));

    const white = await theory.scanTheoryGaps(ME, { color: 'white', fetchImpl: f.fetch, minIntervalMs: 0 });
    expect(white.scanned_games).toBe(1);
    expect(white.gaps.every((g) => g.san_line.length % 2 === 1)).toBe(true);

    theory.resetTheoryState();
    const black = await theory.scanTheoryGaps(ME, { color: 'black', fetchImpl: f.fetch, minIntervalMs: 0 });
    expect(black.scanned_games).toBe(1);
    expect(black.gaps.every((g) => g.san_line.length % 2 === 0)).toBe(true);

    theory.resetTheoryState();
    const both = await theory.scanTheoryGaps(ME, { color: 'both', fetchImpl: f.fetch, minIntervalMs: 0 });
    expect(both.scanned_games).toBe(2);
  });

  it('serves cached explorer rows without touching the network', async () => {
    insertGame({ pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    const online = fakeFetch((fen) => ({ status: 200, body: bodyFor(fen) }));
    const first = await theory.scanTheoryGaps(ME, { color: 'white', fetchImpl: online.fetch, minIntervalMs: 0 });
    expect(online.calls.length).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM theory_cache').get()).toMatchObject({ c: online.calls.length });

    theory.resetTheoryState();
    const offline = fakeFetch(() => new Error('ECONNREFUSED'));
    const second = await theory.scanTheoryGaps(ME, { color: 'white', fetchImpl: offline.fetch, minIntervalMs: 0 });

    expect(offline.calls).toHaveLength(0);
    expect(second.source).toBe('local-book');
    expect(second.gaps.map((g) => g.move_san)).toEqual(first.gaps.map((g) => g.move_san));
  });

  it('degrades to unavailable when the explorer fails and nothing is cached', async () => {
    insertGame({ pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    const f = fakeFetch(() => ({ status: 503 }));

    const payload = await theory.scanTheoryGaps(ME, { color: 'white', fetchImpl: f.fetch, minIntervalMs: 0 });

    expect(payload.source).toBe('unavailable');
    expect(payload.gaps).toEqual([]);
    expect(payload.scanned_games).toBe(1);
    // The first failure opens the circuit breaker; later positions are not asked.
    expect(f.calls).toHaveLength(1);
  });

  it('does not flag a gap when the explorer has no clear main move', async () => {
    // 1.d4 with only 40 explorer games for the top move (< 50) is not theory.
    insertGame({
      pgn: '1. d4 d5 2. c4 e6',
      color: 'white',
      moves: movesFor([{ ply: 1, san: 'd4' }, { ply: 3, san: 'c4' }]),
    });
    const f = fakeFetch(() => ({
      status: 200,
      body: {
        white: 30, draws: 5, black: 5,
        moves: [
          { san: 'e4', uci: 'e2e4', white: 30, draws: 5, black: 5 },
          { san: 'd4', uci: 'd2d4', white: 5, draws: 0, black: 0 },
        ],
        opening: null,
      },
    }));

    const payload = await theory.scanTheoryGaps(ME, { color: 'white', fetchImpl: f.fetch, minIntervalMs: 0 });
    expect(payload.gaps).toEqual([]);
  });

  it('keeps games scoped to the requesting user', async () => {
    insertGame({ userId: OTHER, pgn: WHITE_GAP_PGN, color: 'white', moves: WHITE_MOVES });
    const f = fakeFetch((fen) => ({ status: 200, body: bodyFor(fen) }));

    const payload = await theory.scanTheoryGaps(ME, { color: 'both', fetchImpl: f.fetch, minIntervalMs: 0 });
    expect(payload.scanned_games).toBe(0);
    expect(payload.gaps).toEqual([]);
  });
});
