// Progress — weekly improvement series and frozen weekly reports.
//
// WAVE 0 CONTRACT STUB. Owned by the Progress workstream; the route stays
// mounted so the web app can code against it from day one. Replace the 501
// with the real implementation (patterns/store.ts + patterns/contracts.ts
// WeeklyProgressPayload) without touching index.ts.
//
// GET /api/progress?weeks=12

import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/', (c) => c.json({ error: 'not_implemented', feature: 'progress' }, 501));

export default router;
