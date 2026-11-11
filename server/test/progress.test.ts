import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, isoWeekStart, renderWeeklyReport } from '../src/patterns/report.js';

// The progress route opens the real database on import.
const dir = mkdtempSync(join(tmpdir(), 'patzer-progress-'));
process.env.DB_PATH = join(dir, 'progress.db');

const thisMonday = isoWeekStart(new Date());
const lastMonday = addDays(thisMonday, -7);
const twoWeeksAgo = addDays(thisMonday, -14);

describe('weekly buckets', () => {
  it('starts every week on Monday, including across a month boundary', () => {
    // 29 Aug 2024 is a Thursday; 1 Sep is a Sunday; 2 Sep is a Monday.
    expect(isoWeekStart(new Date('2024-08-29T12:00:00Z'))).toBe('2024-08-26');
    expect(isoWeekStart(new Date('2024-09-01T12:00:00Z'))).toBe('2024-08-26');
    expect(isoWeekStart(new Date('2024-09-02T12:00:00Z'))).toBe('2024-09-02');
    expect(isoWeekStart(new Date('2024-09-08T23:00:00Z'))).toBe('2024-09-02');
  });
});

describe('the templated weekly report', () => {
  const week = {
    games: 5,
    accuracy: 70,
    accuracy_delta: 5,
    errors_per_game: 2.1,
    top_patterns: [{ key: 'hung_piece' as const, count: 4, score: 12 }],
  };
  const previous = {
    accuracy: 65,
    top_patterns: [{ key: 'fork_exposed' as const, count: 3, score: 9 }],
  };

  it('names the habit, the delta, the improvement and the next step', () => {
    const text = renderWeeklyReport(week, previous, 'en');
    expect(text).toContain('hung pieces');
    expect(text).toContain('up 5 points from 65%');
    expect(text).toContain('fork exposure fell from 3 to 0');
    expect(text).toContain('what the opponent can capture');
    const sentences = text.split(/\.\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    expect(sentences.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic and localised, with English as the fallback', () => {
    const a = renderWeeklyReport(week, previous, 'en');
    const b = renderWeeklyReport(week, previous, 'en');
    expect(a).toBe(b);
    expect(renderWeeklyReport(week, previous, 'de')).toContain('Gewohnheit');
    expect(renderWeeklyReport(week, previous, 'de')).not.toBe(a);
    expect(renderWeeklyReport(week, previous, 'xx' as never)).toBe(a);
    expect(renderWeeklyReport(week, previous, undefined)).toBe(a);
  });
});

describe('/api/progress', () => {
  type Router = typeof import('../src/routes/progress.js')['default'];
  interface Payload {
    weeks: {
      week_start: string;
      games: number;
      wins: number;
      draws: number;
      losses: number;
      accuracy: number | null;
      accuracy_delta: number | null;
      inaccuracies_per_game: number;
      mistakes_per_game: number;
      blunders_per_game: number;
      errors_per_game: number;
      top_patterns: { key: string; count: number; score: number }[];
      partial: boolean;
      summary_text?: string | null;
    }[];
    overall: {
      games: number;
      accuracy: number | null;
      accuracy_delta: number | null;
      errors_per_game: number;
      errors_delta: number | null;
      top_pattern: string | null;
    };
  }

  let router: Router;
  let db: typeof import('../src/db.js')['db'];
  let scoring: number;
  const cookies = new Map<number, string>();
  let gameId = 100;

  function isoDay(monday: string): string {
    return `${monday}T10:00:00`;
  }

  function addUser(id: number, language = 'en'): void {
    db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`)
      .run(id, `user${id}`);
    db.prepare(`INSERT INTO profiles (user_id, display_name, language) VALUES (?, ?, ?)`)
      .run(id, `User ${id}`, language);
  }

  /** One analysed game with an empty move list (week maths only). */
  function addGame(userId: number, endTime: string, accuracy: number, result = '1-0', color = 'white'): number {
    const id = gameId++;
    db.prepare(`
      INSERT INTO games (id, user_id, source, pgn, white, black, result, end_time, user_color)
      VALUES (?, ?, 'played', '', 'me', 'opponent', ?, ?, ?)
    `).run(id, userId, result, endTime, color);
    db.prepare(`
      INSERT INTO analyses (game_id, depth, moves_json, scoring_version, accuracy_white, accuracy_black)
      VALUES (?, 12, '[]', ?, ?, ?)
    `).run(id, scoring, color === 'white' ? accuracy : null, color === 'black' ? accuracy : null);
    return id;
  }

  async function call(userId: number, query: string): Promise<Payload> {
    const cookie = cookies.get(userId)!;
    const res = await router.request(`/${query}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    return res.json() as Promise<Payload>;
  }

  beforeAll(async () => {
    ({ db } = await import('../src/db.js'));
    ({ SCORING_VERSION: scoring } = await import('../src/chess/classifier.js'));
    router = (await import('../src/routes/progress.js')).default;
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');

    for (const id of [1, 2, 3, 4]) {
      addUser(id);
      cookies.set(id, `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(id))}`);
    }

    // User 1: a closed week at 60%, the next at 65%, and the current week.
    addGame(1, isoDay(twoWeeksAgo), 60);
    addGame(1, isoDay(lastMonday), 65);
    addGame(1, isoDay(thisMonday), 70);

    // User 2: one closed week, used for the freeze semantics.
    addGame(2, isoDay(lastMonday), 50);

    // User 4: games at the edges of the clamp window.
    addGame(4, isoDay(thisMonday), 80);
    addGame(4, isoDay(addDays(thisMonday, -21)), 78);
    addGame(4, isoDay(addDays(thisMonday, -40 * 7)), 70);
    addGame(4, isoDay(addDays(thisMonday, -55 * 7)), 60);
  });

  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('groups games by ISO week and computes the accuracy delta to the previous week', async () => {
    const payload = await call(1, '?weeks=4&refresh=1');
    expect(payload.weeks.map((w) => w.week_start)).toEqual([twoWeeksAgo, lastMonday, thisMonday]);
    expect(payload.weeks[0]).toMatchObject({ games: 1, wins: 1, draws: 0, losses: 0, accuracy: 60, accuracy_delta: null, partial: false });
    expect(payload.weeks[1]).toMatchObject({ accuracy: 65, accuracy_delta: 5, partial: false });
    expect(payload.weeks[2]).toMatchObject({ accuracy: 70, accuracy_delta: 5, partial: true });
    expect(payload.weeks[2].summary_text).toBeTruthy();
    expect(payload.overall.games).toBe(3);
    expect(payload.overall.accuracy_delta).toBe(5);
  });

  it('freezes a closed week: a second read ignores changed and added games', async () => {
    const first = await call(2, '?weeks=4&refresh=1');
    const frozen = JSON.parse(JSON.stringify(first.weeks[0]));
    expect(frozen.accuracy).toBe(50);
    expect(frozen.summary_text).toBeTruthy();

    const rows = db.prepare('SELECT COUNT(*) AS n FROM weekly_reports WHERE user_id = 2').get() as { n: number };
    expect(rows.n).toBe(1);
    const snaps = db.prepare('SELECT COUNT(*) AS n FROM pattern_snapshots WHERE user_id = 2').get() as { n: number };

    // Re-analysis changes the score and a late game is imported into the same
    // closed week — neither may rewrite the frozen report.
    db.prepare(`UPDATE analyses SET accuracy_white = 90 WHERE game_id = (SELECT id FROM games WHERE user_id = 2)`).run();
    addGame(2, isoDay(lastMonday), 99);

    const second = await call(2, '?weeks=4&refresh=1');
    expect(second.weeks[0]).toEqual(frozen);
    // The snapshot table was written on first read and is untouched by reads.
    expect((db.prepare('SELECT COUNT(*) AS n FROM pattern_snapshots WHERE user_id = 2').get() as { n: number }).n)
      .toBe(snaps.n);
  });

  it('returns a valid empty payload for a user without analysed games', async () => {
    const payload = await call(3, '?weeks=12&refresh=1');
    expect(payload.weeks).toEqual([]);
    expect(payload.overall).toEqual({
      games: 0, accuracy: null, accuracy_delta: null,
      errors_per_game: 0, errors_delta: null, top_pattern: null,
    });
  });

  it('clamps the window to 4–52 weeks', async () => {
    // weeks=1 → 4: the game three weeks ago is still inside, 40 weeks is not.
    const min = await call(4, '?weeks=1&refresh=1');
    expect(min.weeks.map((w) => w.week_start)).toEqual([addDays(thisMonday, -21), thisMonday]);

    // weeks=1000 → 52: the 55-week-old game is out, the 40-week-old one is in.
    const max = await call(4, '?weeks=1000&refresh=1');
    expect(max.weeks.map((w) => w.week_start)).toEqual([
      addDays(thisMonday, -40 * 7), addDays(thisMonday, -21), thisMonday,
    ]);
  });
});
