// "What do I actually play, and where does it cost me?" — the Opening trainer's
// profile of the user's own games.
//
// Everything here comes from data we already store: the ECO opening written by
// the analysis and `analyses.moves_json` with the engine's verdict on every
// move. No engine calls, no network — the panel works offline.
//
// A *leak* is a move of the user in the opening that the analysis called a
// mistake/blunder/miss while the engine knew a better move. Leaks are grouped
// by position + move, so "5…Nf6 here, the engine says 5…d6" counts once per
// game however often it happens. The drill line is the moves up to that
// position plus the engine's move, which the browser replays as-is.

import { Chess } from 'chess.js';
import { db } from '../db.js';
import { SCORING_VERSION } from './classifier.js';
import { replayLine } from './openingTrainer.js';
import { phaseFor } from './phases.js';
import type { AnalyzedMove, Classification, Color, PhaseSplit } from '../types.js';

export const PROFILE_DEFAULT_GAMES = 100;
export const PROFILE_MIN_GAMES = 10;
export const PROFILE_MAX_GAMES = 300;
/** Openings shown per colour — beyond that the panel is a history dump. */
export const MAX_PROFILE_OPENINGS = 6;
/** Leaks kept per opening, worst first. */
export const MAX_PROFILE_LEAKS = 3;
/** Below this the engine's "better move" is not worth relearning. */
export const MIN_LEAK_CP = 80;

const FLAWS: ReadonlySet<Classification> = new Set(['mistake', 'blunder', 'miss']);

export interface OpeningLeak {
  /** SAN moves from the start up to (but not including) the leaked move. */
  san_line: string[];
  /** 1-based ply of the leaked move. */
  ply: number;
  /** What the user played there. */
  played_san: string;
  /** What the engine would have played. */
  best_san: string | null;
  /** Games in the window in which this leak appeared. */
  games: number;
  /** Average centipawn loss of the played move. */
  avg_cp_loss: number;
  /** Line to drill: `san_line` + `best_san`; empty when it can't be replayed. */
  drill: string[];
  example_game_id: number | null;
}

export interface OpeningProfileEntry {
  eco: string | null;
  name: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Score in percent (a draw counts half), 0–100. */
  score: number;
  accuracy: number | null;
  leaks: OpeningLeak[];
}

export interface OpeningProfile {
  /** Analysed games in the window for this colour. */
  games: number;
  openings: OpeningProfileEntry[];
}

export interface OpeningProfilePayload {
  window: number;
  white: OpeningProfile;
  black: OpeningProfile;
}

interface ProfileRow {
  id: number;
  pgn: string;
  result: string | null;
  eco: string | null;
  opening_name: string | null;
  moves_json: string;
  phase_split_json: string | null;
  accuracy: number | null;
}

/** Clamp the requested window (default 100, 10–300). */
export function clampProfileWindow(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return PROFILE_DEFAULT_GAMES;
  return Math.max(PROFILE_MIN_GAMES, Math.min(PROFILE_MAX_GAMES, Math.trunc(n)));
}

/** One accumulated leak inside one opening, before sorting. */
interface LeakAccumulator {
  san_line: string[];
  ply: number;
  played_san: string;
  best_san: string | null;
  games: number;
  cpSum: number;
  example_game_id: number | null;
}

function openingKey(eco: string | null, name: string | null): string {
  return `${eco ?? ''}|${name ?? ''}`;
}

/** `history` gives the SAN line; the analysis gives the verdict. Build the
 *  leaks for one game, de-duplicated by position + move (a user who plays the
 *  same wrong move twice in one game still has one habit, not two). */
function gameLeaks(
  moves: AnalyzedMove[],
  split: PhaseSplit | null,
  color: Color,
  history: string[],
  gameId: number,
): LeakAccumulator[] {
  const out = new Map<string, LeakAccumulator>();
  for (const m of moves) {
    const side: Color = m.ply % 2 === 1 ? 'white' : 'black';
    if (side !== color) continue;
    if (phaseFor(m.ply, split) !== 'opening') continue;
    if (!FLAWS.has(m.classification)) continue;
    if (Math.max(0, m.centipawn_loss ?? 0) < MIN_LEAK_CP) continue;
    if (!m.best_move_san || m.best_move_san === m.san) continue;
    // The analysis and the PGN must agree on the move; otherwise the ply
    // index would point at a different position than the one analysed.
    if (history[m.ply - 1] !== m.san) continue;

    const key = `${m.fen_before}|${m.san}`;
    const seen = out.get(key);
    if (seen) {
      seen.cpSum += m.centipawn_loss;
      continue;
    }
    out.set(key, {
      san_line: history.slice(0, m.ply - 1),
      ply: m.ply,
      played_san: m.san,
      best_san: m.best_move_san,
      games: 1,
      cpSum: Math.max(0, m.centipawn_loss ?? 0),
      example_game_id: gameId,
    });
  }
  return Array.from(out.values());
}

