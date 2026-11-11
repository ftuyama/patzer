// Persistence for diagnostic pattern events (chess/patterns.ts).
//
// The detection itself is pure; this module is the only place that touches
// `error_events`, `pattern_snapshots` and `weekly_reports`. Keeping it behind
// functions means the diagnosis, progress, drill and opening routes never
// build SQL of their own and stay free to change shape independently.
//
// Everything here traces back to an `analyses` row: events are a *materialized
// view* of moves_json for the current PATTERN_VERSION. Re-recording a game
// deletes its previous rows first, so a re-analysis never duplicates events.

import { db } from '../db.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import {
  PATTERN_VERSION,
  type PatternEvent,
  type PatternKey,
  type PatternSummary,
} from '../chess/patterns.js';
import type { GamePhase } from '../types.js';

/** A pattern event as stored: the detector's fields plus row identity. */
export interface StoredPatternEvent extends PatternEvent {
  id: number;
  user_id: number;
  pattern_version: number;
}

export interface StoredPatternSnapshot {
  week_start: string;
  motif: PatternKey;
  count: number;
  games_affected: number;
  score: number;
  avg_severity: number;
}

export interface StoredWeeklyReport {
  week_start: string;
  payload_json: string;
  summary_text: string | null;
  created_at: string;
}

interface EventRow {
  id: number;
  user_id: number;
  game_id: number;
  ply: number;
  motif: string;
  phase: string;
  color: string;
  severity: number;
  cp_loss: number;
  classification: string;
  fen: string;
  played_san: string;
  best_san: string | null;
  end_time: string | null;
  eco: string | null;
  opening_name: string | null;
  opponent: string | null;
  result: string | null;
  pattern_version: number;
}

function toEvent(r: EventRow): StoredPatternEvent {
  return {
    id: r.id,
    user_id: r.user_id,
    pattern_version: r.pattern_version,
    motif: r.motif as PatternKey,
    game_id: r.game_id,
    ply: r.ply,
    phase: r.phase as GamePhase,
    color: r.color === 'black' ? 'black' : 'white',
    severity: r.severity,
    cp_loss: r.cp_loss,
    classification: r.classification as PatternEvent['classification'],
    fen: r.fen,
    played_san: r.played_san,
    best_san: r.best_san,
    end_time: r.end_time,
    eco: r.eco,
    opening_name: r.opening_name,
    opponent: r.opponent,
    result: r.result,
  };
}

/**
 * Replace every stored event for one game with `events`. Idempotent: running
 * it twice yields the same rows, which is what makes re-analysis safe.
 * Returns the number of rows written.
 */
