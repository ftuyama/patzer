// The player's own ratings, shared by every surface that shows them: the
// Home hero, the top bar and Progress. Patzer's Glicko pool wins whenever the
// player has a rated game in that class; otherwise we show the number imported
// from chess.com, so an imported-only profile still has something to look at.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';
import type { RatingRow, TimeClass } from '../types';
import TimeClassIcon from './TimeClassIcon';

export const RATING_CLASSES: readonly TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily'];

export interface RatingsMap {
  [key: string]: RatingRow;
}

export interface ExternalRating {
  rating: number;
  updated_at: string;
}

/** Keyed by source ("chesscom") and then by time class. */
export interface ExternalRatings {
  [source: string]: { [timeClass: string]: ExternalRating | undefined } | undefined;
}

export interface RatingsPayload {
  ratings: RatingsMap;
  external?: ExternalRatings;
}

export function useMyRatings() {
  return useQuery<RatingsPayload>({
    queryKey: ['ratings', 'me'],
    queryFn: () => api.get<RatingsPayload>('/api/ratings/me'),
    staleTime: 30_000,
  });
}

export interface DisplayRating {
  rating: number;
  time_class: TimeClass;
  games_played: number;
  provisional: boolean;
  /** 'patzer' = rated here; 'chesscom' = imported from the linked account. */
  source: 'patzer' | 'chesscom';
}

/** One class, Patzer's own pool first. Null when neither side has a number. */
export function resolveRating(
  ratings: RatingsMap | undefined | null,
  external: ExternalRatings | undefined | null,
  tc: TimeClass,
): DisplayRating | null {
  const own = ratings?.[tc];
  if (own && own.games_played > 0) {
    return {
      rating: own.rating,
      time_class: tc,
      games_played: own.games_played,
      provisional: own.provisional,
      source: 'patzer',
    };
  }
  const ext = external?.chesscom?.[tc];
  if (ext && Number.isFinite(ext.rating)) {
    return { rating: ext.rating, time_class: tc, games_played: 0, provisional: false, source: 'chesscom' };
  }
  return null;
}

/** The class worth a single line of chrome: the most-played Patzer class, or
 *  the highest chess.com class when nothing here is rated. Ties keep the
 *  bullet → blitz → rapid → daily order, so the chip does not jump around. */
export function primaryRating(
  ratings: RatingsMap | undefined | null,
  external?: ExternalRatings | undefined | null,
): DisplayRating | null {
  if (!ratings) return null;
  const own = RATING_CLASSES
    .map((tc) => resolveRating(ratings, null, tc))
    .filter((r): r is DisplayRating => !!r);
  if (own.length > 0) {
    return own.reduce((best, r) => (r.games_played > best.games_played ? r : best));
  }
  return RATING_CLASSES
    .map((tc) => resolveRating(ratings, external, tc))
    .find((r): r is DisplayRating => !!r) ?? null;
}

export function hasAnyRating(
  ratings: RatingsMap | undefined | null,
  external?: ExternalRatings | undefined | null,
): boolean {
  return RATING_CLASSES.some((tc) => !!resolveRating(ratings, external, tc));
}

/** A compact chip for the top bar. Links to the player profile, where the
 *  full table lives. */
export function RatingChip({ rating, to, className }: {
  rating: DisplayRating; to: string; className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      title={t('ratings.title', { defaultValue: 'Ratings' })}
      className={cn(
        'items-center gap-1.5 rounded-md border border-chesscom-700 bg-chesscom-800/60 px-2 py-1 hover:border-gold-500/50 hover:bg-chesscom-800',
        className,
      )}
    >
      <TimeClassIcon timeClass={rating.time_class} orientation="inline" />
      <span className="font-mono text-sm font-semibold tabular-nums text-gold-300">
        {rating.rating}{rating.provisional ? '?' : ''}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-chesscom-400">
        {t(`players.tc.${rating.time_class}`, { defaultValue: rating.time_class })}
      </span>
    </Link>
  );
}

/** Four numbers in a row. Classes with neither a Glicko game nor an imported
 *  rating stay visible as an em dash so the layout never changes shape. */
export function RatingStrip({ ratings, external, tone = 'light', className }: {
  ratings: RatingsMap | undefined | null;
  external?: ExternalRatings | undefined | null;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const { t } = useTranslation();
  const dark = tone === 'dark';
  const shown = RATING_CLASSES.map((tc) => resolveRating(ratings, external, tc));
  const usesChessCom = shown.some((r) => r?.source === 'chesscom');

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {RATING_CLASSES.map((tc, i) => {
          const r = shown[i]!;
          return (
            <div key={tc} className="flex items-center gap-1.5">
              <TimeClassIcon timeClass={tc} orientation="inline" iconClassName="h-3 w-3" />
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-wider',
                dark ? 'text-white/50' : 'text-chesscom-400',
              )}>
                {t(`players.tc.${tc}`, { defaultValue: tc })}
              </span>
              <span
                className={cn(
                  'font-mono text-lg font-semibold tabular-nums',
                  r
                    ? dark ? 'text-gold-300' : 'text-chesscom-900 dark:text-chesscom-100'
                    : dark ? 'text-white/30' : 'text-chesscom-300 dark:text-chesscom-600',
                )}
                title={r
                  ? r.source === 'chesscom'
                    ? t('ratings.chesscomSource', { defaultValue: 'Rating imported from Chess.com' })
                    : r.provisional ? t('ratings.provisional', { defaultValue: 'provisional' }) : undefined
                  : t('ratings.unrated', { defaultValue: 'Unrated' })}
              >
                {r ? r.rating : '—'}{r?.provisional ? '?' : ''}
              </span>
            </div>
          );
        })}
      </div>
      {usesChessCom && (
        <div className={cn('text-[10px]', dark ? 'text-white/40' : 'text-chesscom-400')}>
          {t('ratings.chesscomSource', { defaultValue: 'Rating imported from Chess.com' })}
        </div>
      )}
    </div>
  );
}

export function RatingsCard({ ratings, external, className }: {
  ratings: RatingsMap | undefined | null;
  external?: ExternalRatings | undefined | null;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className={cn('card p-4', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-gold-600" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
          {t('ratings.title', { defaultValue: 'Ratings' })}
        </h2>
      </div>
      <RatingStrip ratings={ratings} external={external} />
    </section>
  );
}
