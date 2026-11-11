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
// Cached for 60 s per user; `games` and `time_class` are part of the cache key
// so changing either recomputes immediately.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { detectGamePatterns, summarizePatterns, type GameMeta, type PatternEvent } from '../chess/patterns.js';
import { hasEventsForGame, listEvents, type StoredPatternEvent } from '../patterns/store.js';
import type {
  DiagnosisModeBreakdown,
  DiagnosisPayload,
  DiagnosisWeeklyBucket,
} from '../patterns/contracts.js';
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
  time_class: string | null;
  eco: string | null;
  opening_name: string | null;
  white: string | null;
  black: string | null;
  result: string | null;
}

interface WeeklyBucket extends DiagnosisWeeklyBucket {}

/** Fastest first — the tab order the page draws, and the tie-break for the
 *  coach's "which mode is worst" comparison. */
const MODE_ORDER = ['bullet', 'blitz', 'rapid', 'daily', 'other'] as const;
type ModeKey = typeof MODE_ORDER[number];

function modeOf(timeClass: string | null): ModeKey {
  return (MODE_ORDER as readonly string[]).includes(timeClass ?? '')
    ? (timeClass as ModeKey)
    : 'other';
}

/** The four rated classes are valid filters; anything else means "no filter". */
function parseMode(raw: string | undefined): ModeKey | null {
  if (!raw) return null;
  return raw === 'bullet' || raw === 'blitz' || raw === 'rapid' || raw === 'daily' ? raw : null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; pending: number; payload: DiagnosisPayload }>();

function isoWeekStart(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay() || 7; // Monday = 1
  copy.setUTCDate(copy.getUTCDate() - (day - 1));
  return copy.toISOString().slice(0, 10);
}

/** Mirrors `modeOf` in SQL, so counts and breakdowns bucket games the same way. */
const MODE_SQL = `CASE WHEN g.time_class IN ('bullet', 'blitz', 'rapid', 'daily')
  THEN g.time_class ELSE 'other' END`;

