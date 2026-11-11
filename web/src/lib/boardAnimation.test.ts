import { describe, expect, it } from 'vitest';
import { BOARD_ANIMATIONS, boardAnimationMs } from './boardAnimation';

describe('boardAnimationMs', () => {
  it('maps every stored preference to a duration', () => {
    expect(BOARD_ANIMATIONS.map(boardAnimationMs)).toEqual([0, 120, 200, 350]);
  });

  it('snaps for off', () => {
    expect(boardAnimationMs('off')).toBe(0);
  });

  it('stays above chessground\'s 70ms floor when animation is on', () => {
    // chessground silently turns animations shorter than 70ms off, so a
    // "fast" setting that landed below it would look broken/identical to off.
    for (const a of BOARD_ANIMATIONS.filter((x) => x !== 'off')) {
      expect(boardAnimationMs(a), a).toBeGreaterThanOrEqual(70);
    }
  });

  it('snaps when the preference is missing or unknown', () => {
    // Profiles created before the setting existed, or a client one version
    // ahead of the server, must not leave the board in a tween.
    expect(boardAnimationMs(null)).toBe(0);
    expect(boardAnimationMs(undefined)).toBe(0);
    expect(boardAnimationMs('warp-speed')).toBe(0);
  });
});
