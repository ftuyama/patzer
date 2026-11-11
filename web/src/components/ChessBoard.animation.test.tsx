// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// chessground itself needs a real layout engine; we only assert what ChessBoard
// asks it to do, so the api — and the initial config — are spies.
const { api, ChessgroundMock } = vi.hoisted(() => {
  const api = { set: vi.fn(), setShapes: vi.fn(), redrawAll: vi.fn(), destroy: vi.fn() };
  return { api, ChessgroundMock: vi.fn((_el: unknown, _config: Record<string, unknown>) => api) };
});
vi.mock('chessground', () => ({ Chessground: ChessgroundMock }));

import ChessBoard from './ChessBoard';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, width: 320, height: 320, right: 320, bottom: 320, toJSON() { /* noop */ } } as DOMRect;
  };
  globalThis.ResizeObserver = class {
    observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ }
  } as unknown as typeof ResizeObserver;
});

describe('ChessBoard piece animation', () => {
  it('stays off by default so live games do not read as lag', () => {
    render(<ChessBoard fen={START} orientation="white" turnColor="white" movable />);
    expect(ChessgroundMock).toHaveBeenCalled();
    expect(ChessgroundMock.mock.calls[0]![1]).toMatchObject({ animation: { enabled: false, duration: 0 } });
  });

  it('slides pieces for the requested duration when animateMs is set', () => {
    render(<ChessBoard fen={START} orientation="white" animateMs={180} />);
    expect(ChessgroundMock.mock.calls[0]![1]).toMatchObject({ animation: { enabled: true, duration: 180 } });
  });

  it('applies the animation setting on the update that moves the pieces', () => {
    // chessground plans the tween from the state configured by this same
    // set() call, so a stale flag here would animate one position behind.
    const { rerender } = render(<ChessBoard fen={START} animateMs={0} />);
    api.set.mockClear();

    rerender(<ChessBoard fen={AFTER_E4} animateMs={180} />);
    expect(api.set).toHaveBeenCalledWith(expect.objectContaining({
      fen: AFTER_E4,
      animation: { enabled: true, duration: 180 },
    }));
  });

  it('snaps when a jump disables animation', () => {
    const { rerender } = render(<ChessBoard fen={START} animateMs={180} />);
    api.set.mockClear();

    rerender(<ChessBoard fen={AFTER_E4} animateMs={0} />);
    expect(api.set).toHaveBeenCalledWith(expect.objectContaining({
      fen: AFTER_E4,
      animation: { enabled: false, duration: 0 },
    }));
  });
});
