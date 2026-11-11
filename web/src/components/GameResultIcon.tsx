import { Equal, Frown, Trophy } from 'lucide-react';
import { cn } from '../lib/utils';

/** The result chip that leads a game row: a trophy for a win, a red sad face
 *  for a loss, an equals sign for a draw. Shared so the Review list and the
 *  Home list always agree on the glyph and its palette. */
export default function GameResultIcon({ result, className }: {
  /** "win" | "loss" | "draw" as stored on a game row. */
  result: string;
  className?: string;
}) {
  const shell = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl';
  if (result === 'win') {
    return (
      <div className={cn(shell, 'bg-board-dark/15 text-board-dark', className)}>
        <Trophy className="h-4 w-4" />
      </div>
    );
  }
  if (result === 'loss') {
    return (
      <div className={cn(shell, 'bg-bad/15 text-bad', className)}>
        <Frown className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className={cn(shell, 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300', className)}>
      <Equal className="h-4 w-4" />
    </div>
  );
}
