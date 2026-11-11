// Pattern drills — the trainer widget for one stored pattern.
//
// Positions come from `GET /api/train/drill` (contracts.ts: DrillPayload) and
// are solved on the shared ChessBoard. The client validates move 1 only; the
// rest of the engine line is context, not a multi-move test. An attempt is
// recorded through the existing trainer contract (`POST /api/train/attempt`,
// game_id + ply), so drills feed the same review queue as regular puzzles.

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Chess } from 'chess.js';
import {
  ArrowRight, BookOpen, Check, Eye, Loader2, Play, RotateCcw, Target, X,
} from 'lucide-react';
import ChessBoard from './ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { localDay } from '../lib/openingTrainer';
import type { DrillPayload, DrillPosition, PatternKey } from '../types';

/** The contract plus the context fields the route adds for the board header. */
type Drill = DrillPosition & {
  opponent?: string | null;
  opening_name?: string | null;
  end_time?: string | null;
};

type DrillMode = DrillPayload['mode'];
type Status = 'play' | 'wrong' | 'correct' | 'revealed';

const MOTIF_FALLBACK: Record<PatternKey, string> = {
  hung_piece: 'Hung piece',
  fork_exposed: 'Fork exposed',
  allowed_mate: 'Allowed mate',
  missed_win: 'Missed win',
  back_rank: 'Back rank',
  opening_leak: 'Opening leak',
  endgame_drift: 'Endgame drift',
  promising_to_losing: 'Promising to losing',
  queen_sortie: 'Queen sortie',
};

function motifLabel(t: TFunction, key: PatternKey): string {
  return t(`diagnosis.patterns.${key}.short`, { defaultValue: MOTIF_FALLBACK[key] });
}

function matchesSolution(uci: string, solution: string[]): boolean {
  const want = solution[0]?.toLowerCase();
  if (!want) return false;
  const tried = uci.toLowerCase();
  if (tried === want) return true;
  // The board sends a promotion without the piece; a missing one means queen.
  return want.length === 5 && want.endsWith('q') && tried === want.slice(0, 4);
}

function afterMove(fen: string, uci: string): { fen: string; lastMove: string[] } | null {
  const chess = new Chess(fen);
  try {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
    return { fen: chess.fen(), lastMove: [move.from, move.to] };
  } catch {
    return null;
  }
}

