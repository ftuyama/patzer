// One-click "analyze every imported game that has no analysis yet" button.
//
// The work itself runs as a server-side queue (`POST /api/analyze/all`), so it
// keeps going if the user navigates away. This component starts the batch and
// follows `GET /api/analyze/all` while it runs. Used by both Diagnosis and the
// game list, so the pending count can be passed in when the page already knows
// it (avoiding a disabled flash before the status request settles).

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { api } from '../api';
import { PROFILE_QUERY_KEY } from './OpeningProfilePanel';

export interface BulkStatus {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current_game_id: number | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  pending_games: number;
}

export default function AnalyzeAllButton({ pending }: { pending?: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: job } = useQuery({
    queryKey: ['analyze-all'],
    queryFn: () => api.get<BulkStatus>('/api/analyze/all'),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
  const start = useMutation({
    mutationFn: () => api.post<BulkStatus>('/api/analyze/all', { depth: 16 }),
    onSuccess: (next) => qc.setQueryData(['analyze-all'], next),
  });

  // When a batch finishes, refresh every page fed by analyses.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (job?.running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    void qc.invalidateQueries({ queryKey: ['diagnosis'] });
    void qc.invalidateQueries({ queryKey: ['insights-v2'] });
    void qc.invalidateQueries({ queryKey: ['games'] });
    void qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
  }, [job?.running, qc]);

  const pendingGames = job?.pending_games ?? pending ?? 0;
  const processed = (job?.done ?? 0) + (job?.failed ?? 0);
  const running = !!job?.running || start.isPending;
  const label = start.isPending
    ? t('review.analyzeAllStarting', { defaultValue: 'Starting…' })
    : job?.running
      ? t('review.analyzeAllProgress', {
        defaultValue: 'Analyzing {{done}}/{{total}}…',
        done: processed,
        total: job.total,
      })
      : t('review.analyzeAll', { defaultValue: 'Analyze all ({{n}})', n: pendingGames });

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={running || pendingGames === 0}
        className="btn-primary text-sm"
        title={t('review.analyzeAllHint', {
          defaultValue: 'Run Stockfish on every imported game that has no analysis yet.',
        })}
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {label}
      </button>
      {start.isError && (
        <span className="text-[11px] text-bad">
          {t('review.analyzeAllError', { defaultValue: 'Could not start the batch. Try again.' })}
        </span>
      )}
      {!running && job && job.failed > 0 && (
        <span className="text-[11px] text-bad">
          {t('review.analyzeAllFailed', { defaultValue: '{{n}} could not be analysed', n: job.failed })}
        </span>
      )}
    </div>
  );
}
