// Progress — weekly improvement series and frozen weekly reports.
//
// The series is built exactly like the diagnosis page's compact weekly list:
// the latest analysis per game, current scoring version, standard start
// position, bucketed by the ISO week (Monday) of the game's end date. Closed
// weeks are frozen on first read (`weekly_reports` + `pattern_snapshots`) and
// served from storage afterwards, so history never changes when old games are
// re-analysed. The current week is always computed live (`partial: true`) and
// therefore never frozen.
//
// GET /api/progress?weeks=12[&refresh=1]

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import {
  PATTERN_WEIGHT,
  detectGamePatterns,
  summarizePatterns,
  type GameMeta,
  type PatternEvent,
} from '../chess/patterns.js';
import type { WeeklyProgressPayload } from '../patterns/contracts.js';
import {
  addDays,
  isoWeekStart,
  renderWeeklyReport,
  type ProgressWeek,
} from '../patterns/report.js';
import {
  listWeeklyReports,
  saveWeeklyReport,
  upsertPatternSnapshot,
} from '../patterns/store.js';
import type { AnalyzedMove, Language, PhaseSplit } from '../types.js';

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

interface Bucket {
  week_start: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracySum: number;
  accuracyN: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  /** Sum of severity × motif weight — the "errors per game" numerator. */
  errorWeight: number;
  events: PatternEvent[];
}

interface ProgressPayload extends WeeklyProgressPayload {
  weeks: ProgressWeek[];
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; payload: ProgressPayload }>();

