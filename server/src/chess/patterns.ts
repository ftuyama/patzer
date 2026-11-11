// Error-pattern detection across analyzed games.
//
// A pattern is a *recurring reason* a move went wrong — not just "blunder".
// Everything here is deterministic and derived from data the analyzer already
// stored (eval swing, classification, FEN, best move): no re-analysis, no LLM.
// The diagnosis route aggregates these events per user and ranks them by
// severity first, frequency second (a single 40-win%-point collapse matters
// more than ten 8-point inaccuracies).

import { cpToWinPct, normalizeEval } from './classifier.js';
import { hasBackRankSignature, phaseFor } from './phases.js';
import { moveMotifs, VALUE } from '../coach/tactics.js';
import type { AnalyzedMove, Classification, GamePhase, PhaseSplit } from '../types.js';

/**
 * Bump when detection rules change shape. Rows in `error_events` carry the
 * version they were produced with; a bump means "backfill before trusting".
 */
export const PATTERN_VERSION = 1;

export type PatternKey =
  | 'hung_piece'
  | 'fork_exposed'
  | 'allowed_mate'
  | 'missed_win'
  | 'back_rank'
  | 'opening_leak'
  | 'endgame_drift'
  | 'promising_to_losing'
  | 'queen_sortie';

export const PATTERN_KEYS: PatternKey[] = [
  'hung_piece', 'fork_exposed', 'allowed_mate', 'missed_win', 'back_rank',
  'opening_leak', 'endgame_drift', 'promising_to_losing', 'queen_sortie',
];

/** Display order fallback; the API ranks by score. */
export const PATTERN_WEIGHT: Record<PatternKey, number> = {
  allowed_mate: 1.15,
  hung_piece: 1,
  fork_exposed: 1.05,
  missed_win: 0.95,
  back_rank: 1.05,
  promising_to_losing: 1.1,
  opening_leak: 0.85,
  endgame_drift: 0.85,
  queen_sortie: 0.8,
};

export interface PatternEvent {
  motif: PatternKey;
  game_id: number;
  ply: number;
  phase: GamePhase;
  color: 'white' | 'black';
  /** Win% (0-100) the player gave away with this move. */
  severity: number;
  cp_loss: number;
  classification: Classification;
  fen: string;
  played_san: string;
  best_san: string | null;
  end_time: string | null;
  eco: string | null;
  opening_name: string | null;
  opponent: string | null;
  result: string | null;
}

export interface GameMeta {
  game_id: number;
  user_color: 'white' | 'black';
  end_time: string | null;
  eco: string | null;
  opening_name: string | null;
  opponent: string | null;
  result: string | null;
}

/** Raw eval fields are white-perspective; severity is from the player's POV. */
function moverWinPct(m: AnalyzedMove): { before: number; after: number } {
  const white = m.ply % 2 === 1;
  const beforeCp = normalizeEval(m.eval_before_cp, m.mate_before, 'w');
  const afterCp = normalizeEval(m.eval_after_cp, m.mate_after, 'w');
  const pov = (cp: number) => (white ? cpToWinPct(cp) : 100 - cpToWinPct(cp));
  return { before: pov(beforeCp), after: pov(afterCp) };
}

const BAD: Classification[] = ['inaccuracy', 'mistake', 'blunder', 'miss'];
const COSTLY: Classification[] = ['mistake', 'blunder', 'miss'];

/**
 * Detect every pattern event in one game. Only the player's moves are scanned,
 * and only moves that already cost something (inaccuracy or worse) — checking
 * good moves for "what did this blunder allow" is meaningless and expensive.
 */
