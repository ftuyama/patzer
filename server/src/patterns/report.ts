// Templated weekly narrative — no LLM.
//
// The progress route computes numbers; this module turns one week of them into
// 3–5 plain sentences: the week's most expensive habit, the accuracy delta
// versus the previous week, an improvement clause when a motif clearly fell,
// and one concrete next step. The output is a pure function of the payload and
// the language, so freezing it in `weekly_reports.summary_text` is safe: the
// same numbers always produce the same words.
//
// Vocabulary note: the web app has its own translated `diagnosis.patterns.*`
// strings, but only for the languages that ship a diagnosis translation. The
// server must render in the profile's language regardless, so the copy lives
// here and English is always the fallback.

import type { PatternKey } from '../chess/patterns.js';
import type { Language } from '../types.js';
import type { WeeklyProgressWeek } from './contracts.js';

/** A week as served by /api/progress: the contract plus the frozen report. */
export type ProgressWeek = WeeklyProgressWeek & {
  /** Templated narrative; stored verbatim once the week closes. */
  summary_text?: string | null;
};

const LANGUAGES: Language[] = ['en', 'bg', 'es', 'de', 'ru', 'pt'];

/** ISO week start (Monday) of the UTC day that `d` falls on. */
export function isoWeekStart(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay() || 7; // Monday = 1, Sunday = 7
  copy.setUTCDate(copy.getUTCDate() - (day - 1));
  return copy.toISOString().slice(0, 10);
}

/** Add whole days to a `YYYY-MM-DD` string without touching the timezone. */
export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function languageOf(value: Language | string | null | undefined): Language {
  return LANGUAGES.includes(value as Language) ? (value as Language) : 'en';
}

/** Trim a rounded number to at most one decimal, without trailing ".0". */
function num(n: number): string {
  return String(Math.round(n * 10) / 10);
}

interface Copy {
  habit: (label: string, count: number) => string;
  noHabit: string;
  accUp: (acc: number, delta: number, prev: number) => string;
  accDown: (acc: number, delta: number, prev: number) => string;
  accFlat: (acc: number, prev: number) => string;
  accOnly: (acc: number) => string;
  noAcc: (games: number) => string;
  improved: (label: string, from: number, to: number) => string;
  next: (step: string) => string;
  genericStep: string;
  labels: Record<PatternKey, string>;
  steps: Record<PatternKey, string>;
}

const EN: Copy = {
  habit: (label, count) => `Your most expensive habit this week was ${label} (${count}×).`,
  noHabit: 'No single error pattern stood out this week.',
  accUp: (acc, delta, prev) => `Accuracy averaged ${num(acc)}%, up ${num(delta)} points from ${num(prev)}% the week before.`,
  accDown: (acc, delta, prev) => `Accuracy averaged ${num(acc)}%, down ${num(delta)} points from ${num(prev)}% the week before.`,
  accFlat: (acc, prev) => `Accuracy averaged ${num(acc)}%, level with ${num(prev)}% the week before.`,
  accOnly: (acc) => `Accuracy averaged ${num(acc)}%.`,
  noAcc: (games) => `You had ${games} analysed games this week.`,
  improved: (label, from, to) => `Good news: ${label} fell from ${from} to ${to}.`,
  next: (step) => `Next week: ${step}`,
  genericStep: 'review one lost game before your next session and name the move you would take back.',
  labels: {
    hung_piece: 'hung pieces',
    fork_exposed: 'fork exposure',
    allowed_mate: 'allowed mates',
    missed_win: 'missed wins',
    back_rank: 'back-rank weaknesses',
    opening_leak: 'opening leaks',
    endgame_drift: 'endgame drift',
    promising_to_losing: 'thrown-away winning positions',
    queen_sortie: 'early queen sorties',
  },
  steps: {
    hung_piece: 'after every move, ask what the opponent can capture and whether that piece is defended.',
    fork_exposed: 'before moving, check that the piece you touch does not leave two targets for one enemy move.',
    allowed_mate: 'look at every check the opponent would have after your move, especially near your king.',
    missed_win: 'when you are winning, calculate checks, captures and threats first.',
    back_rank: 'give your king an escape square or keep a rook on the back rank.',
    opening_leak: 'finish developing before starting tactics and review the main traps in your opening.',
    endgame_drift: 'activate your king and rook early and count pawn moves before pushing.',
    promising_to_losing: 'when clearly better, prefer safe improving moves over forced complications.',
    queen_sortie: 'develop knights and bishops first and bring the queen out only on a safe route.',
  },
};

