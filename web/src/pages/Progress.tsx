// Progress — week-by-week improvement, with the frozen templated report.
//
// The server does the arithmetic (and the prose): this page is a reading view
// over `GET /api/progress`. Closed weeks never change; only the current week
// moves, which is why the table marks it as in progress. "Regenerate" asks the
// server for a fresh read of the live week (`refresh=1`); frozen weeks stay
// exactly as first written.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight, ArrowUpRight, CalendarDays, LineChart, Minus, RefreshCw,
  Sparkles, TrendingUp, Trophy,
} from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';
import type { PatternKey, WeeklyProgressPayload, WeeklyProgressWeek } from '../types';

type ProgressWeek = WeeklyProgressWeek & { summary_text?: string | null };
interface ProgressData extends Omit<WeeklyProgressPayload, 'weeks'> {
  weeks: ProgressWeek[];
}

const RANGES = [4, 8, 12, 26];

const PATTERN_LABEL: Record<PatternKey, string> = {
  hung_piece: 'Hung pieces',
  fork_exposed: 'Forks',
  allowed_mate: 'Allowed mates',
  missed_win: 'Missed wins',
  back_rank: 'Back rank',
  opening_leak: 'Opening leaks',
  endgame_drift: 'Endgame drift',
  promising_to_losing: 'Winning positions lost',
  queen_sortie: 'Early queen',
};