/** The corrected line, when chess.js agrees it is legal and it fits the
 *  trainer's line cap; otherwise empty, and the UI hides the train button. */
function drillFor(sanLine: string[], bestSan: string | null): string[] {
  if (!bestSan) return [];
  const line = [...sanLine, bestSan];
  if (line.length === 0 || line.length > 30) return [];
  return replayLine(line) ? line : [];
}

export function buildOpeningProfile(
  userId: number,
  color: Color,
  window = PROFILE_DEFAULT_GAMES,
): OpeningProfile {
  const rows = db.prepare(`
    SELECT g.id, g.pgn, g.result, g.eco, g.opening_name,
           a.moves_json, a.phase_split_json,
           CASE WHEN g.user_color='white' THEN a.accuracy_white ELSE a.accuracy_black END AS accuracy
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND g.user_color = ? AND a.scoring_version >= ? AND g.start_fen IS NULL
    ORDER BY g.end_time DESC, g.id DESC
    LIMIT ?
  `).all(userId, color, SCORING_VERSION, window) as ProfileRow[];

  interface EntryAccumulator {
    eco: string | null;
    name: string | null;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    accSum: number;
    accN: number;
    leaks: Map<string, LeakAccumulator>;
  }
  const byOpening = new Map<string, EntryAccumulator>();

  for (const r of rows) {
    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { continue; }
    // A corrupt or old phase split must not take the whole panel down: fall
    // back to the ply-based guess in phaseFor.
    let split: PhaseSplit | null = null;
    if (r.phase_split_json) {
      try { split = JSON.parse(r.phase_split_json) as PhaseSplit; } catch { split = null; }
    }

    const chess = new Chess();
    try { chess.loadPgn(r.pgn, { strict: false }); } catch { continue; }
    const history = chess.history();

    const key = openingKey(r.eco, r.opening_name);
    let entry = byOpening.get(key);
    if (!entry) {
      entry = {
        eco: r.eco, name: r.opening_name,
        games: 0, wins: 0, draws: 0, losses: 0, accSum: 0, accN: 0,
        leaks: new Map(),
      };
      byOpening.set(key, entry);
    }
    entry.games++;
    if (r.result === 'win') entry.wins++;
    else if (r.result === 'draw') entry.draws++;
    else if (r.result === 'loss') entry.losses++;
    if (r.accuracy != null) { entry.accSum += r.accuracy; entry.accN++; }

    for (const leak of gameLeaks(moves, split, color, history, r.id)) {
      const existing = entry.leaks.get(`${leak.san_line.join(' ')}|${leak.played_san}`);
      if (existing) {
        existing.games++;
        existing.cpSum += leak.cpSum;
        continue;
      }
      entry.leaks.set(`${leak.san_line.join(' ')}|${leak.played_san}`, leak);
    }
  }

  const openings = Array.from(byOpening.values())
    .map((e): OpeningProfileEntry => ({
      eco: e.eco,
      name: e.name,
      games: e.games,
      wins: e.wins,
      draws: e.draws,
      losses: e.losses,
      score: e.games > 0 ? Math.round(((e.wins + e.draws / 2) / e.games) * 100) : 0,
      accuracy: e.accN > 0 ? Math.round((e.accSum / e.accN) * 10) / 10 : null,
      leaks: Array.from(e.leaks.values())
        .map((l) => {
          const avgCpLoss = Math.round(l.cpSum / l.games);
          return {
            san_line: l.san_line,
            ply: l.ply,
            played_san: l.played_san,
            best_san: l.best_san,
            games: l.games,
            avg_cp_loss: avgCpLoss,
            drill: drillFor(l.san_line, l.best_san),
            example_game_id: l.example_game_id,
          };
        })
        .sort((a, b) => b.games * b.avg_cp_loss - a.games * a.avg_cp_loss || b.games - a.games)
        .slice(0, MAX_PROFILE_LEAKS),
    }))
    .sort((a, b) => b.games - a.games || (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, MAX_PROFILE_OPENINGS);

  return { games: rows.length, openings };
}
