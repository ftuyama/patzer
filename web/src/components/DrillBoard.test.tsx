// @vitest-environment happy-dom
// Pattern drills sit next to the eval bar like the puzzle boards do: the bar
// must follow the position on the board, including the solution's position.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { post } }));
vi.mock('chessground', () => ({
  Chessground: vi.fn(() => ({ set: vi.fn(), setShapes: vi.fn(), redrawAll: vi.fn(), destroy: vi.fn() })),
}));

import i18n from '../i18n';
import { DrillBoard } from './DrillBoard';
import type { DrillPosition } from '../types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const position: DrillPosition & { opponent: string } = {
  game_id: 1,
  ply: 10,
  fen: START,
  played_san: 'Nf3',
  best_san: 'e4',
  best_uci: 'e2e4',
  solution_uci: ['e2e4', 'e7e5'],
  severity: 80,
  cp_loss: 300,
  phase: 'opening',
  motif: 'opening_leak',
  prompt: 'find_best',
  opponent: 'someone',
};

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  post.mockReset();
});

function renderDrill() {
  post.mockResolvedValue({ fen: START, lines: [{ cp: 120, mate: null }] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DrillBoard position={position} current={1} total={3} onNext={() => {}} isLast={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the pattern drill’s eval bar', () => {
  it('shows the engine’s score for the position on the board', async () => {
    renderDrill();

    await screen.findByText('+1.2');
    expect(post).toHaveBeenCalledWith('/api/analyze/position', expect.objectContaining({ fen: START }));
  });
});
