// @vitest-environment happy-dom
// The train page is three tabs: your own mistakes, pattern drills, and the
// general puzzle feed. The drills used to live under "From your games" — a
// deep link from the diagnosis card (?pattern=hung_piece) has to keep landing
// on a working drill, so pin the routing.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { get } }));

import i18n from '../i18n';
import Train from './Train';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  get.mockReset();
});

function route(path: string) {
  if (path.startsWith('/api/train/next')) return { puzzle: null, due: 0 };
  if (path.startsWith('/api/train/stats')) return { total: 0, solved: 0, failed: 0, accuracy: 0, due: 0 };
  if (path.startsWith('/api/train/drill')) return { title: 'x', positions: [] };
  if (path.startsWith('/api/diagnosis')) return { patterns: [] };
  throw new Error(`unexpected ${path}`);
}

function renderAt(url: string, routeImpl: (path: string) => unknown = route) {
  get.mockImplementation(routeImpl);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Train />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('train page tabs', () => {
  it('opens on your own mistakes and offers the three tabs', async () => {
    renderAt('/train');
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/api/train/next')));
    expect(tab(/From your games/).getAttribute('aria-selected')).toBe('true');
    expect(tab(/Pattern drills/).getAttribute('aria-selected')).toBe('false');
    expect(tab(/Puzzles/)).toBeTruthy();
    // The drill block no longer sits under the puzzle queue.
    expect(get.mock.calls.some(([p]) => String(p).includes('/api/train/drill'))).toBe(false);
  });

  it('renders the drills as a page of their own', async () => {
    renderAt('/train?tab=patterns');
    expect(tab(/Pattern drills/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: /Pattern drills/ })).toBeTruthy();
    // Opening the tab shows the picker, it does not spend an engine run by itself.
    expect(get.mock.calls.some(([p]) => String(p).includes('/api/train/drill'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Start drill/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/api/train/drill?pattern=mixed')));
  });

  it('lands a deep link from the diagnosis card on the deep-linked motif', async () => {
    renderAt('/train?pattern=hung_piece');
    expect(tab(/Pattern drills/).getAttribute('aria-selected')).toBe('true');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('/api/train/drill?pattern=hung_piece')),
    );
  });

  it('counts every unsolved puzzle as pending, not just the reviews due today', async () => {
    // 13 tries, 5 solved, 8 missed — the misses come back tomorrow, so "due
    // today" was 0 while accuracy (5/13 = 38%) said otherwise.
    renderAt('/train', (path) => {
      if (path.startsWith('/api/train/next')) return { puzzle: null, due: 0 };
      if (path.startsWith('/api/train/stats')) return { total: 13, solved: 5, failed: 8, accuracy: 38, due: 0 };
      throw new Error(`unexpected ${path}`);
    });
    await waitFor(() => expect(screen.getByText('Pending')).toBeTruthy());
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('38%')).toBeTruthy();
  });
});