export function recordGameEvents(
  userId: number,
  gameId: number,
  events: PatternEvent[],
  version = PATTERN_VERSION,
): number {
  const del = db.prepare('DELETE FROM error_events WHERE game_id = ?');
  const ins = db.prepare(`
    INSERT OR REPLACE INTO error_events
      (game_id, user_id, ply, motif, phase, color, severity, cp_loss,
       classification, fen, played_san, best_san, end_time, eco,
       opening_name, opponent, result, pattern_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const write = db.transaction(() => {
    del.run(gameId);
    for (const e of events) {
      ins.run(
        gameId, userId, e.ply, e.motif, e.phase, e.color, e.severity,
        e.cp_loss, e.classification, e.fen, e.played_san, e.best_san,
        e.end_time, e.eco, e.opening_name, e.opponent, e.result, version,
      );
    }
    return events.length;
  });
  return write();
}

export function deleteGameEvents(gameId: number): void {
  db.prepare('DELETE FROM error_events WHERE game_id = ?').run(gameId);
}

/** True when this game already has rows for the current recipe. */
export function hasEventsForGame(gameId: number, version = PATTERN_VERSION): boolean {
  const row = db
    .prepare('SELECT 1 AS ok FROM error_events WHERE game_id = ? AND pattern_version = ? LIMIT 1')
    .get(gameId, version) as { ok: number } | undefined;
  return !!row;
}

export interface ListEventsOptions {
  /** Only events from games that ended on/after this date (ISO string). */
  sinceEndTime?: string | null;
  /** Restrict to the N most recently analysed games (same window as diagnosis). */
  limitGames?: number | null;
  motif?: PatternKey | null;
  /** Oldest first — handy for trend maths. Default false (newest first). */
  oldestFirst?: boolean;
}

/**
 * Read stored events. `limitGames` mirrors the diagnosis window: the N latest
 * games that have an analysis at the current SCORING_VERSION, not the N latest
 * games that happen to contain errors.
 */
export function listEvents(userId: number, opts: ListEventsOptions = {}): StoredPatternEvent[] {
  const where: string[] = ['e.user_id = @userId'];
  const params: Record<string, unknown> = { userId };

  if (opts.sinceEndTime) {
    where.push('e.end_time >= @sinceEndTime');
    params.sinceEndTime = opts.sinceEndTime;
  }
  if (opts.motif) {
    where.push('e.motif = @motif');
    params.motif = opts.motif;
  }
  if (opts.limitGames && opts.limitGames > 0) {
    where.push(`e.game_id IN (
      SELECT g2.id FROM games g2 JOIN analyses a ON a.game_id = g2.id
      WHERE g2.user_id = @userId AND a.scoring_version >= @scoringVersion
      ORDER BY COALESCE(g2.end_time, g2.created_at) DESC, g2.id DESC
      LIMIT @limitGames
    )`);
    params.limitGames = opts.limitGames;
    params.scoringVersion = SCORING_VERSION;
  }

  const rows = db
    .prepare(`
      SELECT e.* FROM error_events e
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(e.end_time, '') ${opts.oldestFirst ? 'ASC' : 'DESC'}, e.id ASC
    `)
    .all(params) as EventRow[];
  return rows.map(toEvent);
}

/** How many analysed games the diagnosis window covers. */
export function analysedGameCount(userId: number, limitGames = 100): number {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT g.id FROM games g JOIN analyses a ON a.game_id = g.id
        WHERE g.user_id = ? AND (g.start_fen IS NULL OR g.start_fen = '')
          AND a.scoring_version >= ?
        ORDER BY COALESCE(g.end_time, g.created_at) DESC, g.id DESC
        LIMIT ?
      )
    `)
    .get(userId, SCORING_VERSION, limitGames) as { n: number };
  return row.n;
}

/**
 * Freeze the summaries for one ISO week. Called for closed weeks only; the
 * current (in-progress) week is computed live so it never reads stale.
 */
export function upsertPatternSnapshot(
  userId: number,
  weekStart: string,
  summaries: PatternSummary[],
): void {
  const del = db.prepare('DELETE FROM pattern_snapshots WHERE user_id = ? AND week_start = ?');
  const ins = db.prepare(`
    INSERT INTO pattern_snapshots
      (user_id, week_start, motif, count, games_affected, score, avg_severity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    del.run(userId, weekStart);
    for (const s of summaries) {
      ins.run(userId, weekStart, s.key, s.count, s.games_affected, s.score, s.avg_severity);
    }
  })();
}

export function listPatternSnapshots(userId: number, weeks = 12): StoredPatternSnapshot[] {
  const rows = db
    .prepare(`
      SELECT week_start, motif, count, games_affected, score, avg_severity
      FROM pattern_snapshots WHERE user_id = ?
      ORDER BY week_start DESC
      LIMIT ?
    `)
    .all(userId, weeks * 16) as (Omit<StoredPatternSnapshot, 'motif'> & { motif: string })[];
  return rows.map((r) => ({ ...r, motif: r.motif as PatternKey }));
}

export function saveWeeklyReport(
  userId: number,
  weekStart: string,
  payload: unknown,
  summaryText: string | null,
): void {
  db.prepare(`
    INSERT INTO weekly_reports (user_id, week_start, payload_json, summary_text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET
      payload_json = excluded.payload_json,
      summary_text = excluded.summary_text
  `).run(userId, weekStart, JSON.stringify(payload), summaryText);
}

export function listWeeklyReports(userId: number, weeks = 12): StoredWeeklyReport[] {
  return db
    .prepare(`
      SELECT week_start, payload_json, summary_text, created_at
      FROM weekly_reports WHERE user_id = ?
      ORDER BY week_start DESC LIMIT ?
    `)
    .all(userId, weeks) as StoredWeeklyReport[];
}

export function hasWeeklyReport(userId: number, weekStart: string): boolean {
  const row = db
    .prepare('SELECT 1 AS ok FROM weekly_reports WHERE user_id = ? AND week_start = ?')
    .get(userId, weekStart) as { ok: number } | undefined;
  return !!row;
}
