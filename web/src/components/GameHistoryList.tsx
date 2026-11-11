// The recent-games list: one row per game, shared by Home and a player
// profile so both pages read the same. Row content is deliberately the same
// shape as chess.com's archive — speed, result, both names with the row
// owner's side emphasized, date/opening, and the accuracy pair (or a badge
// saying the game has no review yet).

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import GameResultIcon from './GameResultIcon';
import TimeClassIcon from './TimeClassIcon';
import { fmtAccuracy, fmtTimeControl } from '../lib/utils';

/** The subset of a game row this list needs. `user_color` is the color of the
 *  player whose history this is — the name that gets emphasized. */
export interface GameHistoryRow {
  id: number;
  white: string;
  black: string;
  result: string;
  user_color: 'white' | 'black' | null;
  time_control: string;
  time_class: string | null;
  opening_name: string | null;
  end_time: string;
  /** SQLite 0/1 from the API, a boolean in tests. */
  analyzed?: number | boolean | null;
  accuracy_white?: number | null;
  accuracy_black?: number | null;
}

const ROW = 'flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4 sm:py-3';
const LIST = 'divide-y divide-chesscom-100 overflow-hidden rounded-xl border border-chesscom-200 bg-white shadow-soft dark:divide-chesscom-800 dark:border-chesscom-700 dark:bg-chesscom-800';

export default function GameHistoryList({ games, hrefFor }: {
  games: GameHistoryRow[];
  /** Where a row links. Omit when the viewer may not open these games (another
   *  player's history, which the analyzer's user-scoped routes would 404). */
  hrefFor?: (game: GameHistoryRow) => string;
}) {
  return (
    <ul className={LIST}>
      {games.map((g) => (
        <li key={g.id}>
          {hrefFor
            ? <Link to={hrefFor(g)} className={`${ROW} hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40`}><GameHistoryRowContent game={g} /></Link>
            : <div className={ROW}><GameHistoryRowContent game={g} /></div>}
        </li>
      ))}
    </ul>
  );
}

function GameHistoryRowContent({ game: g }: { game: GameHistoryRow }) {
  const { t } = useTranslation();
  const ownerIsWhite = g.user_color === 'white';
  return (
    <>
      <TimeClassIcon
        timeClass={g.time_class}
        label={g.time_control && g.time_control !== '-' ? fmtTimeControl(g.time_control, t) : undefined}
      />
      <GameResultIcon result={g.result} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          <span className={ownerIsWhite ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500'}>{g.white}</span>
          <span className="mx-1.5 text-chesscom-400">{t('players.vs')}</span>
          <span className={ownerIsWhite ? 'text-chesscom-500' : 'text-chesscom-900 dark:text-chesscom-100'}>{g.black}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-chesscom-500">
          <span>{new Date(g.end_time).toLocaleDateString()}</span>
          {!g.time_class && (
            <>
              <span className="text-chesscom-400">·</span>
              <span>{fmtTimeControl(g.time_control, t)}</span>
            </>
          )}
          {g.opening_name && (
            <span className="hidden min-w-0 items-center gap-1.5 sm:inline-flex">
              <span className="text-chesscom-400">·</span>
              <span className="truncate">{g.opening_name}</span>
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {g.analyzed ? (
          <div className="font-mono text-xs tabular-nums">
            <span className={ownerIsWhite ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500'}>
              {fmtAccuracy(g.accuracy_white)}
            </span>
            <span className="mx-1 text-chesscom-400">/</span>
            <span className={ownerIsWhite ? 'text-chesscom-500' : 'font-semibold text-chesscom-900 dark:text-chesscom-100'}>
              {fmtAccuracy(g.accuracy_black)}
            </span>
          </div>
        ) : (
          <span className="badge bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300">
            <BookOpen className="h-3 w-3" /> {t('common.unreviewed')}
          </span>
        )}
      </div>
    </>
  );
}
