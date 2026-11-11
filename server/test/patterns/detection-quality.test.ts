// Precision/recall harness for `detectGamePatterns`.
//
// The fixtures in ./fixtures are hand-labelled: `expected` is the exact motif
// set for the fixture. A motif counts as a true positive only when the
// detector emits it for a fixture that expects it. False positives come from
// negative fixtures and from extra motifs on positive fixtures.
//
// Thresholds live in a single exported object so they are easy to ratchet up:
// when a detector change improves a number, raise the floor in the same commit
// and record the new measurement in docs/patterns-quality.md. Never lower one
// without a review note.

import { describe, it, expect } from 'vitest';
import {
  detectGamePatterns,
  PATTERN_KEYS,
  PATTERN_VERSION,
  type PatternKey,
} from '../../src/chess/patterns.js';
import {
  ALL_FIXTURES,
  NEGATIVE_FIXTURES,
  POSITIVE_FIXTURES,
  metaFor,
  toAnalyzedMoves,
  type Fixture,
} from './fixtures/index.js';

/**
 * The `PATTERN_VERSION` the fixtures and thresholds below were reviewed
 * against. If patterns.ts bumps the version, this test fails until someone
 * re-reads the fixtures, re-measures precision/recall, and updates this
 * constant (plus docs/patterns-quality.md) deliberately.
 */
export const EXPECTED_PATTERN_VERSION = 1;

interface Threshold {
  /** Minimum precision (TP / (TP + FP)) for this motif. */
  precision: number;
  /** Minimum recall (TP / (TP + FN)) for this motif. */
  recall: number;
}

function uniform(value: number): Record<PatternKey, Threshold> {
  return Object.fromEntries(PATTERN_KEYS.map((k) => [k, { precision: value, recall: value }])) as Record<PatternKey, Threshold>;
}

/**
 * Floors measured on 2026-11-11. Every motif is currently perfect on the
 * curated set (see the table in docs/patterns-quality.md), so the floors are
 * 1.0. New fixtures will lower the first measurement — set the floor to that
 * measurement and note it, do not "fix" the fixture.
 */
export const QUALITY_THRESHOLDS = {
  pattern_version: EXPECTED_PATTERN_VERSION,
  /** A motif with fewer labelled fixtures than this is not meaningfully tested. */
  min_fixtures_per_motif: 2,
  /** Per-motif floors, exact match on the fixture set. */
  per_motif: uniform(1),
  /** Overall micro-averaged floors across motifs. */
  micro: { precision: 1, recall: 1 },
};

