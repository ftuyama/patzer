import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AnalyzedMove } from '../src/types.js';

// The store, the route and the backfill script all open the real database on
// import, so point DB_PATH at a throwaway file before any dynamic import.
const dir = mkdtempSync(join(tmpdir(), 'patzer-patterns-'));
process.env.DB_PATH = join(dir, 'patterns.db');

// White to move: Qxd8+ Qxd8 Rxd8# — you played Qd3 and missed the back rank.
const BACK_RANK = '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 1';

function userMove(ply = 1, overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    ply,
    san: 'Qd3',
    uci: 'd2d3',
    fen_before: BACK_RANK,
    fen_after: BACK_RANK,
    eval_before_cp: 2000,
    eval_after_cp: 0,
    mate_before: 2,
    mate_after: null,
    best_move_uci: 'd2d8',
    best_move_san: 'Qxd8+',
    best_pv: ['Qxd8+', 'Qxd8', 'Rxd8#'],
    centipawn_loss: 900,
    classification: 'miss',
    ...overrides,
  };
}

interface BackfillSummary {
  version: number;
  scoringVersion: number;
  scanned: number;
  pending: number;
  recorded: number;
  skipped: number;
  failed: number;
  events: number;
}

const BACKFILL_URL = pathToFileURL(join(process.cwd(), 'scripts/backfill-patterns.ts')).href;

async function backfill(opts: { dryRun?: boolean; limit?: number; user?: number }): Promise<BackfillSummary> {
  // Imported through a variable so TypeScript does not try to type-check a
  // root-level script from the server test project (it is deliberately
  // outside server/tsconfig.json's rootDir).
  const mod = await import(/* @vite-ignore */ BACKFILL_URL) as {
    runBackfill(o: typeof opts): Promise<BackfillSummary>;
  };
  return mod.runBackfill(opts);
}

