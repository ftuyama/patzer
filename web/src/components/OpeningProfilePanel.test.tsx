// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { get } }));

import i18n from '../i18n';
import OpeningProfilePanel from './OpeningProfilePanel';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);

function renderPanel(onStart = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OpeningProfilePanel onStart={onStart} />
    </QueryClientProvider>,
  );
  return onStart;
}

const leak = (over: Record<string, unknown> = {}) => ({
  san_line: ['e4', 'e5'],
  ply: 3,
  played_san: 'Na3',
  best_san: 'Nf3',
  games: 2,
  avg_cp_loss: 200,
  drill: ['e4', 'e5', 'Nf3'],
  example_game_id: 7,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  window: 100,
  white: {
    games: 2,
    openings: [{
      eco: 'C20',
      name: "King's Pawn Game",
      games: 2,
      wins: 1,
      draws: 0,
      losses: 1,
      score: 50,
      accuracy: 70,
      leaks: [leak()],
    }],
  },
  black: { games: 0, openings: [] },
  ...over,
});

describe('OpeningProfilePanel', () => {
  it('shows the opening you play, its score and the costly move', async () => {
    get.mockResolvedValue(payload());
    renderPanel();

    expect(await screen.findByText("King's Pawn Game")).toBeTruthy();
    expect(screen.getAllByText('2 games').length).toBeGreaterThan(0);
    expect(screen.getByText('50% score')).toBeTruthy();
    expect(screen.getByText('70% accuracy')).toBeTruthy();
    // Played move and the engine's move, one after the other.
    expect(screen.getByText('2.Na3')).toBeTruthy();
    expect(screen.getByText('→ 2.Nf3')).toBeTruthy();
    expect(screen.getByText('−2.0')).toBeTruthy();
    // Black has no games in this payload.
    expect(screen.getByText('No games with this colour yet.')).toBeTruthy();
  });

  it('starts the corrected line in the trainer', async () => {
    get.mockResolvedValue(payload());
    const onStart = renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Train the fix/ }));

    expect(onStart).toHaveBeenCalledWith({
      name: "King's Pawn Game",
      eco: 'C20',
      color: 'white',
      moves: ['e4', 'e5', 'Nf3'],
    });
  });

  it('offers no drill when the analysis has no playable correction', async () => {
    get.mockResolvedValue(payload({
      white: {
        games: 1,
        openings: [{
          eco: 'C20', name: 'KP', games: 1, wins: 0, draws: 0, losses: 1,
          score: 0, accuracy: 60, leaks: [leak({ best_san: null, drill: [] })],
        }],
      },
    }));
    renderPanel();

    expect(await screen.findByText('KP')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Train the fix/ })).toBeNull();
  });

  it('explains how to fill it when nothing is analysed yet', async () => {
    get.mockResolvedValue({ window: 100, white: { games: 0, openings: [] }, black: { games: 0, openings: [] } });
    renderPanel();

    await waitFor(() => expect(screen.getByText('No analysed games yet')).toBeTruthy());
    expect(screen.getByText('Import or analyse a few games and your openings show up here.')).toBeTruthy();
  });
});
