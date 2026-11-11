// The eval bar's score for the position on the board, fetched automatically.
//
// Every board component asks through this hook, so they share one query key per
// FEN: a position analysed in Train is free in the pattern drill and the
// openings trainer, and stepping back and forth costs nothing. The server
// rejects a second search per user while one runs (429), hence the short retry
// loop — a rapid line can outrun Stockfish.

import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Chess } from 'chess.js';
import { api } from '../api';
import { whitePovEval, type EngineLine, type WhiteEval } from './positionEval';

/** Deep enough for a trustworthy bar, cheap enough to run behind every board. */
export const POSITION_EVAL_DEPTH = 12;

/** chess.js doubles as the FEN validator — the endpoint rejects what it rejects. */
function readableFen(fen: string | null | undefined): fen is string {
  if (!fen) return false;
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/**
 * White's score for `fen`, or null while there is nothing to show. Pass
 * `enabled: false` to hold the engine (e.g. a board that is not on screen yet).
 */
export function usePositionEval(
  fen: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): WhiteEval | null {
  const validFen = useMemo(() => (readableFen(fen) ? fen : null), [fen]);

  const { data } = useQuery({
    queryKey: ['position-eval', validFen],
    queryFn: () => {
      // Unreachable: the query is disabled without a readable FEN.
      if (!validFen) throw new Error('no fen');
      return api.post<{ fen: string; lines: EngineLine[] }>('/api/analyze/position', {
        fen: validFen,
        depth: POSITION_EVAL_DEPTH,
        lines: 1,
      });
    },
    enabled: enabled && validFen !== null,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    // Keep the last score on screen while the engine looks at the new move —
    // and flip it with the FEN that produced it, not the one now on the board.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: (count, err) => (err as { status?: number }).status === 429 && count < 3,
    retryDelay: 500,
  });

  if (!validFen) return null;
  return whitePovEval(data?.fen ?? validFen, data?.lines[0]);
}