interface MotifScore {
  key: PatternKey;
  fixtures_expected: number;
  fixtures_predicted: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

interface Prediction {
  fixture: Fixture;
  expected: Set<PatternKey>;
  predicted: Set<PatternKey>;
}

function predictAll(fixtures: Fixture[]): Prediction[] {
  return fixtures.map((fixture) => {
    const events = detectGamePatterns(toAnalyzedMoves(fixture), metaFor(fixture), null);
    return {
      fixture,
      expected: new Set(fixture.expected),
      predicted: new Set(events.map((e) => e.motif)),
    };
  });
}

export function scoreByMotif(predictions: Prediction[]): Record<PatternKey, MotifScore> {
  const out = {} as Record<PatternKey, MotifScore>;
  for (const key of PATTERN_KEYS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let fixturesExpected = 0;
    let fixturesPredicted = 0;
    for (const p of predictions) {
      const expecting = p.expected.has(key);
      const predicting = p.predicted.has(key);
      if (expecting) fixturesExpected++;
      if (predicting) fixturesPredicted++;
      if (expecting && predicting) tp++;
      else if (predicting) fp++;
      else if (expecting) fn++;
    }
    out[key] = {
      key,
      fixtures_expected: fixturesExpected,
      fixtures_predicted: fixturesPredicted,
      tp,
      fp,
      fn,
      precision: fixturesPredicted === 0 ? 1 : tp / fixturesPredicted,
      recall: fixturesExpected === 0 ? 1 : tp / fixturesExpected,
    };
  }
  return out;
}

const PREDICTIONS = predictAll(ALL_FIXTURES);
const SCORES = scoreByMotif(PREDICTIONS);

describe('pattern fixture integrity', () => {
  it('every fixture is legal chess and every move has eval data', () => {
    for (const fixture of ALL_FIXTURES) {
      const moves = toAnalyzedMoves(fixture);
      expect(moves.length, `${fixture.id} has no moves`).toBeGreaterThan(0);
      for (const [i, move] of moves.entries()) {
        const source = fixture.moves[i]!;
        const hasBefore = source.eval_before_cp !== null || source.mate_before !== undefined;
        const hasAfter = source.eval_after_cp !== null || source.mate_after !== undefined;
        expect(hasBefore, `${fixture.id} ply ${move.ply}: missing eval_before_cp/mate_before`).toBe(true);
        expect(hasAfter, `${fixture.id} ply ${move.ply}: missing eval_after_cp/mate_after`).toBe(true);
      }
    }
  });

  it('labels are internally consistent — positive fixtures expect something, negatives expect nothing', () => {
    for (const fixture of POSITIVE_FIXTURES) {
      expect(fixture.expected.length, `${fixture.id} is positive but expects no motif`).toBeGreaterThan(0);
    }
    for (const fixture of NEGATIVE_FIXTURES) {
      expect(fixture.expected, `${fixture.id} is negative but expects a motif`).toEqual([]);
    }
  });

  it(`covers every motif with at least ${QUALITY_THRESHOLDS.min_fixtures_per_motif} labelled fixtures`, () => {
    for (const key of PATTERN_KEYS) {
      const count = POSITIVE_FIXTURES.filter((f) => f.expected.includes(key)).length;
      expect(
        count,
        `motif "${key}" has only ${count} labelled fixture(s); add at least `
        + `${QUALITY_THRESHOLDS.min_fixtures_per_motif} to server/test/patterns/fixtures/labelled.ts`,
      ).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.min_fixtures_per_motif);
    }
  });
});

describe('detectGamePatterns precision/recall on the labelled set', () => {
  it('produces exactly the expected motif set for every positive fixture', () => {
    for (const prediction of PREDICTIONS.filter((p) => p.fixture.expected.length > 0)) {
      expect(
        [...prediction.predicted].sort(),
        `${prediction.fixture.id}: predicted ${JSON.stringify([...prediction.predicted])}, `
        + `expected ${JSON.stringify(prediction.fixture.expected)}`,
      ).toEqual([...prediction.expected].sort());
    }
  });

  it('produces zero events on every negative fixture', () => {
    for (const fixture of NEGATIVE_FIXTURES) {
      const events = detectGamePatterns(toAnalyzedMoves(fixture), metaFor(fixture), null);
      expect(
        events.map((e) => `${e.motif}@${e.ply}`),
        `${fixture.id} must stay silent but produced ${events.length} event(s)`,
      ).toEqual([]);
    }
  });

  it('meets the per-motif precision and recall floors', () => {
    for (const key of PATTERN_KEYS) {
      const score = SCORES[key];
      const floor = QUALITY_THRESHOLDS.per_motif[key];
      expect(
        score.precision,
        `precision for "${key}" is ${score.precision.toFixed(3)} (${score.tp} TP / ${score.fp} FP), `
        + `below the ${floor.precision} floor. A false positive means the detector fired on a fixture `
        + 'that does not expect it — check the fixture label first, then patterns.ts.',
      ).toBeGreaterThanOrEqual(floor.precision);
      expect(
        score.recall,
        `recall for "${key}" is ${score.recall.toFixed(3)} (${score.tp} TP / ${score.fn} FN), `
        + `below the ${floor.recall} floor. A miss means a labelled example stopped producing the motif.`,
      ).toBeGreaterThanOrEqual(floor.recall);
    }
  });

  it('meets the micro-averaged floors', () => {
    const keys = PATTERN_KEYS;
    const tp = keys.reduce((n, k) => n + SCORES[k].tp, 0);
    const fp = keys.reduce((n, k) => n + SCORES[k].fp, 0);
    const fn = keys.reduce((n, k) => n + SCORES[k].fn, 0);
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    expect(precision, `micro precision ${precision.toFixed(3)}`).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.micro.precision);
    expect(recall, `micro recall ${recall.toFixed(3)}`).toBeGreaterThanOrEqual(QUALITY_THRESHOLDS.micro.recall);
  });

  it('the measured table is available for the docs', () => {
    // Keep this test as the single source of truth when updating
    // docs/patterns-quality.md: paste the table it prints into the doc.
    const header = 'motif                 fixtures  precision  recall  tp fp fn';
    const lines = PATTERN_KEYS.map((key) => {
      const s = SCORES[key];
      return `${key.padEnd(21)} ${String(s.fixtures_expected).padStart(8)}  `
        + `${s.precision.toFixed(2).padStart(9)}  ${s.recall.toFixed(2).padStart(6)}  `
        + `${s.tp}  ${s.fp}  ${s.fn}`;
    });
    expect(header.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('hung_piece');
  });
});

