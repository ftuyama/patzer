import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import type { AuthedUser, Profile } from './types.js';

// LOCAL_MODE keeps one account (`local`, always an admin) that every request
// implicitly acts as. It is created lazily and idempotently at first use, so a
// fresh desktop install doesn't need the setup wizard.
export const LOCAL_USERNAME = 'local';

let cached: AuthedUser | null = null;

interface LocalUserRow {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
}

function readLocalUser(): AuthedUser | null {
  const user = db
    .prepare('SELECT id, username, role, created_at FROM users WHERE username = ?')
    .get(LOCAL_USERNAME) as LocalUserRow | undefined;
  if (!user) return null;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id) as Profile | undefined;
  if (!profile) return null;
  return { ...user, profile };
}

/**
 * Ensure the single local account exists. Safe to call on every request:
 * a second call finds the row and does nothing. The password hash is random
 * bytes (not a valid bcrypt hash), so the account cannot be logged into with a
 * password even if the login form were reachable.
 */
export function ensureLocalUser(): AuthedUser {
  const existing = readLocalUser();
  if (existing) return existing;

  const displayName = (process.env.LOCAL_USER_NAME ?? '').trim() || 'Local player';
  const unusableHash = `!local-${randomBytes(32).toString('hex')}`;

  // The UNIQUE username constraint + the re-check inside the transaction make
  // this safe when two requests race on a cold start.
  db.transaction(() => {
    if (readLocalUser()) return;
    const result = db
      .prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`)
      .run(LOCAL_USERNAME, unusableHash);
    const id = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior)
       VALUES (?, ?, 'en', 'intermediate', 'on_demand')`,
    ).run(id, displayName);
  })();

  cached = readLocalUser();
  if (!cached) throw new Error('local_mode: failed to create the local user');
  return cached;
}

/**
 * Cached view of the local user. Profile edits (display name, language, …) go
 * through the normal settings routes, so the cache is short-lived rather than
 * permanent; `resetLocalUserCache` exists for tests and for callers that know
 * they just wrote to the row.
 */
const CACHE_TTL_MS = 5_000;
let cachedAt = 0;

export function localUser(): AuthedUser {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  const user = ensureLocalUser();
  cached = user;
  cachedAt = Date.now();
  return user;
}

export function resetLocalUserCache(): void {
  cached = null;
  cachedAt = 0;
}