const DE: Copy = {
  habit: (label, count) => `Deine teuerste Gewohnheit diese Woche war ${label} (${count}×).`,
  noHabit: 'Diese Woche hat sich kein einzelnes Fehlermuster herausgehoben.',
  accUp: (acc, delta, prev) => `Die Genauigkeit lag bei ${num(acc)} %, ${num(delta)} Punkte über ${num(prev)} % in der Vorwoche.`,
  accDown: (acc, delta, prev) => `Die Genauigkeit lag bei ${num(acc)} %, ${num(delta)} Punkte unter ${num(prev)} % in der Vorwoche.`,
  accFlat: (acc, prev) => `Die Genauigkeit lag bei ${num(acc)} %, unverändert zu ${num(prev)} % in der Vorwoche.`,
  accOnly: (acc) => `Die Genauigkeit lag bei ${num(acc)} %.`,
  noAcc: (games) => `Du hattest diese Woche ${games} analysierte Partien.`,
  improved: (label, from, to) => `Gute Nachricht: ${label} sank von ${from} auf ${to}.`,
  next: (step) => `Nächste Woche: ${step}`,
  genericStep: 'sieh dir vor der nächsten Session eine verlorene Partie an und benenne den Zug, den du zurücknehmen würdest.',
  labels: {
    hung_piece: 'hängende Figuren',
    fork_exposed: 'Gabeln',
    allowed_mate: 'zugelassene Mattangriffe',
    missed_win: 'verpasste Gewinne',
    back_rank: 'Grundreihen-Schwächen',
    opening_leak: 'Eröffnungsfehler',
    endgame_drift: 'Endspiel-Drift',
    promising_to_losing: 'verschenkte Gewinnstellungen',
    queen_sortie: 'frühe Damenausflüge',
  },
  steps: {
    hung_piece: 'frage nach jedem Zug, was der Gegner schlagen kann und ob diese Figur gedeckt ist.',
    fork_exposed: 'prüfe vor dem Zug, ob die berührte Figur zwei Ziele für einen gegnerischen Zug lässt.',
    allowed_mate: 'prüfe alle Schachgebote, die der Gegner nach deinem Zug hätte, besonders nahe deinem König.',
    missed_win: 'wenn du gewinnst, berechne zuerst Schachs, Schläge und Drohungen.',
    back_rank: 'gib deinem König ein Fluchtfeld oder halte einen Turm auf der Grundreihe.',
    opening_leak: 'entwickle erst fertig, bevor du Taktik startest, und sieh dir die Hauptfallen deiner Eröffnung an.',
    endgame_drift: 'aktiviere König und Turm früh im Endspiel und zähle Bauernzüge, bevor du schiebst.',
    promising_to_losing: 'wenn du klar besser stehst, wähle sichere Verbesserungszüge statt erzwungener Komplikationen.',
    queen_sortie: 'entwickle erst Springer und Läufer und bring die Dame nur auf einer sicheren Route heraus.',
  },
};

