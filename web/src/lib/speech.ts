// The coach writes moves in algebraic notation ("Qxf7#"). That is perfect on
// screen and terrible out loud: speech synthesis spells "Qxf7#" as letter
// salad. Expand the tokens a chess player would say before handing the text to
// the browser voice, and leave everything else untouched.

import type { Language } from './languages';

interface Words {
  /** Canonical piece letters (KQRBN) → the word spoken aloud. */
  piece: Record<string, string>;
  /** Local SAN letters the model may use instead (Sf3, Lxh7, …). */
  letters: Record<string, string>;
  pawn: string;
  takes: string;
  check: string;
  mate: string;
  castlesShort: string;
  castlesLong: string;
}

const INTERNATIONAL: Record<string, string> = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N' };

const WORDS: Record<Language, Words> = {
  en: {
    piece: { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' },
    letters: INTERNATIONAL,
    pawn: 'pawn', takes: 'takes', check: 'check', mate: 'checkmate',
    castlesShort: 'castles short', castlesLong: 'castles long',
  },
  pt: {
    piece: { K: 'rei', Q: 'dama', R: 'torre', B: 'bispo', N: 'cavalo' },
    letters: { ...INTERNATIONAL, C: 'N', A: 'B', D: 'Q', T: 'R', R: 'K' },
    pawn: 'peão', takes: 'captura', check: 'xeque', mate: 'xeque-mate',
    castlesShort: 'roque curto', castlesLong: 'roque longo',
  },
  es: {
    piece: { K: 'rey', Q: 'dama', R: 'torre', B: 'alfil', N: 'caballo' },
    letters: { ...INTERNATIONAL, C: 'N', A: 'B', D: 'Q', T: 'R', R: 'K' },
    pawn: 'peón', takes: 'captura', check: 'jaque', mate: 'jaque mate',
    castlesShort: 'enroque corto', castlesLong: 'enroque largo',
  },
  de: {
    piece: { K: 'König', Q: 'Dame', R: 'Turm', B: 'Läufer', N: 'Springer' },
    letters: { ...INTERNATIONAL, S: 'N', L: 'B', D: 'Q', T: 'R' },
    pawn: 'Bauer', takes: 'nimmt', check: 'Schach', mate: 'Schachmatt',
    castlesShort: 'kurze Rochade', castlesLong: 'lange Rochade',
  },
  ru: {
    piece: { K: 'король', Q: 'ферзь', R: 'ладья', B: 'слон', N: 'конь' },
    letters: { ...INTERNATIONAL, К: 'K', Ф: 'Q', Л: 'R', С: 'B' },
    pawn: 'пешка', takes: 'берёт', check: 'шах', mate: 'мат',
    castlesShort: 'короткая рокировка', castlesLong: 'длинная рокировка',
  },
  bg: {
    piece: { K: 'цар', Q: 'дама', R: 'топ', B: 'офицер', N: 'кон' },
    letters: { ...INTERNATIONAL, Ц: 'K', Д: 'Q', Т: 'R', О: 'B', К: 'N' },
    pawn: 'пешка', takes: 'взима', check: 'шах', mate: 'мат',
    castlesShort: 'къса рокада', castlesLong: 'дълга рокада',
  },
};

const PIECE_LETTERS = 'KQRBNSCLDTAФКЛСЦДТО';

// Castling, a piece move (`Nbd7`, `Qxf7#`, `e8=Q`) or a pawn capture
// (`exd5`). Plain pawn pushes (`e4`) already read fine, so they are left out.
// Unicode-aware boundaries: with `\b` a Cyrillic move in Russian prose would
// never match.
const SAN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:` +
    `(O-O-O|O-O)` +
    `|([${PIECE_LETTERS}])([a-h]?[1-8]?)(x?)([a-h][1-8])(?:=([${PIECE_LETTERS}]))?([+#])?` +
    `|([a-h])(x)([a-h][1-8])(?:=([${PIECE_LETTERS}]))?([+#])?` +
    `|([a-h][1-8])=([${PIECE_LETTERS}])([+#])?` +
    `)(?![\\p{L}\\p{N}])`,
  'gu',
);

export function sanToSpeech(text: string, lang: Language = 'en'): string {
  const w = WORDS[lang] ?? WORDS.en;
  const pieceWord = (letter: string | undefined): string => {
    if (!letter) return '';
    const canonical = w.letters[letter] ?? letter.toUpperCase();
    return w.piece[canonical] ?? canonical;
  };

  return text.replace(SAN, (match, castle, piece, _disamb, capture, target, promo, suffix, pawnFile, pawnCapture, pawnTarget, pawnPromo, pawnSuffix, pushSquare, pushPromo, pushSuffix) => {
    if (castle) return castle === 'O-O-O' ? w.castlesLong : w.castlesShort;

    // `e8=Q` — a pawn promoting without a capture.
    if (pushSquare) {
      const spoken = [w.pawn, pushSquare, pieceWord(pushPromo)].filter(Boolean).join(' ');
      if (pushSuffix === '#') return `${spoken}, ${w.mate}`;
      if (pushSuffix === '+') return `${spoken}, ${w.check}`;
      return spoken;
    }

    const isPawn = Boolean(pawnFile);
    const from = isPawn ? pawnFile : piece;
    const takes = isPawn ? pawnCapture : capture;
    const square = isPawn ? pawnTarget : target;
    const promoted = isPawn ? pawnPromo : promo;
    const check = isPawn ? pawnSuffix : suffix;
    if (!from || !square) return match;

    const head = isPawn ? w.pawn : pieceWord(from);
    const parts = [head, takes ? w.takes : '', square];
    if (promoted) parts.push(pieceWord(promoted));
    const spoken = parts.filter(Boolean).join(' ');
    if (check === '#') return `${spoken}, ${w.mate}`;
    if (check === '+') return `${spoken}, ${w.check}`;
    return spoken;
  });
}
