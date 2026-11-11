// Pattern drills — turn the user's stored error events into a short set of
// "find the move you missed" positions, filtered by the habit that costs the
// most games (chess/patterns.ts, patterns/store.ts).
//
// The store only keeps the played move (`played_san`) and the best reply in SAN
// (`best_san`); the UCI best move and the engine line live in
// `analyses.moves_json` next to it. We join the two, de-duplicate by position
// and best move, and keep the newest/severe positions first — a drill is a
// lesson, not a history dump.
//
// When the event table is still empty (a fresh install before the backfill ran,
// or a game analysed by an older server build) the same candidates are
// detected live from the most recent `analyses.moves_json` and cached briefly.

import { Chess } from 'chess.js';
import { db } from '../db.js';
import { SCORING_VERSION } from './classifier.js';
import {
  detectGamePatterns,
  summarizePatterns,
  type GameMeta,
  type PatternEvent,
  type PatternKey,
} from './patterns.js';
import { listEvents, type StoredPatternEvent } from '../patterns/store.js';
import type { DrillPayload, DrillPosition } from '../patterns/contracts.js';
import type { AnalyzedMove, PhaseSplit } from '../types.js';

export type DrillMode = DrillPayload['mode'];

/** The contract's fields plus the context the trainer shows above the board. */
export interface DrillPositionWithContext extends DrillPosition {
  opponent: string | null;
  opening_name: string | null;
  end_time: string | null;
}

export interface BuildDrillOptions {
  pattern: PatternKey | 'mixed';
  count: number;
  mode: DrillMode;
  /** How many of the user's most recent analysed games to scan. */
  limitGames?: number;
  now?: number;
}

export const DEFAULT_GAME_WINDOW = 100;
export const MIN_DRILL_COUNT = 1;
export const MAX_DRILL_COUNT = 30;
const LIVE_CACHE_TTL_MS = 60_000;

/** Unbounded pv arrays are not a drill; one line is. */
const MAX_SOLUTION_MOVES = 12;

type Event = PatternEvent & { id?: number };

interface LiveCacheEntry {
  at: number;
  events: PatternEvent[];
}

const liveCache = new Map<string, LiveCacheEntry>();

export function clampDrillCount(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(MAX_DRILL_COUNT, Math.max(MIN_DRILL_COUNT, Math.trunc(value)));
}

/** Position identity ignores the halfmove/fullmove counters. */
function fenKey(fen: string): string {
  return fen.split(/\s+/).slice(0, 4).join(' ');
}

function playUci(chess: Chess, uci: string) {
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
  } catch {
    return null;
  }
}

/**
 * The stored engine line as UCI, starting with the best move. The pv is SAN;
 * it only continues when its first move really is the best move (an analysis
 * row and its event can disagree after a re-analysis).
 */
function solutionLine(fen: string, bestUci: string, pvSan: string[]): string[] | null {
  const chess = new Chess(fen);
  const first = playUci(chess, bestUci);
  if (!first) return null;
  const uci = [bestUci.toLowerCase()];
  if (pvSan[0] !== first.san) return uci;
  for (let i = 1; i < pvSan.length && uci.length < MAX_SOLUTION_MOVES; i++) {
    let move;
    try {
      move = chess.move(pvSan[i]!);
    } catch {
      break;
    }
    uci.push(move.lan);
  }
  return uci;
}

interface LiveRow {
  game_id: number;
  user_color: 'white' | 'black' | null;
  moves_json: string;
  phase_split_json: string | null;
  end_time: string | null;
  eco: string | null;
  opening_name: string | null;
  white: string | null;
  black: string | null;
  result: string | null;
}

/**
 * Detect events from the recent analyses themselves. Used only while
 * `error_events` is empty for this user, and cached per user+window for a
 * minute so a page of drills does not re-parse every game.
 */
function liveEvents(userId: number, limitGames: number, now: number): PatternEvent[] {
  const key = `${userId}:${limitGames}`;
  const hit = liveCache.get(key);
  if (hit && now - hit.at < LIVE_CACHE_TTL_MS) return hit.events;

  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, a.moves_json, a.phase_split_json,
           g.end_time, a.opening_eco AS eco, a.opening_name, g.white, g.black, g.result
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ORDER BY COALESCE(g.end_time, g.created_at) DESC, g.id DESC
    LIMIT ?
  `).all(userId, SCORING_VERSION, limitGames) as LiveRow[];

  const events: PatternEvent[] = [];
  for (const r of rows) {
    const color: 'white' | 'black' = r.user_color ?? 'white';
    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { moves = []; }
    let split: PhaseSplit | null = null;
    if (r.phase_split_json) {
      try { split = JSON.parse(r.phase_split_json) as PhaseSplit; } catch { split = null; }
    }
    const meta: GameMeta = {
      game_id: r.game_id,
      user_color: color,
      end_time: r.end_time,
      eco: r.eco,
      opening_name: r.opening_name,
      opponent: color === 'white' ? r.black : r.white,
      result: r.result,
    };
    events.push(...detectGamePatterns(moves, meta, split));
  }

  liveCache.set(key, { at: now, events });
  return events;
}

/**
 * Events for the requested pattern. An empty motif slice is a legitimate
 * "nothing to drill here"; only a completely empty store falls back to live
 * detection.
 */
function eventsFor(
  userId: number,
  pattern: PatternKey | 'mixed',
  limitGames: number,
  now: number,
): Event[] {
  const filtered = listEvents(userId, {
    motif: pattern === 'mixed' ? null : pattern,
    limitGames,
  });
  if (filtered.length > 0) return filtered;

  if (pattern !== 'mixed') {
    const anyEvents = listEvents(userId, { limitGames });
    if (anyEvents.length > 0) return [];
  }
  const live = liveEvents(userId, limitGames, now);
  return pattern === 'mixed' ? live : live.filter((e) => e.motif === pattern);
}

function loadMovesByGame(gameIds: number[]): Map<number, Map<number, AnalyzedMove>> {
  const out = new Map<number, Map<number, AnalyzedMove>>();
  if (gameIds.length === 0) return out;
  const placeholders = gameIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT game_id, moves_json FROM analyses
    WHERE game_id IN (${placeholders}) AND scoring_version >= ?
  `).all(...gameIds, SCORING_VERSION) as { game_id: number; moves_json: string }[];
  for (const r of rows) {
    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { moves = []; }
    out.set(r.game_id, new Map(moves.map((m) => [m.ply, m])));
  }
  return out;
}

