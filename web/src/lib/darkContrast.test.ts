import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the dark-mode contrast floor in index.css. A muted
// grey that is legible on white chrome is nearly invisible on the dark
// panels, and the symptom is invisible in code review, so the floor is
// asserted here: every covered utility must clear WCAG AA (4.5:1) against
// both dark surfaces and keep its place in the hierarchy.

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

const DARK_PAGE = '#262421'; // body
const DARK_PANEL = '#312e2b'; // .card / panels

/** The three muted grey steps that carry body copy, captions and icons. */
const FLOOR = ['400', '500', '600'] as const;
const MIN_CONTRAST = 4.5;

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolve a `dark:` override declared for `text-chesscom-<step>` in index.css. */
function darkOverride(step: string): string {
  const re = new RegExp(`\\.dark\\s+:where\\(\\.text-chesscom-${step}\\)\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})`);
  const match = css.match(re);
  if (!match) throw new Error(`index.css has no dark-mode override for text-chesscom-${step}`);
  return match[1];
}

describe('dark-mode muted text', () => {
  it('lifts every muted grey above AA on the dark surfaces', () => {
    for (const step of FLOOR) {
      const color = darkOverride(step);
      expect(contrast(color, DARK_PANEL), `text-chesscom-${step} on a card`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(color, DARK_PAGE), `text-chesscom-${step} on the page`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('keeps the hierarchy the light palette has: 600 strongest, 400 faintest', () => {
    const [c400, c500, c600] = FLOOR.map((step) => luminance(darkOverride(step)));
    expect(c600).toBeGreaterThan(c500);
    expect(c500).toBeGreaterThan(c400);
  });

  it('uses :where() so a callsite dark:text-* still wins', () => {
    for (const step of FLOOR) {
      expect(css).toContain(`:where(.text-chesscom-${step}) { color:`);
    }
    // A bare `.dark .text-chesscom-500` would tie with `dark:text-chesscom-200`
    // and, being later in the sheet, silently override it.
    expect(css).not.toMatch(/\.dark\s+\.text-chesscom-(400|500|600)\s*\{/);
  });
});
