// Opening theory gaps — where the player leaves the book and what it costs.
//
// WAVE 0 CONTRACT STUB. Owned by the Opening gaps workstream. Implement with
// theory_cache (db.ts) + the Lichess Opening Explorer
// (https://explorer.lichess.ovh/lichess?fen=...&speeds=...), returning
// TheoryGapPayload from patterns/contracts.ts. Keep the route path GET /theory.
//
// GET /api/openings/theory?color=white&games=100

import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/theory', (c) => c.json({ error: 'not_implemented', feature: 'theory' }, 501));

export default router;
