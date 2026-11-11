import { Chess } from "chess.js";
import { cpToWinPct } from "../chess/classifier.js";
import type { Audience, Language, Classification } from "../types.js";
import { verdictPhrase, PIECE_VALUE } from "./locales.js";
import { sanToNatural, pvToNaturalSan, recentMovesNatural } from "./moves.js";
import { evaluationStateNatural, boardPiecesNatural, materialBalanceNatural, parseMoveDetail } from "./facts-utils.js";


// ─────────────────────────────────────────────────────────────────────────────
// Typed FACTS for the three call types — see spec §3.
// ─────────────────────────────────────────────────────────────────────────────

interface ExplainMoveInput {
  fen: string;
  player: "White" | "Black";
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  /** Optional engine evaluation (cp, white-perspective) before/after the move.
   *  When provided, the FACTS payload gains win-probability and a natural-
   *  language `evaluation_state` field — strong grounding for small models. */
  eval_before_cp?: number | null;
  eval_after_cp?: number | null;
  pv_san?: string[];
  history?: string[];
  user_perspective?: boolean;
}

const SECOND_PERSON_PERSPECTIVE: Record<Language, string> = {
  en: "you",
  bg: "ти",
  es: "tú",
  de: "du",
  ru: "ты",
  pt: "você",
};
/** FACTS payload for /api/coach/explain. */
export function factsForExplain(
  input: ExplainMoveInput,
  language: Language,
  audience: Audience,
) {
  const played = parseMoveDetail(
    input.played_san,
    input.fen,
    language,
    audience,
  );
  const bestSameAsPlayed =
    !input.best_san || input.best_san === input.played_san;
  const best = bestSameAsPlayed
    ? { natural: null, san: null, is_same_as_played: true }
    : {
        natural: sanToNatural(input.best_san!, input.fen, language, audience),
        san: input.best_san,
        is_same_as_played: false,
      };
  const pvNatural = bestSameAsPlayed
    ? []
    : pvToNaturalSan(input.pv_san ?? [], input.fen, language, audience, 4);

  // Material balance + full piece inventory AFTER the played move.
  // The piece inventory is the critical anti-hallucination context: without
  // it, the model invents bishops, knights, and pinned pieces from training
  // data instead of describing the position actually on the board.
  let materialDiffWhite = 0;
  let fenAfter = input.fen;
  try {
    const c = new Chess(input.fen);
    c.move(input.played_san, { strict: false });
    fenAfter = c.fen();
    const board = fenAfter.split(" ")[0] ?? "";
    for (const ch of board) {
      if (ch === "/" || /\d/.test(ch)) continue;
      const v = PIECE_VALUE[ch.toUpperCase()] ?? 0;
      if (ch === ch.toUpperCase()) materialDiffWhite += v;
      else materialDiffWhite -= v;
    }
  } catch {
    /* leave 0 */
  }

  const isWhite = input.player === "White";
  const materialDiffPlayer = isWhite ? materialDiffWhite : -materialDiffWhite;

  // Win-probability anchoring. Without this, small models reach for trained
  // prose ("you have a winning attack") when FACTS only has a centipawn number.
  // With it, the model has a concrete natural-language label to repeat.
  const wpBeforeWhite =
    input.eval_before_cp != null ? cpToWinPct(input.eval_before_cp) : null;
  const wpAfterWhite =
    input.eval_after_cp != null ? cpToWinPct(input.eval_after_cp) : null;
  const wpBeforePlayer =
    wpBeforeWhite != null
      ? isWhite
        ? wpBeforeWhite
        : 100 - wpBeforeWhite
      : null;
  const wpAfterPlayer =
    wpAfterWhite != null ? (isWhite ? wpAfterWhite : 100 - wpAfterWhite) : null;
  const wpDeltaPlayer =
    wpBeforePlayer != null && wpAfterPlayer != null
      ? Math.round(wpAfterPlayer - wpBeforePlayer)
      : null;

  const evaluation =
    wpAfterPlayer != null
      ? {
          win_pct_before: Math.round(wpBeforePlayer!),
          win_pct_after: Math.round(wpAfterPlayer),
          win_pct_delta: wpDeltaPlayer,
          state: evaluationStateNatural(wpAfterPlayer, language),
        }
      : null;

  const playerColor: "white" | "black" = isWhite ? "white" : "black";
  const board = boardPiecesNatural(fenAfter, playerColor, language, audience);
  return {
    lang: language,
    audience,
    perspective: input.user_perspective
      ? (SECOND_PERSON_PERSPECTIVE[language] ?? SECOND_PERSON_PERSPECTIVE.en)
      : input.player,
    side_to_move_before: input.player.toLowerCase(),
    history_recent: recentMovesNatural(
      input.history ?? [],
      language,
      audience,
      5,
    ),
    played: { ...played, san: input.played_san },
    best,
    engine_pv: pvNatural,
    // The coach writes moves in SAN, so the PV is also given unrendered.
    engine_pv_san: (input.pv_san ?? []).slice(0, 4),
    classification: input.classification,
    cp_loss: input.cp_loss,
    evaluation_state: evaluation?.state ?? null,
    win_pct_before: evaluation?.win_pct_before ?? null,
    win_pct_after: evaluation?.win_pct_after ?? null,
    win_pct_delta: evaluation?.win_pct_delta ?? null,
    material_balance: materialBalanceNatural(
      materialDiffPlayer,
      language,
      audience,
    ),
    // Full piece inventory of the position AFTER the move. The model must
    // only reference pieces that appear here (R1) — this is what stops
    // hallucinated "your bishop on c4" prose.
    your_pieces: board.player,
    opponent_pieces: board.opponent,
    verdict: verdictPhrase(input.classification, language),
    // The verdict phrase doubles as a definition ("a blunder — significant
    // material or position lost"). The label alone is what a coach says first,
    // so the task can ask for it and skip the textbook sentence.
    verdict_short: verdictPhrase(input.classification, language).split(" — ")[0],
  };
}