const RU: Copy = {
  habit: (label, count) => `Самая дорогая привычка этой недели — ${label} (${count}×).`,
  noHabit: 'На этой неделе ни один шаблон ошибок не выделился.',
  accUp: (acc, delta, prev) => `Средняя точность — ${num(acc)} %, на ${num(delta)} п. выше прошлой недели (${num(prev)} %).`,
  accDown: (acc, delta, prev) => `Средняя точность — ${num(acc)} %, на ${num(delta)} п. ниже прошлой недели (${num(prev)} %).`,
  accFlat: (acc, prev) => `Средняя точность — ${num(acc)} %, как и на прошлой неделе (${num(prev)} %).`,
  accOnly: (acc) => `Средняя точность — ${num(acc)} %.`,
  noAcc: (games) => `На этой неделе проанализировано партий: ${games}.`,
  improved: (label, from, to) => `Хорошая новость: ${label} — с ${from} до ${to}.`,
  next: (step) => `На следующей неделе: ${step}`,
  genericStep: 'разберите одну проигранную партию перед следующей сессией и назовите ход, который хотели бы вернуть.',
  labels: {
    hung_piece: 'висящие фигуры',
    fork_exposed: 'вилки',
    allowed_mate: 'допущенные маты',
    missed_win: 'упущенные выигрыши',
    back_rank: 'слабость последней горизонтали',
    opening_leak: 'ошибки в дебюте',
    endgame_drift: 'ошибки в эндшпиле',
    promising_to_losing: 'упущенные выигранные позиции',
    queen_sortie: 'ранние вылазки ферзём',
  },
  steps: {
    hung_piece: 'после каждого хода спрашивайте, что может взять соперник и защищена ли эта фигура.',
    fork_exposed: 'перед ходом проверяйте, не оставляет ли трогаемая фигура две цели для одного хода соперника.',
    allowed_mate: 'проверяйте все шахи, которые будут у соперника после вашего хода, особенно рядом с вашим королём.',
    missed_win: 'когда выигрываете, сначала считайте шахи, взятия и угрозы.',
    back_rank: 'дайте королю поле для отхода или держите ладью на последней горизонтали.',
    opening_leak: 'завершите развитие до тактики и разберите главные ловушки своего дебюта.',
    endgame_drift: 'активизируйте короля и ладью в эндшпиле и считайте пешечные ходы перед продвижением.',
    promising_to_losing: 'при явном перевесе выбирайте безопасные улучшающие ходы вместо форсированных осложнений.',
    queen_sortie: 'сначала развивайте коней и слонов, а ферзя выводите только по безопасному маршруту.',
  },
};

const PT: Copy = {
  habit: (label, count) => `Seu hábito mais caro desta semana foi ${label} (${count}×).`,
  noHabit: 'Nenhum padrão de erro se destacou nesta semana.',
  accUp: (acc, delta, prev) => `A precisão média foi ${num(acc)}%, ${num(delta)} pontos acima dos ${num(prev)}% da semana anterior.`,
  accDown: (acc, delta, prev) => `A precisão média foi ${num(acc)}%, ${num(delta)} pontos abaixo dos ${num(prev)}% da semana anterior.`,
  accFlat: (acc, prev) => `A precisão média foi ${num(acc)}%, igual aos ${num(prev)}% da semana anterior.`,
  accOnly: (acc) => `A precisão média foi ${num(acc)}%.`,
  noAcc: (games) => `Você teve ${games} partidas analisadas nesta semana.`,
  improved: (label, from, to) => `Boa notícia: ${label} caiu de ${from} para ${to}.`,
  next: (step) => `Na próxima semana: ${step}`,
  genericStep: 'revise uma partida perdida antes da próxima sessão e nomeie o lance que gostaria de refazer.',
  labels: {
    hung_piece: 'peças penduradas',
    fork_exposed: 'garfos',
    allowed_mate: 'mates permitidos',
    missed_win: 'vitórias desperdiçadas',
    back_rank: 'fraqueza da última fileira',
    opening_leak: 'erros na abertura',
    endgame_drift: 'deriva no final',
    promising_to_losing: 'posições vencedoras desperdiçadas',
    queen_sortie: 'dama adiantada',
  },
  steps: {
    hung_piece: 'depois de cada lance, pergunte o que o adversário pode capturar — e se essa peça está defendida.',
    fork_exposed: 'antes de mover, verifique se a peça que você toca deixa dois alvos para um único lance inimigo.',
    allowed_mate: 'veja todos os xeques que o adversário teria depois do seu lance, especialmente perto do seu rei.',
    missed_win: 'quando estiver ganhando, calcule xeques, capturas e ameaças antes de qualquer outra coisa.',
    back_rank: 'dê uma casa de fuga ao rei ou mantenha uma torre na última fileira para defendê-la.',
    opening_leak: 'termine o desenvolvimento antes de iniciar táticas; revise as armadilhas principais da sua abertura.',
    endgame_drift: 'ative o rei e a torre cedo no final; conte os lances de peão antes de avançar.',
    promising_to_losing: 'quando estiver claramente melhor, prefira lances seguros e de melhoria a complicações forçadas.',
    queen_sortie: 'desenvolva cavalos e bispos primeiro; traga a dama só quando ela tiver uma rota segura.',
  },
};

