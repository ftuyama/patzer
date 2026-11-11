import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-settings-'));
process.env.DB_PATH = join(dir, 'settings.db');

type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let db: DbModule['db'];
let settings: Router;
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  settings = (await import('../src/routes/settings.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'player', 'x', 'user')`).run();
  // Deliberately rely on the column defaults: an existing install gets the
  // value from ensureColumn, a fresh one from the schema.
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Player')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

async function patch(body: unknown) {
  const res = await settings.request('/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { profile?: { move_animation?: string } } };
}

function stored(): string {
  return (db.prepare('SELECT move_animation FROM profiles WHERE user_id = 1').get() as { move_animation: string }).move_animation;
}

describe('piece animation preference', () => {
  it('defaults to medium for profiles that predate the setting', () => {
    expect(stored()).toBe('medium');
  });

  it.each(['off', 'medium', 'slow'])('saves %s and returns the fresh profile', async (value) => {
    const { status, json } = await patch({ move_animation: value });
    expect(status).toBe(200);
    expect(json.profile?.move_animation).toBe(value);
    expect(stored()).toBe(value);
  });

  it('accepts fast as well', async () => {
    expect((await patch({ move_animation: 'fast' })).status).toBe(200);
    expect(stored()).toBe('fast');
  });

  it('rejects anything outside the four names, without touching the row', async () => {
    const before = stored();
    for (const bad of ['fastest', '200', 200, '', null]) {
      expect((await patch({ move_animation: bad })).status, String(bad)).toBe(400);
    }
    expect(stored()).toBe(before);
  });

  it('leaves other profile fields alone when only the animation changes', async () => {
    await patch({ move_animation: 'off' });
    const row = db.prepare('SELECT display_name, board_theme FROM profiles WHERE user_id = 1').get() as { display_name: string; board_theme: string };
    expect(row).toEqual({ display_name: 'Player', board_theme: 'wood' });
  });
});
