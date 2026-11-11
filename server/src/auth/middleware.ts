import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { lookupUser, SESSION_COOKIE_NAME } from './sessions.js';
import { userCount } from '../db.js';
import { config } from '../config.js';
import { localUser } from '../localMode.js';
import type { AuthedUser } from '../types.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthedUser;
  }
}

/**
 * The request's user. Session cookies win; in LOCAL_MODE only, a request with
 * no usable session falls back to the single local account. With the flag off
 * this is exactly the old `lookupUser` behaviour (null → 401 further down).
 */
export function currentUser(c: Context): AuthedUser | null {
  const sessionUser = lookupUser(getCookie(c, SESSION_COOKIE_NAME));
  if (sessionUser) return sessionUser;
  if (!config.localMode) return null;
  return localUser();
}

export const requireSetupComplete: MiddlewareHandler = async (c, next) => {
  // Local mode is single-user by definition: there is nothing to set up.
  if (config.localMode) return next();
  if (userCount() === 0) return c.json({ error: 'setup_required' }, 409);
  await next();
};

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  c.set('user', user);
  await next();
};
