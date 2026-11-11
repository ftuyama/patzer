// Diagnosis — top-5 error patterns and weekly progress.
//
// The server ranks patterns by severity (win% given away) first and frequency
// second, so the card order is already the answer to "what should I fix?".
// Each pattern links to real positions in the user's own games, which open in
// the existing review board at that ply.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, Crown, Crosshair,
  GitFork, Hourglass, Minus, ShieldAlert, Sparkles, Stethoscope, Target, TrendingDown,
} from 'lucide-react';
import { api } from '../api';
import AnalyzeAllButton from '../components/AnalyzeAllButton';
import { cn } from '../lib/utils';

type PatternKey =
  | 'hung_piece' | 'fork_exposed' | 'allowed_mate' | 'missed_win' | 'back_rank'
  | 'opening_leak' | 'endgame_drift' | 'promising_to_losing' | 'queen_sortie';

interface PatternEvent {
  motif: PatternKey;
  game_id: number;
  ply: number;
  phase: 'opening' | 'middlegame' | 'endgame';
  color: 'white' | 'black';
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
}

interface PatternSummary {
  key: PatternKey;
  count: number;
  games_affected: number;
  score: number;
  avg_severity: number;
  max_severity: number;
  trend_pct: number | null;
  phase: { opening: number; middlegame: number; endgame: number };
  color: { white: number; black: number };
  examples: PatternEvent[];
}

