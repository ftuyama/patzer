// Opening theory gaps — where the player leaves the book and what it costs.
//
// GET /api/openings/theory?color=white|black|both&games=100
//   → TheoryGapPayload (see patterns/contracts.ts)
//
// The scan is expensive (it replays every analysed game and may call the
// Lichess Opening Explorer), so the finished payload is memoised per
// user+params for ten minutes. An `unavailable` result is kept only briefly so
// an explorer outage clears as soon as Lichess comes back.

import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware.js';
import { clampGames, normalizeColor, scanTheoryGaps } from '../openings/theory.js';
import type { TheoryGapPayload } from '../patterns/contracts.js';

const router = new Hono();
router.use('*', requireAuth);

const CACHE_TTL_MS = 10 * 60_000;
const UNAVAILABLE_TTL_MS = 60_000;

interface Entry {
  at: number;
  ttl: number;
  payload: TheoryGapPayload;
}

const cache = new Map<string, Entry>();

/** Test hook: drop the per-user memoisation. */
export function clearTheoryRouteCache(): void {
  cache.clear();
}

router.get('/theory', async (c) => {
  const me = c.get('user');
  const color = normalizeColor(c.req.query('color'));
  const games = clampGames(c.req.query('games'));
  const key = `${me.id}:${color}:${games}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    c.header('Cache-Control', 'private, max-age=600');
    return c.json(hit.payload);
  }

  // scanTheoryGaps never throws on an upstream failure; it degrades instead.
  const payload = await scanTheoryGaps(me.id, { color, games });
  cache.set(key, {
    at: Date.now(),
    ttl: payload.source === 'unavailable' ? UNAVAILABLE_TTL_MS : CACHE_TTL_MS,
    payload,
  });
  c.header('Cache-Control', 'private, max-age=600');
  return c.json(payload);
});

export default router;
