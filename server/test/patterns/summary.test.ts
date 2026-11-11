// Behavioural tests for `summarizePatterns`: ranking, recency weighting,
// shrinkage, trend direction, example ordering, and phase/colour breakdown.
//
// These are deterministic: every test passes a fixed `now` and fixed
// `end_time` strings, so nothing depends on the wall clock.

import { describe, it, expect } from 'vitest';
import {
  recencyWeight,
  summarizePatterns,
  PATTERN_WEIGHT,
  type PatternEvent,
  type PatternKey,
} from '../../src/chess/patterns.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-11T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const NOW_ISO = iso(NOW);

function ev(over: Partial<PatternEvent> & { motif: PatternKey }): PatternEvent {
  return {
    game_id: 1,
    ply: 21,
    phase: 'middlegame',
    color: 'white',
    severity: 10,
    cp_loss: 200,
    classification: 'mistake',
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    played_san: 'Qd4',
    best_san: 'Qd5',
    end_time: NOW_ISO,
    eco: null,
    opening_name: null,
    opponent: 'Rival',
    result: '0-1',
    ...over,
  };
}

describe('recency weighting', () => {
  it('is 1 today and halves every 4 weeks', () => {
    expect(recencyWeight(NOW_ISO, NOW)).toBeCloseTo(1, 10);
    expect(recencyWeight(iso(NOW - 4 * 7 * DAY), NOW)).toBeCloseTo(0.5, 6);
    expect(recencyWeight(iso(NOW - 8 * 7 * DAY), NOW)).toBeCloseTo(0.25, 6);
    expect(recencyWeight(iso(NOW - 12 * 7 * DAY), NOW)).toBeCloseTo(0.125, 6);
  });

  it('uses 0.7 for unknown or unparsable dates and clamps future dates to 1', () => {
    expect(recencyWeight(null, NOW)).toBe(0.7);
    expect(recencyWeight('not-a-date', NOW)).toBe(0.7);
    expect(recencyWeight(iso(NOW + 10 * DAY), NOW)).toBe(1);
  });

  it('accepts date-only strings (midday UTC) and still halves at 4 weeks', () => {
    const dateOnly = new Date(NOW - 4 * 7 * DAY).toISOString().slice(0, 10);
    expect(recencyWeight(dateOnly, NOW)).toBeCloseTo(0.5, 2);
  });
});

describe('ranking', () => {
  it('ranks a single severe habit above several trivial ones', () => {
    const events: PatternEvent[] = [
      ev({ motif: 'hung_piece', severity: 60 }),
      ...Array.from({ length: 5 }, (_, i) => ev({ motif: 'opening_leak', severity: 2, game_id: i + 2 })),
    ];
    const rows = summarizePatterns(events, 1, NOW);
    expect(rows.map((r) => r.key)).toEqual(['hung_piece', 'opening_leak']);
    expect(rows[0]!.max_severity).toBeGreaterThan(rows[1]!.max_severity);
  });

  it('breaks score ties by frequency (more events first)', () => {
    // hung_piece: 27 * 1.00 * (1/5)      = 5.4
    // fork_exposed: 4 * 1.05 * 3 * (3/7) = 5.4
    const events: PatternEvent[] = [
      ev({ motif: 'hung_piece', severity: 27 }),
      ...Array.from({ length: 3 }, (_, i) => ev({ motif: 'fork_exposed', severity: 4, game_id: i + 2 })),
    ];
    const rows = summarizePatterns(events, 1, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.score).toBe(rows[1]!.score);
    expect(rows[0]!.key).toBe('fork_exposed');
    expect(rows[0]!.count).toBe(3);
  });

  it('scales the score down when the analysed window has more games', () => {
    const events = [ev({ motif: 'hung_piece', severity: 40 }), ev({ motif: 'hung_piece', severity: 40, game_id: 2 })];
    const narrow = summarizePatterns(events, 2, NOW)[0]!;
    const wide = summarizePatterns(events, 10, NOW)[0]!;
    expect(wide.score).toBeCloseTo(narrow.score / 5, 1);
  });
});

describe('shrinkage', () => {
  it('keeps a one-off high-severity event below a repeated lower-severity habit', () => {
    const once = summarizePatterns([ev({ motif: 'hung_piece', severity: 60 })], 1, NOW)[0]!;
    const repeated = summarizePatterns(
      Array.from({ length: 4 }, (_, i) => ev({ motif: 'hung_piece', severity: 10, game_id: i + 1 })),
      1,
      NOW,
    )[0]!;

    expect(once.count).toBe(1);
    expect(repeated.count).toBe(4);
    // A single event is shrunk to 1/5, four events to 4/8.
    expect(once.score).toBeCloseTo(12, 1);
    expect(repeated.score).toBeCloseTo(20, 1);
    expect(repeated.score).toBeGreaterThan(once.score);
  });

  it('increases monotonically with event count at constant severity', () => {
    const scores = [1, 2, 4, 8].map((n) => summarizePatterns(
      Array.from({ length: n }, (_, i) => ev({ motif: 'queen_sortie', severity: 15, game_id: i + 1 })),
      1,
      NOW,
    )[0]!.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!, `score must grow with count: ${scores.join(' -> ')}`).toBeGreaterThan(scores[i - 1]!);
    }
  });
});

