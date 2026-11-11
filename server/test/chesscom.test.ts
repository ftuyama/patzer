import { describe, it, expect, afterEach, vi } from 'vitest';
import { getPlayerRatings, normalizeStats } from '../src/chess/chesscom.js';

afterEach(() => vi.unstubAllGlobals());

// Shape as returned by GET /pub/player/{username}/stats.
const STATS = {
  chess_bullet: { last: { rating: 1612, date: 1775677143, rd: 42 }, record: { win: 10, loss: 9, draw: 1 } },
  chess_blitz: { last: { rating: 1725, date: 1775677143, rd: 55 } },
  chess_rapid: { last: { rating: 1801, date: 1775677143, rd: 60 } },
  chess_daily: { last: { rating: 1544 } },
  tactics: { highest: { rating: 2100 } },
};

describe('normalizeStats', () => {
  it('maps the four time classes and ignores FIDE/tactics', () => {
    expect(normalizeStats(STATS)).toEqual({
      bullet: 1612,
      blitz: 1725,
      rapid: 1801,
      daily: 1544,
    });
  });

  it('skips classes the player never played and refuses junk numbers', () => {
    expect(normalizeStats({
      chess_bullet: { last: { rating: 0 } },
      chess_blitz: { last: { rating: '1500' } },
      chess_rapid: {},
    })).toEqual({});
    expect(normalizeStats({})).toEqual({});
  });

  it('rounds chess.com’s float ratings', () => {
    expect(normalizeStats({ chess_blitz: { last: { rating: 1499.6 } } })).toEqual({ blitz: 1500 });
  });
});

describe('getPlayerRatings', () => {
  it('reads the real stats route and hands back the four numbers', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(STATS),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPlayerRatings('felipe_lelouch')).resolves.toEqual({
      bullet: 1612,
      blitz: 1725,
      rapid: 1801,
      daily: 1544,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.chess.com/pub/player/felipe_lelouch/stats',
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    );
  });

  it('returns null instead of failing an import when chess.com is down', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 503, json: () => Promise.resolve({}),
    })));
    await expect(getPlayerRatings('felipe_lelouch')).resolves.toBeNull();
  });

  it('returns null for a player chess.com does not know', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 404, json: () => Promise.resolve({}),
    })));
    await expect(getPlayerRatings('nobody_here')).resolves.toBeNull();
  });
});