const BG: Copy = {
  habit: (label, count) => `Най-скъпият навик тази седмица беше ${label} (${count}×).`,
  noHabit: 'Тази седмица нито един модел на грешки не се открои.',
  accUp: (acc, delta, prev) => `Средната точност беше ${num(acc)} %, с ${num(delta)} пункта над ${num(prev)} % предната седмица.`,
  accDown: (acc, delta, prev) => `Средната точност беше ${num(acc)} %, с ${num(delta)} пункта под ${num(prev)} % предната седмица.`,
  accFlat: (acc, prev) => `Средната точност беше ${num(acc)} %, без промяна спрямо ${num(prev)} % предната седмица.`,
  accOnly: (acc) => `Средната точност беше ${num(acc)} %.`,
  noAcc: (games) => `Тази седмица имаше ${games} анализирани партии.`,
  improved: (label, from, to) => `Добра новина: ${label} спадна от ${from} на ${to}.`,
  next: (step) => `Следващата седмица: ${step}`,
  genericStep: 'прегледай една загубена партия преди следващата сесия и назови хода, който би върнал.',
  labels: {
    hung_piece: 'висящи фигури',
    fork_exposed: 'вилици',
    allowed_mate: 'допуснати матове',
    missed_win: 'пропуснати победи',
    back_rank: 'слабост на последния ред',
    opening_leak: 'грешки в дебюта',
    endgame_drift: 'грешки в ендшпила',
    promising_to_losing: 'пропуснати печеливши позиции',
    queen_sortie: 'ранни излизания на дамата',
  },
  steps: {
    hung_piece: 'след всеки ход питайте какво може да вземе противникът и дали фигурата е защитена.',
    fork_exposed: 'преди ход проверете дали фигурата, която местите, не оставя две цели за един ход на противника.',
    allowed_mate: 'проверявайте всички шахове, които противникът би имал след вашия ход, особено до вашия цар.',
    missed_win: 'когато печелите, първо изчислявайте шахове, взимания и заплахи.',
    back_rank: 'дайте на царя поле за отстъпление или дръжте топ на последния ред.',
    opening_leak: 'завършете развитието преди тактика и прегледайте основните капани в дебюта си.',
    endgame_drift: 'активирайте царя и топа рано в ендшпила и бройте пешечните ходове преди да бутате.',
    promising_to_losing: 'при ясно предимство предпочитайте безопасни подобряващи ходове пред форсирани усложнения.',
    queen_sortie: 'развивайте първо коне и офицери и извеждайте дамата само по безопасен маршрут.',
  },
};

