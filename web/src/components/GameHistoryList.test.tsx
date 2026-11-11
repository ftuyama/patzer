// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import GameHistoryList, { type GameHistoryRow } from './GameHistoryList';

afterEach(cleanup);

function game(over: Partial<GameHistoryRow> = {}): GameHistoryRow {
  return {
    id: 1,
    white: 'Me',
    black: 'Opponent',
    result: 'win',
    user_color: 'white',
    time_control: '300+0',
    time_class: 'blitz',
    opening_name: 'Sicilian Defense',
    end_time: '2026-03-02T10:00:00',
    analyzed: 1,
    accuracy_white: 82.5,
    accuracy_black: 71.2,
    ...over,
  };
}

function renderList(games: GameHistoryRow[], hrefFor?: (g: GameHistoryRow) => string) {
  return render(
    <MemoryRouter>
      <GameHistoryList games={games} hrefFor={hrefFor} />
    </MemoryRouter>,
  );
}

describe('GameHistoryList', () => {
  it('shows both names, emphasizing the row owner’s side', () => {
    const { container, unmount } = renderList([game({ user_color: 'black' })]);
    const [white, , black] = [...container.querySelectorAll('.truncate > span')] as HTMLElement[];
    expect(white!.textContent).toBe('Me');
    expect(black!.textContent).toBe('Opponent');
    expect(white!.className).toContain('text-chesscom-500');
    expect(black!.className).toContain('text-chesscom-900');
    unmount();
  });

  it('shows the accuracy pair for an analyzed game', () => {
    const { container } = renderList([game()]);
    expect(container.textContent).toContain('82.5%');
    expect(container.textContent).toContain('71.2%');
  });

  it('shows the unreviewed badge when there is no analysis', () => {
    const { container } = renderList([
      game({ analyzed: 0, accuracy_white: null, accuracy_black: null }),
    ]);
    expect(container.textContent).toContain('common.unreviewed');
    expect(container.textContent).not.toContain('%');
  });

  it('links a row when given a destination', () => {
    const { container } = renderList([game()], (g) => `/review/${g.id}`);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/review/1');
  });

  it('renders a plain row for games the viewer cannot open', () => {
    const { container } = renderList([game()]);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('li')?.textContent).toContain('Opponent');
  });
});