// How long a coaching answer may be. The coach has more to say than the old
// narrator (why, the better idea, the player's pattern), but players skip long
// walls of text: three sentences carry the verdict, the reason and the fix.
const EXPLAIN_SENTENCES: Record<Audience, number> = { kid: 2, beginner: 3, intermediate: 3, advanced: 3 };
const HINT_SENTENCES: Record<Audience, number> = { kid: 2, beginner: 3, intermediate: 3, advanced: 3 };

// The coach writes moves the way players do ("Qxf7#", not "the queen takes the
// pawn on f7"). FACTS carries both spellings: the SAN fields are copied
// verbatim, the natural ones exist for the fallback answer and the TTS.
function explainTask(language: Language, audience: Audience, input: ExplainMoveInput, tone: string): string {
  const n = EXPLAIN_SENTENCES[audience];
  const own = input.user_perspective;
  const noPraise = tone === "correct";

  if (language === "bg") {
    const persp = own ? "ти" : input.player === "White" ? "Бели" : "Черни";
    return `TASK: Коучвай играча за този ход. Твърд лимит: най-много ${n} изречения и не повече от ~50 думи общо.
1. Кажи оценката (FACTS.verdict_short).${noPraise ? " Без никаква похвала." : ""}
2. В едно изречение — ЗАЩО, с FACTS.why и FACTS.opponent_reply: какво става на дъската.
3. Ако има FACTS.better_move, дай по-добрата идея с нотацията на хода (FACTS.better_move_san) и какво постига.
4. Ако FACTS.player_history има запис, завърши с него в една кратка част от изречение.
Пиши ходовете в шахматна нотация, копирана точно от FACTS (played.san, better_move_san, opponent_reply_san, other_good_moves_san, engine_pv_san) — не "конят от g8 на f6", и никога ход, който не е във FACTS. Обръщай се към играча като "${persp}". Без JSON. Само български.`;
  }
  if (language === "es") {
    const persp = own ? "tú" : input.player === "White" ? "Blancas" : "Negras";
    return `TASK: Entrena al jugador sobre esta jugada. Límite estricto: como máximo ${n} frases y nunca más de ~50 palabras en total.
1. Di el veredicto (FACTS.verdict_short).${noPraise ? " Ningún elogio." : ""}
2. En una frase, el PORQUÉ, con FACTS.why y FACTS.opponent_reply: qué pasa en el tablero.
3. Si existe FACTS.better_move, da la idea mejor con la notación de la jugada (FACTS.better_move_san) y lo que consigue.
4. Si FACTS.player_history tiene una entrada, cierra con ella en una frase breve.
Escribe las jugadas en notación algebraica, copiada tal cual de FACTS (played.san, better_move_san, opponent_reply_san, other_good_moves_san, engine_pv_san) — nunca "el caballo de g8 a f6", y nunca una jugada que no esté en FACTS. Dirígete al jugador como "${persp}". Sin JSON. Solo español.`;
  }
  if (language === "de") {
    // Not 'Sprich ihn mit "du" an' — small models read that literally and
    // tack "du" on as a form of address ("Gut gemacht, du!").
    const address = own
      ? 'Duze den Spieler, aber ohne Begrüßung und ohne "du" als Anrede.'
      : `Sprich den Spieler mit "${input.player === "White" ? "Weiß" : "Schwarz"}" an.`;
    return `TASK: Coache den Spieler zu diesem Zug. Harte Grenze: höchstens ${n} Sätze und insgesamt nie mehr als ~50 Wörter.
1. Nenne das Urteil (FACTS.verdict_short).${noPraise ? " Kein Lob." : ""}
2. In einem Satz das WARUM, mit FACTS.why und FACTS.opponent_reply: was auf dem Brett passiert.
3. Wenn FACTS.better_move gesetzt ist, nenne die bessere Idee mit der Notation des Zugs (FACTS.better_move_san) und was sie erreicht.
4. Hat FACTS.player_history einen Eintrag, schließe mit ihm in einem kurzen Teilsatz.
Schreibe Züge in algebraischer Notation, exakt aus FACTS kopiert (played.san, better_move_san, opponent_reply_san, other_good_moves_san, engine_pv_san) — nicht "der Springer von g8 nach f6", und nie einen Zug, der nicht in FACTS steht. ${address} Kein JSON. Nur Deutsch.`;
  }
  if (language === "ru") {
    const persp = own ? "ты" : input.player === "White" ? "Белые" : "Чёрные";
    return `TASK: Разбери с игроком этот ход как тренер. Жёсткий лимит: не больше ${n} предложений и не больше ~50 слов всего.
1. Назови вердикт (FACTS.verdict_short).${noPraise ? " Никакой похвалы." : ""}
2. Одним предложением — ПОЧЕМУ, по FACTS.why и FACTS.opponent_reply: что происходит на доске.
3. Если есть FACTS.better_move, назови идею получше с нотацией хода (FACTS.better_move_san) и что она даёт.
4. Если в FACTS.player_history есть запись, закончи ею в коротком обороте.
Пиши ходы шахматной нотацией, скопированной точно из FACTS (played.san, better_move_san, opponent_reply_san, other_good_moves_san, engine_pv_san) — не "конь с g8 на f6", и никогда ход, которого нет в FACTS. Обращайся к игроку как "${persp}", без глаголов прошедшего времени с родом. Без JSON. Только по-русски.`;
  }
  if (language === "pt") {
    const persp = own ? "você" : input.player === "White" ? "Brancas" : "Negras";
    return `TASK: Treine o jogador neste lance. Limite rígido: no máximo ${n} frases e nunca mais de ~50 palavras.
1. Diga o veredito (FACTS.verdict_short).${noPraise ? " Nenhum elogio." : ""}
2. Em uma frase, o PORQUÊ, com FACTS.why e FACTS.opponent_reply: o que acontece no tabuleiro.
3. Se FACTS.better_move existir, mostre a ideia melhor com a notação do lance (FACTS.better_move_san) e o que ela ganha.
4. Se FACTS.player_history tiver registro, feche com ele em uma oração curta.
Escreva os lances em notação algébrica, copiada exatamente de FACTS (played.san, better_move_san, opponent_reply_san, other_good_moves_san, engine_pv_san) — nunca "o cavalo de g8 para f6", e nunca um lance que não esteja em FACTS. Trate o jogador como "${persp}". Sem JSON. Só português.`;
  }
  const persp = own ? "you" : input.player;
  return `TASK: Coach the player on this move. Hard limit: at most ${n} sentences and never more than ~50 words.
1. Name the verdict (FACTS.verdict_short).${noPraise ? " No praise at all." : ""}
2. In one sentence, WHY, from FACTS.why and FACTS.opponent_reply: what happens on the board.
3. If FACTS.better_move is set, give the better idea with its notation (FACTS.better_move_san) and what it achieves.
4. If FACTS.player_history has an entry, close with it in one short clause.
Write moves in algebraic notation, copied exactly from FACTS (played.san, better_move_san, opponent_reply_san, other_good_moves_san, engine_pv_san) — never "the knight from g8 to f6", and never a move that is not in FACTS. Address the player as "${persp}". No JSON. English only.`;
}

