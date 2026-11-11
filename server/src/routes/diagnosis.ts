// Diagnosis — the "what keeps costing me games?" report.
//
// Aggregates deterministic pattern events (chess/patterns.ts) over the user's
// most recent analysed games and ranks the top habits by severity. Also builds
// a small weekly series so progress can be seen on the same page. Templated,
// no LLM, no re-analysis.
//
// The events themselves are a materialized view of `analyses.moves_json`
// (`error_events`, written by saveAnalysis and scripts/backfill-patterns.ts),
// so this route normally only reads rows. Games analysed before the event
// store existed have no rows yet: those fall back to live detection for that
// game, which keeps the page populated until the backfill catches up. The
// weekly/overview counters still come from the analysis row (accuracy and
// per-game classification counts are not part of a pattern event), so the
// payload shape is unchanged.
//
// Cached for 60 s per user; `games` is part of the cache key so changing the
// window recomputes immediately.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { detectGamePatterns, summarizePatterns, type GameMeta, type PatternEvent } from '../chess/patterns.js';
import { analysedGameCount, hasEventsForGame, listEvents, type StoredPatternEvent } from '../patterns/store.js';
import type { DiagnosisPayload, DiagnosisWeeklyBucket } from '../patterns/contracts.js';
import type { AnalyzedMove, PhaseSplit } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface Row {
  game_id: number;
  user_color: 'white' | 'black' | null;
  moves_json: string;
  phase_split_json: string | null;
  accuracy_white: number | null;
  accuracy_black: number | null;
  end_time: string | null;
  eco: string | null;
  opening_name: string | null;
  white: string | null;
  black: string | null;
  result: string | null;
}

interface WeeklyBucket extends DiagnosisWeeklyBucket {}

const CACHE_TTL_MS = 60_000;
const cache = new Map<number, { at: number; payload: DiagnosisPayload }>();

function isoWeekStart(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay() || 7; // Monday = 1
  copy.setUTCDate(copy.getUTCDate() - (day - 1));
  return copy.toISOString().slice(0, 10);
}

