// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import GameResultIcon from './GameResultIcon';

afterEach(cleanup);

describe('GameResultIcon', () => {
  it('shows a trophy for a win', () => {
    const { container } = render(<GameResultIcon result="win" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('lucide-trophy');
  });

  it('shows a red sad face for a loss', () => {
    const { container } = render(<GameResultIcon result="loss" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('lucide-frown');
    expect(container.firstElementChild?.className).toContain('text-bad');
  });

  it('shows an equals sign for a draw', () => {
    const { container } = render(<GameResultIcon result="draw" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('lucide-equal');
  });
});
