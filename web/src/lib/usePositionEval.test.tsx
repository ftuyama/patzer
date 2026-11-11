// @vitest-environment happy-dom
// The shared automatic eval behind every board: one engine call per FEN,
// flipped to white's point of view, and nothing at all for a FEN the server
// would reject.
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { post } }));

import { usePositionEval, POSITION_EVAL_DEPTH } from './usePositionEval';
import type { WhiteEval } from './positionEval';

const WHITE_TO_MOVE = '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 12';
const BLACK_TO_MOVE = '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 b - - 0 12';

afterEach(() => {
  cleanup();
  post.mockReset();
});

function Probe({ fen }: { fen: string | null }) {
  const evaluation = usePositionEval(fen);
  return <span data-testid="eval">{JSON.stringify(evaluation)}</span>;
}

function renderWith(fen: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe fen={fen} />
    </QueryClientProvider>,
  );
}

function shown(el: HTMLElement): WhiteEval | null {
  return JSON.parse(el.textContent ?? 'null') as WhiteEval | null;
}

describe('the automatic position eval', () => {
  it('asks the engine for the position at the shared depth', async () => {
    post.mockResolvedValue({ fen: WHITE_TO_MOVE, lines: [{ cp: 125, mate: null }] });
    const { getByTestId } = renderWith(WHITE_TO_MOVE);

    await waitFor(() => expect(shown(getByTestId('eval'))).toEqual({ cp: 125, mate: null }));
    expect(post).toHaveBeenCalledWith('/api/analyze/position', {
      fen: WHITE_TO_MOVE,
      depth: POSITION_EVAL_DEPTH,
      lines: 1,
    });
  });

  it('flips the engine’s score for the side to move into White’s score', async () => {
    post.mockResolvedValue({ fen: BLACK_TO_MOVE, lines: [{ cp: 120, mate: null }] });
    const { getByTestId } = renderWith(BLACK_TO_MOVE);

    await waitFor(() => expect(shown(getByTestId('eval'))).toEqual({ cp: -120, mate: null }));
  });

  it('does not spend an engine run on a FEN chess.js cannot read', async () => {
    const { getByTestId } = renderWith('not a fen');
    expect(shown(getByTestId('eval'))).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not request a FEN another board already asked for', async () => {
    post.mockResolvedValue({ fen: WHITE_TO_MOVE, lines: [{ cp: 40, mate: null }] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <Probe fen={WHITE_TO_MOVE} />
        <Probe fen={WHITE_TO_MOVE} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(shown(view.getAllByTestId('eval')[0]!)).toEqual({ cp: 40, mate: null }));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
