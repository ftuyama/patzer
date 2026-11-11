// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

import {
  hasAnyRating, primaryRating, RatingChip, RatingStrip, resolveRating,
  type ExternalRatings, type RatingsMap,
} from './UserRatings';

afterEach(cleanup);

function row(time_class: string, rating: number, games_played: number, provisional = false) {
  return {
    time_class: time_class as never,
    rating,
    rd: 80,
    games_played,
    last_played_at: null,
    provisional,
  };
}

const ratings: RatingsMap = {
  bullet: row('bullet', 1300, 2),
  blitz: row('blitz', 1450, 40, true),
  rapid: row('rapid', 1500, 10),
  daily: row('daily', 1200, 0),
};

// An imported-only profile: nothing rated here, chess.com numbers alongside.
const importedOnly: RatingsMap = { daily: row('daily', 1200, 0) };
const external: ExternalRatings = {
  chesscom: {
    bullet: { rating: 1600, updated_at: '2026-11-11 18:00:00' },
    blitz: { rating: 1725, updated_at: '2026-11-11 18:00:00' },
  },
};

describe('resolveRating', () => {
  it('prefers Patzer’s Glicko pool when that class has rated games', () => {
    expect(resolveRating(ratings, external, 'blitz')).toMatchObject({ rating: 1450, source: 'patzer' });
  });

  it('falls back to the imported chess.com rating for unrated classes', () => {
    expect(resolveRating(ratings, external, 'bullet')).toMatchObject({ rating: 1300, source: 'patzer' });
    const onlyExternal = resolveRating(importedOnly, external, 'blitz');
    expect(onlyExternal).toMatchObject({ rating: 1725, source: 'chesscom' });
  });

  it('returns null when neither side has a number', () => {
    expect(resolveRating(importedOnly, external, 'rapid')).toBeNull();
  });
});

describe('primaryRating', () => {
  it('picks the class with the most games, not the highest number', () => {
    expect(primaryRating(ratings)?.time_class).toBe('blitz');
  });

  it('falls back to chess.com when nothing here is rated', () => {
    expect(primaryRating(importedOnly, external)).toMatchObject({ rating: 1600, source: 'chesscom' });
    expect(primaryRating(importedOnly)).toBeNull();
  });

  it('keeps the bullet → blitz → rapid → daily order on a tie', () => {
    const tied: RatingsMap = {
      rapid: row('rapid', 1500, 5),
      bullet: row('bullet', 1300, 5),
    };
    expect(primaryRating(tied)?.time_class).toBe('bullet');
  });

  it('reports whether anything at all is worth showing', () => {
    expect(hasAnyRating(importedOnly)).toBe(false);
    expect(hasAnyRating(importedOnly, external)).toBe(true);
    expect(hasAnyRating(ratings)).toBe(true);
  });
});

describe('RatingStrip', () => {
  it('shows all four classes, including unplayed ones as an em dash', () => {
    const { container } = render(<RatingStrip ratings={importedOnly} external={external} />);
    const text = container.textContent ?? '';
    expect(text).toContain('1600');
    expect(text).toContain('1725');
    expect(text).toContain('—');
    expect(text).toContain('bullet');
    expect(text).toContain('daily');
  });

  it('marks a provisional rating with a question mark', () => {
    const { container } = render(<RatingStrip ratings={ratings} />);
    expect(container.textContent).toContain('1450?');
  });

  it('says when numbers came from chess.com', () => {
    const { container } = render(<RatingStrip ratings={importedOnly} external={external} />);
    expect(container.textContent).toContain('Rating imported from Chess.com');
  });

  it('draws the speed icon next to every class', () => {
    const { container } = render(<RatingStrip ratings={ratings} />);
    expect(container.querySelectorAll('svg')).toHaveLength(4);
  });
});

describe('RatingChip', () => {
  it('links to the player profile with the rating and its time class', () => {
    const rating = resolveRating(ratings, external, 'blitz')!;
    const { container } = render(<RatingChip rating={rating} to="/players/7" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/players/7');
    expect(link?.textContent).toContain('1450?');
    expect(link?.textContent).toContain('blitz');
    expect(link?.querySelector('svg')).not.toBeNull();
  });
});
