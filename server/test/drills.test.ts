import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The route opens the real database on import, so point it at a throwaway
// file before anything else is loaded.
const dir = mkdtempSync(join(tmpdir(), 'patzer-drills-'));
process.env.DB_PATH = join(dir, 'drills.db');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

type PatternEvent = import('../src/chess/patterns.js').PatternEvent;
type DrillPayload = import('../src/patterns/contracts.js').DrillPayload;
type Router = typeof import('../src/routes/drill.js')['default'];

let router: Router;
let db: typeof import('../src/db.js')['db'];
let cookie: string;
let buildDrill: typeof import('../src/chess/drills.js')['buildDrill'];
let clearDrillCache: typeof import('../src/chess/drills.js')['clearDrillCache'];
let recordGameEvents: typeof import('../src/patterns/store.js')['recordGameEvents'];

function event(over: Partial<PatternEvent> & Pick<PatternEvent, 'motif' | 'game_id' | 'ply' | 'fen'>): PatternEvent {
  return {
    phase: 'opening',
    color: 'white',
    severity: 20,
    cp_loss: 150,
    classification: 'blunder',
    played_san: 'a3',
    best_san: 'e4',
    end_time: null,
    eco: null,
    opening_name: null,
    opponent: null,
    result: null,
    ...over,
  };
}