const ES: Copy = {
  habit: (label, count) => `Tu hábito más caro esta semana fue ${label} (${count}×).`,
  noHabit: 'Ningún patrón de error destacó esta semana.',
  accUp: (acc, delta, prev) => `La precisión media fue ${num(acc)}%, ${num(delta)} puntos más que el ${num(prev)}% de la semana anterior.`,
  accDown: (acc, delta, prev) => `La precisión media fue ${num(acc)}%, ${num(delta)} puntos menos que el ${num(prev)}% de la semana anterior.`,
  accFlat: (acc, prev) => `La precisión media fue ${num(acc)}%, igual que el ${num(prev)}% de la semana anterior.`,
  accOnly: (acc) => `La precisión media fue ${num(acc)}%.`,
  noAcc: (games) => `Tuviste ${games} partidas analizadas esta semana.`,
  improved: (label, from, to) => `Buena noticia: ${label} bajó de ${from} a ${to}.`,
  next: (step) => `La próxima semana: ${step}`,
  genericStep: 'revisa una partida perdida antes de tu próxima sesión y nombra el movimiento que te gustaría recuperar.',
  labels: {
    hung_piece: 'piezas colgadas',
    fork_exposed: 'horquillas',
    allowed_mate: 'mates permitidos',
    missed_win: 'victorias perdidas',
    back_rank: 'debilidad de la última fila',
    opening_leak: 'errores de apertura',
    endgame_drift: 'deriva en el final',
    promising_to_losing: 'posiciones ganadoras desperdiciadas',
    queen_sortie: 'salidas tempranas de dama',
  },
  steps: {
    hung_piece: 'después de cada jugada, pregúntate qué puede capturar el rival y si esa pieza está defendida.',
    fork_exposed: 'antes de mover, comprueba que la pieza que tocas no deja dos objetivos a una sola jugada enemiga.',
    allowed_mate: 'mira todos los jaques que tendría el rival tras tu jugada, sobre todo cerca de tu rey.',
    missed_win: 'cuando vas ganando, calcula primero jaques, capturas y amenazas.',
    back_rank: 'da a tu rey una casilla de escape o mantén una torre en la última fila.',
    opening_leak: 'termina el desarrollo antes de empezar táctica y repasa las trampas principales de tu apertura.',
    endgame_drift: 'activa rey y torre pronto en el final y cuenta las jugadas de peón antes de avanzar.',
    promising_to_losing: 'cuando estés claramente mejor, prefiere jugadas seguras de mejora a complicaciones forzadas.',
    queen_sortie: 'desarrolla caballos y alfiles primero y saca la dama solo por una ruta segura.',
  },
};

const COPY: Record<Language, Copy> = { en: EN, de: DE, ru: RU, pt: PT, bg: BG, es: ES };

interface MotifDrop {
  key: PatternKey;
  from: number;
  to: number;
}

/**
 * The motif that fell most clearly versus the previous week, if any. Only
 * motifs that occurred a few times before count — a single event disappearing
 * is noise, not progress.
 */
export function droppedMotif(
  week: Pick<WeeklyProgressWeek, 'top_patterns'>,
  previous: Pick<WeeklyProgressWeek, 'top_patterns'> | null | undefined,
): MotifDrop | null {
  if (!previous) return null;
  const now = new Map<PatternKey, number>(week.top_patterns.map((p) => [p.key, p.count]));
  let best: MotifDrop | null = null;
  for (const p of previous.top_patterns) {
    if (p.count < 2) continue;
    const to = now.get(p.key) ?? 0;
    if (to > p.count * 0.6) continue;
    const drop = p.count - to;
    if (!best || drop > best.from - best.to) best = { key: p.key, from: p.count, to };
  }
  return best;
}

/**
 * Render the templated weekly report. Deterministic: the same week, previous
 * week and language always yield the same string (no dates, no randomness).
 */
export function renderWeeklyReport(
  week: Pick<WeeklyProgressWeek, 'games' | 'accuracy' | 'accuracy_delta' | 'top_patterns' | 'errors_per_game'>,
  previous: Pick<WeeklyProgressWeek, 'top_patterns' | 'accuracy'> | null | undefined,
  language?: Language | string | null,
): string {
  const copy = COPY[languageOf(language)];
  const sentences: string[] = [];

  const top = week.top_patterns[0];
  sentences.push(top ? copy.habit(copy.labels[top.key], top.count) : copy.noHabit);

  const prevAccuracy = previous?.accuracy ?? null;
  if (week.accuracy != null && prevAccuracy != null) {
    const delta = week.accuracy_delta ?? Math.round((week.accuracy - prevAccuracy) * 10) / 10;
    if (Math.abs(delta) < 0.05) sentences.push(copy.accFlat(week.accuracy, prevAccuracy));
    else if (delta > 0) sentences.push(copy.accUp(week.accuracy, delta, prevAccuracy));
    else sentences.push(copy.accDown(week.accuracy, Math.abs(delta), prevAccuracy));
  } else if (week.accuracy != null) {
    sentences.push(copy.accOnly(week.accuracy));
  } else {
    sentences.push(copy.noAcc(week.games));
  }

  const drop = droppedMotif(week, previous);
  if (drop) sentences.push(copy.improved(copy.labels[drop.key], drop.from, drop.to));

  const step = top ? copy.steps[top.key] : copy.genericStep;
  sentences.push(copy.next(step));

  return sentences.join(' ');
}