describe('pattern event persistence', () => {
  let db: typeof import('../src/db.js')['db'];
  let store: typeof import('../src/patterns/store.js');
  let patterns: typeof import('../src/chess/patterns.js');
  let classifier: typeof import('../src/chess/classifier.js');
  let router: typeof import('../src/routes/diagnosis.js')['default'];
  let cookie: string;

  let nextUserId = 1;
  let nextGameId = 1;

  function addUser(name: string): number {
    const id = nextUserId++;
    db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`).run(id, name);
    db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (?, ?)`).run(id, name);
    return id;
  }

  function addGame(userId: number, opts: { endTime: string; startFen?: string | null; result?: string; color?: 'white' | 'black' }): number {
    const id = nextGameId++;
    db.prepare(`
      INSERT INTO games (id, user_id, source, pgn, white, black, result, end_time, user_color, start_fen)
      VALUES (?, ?, 'imported', '', 'Me', 'Rival', ?, ?, ?, ?)
    `).run(id, userId, opts.result ?? '1-0', opts.endTime, opts.color ?? 'white', opts.startFen ?? null);
    return id;
  }

  function addAnalysis(gameId: number, moves: AnalyzedMove[], opts: { accuracy?: number; scoringVersion?: number } = {}): void {
    db.prepare(`
      INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, moves_json, phase_split_json, scoring_version)
      VALUES (?, 14, ?, ?, ?, NULL, ?)
    `).run(gameId, opts.accuracy ?? 70, opts.accuracy ?? 70, JSON.stringify(moves), opts.scoringVersion ?? classifier.SCORING_VERSION);
  }

  function metaFor(gameId: number): import('../src/chess/patterns.js').GameMeta {
    return {
      game_id: gameId,
      user_color: 'white',
      end_time: '2026-09-01 10:00:00',
      eco: null,
      opening_name: null,
      opponent: 'Rival',
      result: '1-0',
    };
  }

  beforeAll(async () => {
    ({ db } = await import('../src/db.js'));
    store = await import('../src/patterns/store.js');
    patterns = await import('../src/chess/patterns.js');
    classifier = await import('../src/chess/classifier.js');
    router = (await import('../src/routes/diagnosis.js')).default;

    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    addUser('owner');
    cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  });

  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips events through recordGameEvents → listEvents', () => {
    const gameId = addGame(1, { endTime: '2026-09-01 10:00:00' });
    addAnalysis(gameId, [userMove()]);
    const events = patterns.detectGamePatterns([userMove()], metaFor(gameId), null);
    expect(events.length).toBeGreaterThan(0);
    expect(store.recordGameEvents(1, gameId, events)).toBe(events.length);

    const listed = store.listEvents(1, { limitGames: 100 });
    expect(listed).toHaveLength(events.length);
    expect(listed[0]).toMatchObject({
      user_id: 1,
      game_id: gameId,
      pattern_version: patterns.PATTERN_VERSION,
      ply: 1,
      color: 'white',
      opponent: 'Rival',
      result: '1-0',
      end_time: '2026-09-01 10:00:00',
    });
    expect(listed.map((e) => e.motif)).toContain('missed_win');
    expect(store.hasEventsForGame(gameId, patterns.PATTERN_VERSION)).toBe(true);
  });

  it('re-recording a game is idempotent — no duplicate rows, same data', () => {
    const gameId = addGame(1, { endTime: '2026-08-30 10:00:00' });
    const events = patterns.detectGamePatterns([userMove()], metaFor(gameId), null);
    store.recordGameEvents(1, gameId, events);
    const before = store.listEvents(1, { limitGames: 100 })
      .filter((e) => e.game_id === gameId)
      .map((e) => ({ motif: e.motif, ply: e.ply, severity: e.severity, fen: e.fen }));

    store.recordGameEvents(1, gameId, events);
    const after = store.listEvents(1, { limitGames: 100 })
      .filter((e) => e.game_id === gameId)
      .map((e) => ({ motif: e.motif, ply: e.ply, severity: e.severity, fen: e.fen }));

    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before);
    const count = db.prepare('SELECT COUNT(*) AS n FROM error_events WHERE game_id = ?').get(gameId) as { n: number };
    expect(count.n).toBe(events.length);
  });

  it('limitGames windows to the N most recently analysed games', () => {
    const user = addUser('window');
    const oldest = addGame(user, { endTime: '2026-07-01 10:00:00' });
    const middle = addGame(user, { endTime: '2026-07-08 10:00:00' });
    const newest = addGame(user, { endTime: '2026-07-15 10:00:00' });
    for (const id of [oldest, middle, newest]) {
      addAnalysis(id, [userMove()]);
      store.recordGameEvents(user, id, patterns.detectGamePatterns([userMove()], metaFor(id), null));
    }

    const windowed = store.listEvents(user, { limitGames: 2 });
    expect(new Set(windowed.map((e) => e.game_id))).toEqual(new Set([middle, newest]));
    expect(store.analysedGameCount(user, 2)).toBe(2);

    // A game started from a position is not part of the diagnosis window.
    const fromPosition = addGame(user, { endTime: '2026-07-16 10:00:00', startFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' });
    addAnalysis(fromPosition, [userMove()]);
    expect(store.analysedGameCount(user, 10)).toBe(3);
  });

  it('backfill records missing games and skips games that already have events', async () => {
    const user = addUser('backfill');
    const recorded = addGame(user, { endTime: '2026-06-01 10:00:00' });
    const missing = addGame(user, { endTime: '2026-06-02 10:00:00' });
    addAnalysis(recorded, [userMove()]);
    addAnalysis(missing, [userMove()]);
    store.recordGameEvents(user, recorded, patterns.detectGamePatterns([userMove()], metaFor(recorded), null));

    const first = await backfill({ user });
    expect(first).toMatchObject({ scanned: 2, skipped: 1, pending: 1, recorded: 1, failed: 0 });
    expect(first.events).toBeGreaterThan(0);
    expect(store.hasEventsForGame(missing, patterns.PATTERN_VERSION)).toBe(true);

    // Safe to run twice: nothing is re-detected or duplicated.
    const second = await backfill({ user });
    expect(second).toMatchObject({ scanned: 2, skipped: 2, pending: 0, recorded: 0, failed: 0, events: 0 });
  });

  it('backfill --dry-run reports but writes nothing, and --limit caps the scan', async () => {
    const user = addUser('dry');
    const a = addGame(user, { endTime: '2026-05-01 10:00:00' });
    const b = addGame(user, { endTime: '2026-05-02 10:00:00' });
    addAnalysis(a, [userMove()]);
    addAnalysis(b, [userMove()]);

    const dry = await backfill({ user, dryRun: true, limit: 1 });
    expect(dry).toMatchObject({ scanned: 1, pending: 1, recorded: 0, skipped: 0 });
    expect(store.hasEventsForGame(b, patterns.PATTERN_VERSION)).toBe(false);
    expect(store.hasEventsForGame(a, patterns.PATTERN_VERSION)).toBe(false);

    const limited = await backfill({ user, limit: 1 });
    expect(limited).toMatchObject({ scanned: 1, pending: 1, recorded: 1 });
    expect(store.hasEventsForGame(b, patterns.PATTERN_VERSION)).toBe(true);
    expect(store.hasEventsForGame(a, patterns.PATTERN_VERSION)).toBe(false);
  });

  it('saveAnalysis records events for a fresh analysis and skips games from a position', async () => {
    const { saveAnalysis } = await import('../src/routes/analyze.js');
    const user = addUser('hook');
    const gameId = addGame(user, { endTime: '2026-01-01 10:00:00' });
    const result = {
      depth: 14,
      moves: [userMove()],
      accuracy_white: 70,
      accuracy_black: 70,
      estimated_elo_white: null,
      estimated_elo_black: null,
      performance_white: null,
      performance_black: null,
      opening_eco: null,
      opening_name: null,
      key_moments: [],
      phase_split: null,
    };
    saveAnalysis(gameId, result);
    const recorded = store.listEvents(user, { limitGames: 10 }).filter((e) => e.game_id === gameId);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded[0]!.pattern_version).toBe(patterns.PATTERN_VERSION);

    // Re-saving the row (e.g. a forced re-analysis) must not duplicate events.
    saveAnalysis(gameId, result);
    const again = store.listEvents(user, { limitGames: 10 }).filter((e) => e.game_id === gameId);
    expect(again).toHaveLength(recorded.length);

    // A game that began from a position never had an opening — no events.
    const fromPosition = addGame(user, {
      endTime: '2026-01-02 10:00:00',
      startFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    });
    saveAnalysis(fromPosition, result);
    expect(store.hasEventsForGame(fromPosition, patterns.PATTERN_VERSION)).toBe(false);
  });

  async function diagnose(userCookie: string, games = 100): Promise<import('../src/patterns/contracts.js').DiagnosisPayload> {
    const res = await router.request(`/?games=${games}`, { headers: { Cookie: userCookie } });
    expect(res.status).toBe(200);
    return res.json() as Promise<import('../src/patterns/contracts.js').DiagnosisPayload>;
  }

  it('/api/diagnosis falls back to live detection for games with no stored events', async () => {
    const user = addUser('fallback');
    const gameId = addGame(user, { endTime: '2026-04-01 10:00:00' });
    addAnalysis(gameId, [userMove()], { accuracy: 82 });
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const cookieForUser = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(user))}`;

    expect(store.hasEventsForGame(gameId, patterns.PATTERN_VERSION)).toBe(false);
    const payload = await diagnose(cookieForUser);

    expect(payload.games_analyzed).toBe(1);
    expect(payload.window_games).toBe(100);
    expect(payload.patterns.length).toBeGreaterThan(0);
    expect(payload.patterns.map((p) => p.key)).toContain('missed_win');
    expect(payload.weekly).toHaveLength(1);
    expect(payload.weekly[0]).toMatchObject({ games: 1, wins: 1, top_pattern: 'missed_win' });
    expect(payload.overview.accuracy).toBe(82);

    // The read path is read-only: the fallback does not silently backfill.
    expect(store.hasEventsForGame(gameId, patterns.PATTERN_VERSION)).toBe(false);
  });

  it('/api/diagnosis reads stored events and keeps the payload byte-shape', async () => {
    const user = addUser('stored');
    const gameId = addGame(user, { endTime: '2026-03-01 10:00:00' });
    addAnalysis(gameId, [userMove()]);
    store.recordGameEvents(user, gameId, patterns.detectGamePatterns([userMove()], metaFor(gameId), null));
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const cookieForUser = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(user))}`;

    const payload = await diagnose(cookieForUser);
    expect(Object.keys(payload).sort()).toEqual(
      ['games_analyzed', 'generated_at', 'overview', 'patterns', 'weekly', 'window_games'],
    );
    expect(Object.keys(payload.overview).sort()).toEqual(
      ['accuracy', 'blunders_per_game', 'date_from', 'date_to', 'inaccuracies_per_game', 'mistakes_per_game'],
    );
    expect(Object.keys(payload.weekly[0]!).sort()).toEqual(
      ['accuracy', 'blunders_per_game', 'draws', 'games', 'losses', 'mistakes_per_game', 'top_pattern', 'week_start', 'wins'],
    );
    expect(payload.patterns[0]).toMatchObject({
      key: expect.any(String),
      count: expect.any(Number),
      games_affected: expect.any(Number),
      score: expect.any(Number),
      avg_severity: expect.any(Number),
      max_severity: expect.any(Number),
      phase: { opening: expect.any(Number), middlegame: expect.any(Number), endgame: expect.any(Number) },
      color: { white: expect.any(Number), black: expect.any(Number) },
    });
    expect(Array.isArray(payload.patterns[0]!.examples)).toBe(true);
    // Stored rows must not leak their DB identity into the API payload.
    expect(Object.keys(payload.patterns[0]!.examples[0]!).sort()).toEqual([
      'best_san', 'classification', 'color', 'cp_loss', 'eco', 'end_time', 'fen',
      'game_id', 'motif', 'opening_name', 'opponent', 'phase', 'played_san',
      'ply', 'result', 'severity',
    ]);
  });

  it('serves the 60 s cache for the same window and recomputes for a new one', async () => {
    const user = addUser('cache');
    const gameId = addGame(user, { endTime: '2026-02-01 10:00:00' });
    addAnalysis(gameId, [userMove()]);
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const cookieForUser = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(user))}`;

    const first = await diagnose(cookieForUser, 50);
    const second = await diagnose(cookieForUser, 50);
    expect(second.generated_at).toBe(first.generated_at);
    const other = await diagnose(cookieForUser, 60);
    expect(other.window_games).toBe(60);
  });
});
