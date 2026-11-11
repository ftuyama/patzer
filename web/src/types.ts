export type Classification = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced' | 'inaccuracy' | 'mistake' | 'blunder' | 'miss';

export const CLASSIFICATIONS: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss',
];

export type Difficulty = 'kid' | 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'stockfish';

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  // Mate-in-N (white perspective). Present on v7+ analyses; older cached
  // analyses are re-run on view because SCORING_VERSION changed.
  mate_before?: number | null;
  mate_after?: number | null;
  best_move_uci: string | null;
  best_move_san: string | null;
  best_pv: string[];
  centipawn_loss: number;
  classification: Classification;
}

export interface PhasePoint {
  from_ply: number;
  to_ply: number;
  accuracy_white: number;
  accuracy_black: number;
  acpl_white: number;
  acpl_black: number;
}

export interface PhaseSplit {
  opening: PhasePoint | null;
  middlegame: PhasePoint | null;
  endgame: PhasePoint | null;
}

export interface KeyMomentSummary {
  ply: number;
  side: 'white' | 'black';
  san: string;
  fen_before: string;
  classification: Classification;
  cp_loss: number;
  win_pct_delta: number;
  best_san: string | null;
  best_pv: string[];
}

export interface AnalysisResult {
  depth: number;
  moves: AnalyzedMove[];
  accuracy_white: number;
  accuracy_black: number;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  opening_eco: string | null;
  opening_name: string | null;
  key_moments: KeyMomentSummary[];
  phase_split: PhaseSplit | null;
}

export interface GameRow {
  id: number;
  source: 'chesscom' | 'lichess' | 'played' | 'imported' | 'pvp';
  external_id: string | null;
  white: string;
  black: string;
  result: string;
  time_control: string;
  time_class: TimeClass | null;
  eco: string | null;
  opening_name: string | null;
  rated: number | null;
  user_rating_after: number | null;
  opponent_rating_after: number | null;
  end_time: string;
  user_color: 'white' | 'black' | null;
  analyzed: number;
  accuracy_white: number | null;
  accuracy_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  bookmarked: number | null;
  notes: string | null;
  /** 1 for a game played from a position (Game Review / Lab → "Play from here"). */
  from_position?: number;
}

export interface RatingRow {
  time_class: TimeClass;
  rating: number;
  rd: number;
  games_played: number;
  last_played_at: string | null;
  provisional: boolean;
}

// --- Improvement diagnosis (shared API contracts) ---------------------------
// Mirrors server/src/patterns/contracts.ts. Keep both in sync; the server is
// the source of truth.

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

export interface PatternEvent {
  motif: PatternKey;
  game_id: number;
  ply: number;
  phase: 'opening' | 'middlegame' | 'endgame';
  color: 'white' | 'black';
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

export interface PatternSummary {
  key: PatternKey;
  count: number;
  games_affected: number;
  score: number;
  avg_severity: number;
  max_severity: number;
  trend_pct: number | null;
  phase: Record<'opening' | 'middlegame' | 'endgame', number>;
  color: { white: number; black: number };
  examples: PatternEvent[];
}

export interface WeeklyProgressWeek {
  week_start: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number | null;
  accuracy_delta: number | null;
  inaccuracies_per_game: number;
  mistakes_per_game: number;
  blunders_per_game: number;
  errors_per_game: number;
  top_patterns: { key: PatternKey; count: number; score: number }[];
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
    top_pattern: PatternKey | null;
  };
}

export interface DrillPosition {
  game_id: number;
  ply: number;
  fen: string;
  played_san: string;
  best_san: string | null;
  best_uci: string | null;
  solution_uci: string[];
  severity: number;
  cp_loss: number;
  phase: 'opening' | 'middlegame' | 'endgame';
  motif: PatternKey;
  prompt?: 'find_best' | 'spot_threat';
  opponent?: string | null;
  opening_name?: string | null;
  end_time?: string | null;
}

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

export interface TheoryGap {
  eco: string | null;
  name: string | null;
  move_san: string;
  ply: number;
  san_line: string[];
  games: number;
  share: number;
  eval_loss: number | null;
  explorer: ExplorerMove[];
  example_game_id: number | null;
}

export interface TheoryGapPayload {
  generated_at: string;
  color: 'white' | 'black' | 'both';
  scanned_games: number;
  gaps: TheoryGap[];
  source: 'lichess-explorer' | 'local-book' | 'unavailable';
}