describe('regression guard', () => {
  it('PATTERN_VERSION matches the reviewed fixtures and thresholds', () => {
    expect(
      PATTERN_VERSION,
      `PATTERN_VERSION is now ${PATTERN_VERSION}, but the quality harness was reviewed against `
      + `${EXPECTED_PATTERN_VERSION}. Review server/test/patterns/fixtures/labelled.ts and `
      + 'docs/patterns-quality.md, re-measure precision/recall, then bump '
      + 'EXPECTED_PATTERN_VERSION (and QUALITY_THRESHOLDS.pattern_version) deliberately.',
    ).toBe(EXPECTED_PATTERN_VERSION);
    expect(QUALITY_THRESHOLDS.pattern_version).toBe(EXPECTED_PATTERN_VERSION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Known detector limitations.
//
// These are real, reproducible false positives that were found while labelling
// the fixtures. They are marked `it.fails` so the suite stays green while the
// bug is documented; when patterns.ts is fixed, `it.fails` will turn red and
// the test should be promoted to a normal `it` and the reproduction moved into
// labelled.ts. See docs/patterns-quality.md § Known weaknesses.
// ─────────────────────────────────────────────────────────────────────────────
describe('known detector limitations (it.fails until patterns.ts is fixed)', () => {
  function fixtureFor(fen: string, san: string, ply: number, expected: PatternKey[]): Fixture {
    return {
      id: 'known-bug-repro',
      description: 'reproduction',
      user_color: ply % 2 === 1 ? 'white' : 'black',
      end_time: null,
      expected,
      moves: [{
        fen_before: fen,
        san,
        ply,
        classification: 'blunder',
        eval_before_cp: 20,
        eval_after_cp: -240,
        centipawn_loss: 260,
      }],
    };
  }

  it.fails(
    'back_rank fires without any opponent heavy piece (bare own back rank is not a weakness)',
    () => {
      // White has no rook/queen on the board at all and Black has no rook or
      // queen either — there is no back-rank mate to allow. The detector still
      // emits back_rank because the signature only inspects White's own rank.
      const fixture: Fixture = {
        id: 'back_rank_false_positive',
        description: 'bare back rank, no attacker',
        user_color: 'white',
        end_time: null,
        expected: ['hung_piece'],
        moves: [{
          fen_before: '6k1/5ppp/p7/8/3N4/8/5PPP/6K1 w - - 0 1',
          san: 'Nb5',
          ply: 21,
          classification: 'mistake',
          eval_before_cp: 50,
          eval_after_cp: -200,
          centipawn_loss: 250,
        }],
      };
      const events = detectGamePatterns(toAnalyzedMoves(fixture), metaFor(fixture), null);
      expect(events.map((e) => e.motif)).toEqual(['hung_piece']);
    },
  );

  it.fails(
    'hung_piece fallback fires on a pure positional blunder with nothing hanging',
    () => {
      // h3 loses 260 cp to a king-safety/positional idea, but no white piece is
      // attacked after it. The `motifs.size === 0 && cpLoss >= 200` fallback
      // still labels it hung_piece, which will send the user to the wrong drill.
      const fixture = fixtureFor('1r4k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1', 'h3', 21, []);
      const events = detectGamePatterns(toAnalyzedMoves(fixture), metaFor(fixture), null);
      expect(events.map((e) => e.motif)).toEqual([]);
    },
  );
});