/** Build the user-message body for /api/coach/explain. `coaching` is what
 *  coaching.ts worked out (why, alternatives, history); it goes first so a
 *  small model reads the verdict and the reasons before the inventory. */
export function explainMovePrompt(
  input: ExplainMoveInput,
  language: Language,
  audience: Audience = "beginner",
  coaching: Record<string, unknown> = {},
  correction?: string,
): string {
  const facts = { ...coaching, ...factsForExplain(input, language, audience), ...coaching };
  const factsJson = JSON.stringify(facts, null, 2);
  const tone = String(coaching.tone ?? "");
  const task = explainTask(language, audience, input, tone);
  return `FACTS:\n${factsJson}\n\n${task}${correction ? `\n\n${correction}` : ""}`;
}

/** Sent with a retry when the first answer contradicted the verdict. */
export function correctionNote(language: Language, verdict: string): string {
  const notes: Record<Language, string> = {
    en: `IMPORTANT: your previous answer contradicted FACTS.verdict ("${verdict}"). Begin with that verdict and do not praise the move.`,
    bg: `ВАЖНО: предишният ти отговор противоречи на FACTS.verdict ("${verdict}"). Започни с тази оценка и не хвали хода.`,
    es: `IMPORTANTE: tu respuesta anterior contradecía FACTS.verdict ("${verdict}"). Empieza con ese veredicto y no elogies la jugada.`,
    de: `WICHTIG: Deine vorige Antwort widersprach FACTS.verdict ("${verdict}"). Beginne mit diesem Urteil und lobe den Zug nicht.`,
    ru: `ВАЖНО: твой прошлый ответ противоречил FACTS.verdict ("${verdict}"). Начни с этого вердикта и не хвали ход.`,
    pt: `IMPORTANTE: sua resposta anterior contradisse FACTS.verdict ("${verdict}"). Comece com esse veredito e não elogie o lance.`,
  };
  return notes[language] ?? notes.en;
}

