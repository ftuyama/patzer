import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

// The routes open the real database on import, so point it at a throwaway file
// first. LOCAL_MODE is deliberately unset here: the flag is exercised by
// flipping `config.localMode`, exactly like an operator would via the env.
const dir = mkdtempSync(join(tmpdir(), 'patzer-local-mode-'));
process.env.DB_PATH = join(dir, 'local.db');
delete process.env.LOCAL_MODE;
delete process.env.CHESS_LOCAL;
delete process.env.LOCAL_USER_NAME;
delete process.env.HOST;

type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let config: typeof import('../src/config.js')['config'];
let db: typeof import('../src/db.js')['db'];
let local: typeof import('../src/localMode.js');
let middleware: typeof import('../src/auth/middleware.js');
let setup: Router;
let auth: Router;
let authApp: Hono;
let gatedApp: Hono;

beforeAll(async () => {
  ({ config } = await import('../src/config.js'));
  ({ db } = await import('../src/db.js'));
  local = await import('../src/localMode.js');
  middleware = await import('../src/auth/middleware.js');
  setup = (await import('../src/routes/setup.js')).default;
  auth = (await import('../src/routes/auth.js')).default;

  // Minimal routers that expose the middlewares under test.
  authApp = new Hono();
  authApp.use('/private/*', middleware.requireAuth);
  authApp.get('/private/whoami', (c) => c.json({ user: c.get('user') }));
  authApp.use('/admin/*', middleware.requireAdmin);
  authApp.get('/admin/whoami', (c) => c.json({ user: c.get('user') }));

  gatedApp = new Hono();
  gatedApp.use('*', middleware.requireSetupComplete);
  gatedApp.get('/ping', (c) => c.json({ ok: true }));
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  config.localMode = false;
  local.resetLocalUserCache();
  db.exec('DELETE FROM sessions; DELETE FROM profiles; DELETE FROM users;');
});

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('LOCAL_MODE env parsing', () => {
  it('accepts CHESS_LOCAL as an alias and binds loopback by default', async () => {
    process.env.CHESS_LOCAL = '1';
    vi.resetModules();
    try {
      const fresh = await import('../src/config.js');
      expect(fresh.config.localMode).toBe(true);
      expect(fresh.config.host).toBe('127.0.0.1');
    } finally {
      delete process.env.CHESS_LOCAL;
      vi.resetModules();
    }
  });

  it('lets an explicit HOST win over the loopback default', async () => {
    process.env.LOCAL_MODE = '1';
    process.env.HOST = '0.0.0.0';
    vi.resetModules();
    try {
      const fresh = await import('../src/config.js');
      expect(fresh.config.localMode).toBe(true);
      expect(fresh.config.host).toBe('0.0.0.0');
    } finally {
      delete process.env.LOCAL_MODE;
      delete process.env.HOST;
      vi.resetModules();
    }
  });

  it('is off unless the flag is set', () => {
    expect(config.localMode).toBe(false);
  });
});

describe('normal auth with the flag off', () => {
  it('still 401s / 409s — the local user is a strict no-op', async () => {
    config.localMode = false;

    const whoami = await authApp.request('/private/whoami');
    expect(whoami.status).toBe(401);
    expect(await body(whoami)).toEqual({ error: 'unauthorized' });

    const admin = await authApp.request('/admin/whoami');
    expect(admin.status).toBe(401);

    // No users exist, so the setup gate fires exactly as before.
    const gated = await gatedApp.request('/ping');
    expect(gated.status).toBe(409);
    expect(await body(gated)).toEqual({ error: 'setup_required' });

    const session = await auth.request('/session');
    expect(await body(session)).toEqual({ user: null, local_mode: false, setup_required: true });
  });

  it('does not create the local user as a side effect', () => {
    expect(db.prepare(`SELECT id FROM users WHERE username = 'local'`).get()).toBeUndefined();
  });
});

describe('local mode', () => {
  beforeEach(() => {
    config.localMode = true;
  });

  it('creates the local admin idempotently', () => {
    const first = local.ensureLocalUser();
    const second = local.ensureLocalUser();
    const third = local.localUser();

    expect(first.id).toBe(second.id);
    expect(third.id).toBe(first.id);
    expect(first.username).toBe('local');
    expect(first.role).toBe('admin');
    expect(first.profile.display_name).toBe('Local player');

    expect(db.prepare(`SELECT COUNT(*) AS n FROM users`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM profiles`).get()).toEqual({ n: 1 });

    // The password hash is not a usable bcrypt hash.
    const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(first.id) as { password_hash: string };
    expect(row.password_hash.startsWith('!local-')).toBe(true);
  });

  it('honours LOCAL_USER_NAME', () => {
    process.env.LOCAL_USER_NAME = 'Felipe';
    local.resetLocalUserCache();
    try {
      expect(local.ensureLocalUser().profile.display_name).toBe('Felipe');
    } finally {
      delete process.env.LOCAL_USER_NAME;
      local.resetLocalUserCache();
    }
  });

  it('requireAuth succeeds without a cookie', async () => {
    const res = await authApp.request('/private/whoami');
    expect(res.status).toBe(200);
    const data = await body<{ user: { username: string; role: string } }>(res);
    expect(data.user.username).toBe('local');
    expect(data.user.role).toBe('admin');
  });

  it('requireAdmin succeeds because the local user is an admin', async () => {
    const res = await authApp.request('/admin/whoami');
    expect(res.status).toBe(200);
  });

  it('requireSetupComplete no longer 409s, even with zero users', async () => {
    db.exec('DELETE FROM profiles; DELETE FROM users;');
    const res = await gatedApp.request('/ping');
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true });
  });

  it('reports the local user as already set up and logged in', async () => {
    const status = await setup.request('/status');
    expect(await body(status)).toEqual({ setup_required: false, local_mode: true });

    const session = await auth.request('/session');
    const data = await body<{ user: { username: string }; local_mode: boolean; setup_required: boolean }>(session);
    expect(data.local_mode).toBe(true);
    expect(data.setup_required).toBe(false);
    expect(data.user.username).toBe('local');

    const me = await body<{ user: { username: string }; local_mode: boolean }>(await auth.request('/me'));
    expect(me.local_mode).toBe(true);
    expect(me.user.username).toBe('local');
  });
});
