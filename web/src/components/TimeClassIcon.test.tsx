// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import TimeClassIcon from './TimeClassIcon';

afterEach(cleanup);

describe('TimeClassIcon', () => {
  it('renders one icon per time class', () => {
    for (const cls of ['bullet', 'blitz', 'rapid', 'daily'] as const) {
      const { container, unmount } = render(<TimeClassIcon timeClass={cls} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('also covers the play-only speeds', () => {
    for (const cls of ['classical', 'untimed'] as const) {
      const { container, unmount } = render(<TimeClassIcon timeClass={cls} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('ignores a speed it does not know', () => {
    const { container } = render(<TimeClassIcon timeClass="correspondence" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the clock under the icon, like chess.com', () => {
    const { container } = render(<TimeClassIcon timeClass="blitz" label="3+2" />);
    expect(container.textContent).toBe('3+2');
    expect(container.firstElementChild?.getAttribute('title')).toBe('blitz · 3+2');
  });

  it('renders nothing for untimed games', () => {
    const { container } = render(<TimeClassIcon timeClass={null} label="untimed" />);
    expect(container.innerHTML).toBe('');
  });
});
