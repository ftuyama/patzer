// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import i18n from '../i18n';
import WrongMoveVerdict from './WrongMoveVerdict';

// The move you tried in the trainer's result card.
const evaluation = {
  san: 'Bxc4',
  cp: -160,
  mate: null,
  cp_loss: 160,
  win_drop: 20,
  classification: 'miss',
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

describe('the verdict on a move that was not the answer', () => {
  it('shows the move, its classification, its score and what it gave up', () => {
    render(<WrongMoveVerdict evaluation={evaluation} side="white" />);
    expect(screen.getByText('Bxc4')).toBeTruthy();
    expect(screen.getByText('Miss')).toBeTruthy();
    expect(screen.getByText('−1.6')).toBeTruthy();
    expect(screen.getByText(/worse than the best move/)).toBeTruthy();
    expect(screen.getByText(/Evaluation after your move/)).toBeTruthy();
  });

  it('turns the score into the evaluation it cost when the "before" eval is known', () => {
    render(<WrongMoveVerdict evaluation={evaluation} beforeCp={120} side="white" compact />);
    expect(screen.getByText('Your evaluation')).toBeTruthy();
    expect(screen.getAllByText('+1.2')).toHaveLength(3);
    expect(screen.getByText('−1.6')).toBeTruthy();
    expect(screen.getByText('best move')).toBeTruthy();
  });

  it('shows the classification of the game move even without an eval', () => {
    render(<WrongMoveVerdict san="Bxc4" classification="blunder" evaluation={null} side="white" />);
    expect(screen.getByText('Bxc4')).toBeTruthy();
    expect(screen.getByText('Blunder')).toBeTruthy();
  });


  it('compact keeps the verdict but drops the explanatory sentence', () => {
    render(<WrongMoveVerdict evaluation={evaluation} side="white" compact />);
    expect(screen.getByText('Miss')).toBeTruthy();
    expect(screen.getByText('−1.6')).toBeTruthy();
    expect(screen.queryByText(/Evaluation after your move/)).toBeNull();
  });

  it('still names the move while the engine is looking at it', () => {
    render(<WrongMoveVerdict san="Bxc4" evaluation={null} side="white" loading />);
    expect(screen.getByText('Bxc4')).toBeTruthy();
    expect(screen.getByText(/looking at your move/)).toBeTruthy();
  });
});
