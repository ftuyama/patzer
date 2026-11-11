// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
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
  vi.useRealTimers();
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<div>page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function mockMobileViewport(matches = true) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 767px') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function headerIsCollapsed(container: HTMLElement): boolean {
  return container.querySelector('header')!.className.includes('h-0');
}

describe('Layout mobile chrome', () => {
  it('collapses the top bar after a few idle seconds on a phone', () => {
    mockMobileViewport(true);
    vi.useFakeTimers();
    const { container } = renderLayout();
    const header = container.querySelector('header')!;

    expect(header.className).toContain('h-14');
    act(() => { vi.advanceTimersByTime(4000); });
    expect(headerIsCollapsed(container)).toBe(true);
  });

  it('keeps the bar pinned on desktop', () => {
    mockMobileViewport(false);
    vi.useFakeTimers();
    const { container } = renderLayout();

    act(() => { vi.advanceTimersByTime(8000); });
    expect(headerIsCollapsed(container)).toBe(false);
  });

  it('hides while scrolling down and reveals on the way back up', () => {
    mockMobileViewport(true);
    const { container } = renderLayout();

    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 600, writable: true, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(headerIsCollapsed(container)).toBe(true);

    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 300, writable: true, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(headerIsCollapsed(container)).toBe(false);
  });
});
