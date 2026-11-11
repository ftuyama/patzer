// Shared API contracts for the improvement features.
//
// These are the shapes the web app codes against. Route implementations may
// compute them differently (live vs. from `error_events`), but the JSON must
// match — that is what lets the diagnosis, progress, drill and opening
// workstreams be built in parallel.

import type { PatternKey, PatternSummary } from '../chess/patterns.js';
import type { GamePhase } from '../types.js';

/** One week of the diagnosis page's compact series. */
export interface DiagnosisWeeklyBucket {
  week_start: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number | null;
  mistakes_per_game: number;
  blunders_per_game: number;
  top_pattern: string | null;
}

export interface DiagnosisOverview {
  accuracy: number | null;
  blunders_per_game: number;
  mistakes_per_game: number;
  inaccuracies_per_game: number;
  date_from: string | null;
  date_to: string | null;
}

/** GET /api/diagnosis?games=100 */
export interface DiagnosisPayload {
  generated_at: string;
  games_analyzed: number;
  window_games: number;
  overview: DiagnosisOverview;
  patterns: PatternSummary[];
  weekly: DiagnosisWeeklyBucket[];
}

/** One motif's slice of a week, for the progress trend lines. */
export interface WeeklyPatternCount {
  key: PatternKey;
  count: number;
  score: number;
}

/** GET /api/progress?weeks=12 */
export interface WeeklyProgressWeek {
  week_start: string;
  /** Week label already localised by the server? No — the client formats it. */
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number | null;
  /** Accuracy points versus the previous week; null without a baseline. */
  accuracy_delta: number | null;
  inaccuracies_per_game: number;
  mistakes_per_game: number;
  blunders_per_game: number;
  /** Severity-weighted errors per game, all motifs. */
  errors_per_game: number;
  top_patterns: WeeklyPatternCount[];
  /** True for the week currently in progress — never frozen. */
  partial: boolean;
}

export interface WeeklyProgressPayload {
  generated_at: string;
  weeks: WeeklyProgressWeek[];
  overall: {
    games: number;
    accuracy: number | null;
    accuracy_delta: number | null;
    errors_per_game: number;
    errors_delta: number | null;
    /** Top motif over the whole window, if any. */
    top_pattern: PatternKey | null;
  };
}

/** One position to solve in a pattern drill. */
export interface DrillPosition {
  game_id: number;
  ply: number;
  fen: string;
  /** The move actually played (wrong) — shown only after the attempt. */
  played_san: string;
  best_san: string | null;
  best_uci: string | null;
  /** Engine line after the best move, UCI; the client validates the first. */
  solution_uci: string[];
  severity: number;
  cp_loss: number;
  phase: GamePhase;
  motif: PatternKey;
  /** Empty for a plain "find the best move" drill. */
  prompt?: 'find_best' | 'spot_threat';
}

/** GET /api/train/drill?pattern=hung_piece&count=10&mode=find_best */
export interface DrillPayload {
  pattern: PatternKey | 'mixed';
  mode: 'find_best' | 'spot_threat';
  count: number;
  positions: DrillPosition[];
}

export interface ExplorerMove {
  san: string;
  uci: string;
  games: number;
  white: number;
  draws: number;
  black: number;
}

/** A line the player leaves earlier than the explorer's main theory. */
export interface TheoryGap {
  eco: string | null;
  name: string | null;
  /** The move the player chose that the explorer barely plays. */
  move_san: string;
  ply: number;
  /** SAN line from the start of the game up to (and including) the move. */
  san_line: string[];
  games: number;
  /** Share of games in which this gap occurred. */
  share: number;
  /** Average win% lost by this move, when known. */
  eval_loss: number | null;
  /** What theory plays here instead, most popular first. */
  explorer: ExplorerMove[];
  example_game_id: number | null;
}

/** GET /api/openings/theory?color=white&games=100 */
export interface TheoryGapPayload {
  generated_at: string;
  color: 'white' | 'black' | 'both';
  scanned_games: number;
  gaps: TheoryGap[];
  source: 'lichess-explorer' | 'local-book' | 'unavailable';
}