export function hintPrompt(
  fen: string,
  audience: Audience,
  language: Language,
  history: string[] = [],
  coaching: Record<string, unknown> = {},
): string {
  const recent = recentMovesNatural(history, language, audience, 5);
  const facts = {
    ...coaching,
    lang: language,
    audience,
    side_to_move: fen.split(" ")[1] === "w" ? "white" : "black",
    history_recent: recent,
  };
  const factsJson = JSON.stringify(facts, null, 2);
  const n = HINT_SENTENCES[audience];

  if (language === "bg") {
    return `FACTS:\n${factsJson}\n\nTASK: Коучвай играча преди хода му. НЕ казвай най-добрия ход и никакъв конкретен ход. С FACTS.where_to_look и FACTS.best_move_idea покажи какво е важно в позицията и защо; ако FACTS.player_history има запис, напомни му за този навик. Завърши с един въпрос, който го кара да погледне дъската. Най-много ${n} изречения. Без шахматна нотация. Само естествен език на български.`;
  }
  if (language === "es") {
    return `FACTS:\n${factsJson}\n\nTASK: Entrena al jugador antes de su jugada. NO digas la mejor jugada ni ninguna jugada concreta. Con FACTS.where_to_look y FACTS.best_move_idea, señala lo importante de la posición y por qué; si FACTS.player_history tiene una entrada, recuérdale ese hábito. Termina con una pregunta que le haga mirar el tablero. Como máximo ${n} frases. Sin notación de ajedrez. Solo lenguaje natural, en español.`;
  }
  if (language === "de") {
    return `FACTS:\n${factsJson}\n\nTASK: Coache den Spieler vor seinem Zug. Nenne NICHT den besten Zug und keinen konkreten Zug. Zeig mit FACTS.where_to_look und FACTS.best_move_idea, worauf es in der Stellung ankommt und warum; hat FACTS.player_history einen Eintrag, erinnere an diese Gewohnheit. Schließe mit einer Frage, die ihn aufs Brett schauen lässt. Höchstens ${n} Sätze. Keine Schachnotation. Nur natürliche Sprache, auf Deutsch.`;
  }
  if (language === "ru") {
    return `FACTS:\n${factsJson}\n\nTASK: Помоги игроку как тренер перед его ходом. НЕ называй лучший ход и вообще конкретные ходы. По FACTS.where_to_look и FACTS.best_move_idea покажи, что важно в позиции и почему; если в FACTS.player_history есть запись, напомни об этой привычке. Закончи одним вопросом, который заставит посмотреть на доску. Не больше ${n} предложений. Без шахматной нотации. Только естественный язык, по-русски.`;
  }
  if (language === "pt") {
    return `FACTS:\n${factsJson}\n\nTASK: Treine o jogador antes do lance dele. NÃO diga o melhor lance nem qualquer lance concreto. Com FACTS.where_to_look e FACTS.best_move_idea, aponte o que importa na posição e por quê; se FACTS.player_history tiver registro, lembre-o desse hábito. Termine com uma pergunta que o faça olhar o tabuleiro. No máximo ${n} frases. Sem notação de xadrez. Só português.`;
  }
  return `FACTS:\n${factsJson}\n\nTASK: Coach the player before their move. Do NOT name the best move or any concrete move. Using FACTS.where_to_look and FACTS.best_move_idea, point out what matters in this position and why; if FACTS.player_history has an entry, remind them of that habit. End with one question that makes them look at the board. At most ${n} sentences. No chess notation. Natural language only, in English.`;
}