/** Newest first, then severest — a stale blunder loses to a fresh one. */
function byRecencyThenSeverity(a: Event, b: Event): number {
  const at = a.end_time ?? '';
  const bt = b.end_time ?? '';
  if (at !== bt) return bt.localeCompare(at);
  if (a.severity !== b.severity) return b.severity - a.severity;
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Attach the engine's UCI move/line to each event, dropping anything that
 * cannot be drilled: no best SAN, no best UCI, a FEN that does not contain the
 * move, or a "best" move identical to the one played.
 */
function toPositions(events: Event[], mode: DrillMode): DrillPositionWithContext[] {
  const usable = events.filter((e) => !!e.best_san);
  const gameIds = [...new Set(usable.map((e) => e.game_id))];
  const movesByGame = loadMovesByGame(gameIds);

  const seen = new Set<string>();
  const out: DrillPositionWithContext[] = [];
  for (const e of [...usable].sort(byRecencyThenSeverity)) {
    const move = movesByGame.get(e.game_id)?.get(e.ply);
    if (!move?.best_move_uci) continue;
    if (move.uci && move.best_move_uci.toLowerCase() === move.uci.toLowerCase()) continue;

    const solution = solutionLine(e.fen, move.best_move_uci, move.best_pv ?? []);
    if (!solution) continue;

    const key = `${fenKey(e.fen)}|${move.best_move_uci.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      game_id: e.game_id,
      ply: e.ply,
      fen: e.fen,
      played_san: e.played_san,
      best_san: move.best_move_san ?? e.best_san,
      best_uci: move.best_move_uci.toLowerCase(),
      solution_uci: solution,
      severity: e.severity,
      cp_loss: e.cp_loss,
      phase: e.phase,
      motif: e.motif,
      prompt: mode,
      opponent: e.opponent,
      opening_name: e.opening_name,
      end_time: e.end_time,
    });
  }
  return out;
}

/** Round-robin the user's strongest motifs so one habit cannot fill the set. */
function interleave(positions: DrillPositionWithContext[], ranked: PatternKey[], count: number): DrillPositionWithContext[] {
  if (positions.length === 0) return [];
  const byMotif = new Map<PatternKey, DrillPositionWithContext[]>();
  for (const p of positions) {
    const list = byMotif.get(p.motif) ?? [];
    list.push(p);
    byMotif.set(p.motif, list);
  }
  const order = ranked.filter((k) => byMotif.has(k));
  // Any motif the summary did not rank (it should rank all) still gets a turn.
  for (const key of byMotif.keys()) if (!order.includes(key)) order.push(key);

  const taken = new Map<PatternKey, number>();
  const out: DrillPositionWithContext[] = [];
  while (out.length < count) {
    let advanced = false;
    for (const key of order) {
      if (out.length >= count) break;
      const list = byMotif.get(key)!;
      const i = taken.get(key) ?? 0;
      if (i >= list.length) continue;
      out.push(list[i]!);
      taken.set(key, i + 1);
      advanced = true;
    }
    if (!advanced) break;
  }
  return out;
}

export function buildDrill(userId: number, opts: BuildDrillOptions): DrillPayload {
  const now = opts.now ?? Date.now();
  const limitGames = opts.limitGames && opts.limitGames > 0 ? opts.limitGames : DEFAULT_GAME_WINDOW;
  const count = clampDrillCount(opts.count);
  const mode: DrillMode = opts.mode === 'spot_threat' ? 'spot_threat' : 'find_best';

  let events = eventsFor(userId, opts.pattern, limitGames, now);
  // "Spot the threat" is about the refutation of a real plan: blunders and
  // misses only. Inaccuracies make for fuzzy threats.
  if (mode === 'spot_threat') {
    events = events.filter((e) => e.classification === 'blunder' || e.classification === 'miss');
  }

  const positions = toPositions(events, mode);
  let chosen: DrillPositionWithContext[];
  if (opts.pattern === 'mixed') {
    const games = new Set(events.map((e) => e.game_id)).size;
    const ranked = summarizePatterns(events, Math.max(1, games)).map((s) => s.key);
    chosen = interleave(positions, ranked, count);
  } else {
    chosen = positions.slice(0, count);
  }

  return {
    pattern: opts.pattern,
    mode,
    count,
    positions: chosen,
  };
}

/** Test hook: forget the live-detection cache between cases. */
export function clearDrillCache(): void {
  liveCache.clear();
}
