// Read-only metadata the Play setup screen needs before a socket exists.

import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware.js';
import { BOT_LEVELS } from '../chess/botLevels.js';

const router = new Hono();
router.use('*', requireAuth);

// The bot tiers' approximate ratings. Served from the same config the engine
// uses, so the cards can't drift from what you actually play.
router.get('/bots', (c) => c.json({ bots: BOT_LEVELS }));

export default router;