describe('trend', () => {
  const t0 = Date.parse('2026-09-01T12:00:00Z');

  it('is positive when the recent half is worse than the earlier half', () => {
    const worsening: PatternEvent[] = [
      ev({ motif: 'hung_piece', severity: 10, end_time: iso(t0) }),
      ev({ motif: 'hung_piece', severity: 10, end_time: iso(t0 + 7 * DAY), game_id: 2 }),
      ev({ motif: 'hung_piece', severity: 20, end_time: iso(t0 + 21 * DAY), game_id: 3 }),
      ev({ motif: 'hung_piece', severity: 20, end_time: iso(t0 + 28 * DAY), game_id: 4 }),
    ];
    const row = summarizePatterns(worsening, 4, NOW)[0]!;
    expect(row.trend_pct).not.toBeNull();
    expect(row.trend_pct!).toBeGreaterThan(0);
  });

  it('is negative when the player has improved', () => {
    const improving: PatternEvent[] = [
      ev({ motif: 'hung_piece', severity: 20, end_time: iso(t0) }),
      ev({ motif: 'hung_piece', severity: 20, end_time: iso(t0 + 7 * DAY), game_id: 2 }),
      ev({ motif: 'hung_piece', severity: 10, end_time: iso(t0 + 21 * DAY), game_id: 3 }),
      ev({ motif: 'hung_piece', severity: 10, end_time: iso(t0 + 28 * DAY), game_id: 4 }),
    ];
    const row = summarizePatterns(improving, 4, NOW)[0]!;
    expect(row.trend_pct!).toBeLessThan(0);
  });

  it('reports +100 when every event is in the recent half with no baseline', () => {
    // No end_time means the window has no timestamps, so everything is
    // bucketed as "recent" and there is no earlier baseline.
    const events = [ev({ motif: 'hung_piece', end_time: null }), ev({ motif: 'hung_piece', end_time: null, game_id: 2 })];
    expect(summarizePatterns(events, 2, NOW)[0]!.trend_pct).toBe(100);
  });
});

describe('examples', () => {
  it('returns at most three examples, ordered by severity descending', () => {
    const severities = [10, 50, 30, 20, 40];
    const events = severities.map((severity, i) => ev({ motif: 'allowed_mate', severity, game_id: i + 1 }));
    const row = summarizePatterns(events, severities.length, NOW)[0]!;
    expect(row.examples).toHaveLength(3);
    expect(row.examples.map((e) => e.severity)).toEqual([50, 40, 30]);
    expect(row.max_severity).toBe(50);
    expect(row.avg_severity).toBe(30);
  });

  it('keeps the full event list in count while examples stay capped', () => {
    const events = Array.from({ length: 7 }, (_, i) => ev({ motif: 'queen_sortie', severity: i + 1, game_id: i + 1 }));
    const row = summarizePatterns(events, 7, NOW)[0]!;
    expect(row.count).toBe(7);
    expect(row.games_affected).toBe(7);
    expect(row.examples).toHaveLength(3);
  });
});

describe('phase and colour breakdown', () => {
  it('counts each event into exactly one phase and one colour', () => {
    const events: PatternEvent[] = [
      ev({ motif: 'hung_piece', phase: 'opening', color: 'white', game_id: 1 }),
      ev({ motif: 'hung_piece', phase: 'middlegame', color: 'white', game_id: 1 }),
      ev({ motif: 'hung_piece', phase: 'middlegame', color: 'white', game_id: 2 }),
      ev({ motif: 'hung_piece', phase: 'endgame', color: 'black', game_id: 3 }),
    ];
    const row = summarizePatterns(events, 3, NOW)[0]!;
    expect(row.count).toBe(4);
    expect(row.phase).toEqual({ opening: 1, middlegame: 2, endgame: 1 });
    expect(row.color).toEqual({ white: 3, black: 1 });
    expect(row.games_affected).toBe(3);
  });

  it('counts a game once even when it contributes several events of one motif', () => {
    const events = [
      ev({ motif: 'missed_win', game_id: 9, ply: 21 }),
      ev({ motif: 'missed_win', game_id: 9, ply: 41 }),
      ev({ motif: 'missed_win', game_id: 10, ply: 22 }),
    ];
    const row = summarizePatterns(events, 2, NOW)[0]!;
    expect(row.count).toBe(3);
    expect(row.games_affected).toBe(2);
  });
});

describe('motif weights', () => {
  it('uses PATTERN_WEIGHT in the score', () => {
    const hung = summarizePatterns([ev({ motif: 'hung_piece', severity: 20 })], 1, NOW)[0]!;
    const queen = summarizePatterns([ev({ motif: 'queen_sortie', severity: 20 })], 1, NOW)[0]!;
    const expectedRatio = PATTERN_WEIGHT.queen_sortie / PATTERN_WEIGHT.hung_piece;
    expect(queen.score / hung.score).toBeCloseTo(expectedRatio, 1);
  });
});