function clampWeeks(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 12;
  return Math.min(52, Math.max(4, Math.round(n)));
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function isDraw(result: string): boolean {
  return result.includes('1/2') || result === 'draw' || result === '½-½';
}

function isWin(result: string, color: 'white' | 'black'): boolean {
  return result === 'win' || (result === '1-0' && color === 'white') || (result === '0-1' && color === 'black');
}

function liveWeek(bucket: Bucket, partial: boolean, previous: ProgressWeek | null): ProgressWeek {
  const accuracy = bucket.accuracyN ? round(bucket.accuracySum / bucket.accuracyN, 1) : null;
  const previousAccuracy = previous?.accuracy ?? null;
  const summaries = summarizePatterns(bucket.events, Math.max(1, bucket.games));
  return {
    week_start: bucket.week_start,
    games: bucket.games,
    wins: bucket.wins,
    draws: bucket.draws,
    losses: bucket.losses,
    accuracy,
    accuracy_delta: accuracy != null && previousAccuracy != null
      ? round(accuracy - previousAccuracy, 1)
      : null,
    inaccuracies_per_game: round(bucket.inaccuracies / Math.max(1, bucket.games)),
    mistakes_per_game: round(bucket.mistakes / Math.max(1, bucket.games)),
    blunders_per_game: round(bucket.blunders / Math.max(1, bucket.games)),
    errors_per_game: round(bucket.errorWeight / Math.max(1, bucket.games)),
    top_patterns: summaries.slice(0, 3).map((s) => ({ key: s.key, count: s.count, score: s.score })),
    partial,
    summary_text: null,
  };
}

/** Parse a frozen week from `weekly_reports`; tolerate old or broken rows. */
function parseStored(payloadJson: string, summaryText: string | null): ProgressWeek | null {
  try {
    const parsed = JSON.parse(payloadJson) as ProgressWeek;
    if (!parsed || typeof parsed.week_start !== 'string' || typeof parsed.games !== 'number') return null;
    if (!Array.isArray(parsed.top_patterns)) parsed.top_patterns = [];
    parsed.partial = false;
    if (parsed.summary_text == null) parsed.summary_text = summaryText;
    return parsed;
  } catch {
    return null;
  }
}

function build(userId: number, weeks: number, language: Language): ProgressPayload {
  const currentStart = isoWeekStart(new Date());
  // The window is `weeks` calendar weeks including the current one.
  const cutoff = addDays(currentStart, -(weeks - 1) * 7);

  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, a.moves_json, a.phase_split_json,
           a.accuracy_white, a.accuracy_black,
           g.end_time, a.opening_eco AS eco, a.opening_name, g.white, g.black, g.result
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
      AND (g.start_fen IS NULL OR g.start_fen = '')
      AND date(COALESCE(g.end_time, g.created_at)) >= date(?)
    ORDER BY COALESCE(g.end_time, g.created_at) ASC, g.id ASC
  `).all(userId, SCORING_VERSION, cutoff) as Row[];

  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const day = (r.end_time ?? '').slice(0, 10);
    if (!day) continue; // undated games cannot be placed on a week
    const start = isoWeekStart(new Date(`${day}T12:00:00Z`));
    const color = r.user_color ?? 'white';
    const accuracy = color === 'white' ? r.accuracy_white : r.accuracy_black;

    const b = buckets.get(start) ?? {
      week_start: start, games: 0, wins: 0, draws: 0, losses: 0,
      accuracySum: 0, accuracyN: 0, inaccuracies: 0, mistakes: 0,
      blunders: 0, errorWeight: 0, events: [],
    };

    b.games++;
    const result = (r.result ?? '').toLowerCase();
    if (isDraw(result)) b.draws++;
    else if (isWin(result, color)) b.wins++;
    else b.losses++;
    if (accuracy != null) { b.accuracySum += accuracy; b.accuracyN++; }

    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { moves = []; }

    let gameInaccuracies = 0;
    let gameMistakes = 0;
    let gameBlunders = 0;
    for (const m of moves) {
      const side = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== color) continue;
      if (m.classification === 'blunder') gameBlunders++;
      else if (m.classification === 'mistake' || m.classification === 'miss') gameMistakes++;
      else if (m.classification === 'inaccuracy') gameInaccuracies++;
    }
    b.inaccuracies += gameInaccuracies;
    b.mistakes += gameMistakes;
    b.blunders += gameBlunders;

    const meta: GameMeta = {
      game_id: r.game_id,
      user_color: color,
      end_time: r.end_time,
      eco: r.eco,
      opening_name: r.opening_name,
      opponent: color === 'white' ? r.black : r.white,
      result: r.result,
    };
    let split: PhaseSplit | null = null;
    try { split = r.phase_split_json ? (JSON.parse(r.phase_split_json) as PhaseSplit) : null; } catch { split = null; }
    const events = detectGamePatterns(moves, meta, split);
    b.events.push(...events);
    for (const e of events) b.errorWeight += e.severity * PATTERN_WEIGHT[e.motif];

    buckets.set(start, b);
  }

  const ordered = [...buckets.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));

  // Frozen history, newest first. Only reports inside this window matter.
  const stored = new Map<string, ProgressWeek>();
  for (const row of listWeeklyReports(userId, weeks)) {
    const week = parseStored(row.payload_json, row.summary_text);
    if (week) stored.set(week.week_start, week);
  }

  const out: ProgressWeek[] = [];
  let previous: ProgressWeek | null = null;

  for (const bucket of ordered) {
    const isCurrent = bucket.week_start === currentStart;
    if (isCurrent) {
      // Always live: the week is still being played.
      const week = liveWeek(bucket, true, previous);
      week.summary_text = renderWeeklyReport(week, previous, language);
      out.push(week);
    } else {
      const frozen = stored.get(bucket.week_start);
      if (frozen) {
        // History is immutable once frozen — even if the underlying games
        // were re-analysed or deleted since.
        if (frozen.summary_text == null) frozen.summary_text = renderWeeklyReport(frozen, previous, language);
        out.push(frozen);
      } else {
        // First read of a closed week: freeze the numbers and the prose.
        const week = liveWeek(bucket, false, previous);
        week.summary_text = renderWeeklyReport(week, previous, language);
        saveWeeklyReport(userId, week.week_start, week, week.summary_text);
        upsertPatternSnapshot(userId, week.week_start, summarizePatterns(bucket.events, Math.max(1, bucket.games)));
        out.push(week);
      }
    }
    previous = out[out.length - 1]!;
  }

  const totalGames = out.reduce((sum, w) => sum + w.games, 0);
  const withAccuracy = out.filter((w) => w.accuracy != null);
  const accuracyWeight = withAccuracy.reduce((sum, w) => sum + w.games, 0);
  const overallAccuracy = accuracyWeight
    ? round(withAccuracy.reduce((sum, w) => sum + (w.accuracy as number) * w.games, 0) / accuracyWeight, 1)
    : null;

  const last = out[out.length - 1] ?? null;
  const beforeLast = out[out.length - 2] ?? null;

  const patternScore = new Map<string, number>();
  for (const w of out) {
    for (const p of w.top_patterns) patternScore.set(p.key, (patternScore.get(p.key) ?? 0) + p.score);
  }
  const topPattern = [...patternScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    generated_at: new Date().toISOString(),
    weeks: out,
    overall: {
      games: totalGames,
      accuracy: overallAccuracy,
      accuracy_delta: last?.accuracy != null && beforeLast?.accuracy != null
        ? round(last.accuracy - beforeLast.accuracy, 1)
        : null,
      errors_per_game: totalGames
        ? round(out.reduce((sum, w) => sum + w.errors_per_game * w.games, 0) / totalGames)
        : 0,
      errors_delta: last && beforeLast ? round(last.errors_per_game - beforeLast.errors_per_game) : null,
      top_pattern: topPattern as WeeklyProgressPayload['overall']['top_pattern'],
    },
  };
}

router.get('/', (c) => {
  const me = c.get('user');
  const weeks = clampWeeks(c.req.query('weeks'));
  const refresh = c.req.query('refresh');
  const bust = refresh === '1' || refresh === 'true';
  const key = `${me.id}:${weeks}`;

  if (!bust) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return c.json(hit.payload);
  }

  const language = (me.profile?.language ?? 'en') as Language;
  const payload = build(me.id, weeks, language);
  cache.set(key, { at: Date.now(), payload });
  return c.json(payload);
});

export default router;
