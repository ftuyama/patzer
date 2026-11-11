// @vitest-environment happy-dom
// The review sidebar used to be one long scroll of stacked cards. It is now
// four tabs — Overview / Moves / Report / Key moments — so pin the tab
// contract: one panel at a time, Overview first, and the moves of the current
// ply explainable without any page-level scroll.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get, post } }));
// chessground needs a real layout engine; the tabs don't depend on the board.
vi.mock('../components/ChessBoard', () => ({ default: () => <div data-testid="board" /> }));
vi.mock('../lib/sounds', () => ({
  soundForMove: vi.fn(),
  inferMoveFlagsFromSan: () => ({}),
}));

import i18n from '../i18n';
import GameAnalyzer from './GameAnalyzer';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  get.mockReset();
  post.mockReset();
});

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PGN = [
  '[Event "Test"]',
  '[White "Alice"]',
  '[Black "Bob"]',
  '[Result "1/2-1/2"]',
  '',
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7',
  '6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1/2-1/2',
].join('\n');
const SANS = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7',
  'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7',
];

function gameDetail() {
  const moves = SANS.map((san, i) => ({
    ply: i + 1,
    san,
    uci: 'e2e4',
    fen_before: START_FEN,
    fen_after: START_FEN,
    eval_before_cp: 20,
    eval_after_cp: 20,
    best_move_uci: null,
    best_move_san: null,
    best_pv: [],
    centipawn_loss: 0,
    classification: 'good',
  }));
  return {
    game: {
      id: 1,
      pgn: PGN,
      white: 'Alice',
      black: 'Bob',
      result: '1/2-1/2',
      time_control: '600',
      time_class: 'rapid',
      user_color: 'white',
      eco: null,
      opening_name: null,
      bookmarked: 0,
      notes: null,
      start_fen: null,
    },
    analysis: {
      depth: 16,
      accuracy_white: 90,
      accuracy_black: 88,
      estimated_elo_white: 1500,
      estimated_elo_black: 1480,
      performance_white: 1500,
      performance_black: 1480,
      opening_eco: null,
      opening_name: null,
      key_moments_json: '[]',
      phase_split_json: null,
      moves_json: JSON.stringify(moves),
    },
    analysis_stale: false,
  };
}

function renderReview() {
  get.mockImplementation((path: string) => {
    if (path === '/api/games/1') return Promise.resolve(gameDetail());
    if (path === '/api/games/1/review') return Promise.resolve({ review: null });
    if (path === '/api/coach/status') return Promise.resolve({ configured: false });
    throw new Error(`unexpected GET ${path}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/review/1?ply=16']}>
        <Routes>
          <Route path="/review/:id" element={<GameAnalyzer />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('review sidebar tabs', () => {
  it('opens on the Overview tab instead of one long scrolling rail', async () => {
    renderReview();

    await waitFor(() => expect(tab('Overview')).toBeTruthy());
    expect(screen.getAllByRole('tab').map((el) => el.getAttribute('aria-label')))
      .toEqual(['Overview', 'Moves', 'Report', 'Key moments']);
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    // The report card lives in Overview; the AI report is its own tab.
    expect(screen.getAllByText('Est. Rating').length).toBeGreaterThan(0);
    expect(screen.queryByText('Write AI report')).toBeNull();
  });

  it('shows exactly one panel at a time when switching tabs', async () => {
    renderReview();
    await waitFor(() => expect(tab('Moves')).toBeTruthy());

    fireEvent.click(tab('Moves'));
    expect(tab('Moves').getAttribute('aria-selected')).toBe('true');
    // Ply 16 is Black's move and the user is White.
    expect(screen.getByText("Opponent's move")).toBeTruthy();
    expect(screen.queryAllByText('Est. Rating')).toHaveLength(0);

    fireEvent.click(tab('Report'));
    expect(await screen.findByText('Write AI report')).toBeTruthy();
    expect(screen.queryByText("Opponent's move")).toBeNull();

    fireEvent.click(tab('Key moments'));
    expect(screen.getByText('No key moments — a clean game.')).toBeTruthy();
    expect(screen.queryByText('Write AI report')).toBeNull();

    fireEvent.click(tab('Overview'));
    expect(screen.getAllByText('Est. Rating').length).toBeGreaterThan(0);
  });
});
