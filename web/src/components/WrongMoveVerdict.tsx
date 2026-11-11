// "Not the correct move" — the trainer's verdict on a wrong try: the move, the
// chess.com-style classification and the engine's score from your side, so a
// miss teaches something instead of only saying "no". When the eval *before*
// the move is known (the move you played in the game), the score reads as the
// transition it caused — "+1.2 → −0.6" — because "how much did it cost?" is the
// question a player actually asks. Shared by both Train tabs (From your games
// and Puzzles).

import { useTranslation } from 'react-i18next';
import { ArrowRight, Loader2 } from 'lucide-react';
import { GLYPH_SVG, styleFor } from '../lib/classification';
import { formatTryEval, type TriedMoveEval } from '../lib/moveVerdict';
import { cn } from '../lib/utils';

interface Props {
  /** The move you tried, when the eval hasn't arrived (or never will). */
  san?: string | null;
  evaluation: TriedMoveEval | null;
  /** Your side; the eval is shown from here. */
  side: 'white' | 'black';
  /** The engine is still looking at the move. */
  loading?: boolean;
  /** Just the move, badge and score — no sentence explaining the eval. For
   *  the result summary, where two of these are stacked. */
  compact?: boolean;
  /** Classification to show when there is no `evaluation` (the game's own move
   *  when the analysis had no score after it). */
  classification?: string | null;
  /** White-perspective eval before the move, which turns the score into
   *  "before → after" and makes the cost obvious. */
  beforeCp?: number | null;
  beforeMate?: number | null;
}

export default function WrongMoveVerdict({
  san, evaluation, side, loading = false, compact = false,
  classification, beforeCp = null, beforeMate = null,
}: Props) {
  const { t } = useTranslation();
  const style = styleFor(classification ?? evaluation?.classification);
  const move = evaluation?.san ?? san ?? null;
  if (!move && !loading) return null;

  const after = evaluation ? formatTryEval(evaluation.cp, evaluation.mate, side) : null;
  const before = beforeCp != null || beforeMate != null
    ? formatTryEval(beforeCp ?? 0, beforeMate ?? null, side)
    : null;
  const loss = evaluation && evaluation.cp_loss > 0 ? (evaluation.cp_loss / 100).toFixed(1) : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {move && (
          <span className="font-mono text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{move}</span>
        )}
        {style && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white', style.bgClass)}>
            <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">{GLYPH_SVG[style.glyph]}</svg>
            {t(`classification.${style.labelKey}`)}
          </span>
        )}
      </div>
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-chesscom-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('train.evalChecking')}
        </div>
      )}
      {(before != null || after != null) && (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-chesscom-500" title={t('train.evalDropHint')}>
            <span>{t('train.evalBefore')}</span>
            <span className="flex items-center gap-1 font-mono text-sm font-semibold tabular-nums">
              {before != null && (
                <>
                  <span className="text-chesscom-600 dark:text-chesscom-300">{before}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-chesscom-400" aria-hidden="true" />
                </>
              )}
              {after != null && (
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-white',
                  style ? style.bgClass : 'bg-chesscom-500',
                )}>
                  {after}
                </span>
              )}
            </span>
          </div>
          {loss && (
            <div className="text-xs text-chesscom-500">
              {before != null ? (
                <div className="flex flex-wrap items-center gap-1.5" title={t('train.evalDropHint')}>
                  <span>{t('train.bestScore')}</span>
                  <span className="flex items-center gap-1 font-mono text-sm font-semibold tabular-nums">
                    <span className="text-chesscom-600 dark:text-chesscom-300">{before}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-chesscom-400" aria-hidden="true" />
                    <span className="rounded bg-move-best px-1.5 py-0.5 text-white">{before}</span>
                  </span>
                </div>
              ) : t('train.evalLoss', { loss })}
            </div>
          )}
        </div>
      )}
      {!compact && evaluation && before == null && (
        <div className="text-xs text-chesscom-500">{t('train.evalSide')}</div>
      )}
    </div>
  );
}