interface WeeklyBucket {
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

interface DiagnosisData {
  generated_at: string;
  games_analyzed: number;
  total_games: number;
  pending_games: number;
  window_games: number;
  overview: {
    accuracy: number | null;
    blunders_per_game: number;
    mistakes_per_game: number;
    inaccuracies_per_game: number;
    date_from: string | null;
    date_to: string | null;
  };
  patterns: PatternSummary[];
  weekly: WeeklyBucket[];
}

const META: Record<PatternKey, { icon: React.ElementType; tone: string; bar: string }> = {
  hung_piece: { icon: ShieldAlert, tone: 'text-move-blunder', bar: 'bg-move-blunder' },
  fork_exposed: { icon: GitFork, tone: 'text-orange-500', bar: 'bg-orange-500' },
  allowed_mate: { icon: AlertTriangle, tone: 'text-bad', bar: 'bg-bad' },
  missed_win: { icon: Crosshair, tone: 'text-move-miss', bar: 'bg-move-miss' },
  back_rank: { icon: TrendingDown, tone: 'text-move-mistake', bar: 'bg-move-mistake' },
  opening_leak: { icon: BookOpen, tone: 'text-sky-500', bar: 'bg-sky-500' },
  endgame_drift: { icon: Hourglass, tone: 'text-violet-500', bar: 'bg-violet-500' },
  promising_to_losing: { icon: Activity, tone: 'text-amber-500', bar: 'bg-amber-500' },
  queen_sortie: { icon: Crown, tone: 'text-pink-500', bar: 'bg-pink-500' },
};

const FIX_DEFAULT: Record<PatternKey, string> = {
  hung_piece: 'After every move, ask what the opponent can capture — and whether that piece is defended.',
  fork_exposed: 'Before moving, check whether the piece you touch leaves two targets for one enemy move.',
  allowed_mate: 'Look at every check the opponent would have after your move, especially near your king.',
  missed_win: 'When you are winning, calculate checks, captures and threats before anything else.',
  back_rank: 'Give your king an escape square, or keep a rook on the back rank to defend it.',
  opening_leak: 'Finish developing before starting tactics; check the main traps in your opening.',
  endgame_drift: 'Activate your king and rook early in the endgame; count pawn moves before pushing.',
  promising_to_losing: 'When clearly better, prefer safe, improving moves over forced complications.',
  queen_sortie: 'Develop knights and bishops first; bring the queen out only when it has a safe route.',
};

export default function Diagnosis() {
  const { t } = useTranslation();
  const [windowGames, setWindowGames] = useState(100);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['diagnosis', windowGames],
    queryFn: () => api.get<DiagnosisData>(`/api/diagnosis?games=${windowGames}`),
  });

  if (isLoading) return <Skeleton />;
  if (isError) {
    return (
      <div className="card p-8 text-center text-sm text-chesscom-500">
        {t('diagnosis.error', { defaultValue: 'Could not build your diagnosis. Try again in a moment.' })}
      </div>
    );
  }
  if (!data || data.games_analyzed === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center">
        <Stethoscope className="h-8 w-8 text-chesscom-400" />
        <div className="text-base font-semibold">{t('diagnosis.empty', { defaultValue: 'No diagnosis yet' })}</div>
        <div className="max-w-md text-sm text-chesscom-500">
          {t('diagnosis.emptyDesc', {
            defaultValue: 'Analyze at least a few of your games with Stockfish. Your recurring error patterns will appear here, ranked by how much they cost you.',
          })}
        </div>
        {data && data.pending_games > 0 ? (
          <div className="mt-3">
            <AnalyzeAllButton pending={data.pending_games} />
          </div>
        ) : (
          <Link to="/review" className="btn-primary mt-2 text-sm">{t('review.title')}</Link>
        )}
      </div>
    );
  }

  const maxScore = Math.max(1, ...data.patterns.map((p) => p.score));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-h1">{t('diagnosis.title', { defaultValue: 'Diagnosis' })}</h1>
          <p className="page-sub">
            {t('diagnosis.sub', {
              defaultValue: '{{n}} of your {{total}} games analysed. Patterns are ranked by how much they cost you, not just how often they happen.',
              n: data.games_analyzed,
              total: data.total_games,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AnalyzeAllButton pending={data.pending_games} />
          <label className="flex items-center gap-2 text-xs text-chesscom-500">
            {t('diagnosis.window', { defaultValue: 'Window' })}
            <select
              className="input py-1 text-xs"
              value={windowGames}
              onChange={(e) => setWindowGames(Number(e.target.value))}
            >
              {[50, 100, 200].map((n) => (
                <option key={n} value={n}>{t('diagnosis.gamesCount', { defaultValue: '{{n}} games', n })}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <Overview data={data} />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-gold-600" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
            {t('diagnosis.topPatterns', { defaultValue: 'Your 5 most expensive patterns' })}
          </h2>
        </div>
        {data.patterns.length === 0 ? (
          <div className="card p-6 text-sm text-chesscom-500">
            {t('diagnosis.noPatterns', { defaultValue: 'Not enough mistakes in this window to detect a pattern — that is a good sign.' })}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.patterns.map((p, i) => (
              <PatternCard key={p.key} pattern={p} rank={i + 1} maxScore={maxScore} />
            ))}
          </div>
        )}
      </section>

      <WeeklyProgress weekly={data.weekly} overview={data.overview} />

      <p className="text-[11px] leading-relaxed text-chesscom-400">
        {t('diagnosis.method', {
          defaultValue: 'Patterns come from Stockfish analysis stored on this server. Severity = win probability given away; a recent collapse weighs more than an old one. Click an example to see the exact position.',
        })}
      </p>
    </div>
  );
}

function Overview({ data }: { data: DiagnosisData }) {
  const { t } = useTranslation();
  const o = data.overview;
  const tiles = [
    { label: t('diagnosis.accuracy', { defaultValue: 'Average accuracy' }), value: o.accuracy != null ? `${o.accuracy}%` : '—' },
    { label: t('diagnosis.blundersPerGame', { defaultValue: 'Blunders / game' }), value: o.blunders_per_game.toFixed(2) },
    { label: t('diagnosis.mistakesPerGame', { defaultValue: 'Mistakes / game' }), value: o.mistakes_per_game.toFixed(2) },
    { label: t('diagnosis.gamesAnalyzed', { defaultValue: 'Games analysed' }), value: String(data.games_analyzed) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((s) => (
        <div key={s.label} className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-chesscom-500">{s.label}</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-chesscom-900 dark:text-chesscom-100">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function PatternCard({ pattern, rank, maxScore }: { pattern: PatternSummary; rank: number; maxScore: number }) {
  const { t, i18n } = useTranslation();
  const meta = META[pattern.key];
  const Icon = meta.icon;
  const pct = Math.max(4, Math.round((pattern.score / maxScore) * 100));
  const date = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString(i18n.language) : '');
  const moveNumber = (ply: number) => (ply % 2 === 1 ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}…`);
  const phases = (['opening', 'middlegame', 'endgame'] as const).filter((ph) => pattern.phase[ph] > 0);
  const phaseLabel = (ph: 'opening' | 'middlegame' | 'endgame') => t(`diagnosis.phase.${ph}`, {
    defaultValue: ph === 'opening' ? 'Opening' : ph === 'middlegame' ? 'Middlegame' : 'Endgame',
  });

  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-chesscom-100 font-mono text-xs font-bold text-chesscom-500 dark:bg-chesscom-700/60">
          {rank}
        </div>
        <Icon className={cn('mt-1 h-5 w-5 shrink-0', meta.tone)} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
            {t(`diagnosis.patterns.${pattern.key}.title`)}
          </h3>
          <p className="mt-0.5 text-xs leading-snug text-chesscom-500">
            {t(`diagnosis.patterns.${pattern.key}.desc`)}
          </p>
        </div>
        <TrendChip trend={pattern.trend_pct} />
      </div>

      <div>
        <div className="h-2 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700/60">
          <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-chesscom-500">
          <span>{t('diagnosis.events', { defaultValue: '{{n}} occurrences', n: pattern.count })}</span>
          <span>{t('diagnosis.inGames', { defaultValue: 'in {{n}} games', n: pattern.games_affected })}</span>
          <span className="font-medium text-chesscom-700 dark:text-chesscom-300">
            {t('diagnosis.avgSeverity', { defaultValue: '−{{n}}% win chance each', n: pattern.avg_severity })}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {phases.map((ph) => (
            <span key={ph} className="rounded bg-chesscom-100 px-1.5 py-0.5 text-[10px] font-medium text-chesscom-600 dark:bg-chesscom-700/60 dark:text-chesscom-300">
              {phaseLabel(ph)} · {pattern.phase[ph]}
            </span>
          ))}
          {pattern.color.black > 0 && pattern.color.white > 0 && (
            <span className="rounded bg-chesscom-100 px-1.5 py-0.5 text-[10px] font-medium text-chesscom-600 dark:bg-chesscom-700/60 dark:text-chesscom-300">
              {t('diagnosis.bothColors', { defaultValue: 'both colours' })}
            </span>
          )}
        </div>
        <div className="mt-2 rounded-md bg-chesscom-50 px-2 py-1.5 text-[11px] leading-snug text-chesscom-600 dark:bg-chesscom-900/40 dark:text-chesscom-300">
          <span className="font-semibold text-chesscom-700 dark:text-chesscom-200">
            {t('diagnosis.fix', { defaultValue: 'Next game: ' })}
          </span>
          {t(`diagnosis.fixes.${pattern.key}`, { defaultValue: FIX_DEFAULT[pattern.key] })}
        </div>
      </div>

      <div className="space-y-1 border-t border-chesscom-100 pt-2 dark:border-chesscom-700/60">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-400">
          {t('diagnosis.examples', { defaultValue: 'Your positions' })}
        </div>
        {pattern.examples.map((e) => (
          <Link
            key={`${e.game_id}-${e.ply}-${e.motif}`}
            to={`/review/${e.game_id}?ply=${e.ply}`}
            className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-chesscom-100 dark:hover:bg-chesscom-700/40"
          >
            <span className="font-mono font-semibold text-chesscom-800 dark:text-chesscom-200">
              {moveNumber(e.ply)} {e.played_san}
            </span>
            {e.best_san && (
              <span className="truncate text-chesscom-500">
                {t('diagnosis.bestWas', { defaultValue: 'best was' })} <span className="font-mono text-good">{e.best_san}</span>
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[11px] text-chesscom-400">−{e.severity}%</span>
            <span className="hidden shrink-0 text-[11px] text-chesscom-400 sm:inline">
              {e.opponent ? `vs ${e.opponent}` : ''} {e.end_time ? `· ${date(e.end_time)}` : ''}
            </span>
          </Link>
        ))}
      </div>

      <Link to="/train" className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold-700 hover:underline dark:text-gold-500">
        <Sparkles className="h-3 w-3" />
        {t('diagnosis.practise', { defaultValue: 'Practise with puzzles from your games' })}
      </Link>
    </article>
  );
}

function TrendChip({ trend }: { trend: number | null }) {
  const { t } = useTranslation();
  if (trend == null) return null;
  const flat = Math.abs(trend) < 10;
  const worse = trend > 0;
  const Icon = flat ? Minus : worse ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title={t('diagnosis.trendHint', { defaultValue: 'Change versus the earlier half of this window' })}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        flat
          ? 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700/60'
          : worse
            ? 'bg-bad/10 text-bad'
            : 'bg-good/10 text-good',
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(trend)}%
    </span>
  );
}

function WeeklyProgress({ weekly, overview }: { weekly: WeeklyBucket[]; overview: DiagnosisData['overview'] }) {
  const { t, i18n } = useTranslation();
  const label = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' });
  const maxGames = Math.max(1, ...weekly.map((w) => w.games));
  const maxBad = Math.max(1, ...weekly.map((w) => w.blunders_per_game + w.mistakes_per_game));
  const firstWeek = weekly[0];
  const lastWeek = weekly[weekly.length - 1];
  const accuracyDelta = firstWeek?.accuracy != null && lastWeek?.accuracy != null
    ? Math.round((lastWeek.accuracy - firstWeek.accuracy) * 10) / 10
    : null;

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-chesscom-500" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
          {t('diagnosis.weekly', { defaultValue: 'Weekly progress' })}
        </h2>
        {accuracyDelta != null && (
          <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold',
            accuracyDelta >= 0 ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad')}>
            {accuracyDelta >= 0 ? '+' : ''}{accuracyDelta}% {t('diagnosis.accuracySince', { defaultValue: 'accuracy since first week' })}
          </span>
        )}
      </div>

      {weekly.length === 0 ? (
        <div className="text-sm text-chesscom-500">{t('diagnosis.noWeekly', { defaultValue: 'No dated games in this window.' })}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-chesscom-400">
                <th className="pb-2 font-semibold">{t('diagnosis.week', { defaultValue: 'Week' })}</th>
                <th className="pb-2 font-semibold">{t('diagnosis.games', { defaultValue: 'Games' })}</th>
                <th className="pb-2 font-semibold">{t('diagnosis.record', { defaultValue: 'W / D / L' })}</th>
                <th className="pb-2 font-semibold">{t('diagnosis.accuracy', { defaultValue: 'Accuracy' })}</th>
                <th className="pb-2 font-semibold">{t('diagnosis.errorRate', { defaultValue: 'Errors / game' })}</th>
                <th className="pb-2 font-semibold">{t('diagnosis.mainHabit', { defaultValue: 'Main habit' })}</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((w) => (
                <tr key={w.week_start} className="border-t border-chesscom-100 dark:border-chesscom-700/60">
                  <td className="py-2 font-medium text-chesscom-700 dark:text-chesscom-200">{label(w.week_start)}</td>
                  <td className="py-2 tabular-nums text-chesscom-600 dark:text-chesscom-300">
                    <span className="inline-flex items-center gap-1">
                      {w.games}
                      <span className="inline-block h-1.5 rounded-full bg-chesscom-200 dark:bg-chesscom-700" style={{ width: `${Math.round((w.games / maxGames) * 40)}px` }} />
                    </span>
                  </td>
                  <td className="py-2 font-mono text-chesscom-600 dark:text-chesscom-300">{w.wins}/{w.draws}/{w.losses}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-10 font-mono tabular-nums text-chesscom-800 dark:text-chesscom-100">{w.accuracy != null ? `${w.accuracy}%` : '—'}</span>
                      {w.accuracy != null && (
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700/60">
                          <span className="block h-full rounded-full bg-gold-500" style={{ width: `${Math.max(0, Math.min(100, ((w.accuracy - 40) / 60) * 100))}%` }} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-10 font-mono tabular-nums text-chesscom-600 dark:text-chesscom-300">
                        {(w.blunders_per_game + w.mistakes_per_game).toFixed(1)}
                      </span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700/60">
                        <span className="block h-full rounded-full bg-move-blunder" style={{ width: `${Math.max(3, Math.min(100, ((w.blunders_per_game + w.mistakes_per_game) / maxBad) * 100))}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="py-2 text-chesscom-500">
                    {w.top_pattern ? t(`diagnosis.patterns.${w.top_pattern}.short`, { defaultValue: t(`diagnosis.patterns.${w.top_pattern}.title`) }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-[11px] text-chesscom-400">
        {overview.date_from && overview.date_to
          ? t('diagnosis.range', { defaultValue: 'Games from {{from}} to {{to}}.', from: label(overview.date_from), to: label(overview.date_to) })
          : null}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded bg-chesscom-100 dark:bg-chesscom-800" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-chesscom-100 dark:bg-chesscom-800" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-56 animate-pulse rounded-lg bg-chesscom-100 dark:bg-chesscom-800" />)}
      </div>
    </div>
  );
}
