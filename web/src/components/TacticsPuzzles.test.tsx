// @vitest-environment happy-dom
// Train → Puzzles puts the eval bar beside the board, like the "from your
// games" tab: the bar scores the position the puzzle shows.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get, post } }));
vi.mock('chessground', () => ({
  Chessground: vi.fn(() => ({ set: vi.fn(), setShapes: vi.fn(), redrawAll: vi.fn(), destroy: vi.fn() })),
}));

import i18n from '../i18n';
import TacticsPuzzles from './TacticsPuzzles';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const puzzle = {
  id: 'p1',
  fen: START,
  moves: ['e2e4', 'e7e5', 'g1f3'],
  rating: 1200,
  themes: ['opening'],
};

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  get.mockReset();
  post.mockReset();
});

describe('the puzzle board’s eval bar', () => {
  it('shows the engine’s score for the position on the board', async () => {
    get.mockImplementation((path: string) => {
      if (path.startsWith('/api/tactics/stats')) {
        return Promise.resolve({ rating: 1200, provisional: false, best: 1200, played: 0, solved: 0, recent: [], total: 0 });
      }
      if (path.startsWith('/api/tactics/next')) return Promise.resolve({ puzzle });
      throw new Error(`unexpected ${path}`);
    });
    post.mockResolvedValue({ fen: START, lines: [{ cp: 120, mate: null }] });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TacticsPuzzles />
      </QueryClientProvider>,
    );

    await screen.findByText('+1.2');
    expect(post).toHaveBeenCalledWith('/api/analyze/position', expect.objectContaining({ fen: START }));
  });
});