function endOfWeek(start: string): string {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export default function Progress() {
  const { t, i18n } = useTranslation();
  const [weeks, setWeeks] = useState(12);
  const [refresh, setRefresh] = useState(0);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['progress', weeks, refresh],
    queryFn: () => api.get<ProgressData>(
      `/api/progress?weeks=${weeks}${refresh ? `&refresh=${refresh}` : ''}`,
    ),
    staleTime: 30_000,
    // Keep the current table visible while a new range or a regenerate is in
    // flight; only the first load shows the skeleton.
    placeholderData: (previous) => previous,
  });

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-h1 flex items-center gap-2">
          <LineChart className="h-5 w-5 text-gold-600" />
          {t('progress.title', { defaultValue: 'Progress' })}
        </h1>
        <p className="page-sub">
          {t('progress.sub', {
            defaultValue: 'Week by week: accuracy, errors per game and the habit that cost you most.',
          })}
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-chesscom-500">
        {t('progress.range', { defaultValue: 'Range' })}
        <select
          className="input py-1 text-xs"
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
        >
          {RANGES.map((n) => (
            <option key={n} value={n}>
              {t('progress.weeks', { count: n, defaultValue: '{{count}} weeks' })}
            </option>
          ))}
        </select>
      </label>
    </header>
  );

  if (isLoading) return <Skeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-chesscom-500">
            {t('progress.error', { defaultValue: 'Could not load your progress. Try again.' })}
          </p>
          <button type="button" className="btn-secondary text-xs" onClick={() => void refetch()}>
            {t('progress.retry', { defaultValue: 'Try again' })}
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.weeks.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <LineChart className="h-8 w-8 text-chesscom-400" />
          <div className="text-base font-semibold">
            {t('progress.noData', { defaultValue: 'No analysed games in this period.' })}
          </div>
          <div className="max-w-md text-sm text-chesscom-500">
            {t('progress.report.empty', {
              defaultValue: 'Finish a full week of analysed games to get a written report.',
            })}
          </div>
          <Link to="/review" className="btn-primary mt-2 text-sm">{t('review.title')}</Link>
        </div>
      </div>
    );
  }

  const last = data.weeks[data.weeks.length - 1];
  const beforeLast = data.weeks[data.weeks.length - 2] ?? null;
  const accuracyWeek = [...data.weeks].reverse().find((w) => w.accuracy != null) ?? null;
  const bestWeek = data.weeks.reduce<ProgressWeek | null>(
    (best, w) => (w.accuracy != null && (!best || (best.accuracy ?? -1) < w.accuracy) ? w : best),
    null,
  );
  const errorsDelta = beforeLast ? round(last.errors_per_game - beforeLast.errors_per_game) : null;
  const maxGames = Math.max(1, ...data.weeks.map((w) => w.games));
  const maxErrors = Math.max(0.1, ...data.weeks.map((w) => w.errors_per_game));
  const reportWeek = [...data.weeks].reverse().find((w) => w.summary_text) ?? last;

  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' });
  const rangeLabel = (w: ProgressWeek) =>
    t('progress.dateRange', {
      from: fmt(w.week_start),
      to: fmt(endOfWeek(w.week_start)),
      defaultValue: '{{from}} – {{to}}',
    });

  const regenerate = () => setRefresh((n) => n + 1);

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label={t('progress.summary.currentAccuracy', { defaultValue: 'Current accuracy' })}
          value={accuracyWeek?.accuracy != null ? `${accuracyWeek.accuracy}%` : '—'}
          hint={t('progress.accuracyDelta', { defaultValue: 'vs. previous week' })}
          delta={accuracyWeek?.accuracy_delta ?? null}
          lowerIsBetter={false}
        />
        <Tile
          label={t('progress.errorsPerGame', { defaultValue: 'Errors / game' })}
          value={last.errors_per_game.toFixed(2)}
          hint={t('progress.errorsDelta', { defaultValue: 'vs. previous week' })}
          delta={errorsDelta}
          lowerIsBetter
        />
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-chesscom-500">
            <Trophy className="h-3 w-3 text-gold-600" />
            {t('progress.summary.bestWeek', { defaultValue: 'Best week' })}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-chesscom-900 dark:text-chesscom-100">
            {bestWeek?.accuracy != null ? `${bestWeek.accuracy}%` : '—'}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-chesscom-400">
            <CalendarDays className="h-3 w-3" />
            {bestWeek ? rangeLabel(bestWeek) : t('progress.noData', { defaultValue: 'No analysed games in this period.' })}
          </div>
        </div>
      </div>

      <EvolutionChart weeks={data.weeks} fmt={fmt} />

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <CalendarDays className="h-4 w-4 text-chesscom-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
            {t('progress.week', { defaultValue: 'Week' })}
          </h2>
          <span className="ml-auto text-[11px] text-chesscom-400">
            {t('progress.inProgressNote', { defaultValue: 'The current week is still in progress.' })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-chesscom-400">
                <th className="pb-2 font-semibold">{t('progress.week', { defaultValue: 'Week' })}</th>
                <th className="pb-2 font-semibold">{t('progress.games', { defaultValue: 'Games' })}</th>
                <th className="pb-2 font-semibold">{t('diagnosis.record', { defaultValue: 'W / D / L' })}</th>
                <th className="pb-2 font-semibold">{t('progress.accuracy', { defaultValue: 'Accuracy' })}</th>
                <th className="pb-2 font-semibold">{t('progress.errorsPerGame', { defaultValue: 'Errors / game' })}</th>
                <th className="pb-2 font-semibold">{t('progress.topPattern', { defaultValue: 'Main habit' })}</th>
              </tr>
            </thead>
            <tbody>
              {data.weeks.map((w) => (
                <WeekRow
                  key={w.week_start}
                  week={w}
                  range={rangeLabel(w)}
                  maxGames={maxGames}
                  maxErrors={maxErrors}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              <Sparkles className="h-4 w-4 text-gold-600" />
              {t('progress.report.title', { defaultValue: 'Weekly report' })}
            </h2>
            <div className="mt-0.5 text-[11px] text-chesscom-400">
              {t('progress.report.weekOf', { date: fmt(reportWeek.week_start), defaultValue: 'Week of {{date}}' })}
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
            disabled={isFetching}
            onClick={regenerate}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            {reportWeek.summary_text
              ? t('progress.report.regenerate', { defaultValue: 'Regenerate' })
              : t('progress.report.generate', { defaultValue: 'Generate report' })}
          </button>
        </div>

        {reportWeek.summary_text ? (
          <p className="mt-3 text-sm leading-relaxed text-chesscom-700 dark:text-chesscom-200">
            {reportWeek.summary_text}
          </p>
        ) : (
          <p className="mt-3 text-sm text-chesscom-500">
            {t('progress.report.empty', {
              defaultValue: 'Finish a full week of analysed games to get a written report.',
            })}
          </p>
        )}

        <div className="mt-3 border-t border-chesscom-100 pt-2 text-[11px] text-chesscom-400 dark:border-chesscom-700/60">
          {t('progress.report.hint', {
            defaultValue: "Built from the week's numbers — same numbers, same words.",
          })}
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-chesscom-400">
        {t('progress.explain.errors', {
          defaultValue: 'Severity-weighted errors per game: one blunder weighs more than several inaccuracies.',
        })}
      </p>
    </div>
  );
}

/* ───── Evolution chart ───────────────────────────────────────────────── */
//
// Inline SVG (no chart dependency). Works with a single week: the point is
// centred and drawn against a dashed level line, so the card never looks
// broken while the history is still one column wide.
type Metric = 'accuracy' | 'errors';

function EvolutionChart({ weeks, fmt }: { weeks: ProgressWeek[]; fmt: (iso: string) => string }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<Metric>('accuracy');

  const values = weeks.map((w) => (metric === 'accuracy' ? w.accuracy : w.errors_per_game));
  const points = values
    .map((value, index) => ({ value, index, week: weeks[index] }))
    .filter((p): p is { value: number; index: number; week: ProgressWeek } => p.value != null);

  const color = metric === 'accuracy' ? '#e0a02b' : '#c63b3a';
  const format = (v: number) =>
    metric === 'accuracy' ? `${v.toFixed(1)}%` : v.toFixed(2);

  const W = 520, H = 180, padL = 38, padR = 14, padT = 16, padB = 26;
  let min = 0;
  let max = 1;

  if (points.length > 0) {
    if (metric === 'accuracy') {
      min = Math.min(...points.map((p) => p.value));
      max = Math.max(...points.map((p) => p.value));
      if (min === max) { min = Math.max(0, min - 5); max = Math.min(100, max + 5); }
      const pad = Math.max(2, (max - min) * 0.12);
      min = Math.max(0, min - pad);
      max = Math.min(100, max + pad);
    } else {
      min = 0;
      max = Math.max(0.5, ...points.map((p) => p.value)) * 1.15;
    }
  }

  const n = weeks.length;
  const xScale = (i: number) =>
    n <= 1
      ? (padL + W - padR) / 2
      : padL + (i / (n - 1)) * (W - padL - padR);
  const yScale = (v: number) =>
    H - padB - ((v - min) / Math.max(0.0001, max - min)) * (H - padT - padB);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.index).toFixed(1)},${yScale(p.value).toFixed(1)}`)
    .join(' ');
  const avg = points.length >= 2
    ? points.reduce((sum, p) => sum + p.value, 0) / points.length
    : null;

  const ticks = [min, (min + max) / 2, max];
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const metrics: { key: Metric; label: string; color: string }[] = [
    { key: 'accuracy', label: t('progress.accuracy', { defaultValue: 'Accuracy' }), color: '#e0a02b' },
    { key: 'errors', label: t('progress.errorsPerGame', { defaultValue: 'Errors / game' }), color: '#c63b3a' },
  ];

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-gold-600" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
            {t('progress.evolution.title', { defaultValue: 'Evolution' })}
          </h2>
        </div>
        <div className="inline-flex rounded-md border border-chesscom-200 p-0.5 dark:border-chesscom-700">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                metric === m.key
                  ? 'bg-chesscom-800 text-white dark:bg-chesscom-100 dark:text-chesscom-900'
                  : 'text-chesscom-500 hover:text-chesscom-700 dark:hover:text-chesscom-200',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="py-10 text-center text-xs text-chesscom-400">
          {t('progress.evolution.noMetric', { defaultValue: 'No data for this metric yet.' })}
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t('progress.evolution.title', { defaultValue: 'Evolution' })}
        >
          {ticks.map((v, i) => (
            <g key={i}>
              <line
                x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)}
                className="stroke-chesscom-200 dark:stroke-chesscom-700"
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
              <text
                x={padL - 6} y={yScale(v) + 3}
                textAnchor="end" fontSize={9}
                className="fill-chesscom-400"
              >
                {metric === 'accuracy' ? `${Math.round(v)}%` : v.toFixed(1)}
              </text>
            </g>
          ))}

          {avg != null && (
            <line
              x1={padL} x2={W - padR} y1={yScale(avg)} y2={yScale(avg)}
              stroke={color} strokeWidth={0.7} strokeDasharray="3 3" opacity={0.55}
            />
          )}

          {points.length === 1 && (
            <line
              x1={padL} x2={W - padR}
              y1={yScale(points[0].value)} y2={yScale(points[0].value)}
              stroke={color} strokeWidth={1} strokeDasharray="1 3" opacity={0.6}
            />
          )}

          {points.length >= 2 && (
            <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
          )}

          {points.map((p) => (
            <circle
              key={p.week.week_start}
              cx={xScale(p.index)}
              cy={yScale(p.value)}
              r={p.week.partial ? 3 : 2.6}
              fill={p.week.partial ? 'transparent' : color}
              stroke={color}
              strokeWidth={p.week.partial ? 1.6 : 0}
            >
              <title>
                {`${fmt(p.week.week_start)} · ${format(p.value)}`}
                {p.week.partial ? ` · ${t('progress.partial', { defaultValue: 'in progress' })}` : ''}
              </title>
            </circle>
          ))}

          {weeks.map((w, i) => {
            if (i % labelEvery !== 0 && i !== n - 1) return null;
            if (n === 1) return null;
            return (
              <text
                key={w.week_start}
                x={xScale(i)}
                y={H - 8}
                fontSize={9}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                className="fill-chesscom-400"
              >
                {fmt(w.week_start)}
              </text>
            );
          })}
        </svg>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-chesscom-400">
        <span>
          {t('progress.evolution.hint', {
            defaultValue: 'Accuracy or severity-weighted errors, week by week. Dashed line = average.',
          })}
        </span>
        {points.length === 1 || n === 1 ? (
          <span>
            {t('progress.evolution.singleWeek', {
              defaultValue: 'Only one week so far — the line grows as you keep playing.',
            })}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  delta,
  lowerIsBetter,
}: {
  label: string;
  value: string;
  hint: string;
  delta: number | null;
  lowerIsBetter: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-chesscom-500">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums text-chesscom-900 dark:text-chesscom-100">
          {value}
        </span>
        <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} />
      </div>
      <div className="mt-1 text-[11px] text-chesscom-400">{hint}</div>
    </div>
  );
}

function DeltaChip({ delta, lowerIsBetter }: { delta: number | null; lowerIsBetter: boolean }) {
  if (delta == null) return null;
  const flat = Math.abs(delta) < 0.05;
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        flat
          ? 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700/60'
          : better
            ? 'bg-good/10 text-good'
            : 'bg-bad/10 text-bad',
      )}
    >
      <Icon className="h-3 w-3" />
      {delta > 0 ? '+' : ''}{round(delta)}
    </span>
  );
}

function WeekRow({
  week,
  range,
  maxGames,
  maxErrors,
}: {
  week: ProgressWeek;
  range: string;
  maxGames: number;
  maxErrors: number;
}) {
  const { t } = useTranslation();
  const top = week.top_patterns[0];
  return (
    <tr className={cn(
      'border-t border-chesscom-100 dark:border-chesscom-700/60',
      week.partial && 'bg-gold-500/5',
    )}>
      <td className="py-2 pr-3">
        <div className="font-medium text-chesscom-700 dark:text-chesscom-200">{range}</div>
        {week.partial && (
          <span className="mt-0.5 inline-block rounded bg-gold-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-500">
            {t('progress.partial', { defaultValue: 'in progress' })}
          </span>
        )}
      </td>
      <td className="py-2 pr-3 tabular-nums text-chesscom-600 dark:text-chesscom-300">
        <span className="inline-flex items-center gap-1">
          {week.games}
          <span
            className="inline-block h-1.5 rounded-full bg-chesscom-200 dark:bg-chesscom-700"
            style={{ width: `${Math.round((week.games / maxGames) * 40)}px` }}
          />
        </span>
      </td>
      <td className="py-2 pr-3 font-mono text-chesscom-600 dark:text-chesscom-300">
        {week.wins}/{week.draws}/{week.losses}
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <span className="w-10 font-mono tabular-nums text-chesscom-800 dark:text-chesscom-100">
            {week.accuracy != null ? `${week.accuracy}%` : '—'}
          </span>
          {week.accuracy != null && (
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700/60">
              <span
                className="block h-full rounded-full bg-gold-500"
                style={{ width: `${Math.max(0, Math.min(100, ((week.accuracy - 40) / 60) * 100))}%` }}
              />
            </span>
          )}
          <DeltaChip delta={week.accuracy_delta} lowerIsBetter={false} />
        </div>
      </td>
      <td className="py-2 pr-3">
        <span className="inline-flex items-center gap-2">
          <span className="w-10 font-mono tabular-nums text-chesscom-600 dark:text-chesscom-300">
            {week.errors_per_game.toFixed(2)}
          </span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700/60">
            <span
              className="block h-full rounded-full bg-move-blunder"
              style={{ width: `${Math.max(3, Math.min(100, (week.errors_per_game / maxErrors) * 100))}%` }}
            />
          </span>
        </span>
      </td>
      <td className="py-2">
        {top ? (
          <span className="inline-flex items-center gap-1 rounded bg-chesscom-100 px-1.5 py-0.5 text-[10px] font-medium text-chesscom-600 dark:bg-chesscom-700/60 dark:text-chesscom-300">
            {t(`diagnosis.patterns.${top.key}.short`, { defaultValue: PATTERN_LABEL[top.key] })}
            <span className="font-mono text-chesscom-400">×{top.count}</span>
          </span>
        ) : (
          <span className="text-chesscom-400">—</span>
        )}
      </td>
    </tr>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded bg-chesscom-100 dark:bg-chesscom-800" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-chesscom-100 dark:bg-chesscom-800" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-chesscom-100 dark:bg-chesscom-800" />
      <div className="h-40 animate-pulse rounded-lg bg-chesscom-100 dark:bg-chesscom-800" />
    </div>
  );
}
