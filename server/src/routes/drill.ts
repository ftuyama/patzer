// Pattern drills — "find the best move in this position" filtered by the
// habit the diagnosis found most expensive. The positions come from the stored
// pattern events (patterns/store.ts), with a live-detection fallback while the
// event table is still empty (chess/drills.ts).
//
// GET /api/train/drill?pattern=hung_piece&count=10&mode=find_best

import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware.js';
import { PATTERN_KEYS, type PatternKey } from '../chess/patterns.js';
import { buildDrill, clampDrillCount, MAX_DRILL_COUNT, MIN_DRILL_COUNT } from '../chess/drills.js';

const router = new Hono();
router.use('*', requireAuth);

const DEFAULT_COUNT = 10;

function parsePattern(raw: string | undefined): PatternKey | 'mixed' | null {
  if (!raw || raw === 'mixed') return 'mixed';
  return (PATTERN_KEYS as string[]).includes(raw) ? (raw as PatternKey) : null;
}

router.get('/drill', (c) => {
  const me = c.get('user');

  const pattern = parsePattern(c.req.query('pattern'));
  if (pattern === null) {
    return c.json({ error: 'invalid_pattern', patterns: [...PATTERN_KEYS, 'mixed'] }, 400);
  }

  const rawMode = c.req.query('mode') ?? 'find_best';
  if (rawMode !== 'find_best' && rawMode !== 'spot_threat') {
    return c.json({ error: 'invalid_mode', modes: ['find_best', 'spot_threat'] }, 400);
  }

  const rawCount = c.req.query('count');
  const requested = rawCount === undefined || rawCount === '' ? DEFAULT_COUNT : Number(rawCount);
  const count = clampDrillCount(requested);

  const payload = buildDrill(me.id, { pattern, mode: rawMode, count });
  return c.json(payload);
});

export default router;
