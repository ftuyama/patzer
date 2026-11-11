// Pattern drills — "find the best move in this position" filtered by the
// habit the diagnosis found most expensive.
//
// WAVE 0 CONTRACT STUB. Owned by the Drills workstream. Mounted under
// /api/train so it shares the trainer's namespace; keep the path GET /drill.
// Implement against patterns/store.ts (listEvents with motif) and
// patterns/contracts.ts (DrillPayload).
//
// GET /api/train/drill?pattern=hung_piece&count=10&mode=find_best

import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/drill', (c) => c.json({ error: 'not_implemented', feature: 'drill' }, 501));

export default router;