export function detectGamePatterns(
  moves: AnalyzedMove[],
  meta: GameMeta,
  split: PhaseSplit | null,
): PatternEvent[] {
  const out: PatternEvent[] = [];
  const color = meta.user_color;

  for (const m of moves) {
    const side = m.ply % 2 === 1 ? 'white' : 'black';
    if (side !== color) continue;
    if (!BAD.includes(m.classification)) continue;
    const cpLoss = Math.max(0, m.centipawn_loss ?? 0);
    if (cpLoss < 40) continue;

    const { before, after } = moverWinPct(m);
    const severity = Math.max(0, before - after);
    if (severity < 2 && cpLoss < 100) continue;

    const phase = phaseFor(m.ply, split);
    const motifs = new Set<PatternKey>();

    // Cheap checks first; moveMotifs parses/plays the position so it runs only
    // on moves that are already known to be mistakes.
    if (COSTLY.includes(m.classification) || cpLoss >= 150) {
      let mm: ReturnType<typeof moveMotifs> = null;
      try {
        mm = moveMotifs(m.fen_before, m.san);
      } catch {
        mm = null;
      }
      if (mm) {
        const hungValue = mm.hangs.reduce((sum, p) => sum + VALUE[p.type], 0);
        if (mm.hangs.length >= 2 && hungValue >= 3) motifs.add('fork_exposed');
        else if (hungValue >= 3 || (mm.hangs.length > 0 && cpLoss >= 200)) motifs.add('hung_piece');
        if (mm.allowsMate) motifs.add('allowed_mate');
      }
    }

    if (m.classification === 'miss' && !motifs.has('allowed_mate')) motifs.add('missed_win');

    if ((m.classification === 'blunder' || m.classification === 'mistake')
      && hasBackRankSignature(m.fen_after, color)) {
      motifs.add('back_rank');
    }

    if (phase === 'opening' && COSTLY.includes(m.classification)) motifs.add('opening_leak');
    if (phase === 'endgame' && (m.classification === 'inaccuracy' || COSTLY.includes(m.classification))) {
      motifs.add('endgame_drift');
    }

    // Eval flip: was clearly better, now clearly worse (white perspective in
    // the stored data, so flip the sign for Black).
    const sign = color === 'white' ? 1 : -1;
    const evalBefore = normalizeEval(m.eval_before_cp, m.mate_before, 'w') * sign;
    const evalAfter = normalizeEval(m.eval_after_cp, m.mate_after, 'w') * sign;
    if (evalBefore >= 120 && evalAfter <= -50) motifs.add('promising_to_losing');

    // Early queen adventure that already lost material/time.
    if (phase === 'opening' && m.ply <= 24 && /^Q/.test(m.san) && cpLoss >= 100) {
      motifs.add('queen_sortie');
    }

    if (motifs.size === 0) {
      // A costly move that matches nothing specific is still worth counting as
      // a hung piece when material actually left the board.
      if (cpLoss >= 200) motifs.add('hung_piece');
      else continue;
    }

    for (const motif of motifs) {
      out.push({
        motif,
        game_id: meta.game_id,
        ply: m.ply,
        phase,
        color,
        severity: Math.round(severity * 10) / 10,
        cp_loss: cpLoss,
        classification: m.classification,
        fen: m.fen_before,
        played_san: m.san,
        best_san: m.best_move_san ?? null,
        end_time: meta.end_time,
        eco: meta.eco,
        opening_name: meta.opening_name,
        opponent: meta.opponent,
        result: meta.result,
      });
    }
  }

  return out;
}

export interface PatternSummary {
  key: PatternKey;
  count: number;
  games_affected: number;
  /** Recency-weighted severity total (higher = more costly habit). */
  score: number;
  avg_severity: number;
  max_severity: number;
  /** % change versus the earlier half of the window; null when no baseline. */
  trend_pct: number | null;
  phase: Record<GamePhase, number>;
  color: { white: number; black: number };
  examples: PatternEvent[];
}

const HALF_LIFE_WEEKS = 4;
const DAY_MS = 86_400_000;

/** Recency weight: a mistake today is worth 1, one four weeks ago 0.5. */
export function recencyWeight(endTime: string | null, now = Date.now()): number {
  if (!endTime) return 0.7;
  const t = Date.parse(endTime.length <= 10 ? `${endTime}T12:00:00Z` : endTime);
  if (!Number.isFinite(t)) return 0.7;
  const weeks = Math.max(0, (now - t) / (7 * DAY_MS));
  return Math.pow(0.5, weeks / HALF_LIFE_WEEKS);
}

export function summarizePatterns(
  events: PatternEvent[],
  gamesAnalyzed: number,
  now = Date.now(),
): PatternSummary[] {
  const by = new Map<PatternKey, PatternEvent[]>();
  for (const e of events) {
    const list = by.get(e.motif) ?? [];
    list.push(e);
    by.set(e.motif, list);
  }

  // Baseline for trend: events older than the midpoint of the analysed window.
  const times = events.map((e) => Date.parse(e.end_time ?? '') || 0).filter(Boolean);
  const min = times.length ? Math.min(...times) : now;
  const max = times.length ? Math.max(...times) : now;
  const mid = min + (max - min) / 2;

  const rows: PatternSummary[] = [];
  for (const [key, list] of by) {
    let score = 0;
    const games = new Set<number>();
    const phase: Record<GamePhase, number> = { opening: 0, middlegame: 0, endgame: 0 };
    const color = { white: 0, black: 0 };
    let recent = 0;
    let earlier = 0;
    let sevSum = 0;
    let maxSev = 0;
    for (const e of list) {
      const w = recencyWeight(e.end_time, now);
      score += e.severity * w * PATTERN_WEIGHT[key];
      games.add(e.game_id);
      phase[e.phase]++;
      color[e.color]++;
      sevSum += e.severity;
      maxSev = Math.max(maxSev, e.severity);
      const t = Date.parse(e.end_time ?? '') || 0;
      if (!times.length || t > mid) recent += e.severity * w;
      else earlier += e.severity * w;
    }

    // Shrink small samples: 4 events is not yet a habit. The score keeps its
    // severity basis and is nudged down until ~8 events are seen.
    const shrink = list.length / (list.length + 4);
    const trendPct = earlier > 0
      ? Math.round(((recent - earlier) / earlier) * 100)
      : recent > 0 ? 100 : null;

    rows.push({
      key,
      count: list.length,
      games_affected: games.size,
      score: Math.round((score / Math.max(1, gamesAnalyzed)) * shrink * 10) / 10,
      avg_severity: Math.round((sevSum / list.length) * 10) / 10,
      max_severity: Math.round(maxSev * 10) / 10,
      trend_pct: trendPct,
      phase,
      color,
      examples: [...list].sort((a, b) => b.severity - a.severity).slice(0, 3),
    });
  }

  // Severity first: score already encodes win% given away per game. Frequency
  // breaks ties, then the motif's intrinsic cost.
  rows.sort((a, b) => b.score - a.score || b.count - a.count);
  return rows;
}
