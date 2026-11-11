// "Your openings" — the Trainer's view of the openings actually in your games.
// The server (chess/openingProfile.ts) aggregates the analysed games: what you
// play, how it scores, and the costly opening moves with the engine's move.
// Each leak drills the corrected line straight into the trainer.

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Loader2, TrendingDown } from 'lucide-react';
import { api } from '../api';
import { formatMoves, moveLabel, type DrillLine, type Side } from '../lib/openingTrainer';
import { profileDrill, type OpeningProfile, type OpeningProfileEntry, type OpeningProfilePayload } from '../lib/openingProfile';

export const PROFILE_QUERY_KEY = ['opening-profile'];

export default function OpeningProfilePanel({ onStart }: { onStart: (line: DrillLine) => void }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => api.get<OpeningProfilePayload>('/api/openings/profile'),
  });

  const games = (data?.white.games ?? 0) + (data?.black.games ?? 0);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-chesscom-200 px-4 py-3 dark:border-chesscom-700">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
          <TrendingDown className="h-4 w-4 text-board-dark" />
          {t('openings.trainer.profile.title')}
        </h2>
        <p className="mt-1 text-sm text-chesscom-500">{t('openings.trainer.profile.sub')}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-chesscom-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : isError || !data ? (
        <div className="flex items-center gap-2 p-6 text-sm text-move-mistake">
          <AlertTriangle className="h-4 w-4" /> {t('openings.trainer.profile.loadError')}
        </div>
      ) : games === 0 ? (
        <div className="p-6">
          <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
            {t('openings.trainer.profile.empty')}
          </div>
          <div className="mt-1 text-sm text-chesscom-500">{t('openings.trainer.profile.emptyHint')}</div>
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <SideColumn color="white" profile={data.white} onStart={onStart} />
          <SideColumn color="black" profile={data.black} onStart={onStart} />
        </div>
      )}
    </section>
  );
}

function SideColumn({ color, profile, onStart }: {
  color: Side;
  profile: OpeningProfile;
  onStart: (line: DrillLine) => void;
}) {
  const { t } = useTranslation();
  if (profile.games === 0) {
    return (
      <div>
        <SideTitle color={color} games={0} />
        <p className="mt-2 text-xs text-chesscom-500">{t('openings.trainer.profile.noGames')}</p>
      </div>
    );
  }
  return (
    <div>
      <SideTitle color={color} games={profile.games} />
      <ul className="mt-2 space-y-2">
        {profile.openings.map((opening) => (
          <OpeningRow
            key={`${opening.eco ?? ''}|${opening.name ?? ''}`}
            color={color}
            opening={opening}
            onStart={onStart}
          />
        ))}
      </ul>
    </div>
  );
}

function SideTitle({ color, games }: { color: Side; games: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
        {color === 'white' ? t('openings.trainer.white') : t('openings.trainer.black')}
      </h3>
      <span className="font-mono text-[11px] tabular-nums text-chesscom-400">
        {t('openings.trainer.profile.sample', { count: games })}
      </span>
    </div>
  );
}

function OpeningRow({ color, opening, onStart }: {
  color: Side;
  opening: OpeningProfileEntry;
  onStart: (line: DrillLine) => void;
}) {
  const { t } = useTranslation();
  const name = opening.name ?? t('openings.trainer.profile.unknownOpening');
  const bar = opening.score >= 55 ? 'bg-board-dark' : opening.score >= 45 ? 'bg-gold-500' : 'bg-move-mistake';

  return (
    <li className="rounded-lg border border-chesscom-200 p-2.5 dark:border-chesscom-700">
      <div className="flex items-start gap-2">
        {opening.eco && (
          <span className="mt-0.5 rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-[11px] text-chesscom-600 dark:bg-chesscom-900/60 dark:text-chesscom-300">
            {opening.eco}
          </span>
        )}
        <span className="line-clamp-1 text-sm font-medium text-chesscom-900 dark:text-chesscom-100">{name}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-chesscom-500">
          {t('openings.trainer.profile.score', { n: opening.score })}
        </span>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700/60">
        <div className={`h-full ${bar}`} style={{ width: `${opening.score}%` }} />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-chesscom-500">
        <span>{t('openings.trainer.games', { count: opening.games })}</span>
        {opening.accuracy !== null && (
          <span>{t('openings.trainer.profile.accuracy', { n: opening.accuracy })}</span>
        )}
      </div>

      {opening.leaks.length === 0 ? (
        <div className="mt-1.5 text-[11px] text-chesscom-400">{t('openings.trainer.profile.noLeaks')}</div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {opening.leaks.map((leak) => {
            const line = profileDrill(opening, leak, color, name);
            return (
              <div key={`${leak.san_line.join(' ')}|${leak.played_san}`} className="rounded-md bg-chesscom-50 p-1.5 dark:bg-chesscom-900/40">
                <div className="truncate font-mono text-[11px] text-chesscom-400">
                  {formatMoves(leak.san_line) || '—'}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
                  <span className="font-mono text-move-mistake">
                    {moveLabel([...leak.san_line, leak.played_san], leak.ply - 1)}
                  </span>
                  {leak.best_san && (
                    <span className="font-mono text-board-dark dark:text-chesscom-200">
                      → {moveLabel([...leak.san_line, leak.best_san], leak.ply - 1)}
                    </span>
                  )}
                  <span className="ml-auto font-mono tabular-nums text-chesscom-400">
                    {t('openings.trainer.profile.cpLoss', { pawns: (leak.avg_cp_loss / 100).toFixed(1) })}
                  </span>
                </div>
                {line && (
                  <button onClick={() => onStart(line)} className="btn-secondary mt-1 w-full text-[11px]">
                    {t('openings.trainer.profile.train')} <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}