function countGames(userId: number, timeClass: ModeKey | null): { total: number; pending: number } {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN a.game_id IS NULL OR a.scoring_version < ? THEN 1 ELSE 0 END), 0) AS pending
      FROM games g
      LEFT JOIN analyses a ON a.game_id = g.id
     WHERE g.user_id = ? AND (? IS NULL OR ${MODE_SQL} = ?)
  `).get(SCORING_VERSION, userId, timeClass, timeClass) as { total: number; pending: number };
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

/** Everything one bucket of games contributes to a payload. Keeping the
 *  accumulation in a value (instead of a closure per bucket) is what lets a
 *  single pass feed the "all modes" view and each time class at once. */
interface Acc {
  games: number;
  accuracySum: number;
  accuracyN: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  events: PatternEvent[];
  weekly: Map<string, WeeklyBucket>;
  dates: string[];
}

function emptyAcc(): Acc {
  return {
    games: 0, accuracySum: 0, accuracyN: 0,
    blunders: 0, mistakes: 0, inaccuracies: 0,
    events: [], weekly: new Map(), dates: [],
  };
}

/** Average of per-game values already accumulated, one decimal. */
function mean(sum: number, n: number): number | null {
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

function perGame(total: number, games: number): number {
  return games ? Math.round((total / games) * 100) / 100 : 0;
}

function absorb(
  acc: Acc,
  r: Row,
  gameEvents: PatternEvent[],
  accuracy: number | null,
  counts: { blunders: number; mistakes: number; inaccuracies: number },
): void {
  acc.games++;
  if (accuracy != null) { acc.accuracySum += accuracy; acc.accuracyN++; }
  acc.blunders += counts.blunders;
  acc.mistakes += counts.mistakes;
  acc.inaccuracies += counts.inaccuracies;
  acc.events.push(...gameEvents);

  const day = (r.end_time ?? '').slice(0, 10);
  if (!day) return;
  acc.dates.push(day);
  const start = isoWeekStart(new Date(`${day}T12:00:00Z`));
  const b = acc.weekly.get(start) ?? {
    week_start: start, games: 0, wins: 0, draws: 0, losses: 0,
    accuracy: null, mistakes_per_game: 0, blunders_per_game: 0, top_pattern: null,
  };
  b.games++;
  const color = r.user_color ?? 'white';
  const res = (r.result ?? '').toLowerCase();
  const won = res === '1-0' ? color === 'white' : res === '0-1' ? color === 'black' : false;
  const drew = res.includes('1/2') || res === 'draw' || res === '½-½';
  if (drew) b.draws++;
  else if (won) b.wins++;
  else b.losses++;
  b.accuracy = accuracy != null
    ? Math.round((((b.accuracy ?? 0) * (b.games - 1) + accuracy) / b.games) * 10) / 10
    : b.accuracy;
  b.mistakes_per_game = Math.round(((b.mistakes_per_game * (b.games - 1) + counts.mistakes) / b.games) * 100) / 100;
  b.blunders_per_game = Math.round(((b.blunders_per_game * (b.games - 1) + counts.blunders) / b.games) * 100) / 100;
  const top = [...gameEvents].sort((x, y) => y.severity - x.severity)[0];
  if (top) b.top_pattern = b.top_pattern ?? top.motif;
  acc.weekly.set(start, b);
}

function payloadFor(
  acc: Acc,
  counts: { total: number; pending: number },
  windowGames: number,
  timeClass: ModeKey | null,
  modes: DiagnosisModeBreakdown[],
): DiagnosisPayload {
  const weeklyRows = [...acc.weekly.values()]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-8);
  const dates = [...acc.dates].sort();

  return {
    generated_at: new Date().toISOString(),
    games_analyzed: acc.games,
    total_games: counts.total,
    pending_games: counts.pending,
    window_games: windowGames,
    time_class: timeClass,
    modes,
    overview: {
      accuracy: mean(acc.accuracySum, acc.accuracyN),
      blunders_per_game: perGame(acc.blunders, acc.games),
      mistakes_per_game: perGame(acc.mistakes + acc.inaccuracies, acc.games),
      inaccuracies_per_game: perGame(acc.inaccuracies, acc.games),
      date_from: dates[0] ?? null,
      date_to: dates[dates.length - 1] ?? null,
    },
    patterns: summarizePatterns(acc.events, Math.max(1, acc.games)).slice(0, 5),
    weekly: weeklyRows,
  };
}

function breakdownFor(key: ModeKey, acc: Acc): DiagnosisModeBreakdown {
  const summaries = summarizePatterns(acc.events, Math.max(1, acc.games)).slice(0, 3);
  return {
    time_class: key,
    games: acc.games,
    accuracy: mean(acc.accuracySum, acc.accuracyN),
    blunders_per_game: perGame(acc.blunders, acc.games),
    mistakes_per_game: perGame(acc.mistakes + acc.inaccuracies, acc.games),
    top_patterns: summaries.map((s) => ({
      key: s.key,
      count: s.count,
      games_affected: s.games_affected,
      score: s.score,
      avg_severity: s.avg_severity,
    })),
  };
}

/**
 * One query, one pass, one payload per time class. The window is always the
 * most recent N analysed games *overall*; a mode filter only picks which
 * bucket the payload is read from, so switching tabs costs no extra query and
 * the breakdowns stay comparable to each other.
 */
function build(
  userId: number,
  windowGames: number,
  timeClass: ModeKey | null,
  counts: { total: number; pending: number },
): DiagnosisPayload {
  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, a.moves_json, a.phase_split_json,
           a.accuracy_white, a.accuracy_black,
           g.end_time, g.time_class,
           a.opening_eco AS eco, a.opening_name, g.white, g.black, g.result
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ? AND (g.start_fen IS NULL OR g.start_fen = '')
    ORDER BY COALESCE(g.end_time, g.created_at) DESC, g.id DESC
    LIMIT ?
  `).all(userId, SCORING_VERSION, windowGames) as Row[];

  const stored = eventsByGame(userId, windowGames);
  const all = emptyAcc();
  const byMode = new Map<ModeKey, Acc>();

  for (const r of rows) {
    const color = r.user_color ?? 'white';
    const accuracy = color === 'white' ? r.accuracy_white : r.accuracy_black;

    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { moves = []; }
    const split = r.phase_split_json ? (JSON.parse(r.phase_split_json) as PhaseSplit) : null;

    const gameCounts = { blunders: 0, mistakes: 0, inaccuracies: 0 };
    for (const m of moves) {
      const side = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== color) continue;
      if (m.classification === 'blunder') gameCounts.blunders++;
      else if (m.classification === 'mistake' || m.classification === 'miss') gameCounts.mistakes++;
      else if (m.classification === 'inaccuracy') gameCounts.inaccuracies++;
    }

    const gameEvents = gameEventsFor(r, moves, split, stored);
    absorb(all, r, gameEvents, accuracy, gameCounts);

    const key = modeOf(r.time_class);
    const acc = byMode.get(key) ?? emptyAcc();
    absorb(acc, r, gameEvents, accuracy, gameCounts);
    byMode.set(key, acc);
  }

  const modes = MODE_ORDER
    .filter((k) => (byMode.get(k)?.games ?? 0) > 0)
    .map((k) => breakdownFor(k, byMode.get(k)!));

  const source = timeClass ? byMode.get(timeClass) ?? emptyAcc() : all;
  return payloadFor(source, counts, windowGames, timeClass, modes);
}

router.get('/', (c) => {
  const me = c.get('user');
  const requested = Number(c.req.query('games') ?? 100);
  const windowGames = Math.min(200, Math.max(20, Number.isFinite(requested) ? requested : 100));
  const timeClass = parseMode(c.req.query('time_class'));

  // Include the pending count in the cache key: a background "analyze all"
  // changes it without touching `analyses` through this route, and a stale
  // cache would keep telling the user there is nothing left to analyze.
  const counts = countGames(me.id, timeClass);
  const cacheKey = `${me.id}|${windowGames}|${timeClass ?? 'all'}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.pending === counts.pending) {
    return c.json(hit.payload);
  }
  const payload = build(me.id, windowGames, timeClass, counts);
  cache.set(cacheKey, { at: Date.now(), pending: counts.pending, payload });
  return c.json(payload);
});

export default router;
