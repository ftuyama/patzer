// A player profile's "recent games" must read exactly like the Home list:
// both sides' accuracy, an `analyzed` flag, and a time class even for rows
// whose stored time_class is null. This pins the API side of that contract.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'patzer-players-'));
process.env.DB_PATH = join(dir, 'players.db');

type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

interface RecentGame {
  id: number;
  white: string;
  black: string;
  result: string;
  user_color: 'white' | 'black' | null;
  time_control: string | null;
  time_class: string | null;
  opening_name: string | null;
  end_time: string;
  analyzed: number;
  accuracy_white: number | null;
  accuracy_black: number | null;
}

let db: DbModule['db'];
let router: Router;
let cookie: string;
let scoring: number;

function addUser(id: number, name: string): void {
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`).run(id, name);
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (?, ?)`).run(id, name);
}

/** Insert one game for `userId`, optionally with an analysis at `version`. */
function addGame(args: {
  id: number; userId: number; endTime: string; white?: string; black?: string;
  color: 'white' | 'black'; timeClass?: string | null; timeControl?: string | null;
  analysis?: { version: number; accuracy_white: number; accuracy_black: number };
}): void {
  db.prepare(`
    INSERT INTO games (id, user_id, source, pgn, white, black, result, time_control, time_class, end_time, user_color)
    VALUES (?, ?, 'played', '', ?, ?, 'win', ?, ?, ?, ?)
  `).run(args.id, args.userId, args.white ?? 'Rival', args.black ?? 'Opponent',
    args.timeControl ?? null, args.timeClass ?? null, args.endTime, args.color);
  if (args.analysis) {
    db.prepare(`
      INSERT INTO analyses (game_id, depth, moves_json, scoring_version, accuracy_white, accuracy_black)
      VALUES (?, 12, '[]', ?, ?, ?)
    `).run(args.id, args.analysis.version, args.analysis.accuracy_white, args.analysis.accuracy_black);
  }
}

async function profile(id: number): Promise<{ recent_games: RecentGame[] }> {
  const res = await router.request(`/${id}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ recent_games: RecentGame[] }>;
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  ({ SCORING_VERSION: scoring } = await import('../src/chess/classifier.js'));
  router = (await import('../src/routes/players.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');

  addUser(1, 'Me');
  addUser(2, 'Rival');
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  addGame({
    id: 10, userId: 2, endTime: '2026-03-02T10:00:00', color: 'white',
    timeClass: 'blitz', timeControl: '300+0',
    analysis: { version: scoring, accuracy_white: 82.5, accuracy_black: 71.2 },
  });
  addGame({
    id: 11, userId: 2, endTime: '2026-03-01T10:00:00', color: 'black',
    timeClass: null, timeControl: '600+0',
    analysis: { version: scoring - 1, accuracy_white: 99, accuracy_black: 99 },
  });
  addGame({ id: 12, userId: 2, endTime: '2026-02-28T10:00:00', color: 'white', timeClass: 'rapid', timeControl: '600+0' });
  // Another user's game must never leak into this profile.
  addGame({ id: 13, userId: 1, endTime: '2026-03-03T10:00:00', color: 'white', timeClass: 'bullet', timeControl: '60+0' });
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/players/:id recent games', () => {
  it('only lists the profile owner’s games, newest first', async () => {
    const { recent_games } = await profile(2);
    expect(recent_games.map((g) => g.id)).toEqual([10, 11, 12]);
  });

  it('carries the accuracy pair the Home list shows, for a current analysis', async () => {
    const { recent_games } = await profile(2);
    expect(recent_games[0]).toMatchObject({
      analyzed: 1, accuracy_white: 82.5, accuracy_black: 71.2, time_class: 'blitz',
    });
  });

  it('treats an analysis from an older scoring version as unreviewed', async () => {
    const { recent_games } = await profile(2);
    expect(recent_games[1]).toMatchObject({
      analyzed: 0, accuracy_white: null, accuracy_black: null,
    });
  });

  it('derives a missing time class from the clock string', async () => {
    const { recent_games } = await profile(2);
    // Row 11 stores no time_class but has a 600+0 clock; row 12 has one already.
    expect(recent_games[1]!.time_class).toBe('rapid');
    expect(recent_games[2]!.time_class).toBe('rapid');
  });

  it('reports an unanalysed game without accuracy numbers', async () => {
    const { recent_games } = await profile(2);
    expect(recent_games[2]).toMatchObject({ analyzed: 0, accuracy_white: null, accuracy_black: null });
  });
});