export function DrillBoard({ position, current, total, onNext, isLast }: {
  position: Drill;
  current: number;
  total: number;
  onNext: () => void;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>('play');
  const [boardKey, setBoardKey] = useState(0);
  const sent = useRef(false);

  const solution = position.solution_uci;
  const side = position.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const solved = afterMove(position.fen, solution[0] ?? '');
  const showSolution = status === 'correct' || status === 'revealed';
  const boardFen = showSolution && solved ? solved.fen : position.fen;
  const turnColor = boardFen.split(' ')[1] === 'b' ? 'black' : 'white';
  const yourTurn = status === 'play' || status === 'wrong';

  function record(ok: boolean, attempted?: string) {
    if (sent.current) return;
    sent.current = true;
    api.post('/api/train/attempt', {
      game_id: position.game_id,
      ply: position.ply,
      solved: ok,
      attempted_uci: attempted,
      today: localDay(),
    }).catch(() => { /* the drill goes on; it just isn't in the queue */ });
  }

  function onMove(uci: string) {
    if (!yourTurn) return;
    if (matchesSolution(uci, solution)) {
      setStatus('correct');
      record(true, solution[0]);
      return;
    }
    setStatus('wrong');
    setBoardKey((k) => k + 1);
    record(false, uci);
  }

  const arrows = useMemo(() => {
    if (!showSolution || !solution[0]) return [];
    return [{ orig: solution[0].slice(0, 2), dest: solution[0].slice(2, 4), brush: 'paleBlue' }];
  }, [showSolution, solution]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full lg:flex-1 lg:max-w-[560px] board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs shadow-soft dark:bg-chesscom-800">
          <span className="font-medium text-chesscom-700 dark:text-chesscom-200">
            {t('train.drill.position', { current, total })}
          </span>
          <span className="badge bg-gold-500/15 text-gold-700 dark:text-gold-400">
            {t('train.drill.severity', { value: Math.round(position.severity) })}
          </span>
        </div>
        <ChessBoard
          fen={boardFen}
          orientation={side}
          turnColor={turnColor}
          movable={yourTurn}
          onMove={onMove}
          lastMove={showSolution ? (solved?.lastMove as never) : undefined}
          arrows={arrows as never}
          resetKey={boardKey}
        />
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-500">
              {position.prompt === 'spot_threat' ? t('train.drill.spotThreat') : t('train.drill.findBest')}
            </div>
            <span className="badge bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700/40 dark:text-chesscom-300">
              {motifLabel(t, position.motif)}
            </span>
          </div>
          <div className="mt-1 text-sm text-chesscom-700 dark:text-chesscom-200">
            {side === 'white'
              ? t('train.whiteToMove', { defaultValue: 'White to move' })
              : t('train.blackToMove', { defaultValue: 'Black to move' })}
          </div>
          {position.opponent && (
            <div className="mt-2 text-xs text-chesscom-500">
              {t('train.drill.source', { opponent: position.opponent })}
            </div>
          )}
          {position.played_san && status !== 'play' && (
            <div className="mt-2 text-xs text-chesscom-500">
              {t('train.taskBody', { played: position.played_san })}
            </div>
          )}
        </div>

        <div className={`card p-4 ${
          status === 'wrong' ? 'border-move-mistake bg-move-mistake/5'
            : status === 'correct' ? 'border-board-dark bg-board-dark/5' : ''
        }`}>
          {status === 'play' && (
            <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {t('train.mine.yourMove')}
            </div>
          )}
          {status === 'wrong' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" />
              <span>{t('train.drill.wrong')}</span>
            </div>
          )}
          {status === 'correct' && (
            <div className="flex items-start gap-2 text-sm font-semibold">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-dark" />
              <span>{t('train.drill.correct')}</span>
            </div>
          )}
          {status === 'revealed' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
              <span>{position.best_san}</span>
            </div>
          )}
          {showSolution && position.best_san && (
            <div className="mt-2 text-xs text-chesscom-500">
              {t('train.mine.solution')} <span className="font-mono">{position.best_san}</span>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!showSolution && (
              <button
                onClick={() => { setStatus('revealed'); record(false); }}
                className="btn-secondary flex-1 text-sm"
              >
                <Eye className="h-4 w-4" /> {t('train.drill.reveal')}
              </button>
            )}
            {(showSolution || status === 'wrong') && (
              <button onClick={onNext} className="btn-primary flex-1 text-sm">
                {isLast ? t('train.drill.done') : t('train.drill.next')} <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <Link to={`/review/${position.game_id}?ply=${position.ply}`} className="card-hover flex items-center gap-2 p-3 text-xs">
          <BookOpen className="h-4 w-4 text-chesscom-400" />
          <span className="text-chesscom-600 dark:text-chesscom-200">
            {t('train.openInReview', { defaultValue: 'Open this position in the full review' })}
          </span>
        </Link>
      </aside>
    </div>
  );
}

/**
 * The compact "Train this pattern" section on Train. It picks the user's top
 * diagnosed motifs (mixed = all of them, interleaved), fetches one set, then
 * walks it position by position.
 */
export function PatternDrills() {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState<PatternKey | 'mixed'>('mixed');
  const [mode, setMode] = useState<DrillMode>('find_best');
  const [started, setStarted] = useState(false);
  const [run, setRun] = useState(0);
  const [index, setIndex] = useState(0);

  const { data: diagnosis } = useQuery({
    queryKey: ['drill-pattern-options'],
    queryFn: () => api.get<{ patterns: { key: PatternKey }[] }>('/api/diagnosis?games=100'),
    staleTime: 60_000,
    retry: false,
  });

  const { data, isFetching, isError } = useQuery({
    queryKey: ['pattern-drill', pattern, mode, run],
    queryFn: () => api.get<DrillPayload>(
      `/api/train/drill?pattern=${encodeURIComponent(pattern)}&count=10&mode=${mode}`,
    ),
    enabled: started,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const topPatterns = (diagnosis?.patterns ?? []).map((p) => p.key);
  const options: (PatternKey | 'mixed')[] = ['mixed', ...topPatterns.filter((k, i) => topPatterns.indexOf(k) === i)];
  const currentPattern = options.includes(pattern) ? pattern : 'mixed';

  function reset() {
    setStarted(false);
    setIndex(0);
  }
  function choose(next: PatternKey | 'mixed') {
    setPattern(next);
    reset();
  }
  function chooseMode(next: DrillMode) {
    setMode(next);
    reset();
  }
  function start() {
    setIndex(0);
    setRun((r) => r + 1);
    setStarted(true);
  }

  const positions = (data?.positions ?? []) as Drill[];
  const position = positions[index];
  const done = started && !isFetching && !!data && index >= positions.length;
  const empty = started && !isFetching && !!data && positions.length === 0;

  return (
    <section className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
            <Target className="h-4 w-4 text-gold-600" /> {t('train.drill.title')}
          </h2>
          <p className="mt-0.5 text-xs text-chesscom-500">{t('train.drill.sub')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-chesscom-500">
            {t('train.drill.pattern')}
            <select
              className="input py-1 text-xs"
              value={currentPattern}
              onChange={(e) => choose(e.target.value as PatternKey | 'mixed')}
            >
              {options.map((key) => (
                <option key={key} value={key}>
                  {key === 'mixed' ? t('train.drill.mixed') : motifLabel(t, key)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1">
            <button
              onClick={() => chooseMode('find_best')}
              className={`btn-secondary text-xs ${mode === 'find_best' ? 'border-gold-500 text-gold-700 dark:text-gold-400' : ''}`}
            >
              {t('train.drill.findBest')}
            </button>
            <button
              onClick={() => chooseMode('spot_threat')}
              className={`btn-secondary text-xs ${mode === 'spot_threat' ? 'border-gold-500 text-gold-700 dark:text-gold-400' : ''}`}
            >
              {t('train.drill.spotThreat')}
            </button>
          </div>
          <button onClick={start} disabled={isFetching} className="btn-primary text-xs">
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {started ? t('train.drill.again') : t('train.drill.start')}
          </button>
        </div>
      </div>

      {started && (
        <div className="mt-4">
          {isFetching && (
            <div className="py-8 text-center text-sm text-chesscom-500">{t('common.loading')}</div>
          )}
          {isError && (
            <div className="py-6 text-center text-sm text-chesscom-500">{t('train.puzzles.loadError')}</div>
          )}
          {empty && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Target className="h-7 w-7 text-gold-500" />
              <div className="text-sm font-semibold">{t('train.drill.empty')}</div>
              <p className="max-w-md text-xs text-chesscom-500">{t('train.drill.emptyDesc')}</p>
              <button onClick={start} className="btn-secondary mt-2 text-xs">
                <RotateCcw className="h-3.5 w-3.5" /> {t('train.drill.again')}
              </button>
            </div>
          )}
          {done && !empty && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Check className="h-7 w-7 text-board-dark" />
              <div className="text-sm font-semibold">{t('train.drill.done')}</div>
              <button onClick={start} className="btn-secondary mt-1 text-xs">
                <RotateCcw className="h-3.5 w-3.5" /> {t('train.drill.again')}
              </button>
            </div>
          )}
          {position && (
            <DrillBoard
              key={`${pattern}:${position.game_id}:${position.ply}:${index}`}
              position={position}
              current={index + 1}
              total={positions.length}
              isLast={index + 1 >= positions.length}
              onNext={() => setIndex((i) => i + 1)}
            />
          )}
        </div>
      )}
    </section>
  );
}

