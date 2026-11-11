import { describe, expect, it } from 'vitest';
import { sanToSpeech } from './speech';

describe('sanToSpeech', () => {
  it('expands a piece move, a capture and check', () => {
    expect(sanToSpeech('Play Nf3, then Qxf7+ wins.', 'en'))
      .toBe('Play knight f3, then queen takes f7, check wins.');
  });

  it('names mate and castling', () => {
    expect(sanToSpeech('Qxf7# or O-O', 'en')).toBe('queen takes f7, checkmate or castles short');
    expect(sanToSpeech('O-O-O is safer', 'en')).toBe('castles long is safer');
  });

  it('reads a pawn capture and a promotion', () => {
    expect(sanToSpeech('exd5 and e8=Q', 'en')).toBe('pawn takes d5 and pawn e8 queen');
  });

  it('handles disambiguation without reading it aloud', () => {
    expect(sanToSpeech('Nbd7', 'en')).toBe('knight d7');
  });

  it('speaks the player\'s language', () => {
    expect(sanToSpeech('Qxf7#', 'pt')).toBe('dama captura f7, xeque-mate');
    expect(sanToSpeech('Sf3', 'de')).toBe('Springer f3');
    expect(sanToSpeech('Фd2+', 'ru')).toBe('ферзь d2, шах');
  });

  it('leaves ordinary prose and plain pawn pushes alone', () => {
    expect(sanToSpeech('your knight is hanging, play e4', 'en'))
      .toBe('your knight is hanging, play e4');
  });
});
