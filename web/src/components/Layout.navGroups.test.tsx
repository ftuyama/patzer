// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../state/auth', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: 'tester',
      role: 'user',
      profile: { display_name: 'Tester', avatar_emoji: '♟' },
    },
    refresh: vi.fn(),
  }),
}));
vi.mock('./UserRatings', () => ({
  useMyRatings: () => ({ data: undefined }),
  primaryRating: () => null,
  RatingChip: () => null,
}));
vi.mock('./LanguagePicker', () => ({ default: () => null }));
vi.mock('./GitHubStar', () => ({ default: () => null }));
vi.mock('./UpdateNotice', () => ({ default: () => null }));
vi.mock('../api', () => ({ api: { get: () => Promise.resolve({ version: 'test' }) } }));

import i18n from '../i18n';
import Layout from './Layout';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLayout(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<div>page</div>} />
          <Route path="*" element={<div>page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockMobileViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 767px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// The bar is one group per area of the app: Review owns the analysis tools,
// Progress the numbers about the player, Train everything practised away from
// the board, Play the live loop.
describe('Layout nav groups', () => {
  it('renders one trigger per area instead of a flat list of destinations', () => {
    renderLayout();
    for (const label of ['Play', 'Review', 'Progress', 'Train']) {
      const trigger = screen.getByRole('button', { name: label });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    }
    // A grouped destination must not be reachable as a top-level pill.
    expect(screen.queryByRole('link', { name: 'Diagnosis' })).toBeNull();
  });

  it('opens a group menu with that group’s destinations', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    const menu = screen.getByRole('menu');
    expect(screen.getByRole('button', { name: 'Review' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: 'Diagnosis' }).getAttribute('href')).toBe('/diagnosis');
    expect(within(menu).getByRole('menuitem', { name: 'Lab' }).getAttribute('href')).toBe('/lab');
    expect(within(menu).getByRole('menuitem', { name: 'Game Review' }).getAttribute('href')).toBe('/review');
  });

  it('swaps menus instead of stacking them, and closes with Escape', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));

    expect(screen.getAllByRole('menu')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu after choosing a destination', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Train' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Openings' }));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks the group active when one of its pages is open', () => {
    renderLayout('/diagnosis');
    const review = screen.getByRole('button', { name: 'Review' });
    const train = screen.getByRole('button', { name: 'Train' });
    expect(review.className).toContain('after:bg-gold-500');
    expect(train.className).not.toContain('after:bg-gold-500');
  });

  it('keeps nested pages inside their group', () => {
    renderLayout('/players/7');
    expect(screen.getByRole('button', { name: 'Play' }).className).toContain('after:bg-gold-500');
  });

  it('labels the sections in the mobile drawer', () => {
    mockMobileViewport();
    renderLayout();

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Menu' })); });

    const drawer = screen.getByRole('complementary');
    for (const label of ['Play', 'Review', 'Progress', 'Train']) {
      const header = within(drawer)
        .getAllByText(label)
        .find((el) => el.className.includes('uppercase'));
      expect(header, label).toBeTruthy();
    }
    expect(within(drawer).getByRole('link', { name: 'Diagnosis' }).getAttribute('href')).toBe('/diagnosis');
    expect(within(drawer).getByRole('link', { name: 'Lab' }).getAttribute('href')).toBe('/lab');
  });
});