function countGames(userId: number): { total: number; pending: number } {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN a.game_id IS NULL OR a.scoring_version < ? THEN 1 ELSE 0 END), 0) AS pending
      FROM games g
      LEFT JOIN analyses a ON a.game_id = g.id
     WHERE g.user_id = ?
  `).get(SCORING_VERSION, userId) as { total: number; pending: number };
  return { total: row.total, pending: row.pending };
}

function metaFor(r: Row): GameMeta {
  const color = r.user_color ?? 'white';
  return {
    game_id: r.game_id,
    user_color: color,
    end_time: r.end_time,
    eco: r.eco,
    opening_name: r.opening_name,
    opponent: color === 'white' ? r.black : r.white,
    result: r.result,
  };
}

/** Stored rows carry row identity; the payload's `examples` must stay a plain
 *  `PatternEvent` so stored and live-detected games serialise identically. */
function toPatternEvent(e: StoredPatternEvent): PatternEvent {
  return {
    motif: e.motif,
    game_id: e.game_id,
    ply: e.ply,
    phase: e.phase,
    color: e.color,
    severity: e.severity,
    cp_loss: e.cp_loss,
    classification: e.classification,
    fen: e.fen,
    played_san: e.played_san,
    best_san: e.best_san,
    end_time: e.end_time,
    eco: e.eco,
    opening_name: e.opening_name,
    opponent: e.opponent,
    result: e.result,
  };
}

/** Group the stored events by game so the per-game loop can use them. */
function eventsByGame(userId: number, limitGames: number): Map<number, PatternEvent[]> {
  const byGame = new Map<number, PatternEvent[]>();
  for (const stored of listEvents(userId, { limitGames })) {
    const list = byGame.get(stored.game_id) ?? [];
    list.push(toPatternEvent(stored));
    byGame.set(stored.game_id, list);
  }
  return byGame;
}

/**
 * The one place both data paths meet: stored events when the game has them,
 * live detection when it does not. A game whose detection produced no events
 * has no rows to read (the store only writes events), so it re-runs the cheap
 * detector — `hasEventsForGame` still saves the (rare) case where another
 * current-version row exists but the listEvents window missed it.
 */
function gameEventsFor(
  r: Row,
  moves: AnalyzedMove[],
  split: PhaseSplit | null,
  stored: Map<number, PatternEvent[]>,
): PatternEvent[] {
  const recorded = stored.get(r.game_id);
  if (recorded) return recorded;
  if (hasEventsForGame(r.game_id)) return [];
  return detectGamePatterns(moves, metaFor(r), split);
}

function build(userId: number, windowGames: number, counts: { total: number; pending: number }): DiagnosisPayload {
  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, a.moves_json, a.phase_split_json,
           a.accuracy_white, a.accuracy_black,
           g.end_time, a.opening_eco AS eco, a.opening_name, g.white, g.black, g.result
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ? AND (g.start_fen IS NULL OR g.start_fen = '')
    ORDER BY COALESCE(g.end_time, g.created_at) DESC, g.id DESC
    LIMIT ?
  `).all(userId, SCORING_VERSION, windowGames) as Row[];

  const stored = eventsByGame(userId, windowGames);
  const events: PatternEvent[] = [];
  const weekly = new Map<string, WeeklyBucket>();
  let accuracySum = 0;
  let accuracyN = 0;
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let userMoves = 0;
  const dates: string[] = [];

  for (const r of rows) {
    const color = r.user_color ?? 'white';
    const accuracy = color === 'white' ? r.accuracy_white : r.accuracy_black;
    if (accuracy != null) { accuracySum += accuracy; accuracyN++; }

    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { moves = []; }
    const split = r.phase_split_json ? (JSON.parse(r.phase_split_json) as PhaseSplit) : null;

    let gameBlunders = 0;
    let gameMistakes = 0;
    let gameInaccuracies = 0;
    for (const m of moves) {
      const side = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== color) continue;
      userMoves++;
      if (m.classification === 'blunder') gameBlunders++;
      else if (m.classification === 'mistake' || m.classification === 'miss') gameMistakes++;
      else if (m.classification === 'inaccuracy') gameInaccuracies++;
    }
    blunders += gameBlunders;
    mistakes += gameMistakes;
    inaccuracies += gameInaccuracies;

    const gameEvents = gameEventsFor(r, moves, split, stored);
    events.push(...gameEvents);

    const day = (r.end_time ?? '').slice(0, 10);
    if (day) dates.push(day);
    const start = day ? isoWeekStart(new Date(`${day}T12:00:00Z`)) : null;
    if (start) {
      const b = weekly.get(start) ?? {
        week_start: start, games: 0, wins: 0, draws: 0, losses: 0,
        accuracy: null, mistakes_per_game: 0, blunders_per_game: 0, top_pattern: null,
      };
      b.games++;
      const res = (r.result ?? '').toLowerCase();
      const won = res === '1-0' ? color === 'white' : res === '0-1' ? color === 'black' : false;
      const drew = res.includes('1/2') || res === 'draw' || res === '½-½';
      if (drew) b.draws++;
      else if (won) b.wins++;
      else b.losses++;
      b.accuracy = accuracy != null
        ? Math.round((((b.accuracy ?? 0) * (b.games - 1) + accuracy) / b.games) * 10) / 10
        : b.accuracy;
      b.mistakes_per_game = Math.round(((b.mistakes_per_game * (b.games - 1) + gameMistakes) / b.games) * 100) / 100;
      b.blunders_per_game = Math.round(((b.blunders_per_game * (b.games - 1) + gameBlunders) / b.games) * 100) / 100;
      const top = [...gameEvents].sort((a, b2) => b2.severity - a.severity)[0];
      if (top) b.top_pattern = b.top_pattern ?? top.motif;
      weekly.set(start, b);
    }
  }

  const gamesAnalyzed = analysedGameCount(userId, windowGames);
  const patterns = summarizePatterns(events, Math.max(1, gamesAnalyzed));
  const weeklyRows = [...weekly.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)).slice(-8);

  dates.sort();
  return {
    generated_at: new Date().toISOString(),
    games_analyzed: gamesAnalyzed,
    total_games: counts.total,
    pending_games: counts.pending,
    window_games: windowGames,
    overview: {
      accuracy: accuracyN ? Math.round((accuracySum / accuracyN) * 10) / 10 : null,
      blunders_per_game: rows.length ? Math.round((blunders / rows.length) * 100) / 100 : 0,
      mistakes_per_game: rows.length ? Math.round(((mistakes + inaccuracies) / rows.length) * 100) / 100 : 0,
      inaccuracies_per_game: rows.length ? Math.round((inaccuracies / rows.length) * 100) / 100 : 0,
      date_from: dates[0] ?? null,
      date_to: dates[dates.length - 1] ?? null,
    },
    patterns: patterns.slice(0, 5),
    weekly: weeklyRows,
  };
}

router.get('/', (c) => {
  const me = c.get('user');
  const requested = Number(c.req.query('games') ?? 100);
  const windowGames = Math.min(200, Math.max(20, Number.isFinite(requested) ? requested : 100));

  // Include the pending count in the cache key: a background "analyze all"
  // changes it without touching `analyses` through this route, and a stale
  // cache would keep telling the user there is nothing left to analyze.
  const counts = countGames(me.id);
  const hit = cache.get(me.id);
  if (
    hit && Date.now() - hit.at < CACHE_TTL_MS
    && hit.payload.window_games === windowGames
    && hit.payload.pending_games === counts.pending
  ) {
    return c.json(hit.payload);
  }
  const payload = build(me.id, windowGames, counts);
  cache.set(me.id, { at: Date.now(), payload });
  return c.json(payload);
});

export default router;