/** One analysed move: the played move and the engine's best reply. */
function move(ply: number, over: Record<string, unknown> = {}) {
  return {
    ply,
    san: 'a3',
    uci: 'a2a3',
    fen_before: START,
    fen_after: START,
    eval_before_cp: 0,
    eval_after_cp: -300,
    mate_before: null,
    mate_after: null,
    best_move_uci: 'e2e4',
    best_move_san: 'e4',
    best_pv: ['e4', 'e5'],
    centipawn_loss: 300,
    classification: 'blunder',
    ...over,
  };
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  ({ buildDrill, clearDrillCache } = await import('../src/chess/drills.js'));
  ({ recordGameEvents } = await import('../src/patterns/store.js'));
  router = (await import('../src/routes/drill.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');

  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'me', 'x', 'user'), (2, 'fresh', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Me'), (2, 'Fresh')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const game = db.prepare(`
    INSERT INTO games (id, user_id, source, pgn, white, black, result, end_time, user_color)
    VALUES (?, ?, 'played', '', ?, ?, ?, ?, ?)
  `);
  const analysis = db.prepare(`INSERT INTO analyses (game_id, depth, moves_json, scoring_version) VALUES (?, 18, ?, ?)`);

  // User 1: four games carry drillable events, one is a duplicate position,
  // two must be dropped (no best SAN / no best UCI).
  game.run(1, 1, 'me', 'Bot', 'loss', '2026-09-01 10:00:00', 'white');
  game.run(2, 1, 'me', 'Anna', 'loss', '2026-09-03 10:00:00', 'white');
  game.run(3, 1, 'me', 'Carl', 'loss', '2026-09-05 10:00:00', 'white');
  game.run(4, 1, 'me', 'Dina', 'loss', '2026-09-06 10:00:00', 'white');
  game.run(5, 1, 'me', 'Ed', 'loss', '2026-09-07 10:00:00', 'white');

  analysis.run(1, JSON.stringify([move(1)]), SCORING_VERSION);
  analysis.run(2, JSON.stringify([move(3, { fen_before: AFTER_E4_E5, best_move_uci: 'g1f3', best_move_san: 'Nf3', best_pv: ['Nf3', 'Nc6'] })]), SCORING_VERSION);
  analysis.run(3, JSON.stringify([move(1)]), SCORING_VERSION);
  analysis.run(4, JSON.stringify([move(1, { best_move_uci: null, best_move_san: null, best_pv: [] })]), SCORING_VERSION);
  analysis.run(5, JSON.stringify([move(3, { fen_before: AFTER_E4_E5 })]), SCORING_VERSION);

  recordGameEvents(1, 1, [event({ motif: 'hung_piece', game_id: 1, ply: 1, fen: START, severity: 30, end_time: '2026-09-01 10:00:00', opponent: 'Bot' })]);
  recordGameEvents(1, 2, [event({
    motif: 'fork_exposed', game_id: 2, ply: 3, fen: AFTER_E4_E5, severity: 25,
    classification: 'inaccuracy', end_time: '2026-09-03 10:00:00', opponent: 'Anna',
  })]);
  // Same position and best move as game 1 — the newer one wins.
  recordGameEvents(1, 3, [event({ motif: 'hung_piece', game_id: 3, ply: 1, fen: START, severity: 40, end_time: '2026-09-05 10:00:00', opponent: 'Carl' })]);
  recordGameEvents(1, 4, [event({
    motif: 'missed_win', game_id: 4, ply: 1, fen: START, severity: 50,
    classification: 'miss', end_time: '2026-09-06 10:00:00',
  })]);
  recordGameEvents(1, 5, [event({
    motif: 'hung_piece', game_id: 5, ply: 3, fen: AFTER_E4_E5, severity: 40,
    best_san: null, end_time: '2026-09-07 10:00:00',
  })]);

  // User 2 has no stored events: the drill detects live from the analysis.
  game.run(6, 2, 'Fresh', 'Bot', 'loss', '2026-09-08 10:00:00', 'white');
  analysis.run(6, JSON.stringify([move(1)]), SCORING_VERSION);
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

async function call(path: string): Promise<{ status: number; body: DrillPayload & { error?: string } }> {
  const res = await router.request(path, { headers: { Cookie: cookie } });
  return { status: res.status, body: await res.json() as DrillPayload & { error?: string } };
}

describe('drill sets from stored pattern events', () => {
  it('keeps one position per (fen, best move) and the newest example', () => {
    const payload = buildDrill(1, { pattern: 'hung_piece', count: 10, mode: 'find_best' });
    expect(payload.positions.map((p) => p.game_id)).toEqual([3]);
    expect(payload.positions[0]).toMatchObject({
      ply: 1, fen: START, played_san: 'a3', best_san: 'e4', best_uci: 'e2e4',
      severity: 40, motif: 'hung_piece', prompt: 'find_best', opponent: 'Carl',
    });
  });

  it('interleaves the top motifs for `mixed`', () => {
    const payload = buildDrill(1, { pattern: 'mixed', count: 10, mode: 'find_best' });
    expect(payload.pattern).toBe('mixed');
    expect(payload.positions.map((p) => p.game_id)).toEqual([3, 2]);
    expect(payload.positions.map((p) => p.motif)).toEqual(['hung_piece', 'fork_exposed']);
  });

  it('drops positions without a best SAN or a best UCI', () => {
    // game 4 (no best UCI) and game 5 (no best SAN) are in the store but not
    // in any drill.
    const all = buildDrill(1, { pattern: 'mixed', count: 30, mode: 'find_best' });
    expect(all.positions.map((p) => p.game_id)).not.toContain(4);
    expect(all.positions.map((p) => p.game_id)).not.toContain(5);
  });

  it('continues the solution with the stored engine line in UCI', () => {
    const payload = buildDrill(1, { pattern: 'hung_piece', count: 10, mode: 'find_best' });
    expect(payload.positions[0]!.solution_uci).toEqual(['e2e4', 'e7e5']);
  });

  it('spot_threat keeps blunders and misses only and asks about the threat', () => {
    const threat = buildDrill(1, { pattern: 'hung_piece', count: 10, mode: 'spot_threat' });
    expect(threat.mode).toBe('spot_threat');
    expect(threat.positions.map((p) => p.game_id)).toEqual([3]);
    expect(threat.positions[0]!.prompt).toBe('spot_threat');

    const thin = buildDrill(1, { pattern: 'fork_exposed', count: 10, mode: 'spot_threat' });
    expect(thin.positions).toEqual([]);
  });

  it('returns an empty set for a motif with no stored events', () => {
    const payload = buildDrill(1, { pattern: 'queen_sortie', count: 10, mode: 'find_best' });
    expect(payload.pattern).toBe('queen_sortie');
    expect(payload.positions).toEqual([]);
  });
});

describe('drill clamping', () => {
  it('clamps count into 1..30 and defaults a non-number to 10', () => {
    expect(buildDrill(1, { pattern: 'mixed', count: 0, mode: 'find_best' }).count).toBe(1);
    expect(buildDrill(1, { pattern: 'mixed', count: -5, mode: 'find_best' }).count).toBe(1);
    expect(buildDrill(1, { pattern: 'mixed', count: 999, mode: 'find_best' }).count).toBe(30);
    expect(buildDrill(1, { pattern: 'mixed', count: Number.NaN, mode: 'find_best' }).count).toBe(10);
  });
});

describe('live-detection fallback', () => {
  it('builds a drill from analyses when the event store is empty', () => {
    clearDrillCache();
    const payload = buildDrill(2, { pattern: 'opening_leak', count: 10, mode: 'find_best' });
    expect(payload.positions).toHaveLength(1);
    expect(payload.positions[0]).toMatchObject({
      game_id: 6, ply: 1, fen: START, best_uci: 'e2e4', best_san: 'e4',
      solution_uci: ['e2e4', 'e7e5'], motif: 'opening_leak',
    });
  });
});

describe('GET /api/train/drill', () => {
  it('serves the contract shape', async () => {
    const { status, body } = await call('/drill?pattern=mixed&count=10&mode=find_best');
    expect(status).toBe(200);
    expect(body).toMatchObject({ pattern: 'mixed', mode: 'find_best', count: 10 });
    expect(body.positions.map((p) => p.game_id)).toEqual([3, 2]);
    for (const p of body.positions) {
      expect(typeof p.fen).toBe('string');
      expect(Array.isArray(p.solution_uci)).toBe(true);
      expect(p.solution_uci[0]).toBe(p.best_uci);
    }
  });

  it('defaults to mixed/find_best/10 and clamps count', async () => {
    const plain = await call('/drill');
    expect(plain.body).toMatchObject({ pattern: 'mixed', mode: 'find_best', count: 10 });
    expect((await call('/drill?count=0')).body.count).toBe(1);
    expect((await call('/drill?count=999')).body.count).toBe(30);
    expect((await call('/drill?count=nope')).body.count).toBe(10);
  });

  it('rejects an unknown pattern or mode', async () => {
    const badPattern = await call('/drill?pattern=not_a_motif');
    expect(badPattern.status).toBe(400);
    expect(badPattern.body.error).toBe('invalid_pattern');

    const badMode = await call('/drill?mode=quiz');
    expect(badMode.status).toBe(400);
    expect(badMode.body.error).toBe('invalid_mode');
  });
});
