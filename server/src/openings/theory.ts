// Opening theory gaps — where the player leaves the book and what it costs.
//
// For every analysed game we replay the PGN with chess.js, up to ply 24, and
// ask the Lichess Opening Explorer what the crowd plays in each position the
// player had to move in. A *gap* is a move the explorer barely sees while a
// clearly more popular move exists.
//
// Gap heuristic (all shares are of the position's explorer sample):
//   - the explorer's top move must have >= 50 games AND >= 10 % share;
//   - the player's move must have < 5 % share (a move the explorer does not
//     return at all counts as 0 %);
//   - plies where the player played the top move are skipped;
//   - eval_loss is the win-percentage drop (Lichess cp → win% curve, mover's
//     perspective) between the position before and after the move. Missing
//     engine evals leave it null;
//   - ranking is `games × eval_loss` (games first when eval is unknown).
//
// The explorer is a public, rate-limited API: one request per second, 8 s
// timeout, every response cached in `theory_cache` for seven days under
// `lichess:<FEN>`. Cached rows are always preferred, and an unreachable
// upstream degrades to whatever the cache holds — never an exception.

import { Chess } from 'chess.js';
import { db } from '../db.js';
import { SCORING_VERSION, cpToWinPct, normalizeEval } from '../chess/classifier.js';
import { lookupOpeningByEpd, fenToEpd } from '../chess/openings.js';
import type { AnalyzedMove } from '../types.js';
import type { ExplorerMove, TheoryGap, TheoryGapPayload } from '../patterns/contracts.js';

export type TheoryColor = 'white' | 'black' | 'both';

const MAX_PLY = 24;
const DEFAULT_GAMES = 100;
const MIN_GAMES = 20;
const MAX_GAMES = 200;
const CACHE_TTL_DAYS = 7;
const FETCH_TIMEOUT_MS = 8_000;
const MIN_REQUEST_INTERVAL_MS = 1_000;
const EXPLORER_MOVES = 8;
const GAP_MAX_SHARE = 0.05;
const TOP_MIN_SHARE = 0.1;
const TOP_MIN_GAMES = 50;
const MAX_GAPS = 50;

const DEFAULT_BASE = 'https://explorer.lichess.ovh';
const USER_AGENT =
  'patzer (opening theory gaps; +https://github.com/SikamikanikoBG/patzer; contact: admin@example.com)';

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface TheoryScanOptions {
  color?: string | null;
  games?: string | number | null;
  /** Inject for tests — production uses the global fetch. */
  fetchImpl?: FetchLike;
  /** Inject for tests — production uses a real timer. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Request spacing. Tests set 0; production is 1 000 ms. */
  minIntervalMs?: number;
  maxPly?: number;
}

// Module-wide so concurrent scans share the 1 req/s budget. A failed upstream
// also short-circuits every later scan for a minute instead of hammering it.
let lastRequestAt = 0;
let upstreamDownUntil = 0;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Clamp the requested game window (default 100, 20–200). */
export function clampGames(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_GAMES;
  return Math.max(MIN_GAMES, Math.min(MAX_GAMES, Math.trunc(n)));
}

export function normalizeColor(raw: string | null | undefined): TheoryColor {
  return raw === 'white' || raw === 'black' ? raw : 'both';
}

function explorerBase(): string {
  return (process.env.LICHESS_EXPLORER_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Test hook: forget the rate-limit / outage bookkeeping. */
export function resetTheoryState(): void {
  lastRequestAt = 0;
  upstreamDownUntil = 0;
}

interface ExplorerBody {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
  total: number;
}

function parseExplorer(body: unknown): ExplorerBody | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as {
    white?: unknown; draws?: unknown; black?: unknown;
    moves?: Array<Record<string, unknown>>;
    opening?: { eco?: unknown; name?: unknown } | null;
  };
  const white = Number(r.white ?? 0);
  const draws = Number(r.draws ?? 0);
  const black = Number(r.black ?? 0);
  if (![white, draws, black].every(Number.isFinite)) return null;
  const moves: ExplorerMove[] = (Array.isArray(r.moves) ? r.moves : [])
    .filter((m) => typeof m?.san === 'string' && typeof m?.uci === 'string')
    .map((m) => ({
      san: String(m.san),
      uci: String(m.uci),
      games: Number(m.white ?? 0) + Number(m.draws ?? 0) + Number(m.black ?? 0),
      white: Number(m.white ?? 0),
      draws: Number(m.draws ?? 0),
      black: Number(m.black ?? 0),
    }))
    .filter((m) => Number.isFinite(m.games))
    .sort((a, b) => b.games - a.games)
    .slice(0, EXPLORER_MOVES);
  const total = white + draws + black || moves.reduce((sum, m) => sum + m.games, 0);
  const opening = r.opening && typeof r.opening.eco === 'string' && typeof r.opening.name === 'string'
    ? { eco: r.opening.eco, name: r.opening.name }
    : null;
  return { white, draws, black, moves, opening, total };
}

function readCache(fen: string): ExplorerBody | null {
  const row = db.prepare(
    `SELECT payload_json FROM theory_cache
      WHERE key = ? AND fetched_at > datetime('now', ?)`,
  ).get(`lichess:${fen}`, `-${CACHE_TTL_DAYS} days`) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    return parseExplorer(JSON.parse(row.payload_json));
  } catch {
    return null;
  }
}

function writeCache(fen: string, body: ExplorerBody): void {
  db.prepare(
    `INSERT INTO theory_cache (key, payload_json, fetched_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       payload_json = excluded.payload_json,
       fetched_at = datetime('now')`,
  ).run(`lichess:${fen}`, JSON.stringify(body));
}

async function fetchExplorer(
  fen: string,
  opts: Required<Pick<TheoryScanOptions, 'fetchImpl' | 'sleep' | 'now' | 'minIntervalMs'>>,
): Promise<ExplorerBody | null> {
  const now = opts.now();
  if (now < upstreamDownUntil) return null;

  const wait = opts.minIntervalMs - (now - lastRequestAt);
  if (wait > 0) await opts.sleep(wait);
  lastRequestAt = opts.now();

  const url =
    `${explorerBase()}/lichess?fen=${encodeURIComponent(fen)}` +
    `&speeds=blitz,rapid,classical&topGames=0&moves=${EXPLORER_MOVES}`;
  try {
    const res = await opts.fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const parsed = parseExplorer(await res.json());
    if (!parsed) throw new Error('unparseable explorer response');
    writeCache(fen, parsed);
    return parsed;
  } catch {
    // Back off for a minute: a dead explorer must not cost 20 timeouts per scan.
    upstreamDownUntil = opts.now() + 60_000;
    return null;
  }
}

interface GameRow {
  id: number;
  pgn: string;
  user_color: 'white' | 'black' | null;
  moves_json: string;
  eco: string | null;
  opening_name: string | null;
}

interface Candidate {
  gameId: number;
  ply: number;
  sanLine: string[];
  fen: string;
  san: string;
  uci: string | null;
  evalLoss: number | null;
  eco: string | null;
  name: string | null;
}

function winPctForMover(
  m: AnalyzedMove,
  sign: 1 | -1,
): { before: number; after: number } | null {
  const beforeKnown = m.eval_before_cp != null || m.mate_before != null;
  const afterKnown = m.eval_after_cp != null || m.mate_after != null;
  if (!beforeKnown || !afterKnown) return null;
  const before = cpToWinPct(sign * normalizeEval(m.eval_before_cp, m.mate_before, 'w'));
  const after = cpToWinPct(sign * normalizeEval(m.eval_after_cp, m.mate_after, 'w'));
  return { before, after };
}

function gameCandidates(row: GameRow, maxPly: number): Candidate[] {
  if (row.user_color !== 'white' && row.user_color !== 'black') return [];
  const chess = new Chess();
  try {
    chess.loadPgn(row.pgn, { strict: false });
  } catch {
    return [];
  }
  // Games from a custom position have no opening line to scan.
  if (chess.getHeaders().SetUp === '1') return [];

  const history = chess.history({ verbose: true });
  if (history.length === 0) return [];

  let analysed: AnalyzedMove[] = [];
  try { analysed = JSON.parse(row.moves_json) as AnalyzedMove[]; } catch { /* no verdicts */ }
  const byPly = new Map<number, AnalyzedMove>();
  if (Array.isArray(analysed)) {
    analysed.forEach((m, i) => {
      if (m && typeof m === 'object') byPly.set(Number(m.ply) || i + 1, m);
    });
  }

  const sign: 1 | -1 = row.user_color === 'white' ? 1 : -1;
  const replay = new Chess();
  const sans: string[] = [];
  const out: Candidate[] = [];
  const upper = Math.min(history.length, maxPly);

  for (let i = 0; i < upper; i++) {
    const move = history[i]!;
    const fenBefore = replay.fen();
    const ply = i + 1;
    const isUserMove = ply % 2 === (row.user_color === 'white' ? 1 : 0);
    sans.push(move.san);

    if (isUserMove) {
      const verdict = byPly.get(ply);
      const wp = verdict && verdict.san === move.san ? winPctForMover(verdict, sign) : null;
      const local = lookupOpeningByEpd(fenToEpd(fenBefore));
      out.push({
        gameId: row.id,
        ply,
        sanLine: sans.slice(),
        fen: fenBefore,
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ''}` || null,
        evalLoss: wp ? Math.max(0, wp.before - wp.after) : null,
        eco: local?.eco ?? row.eco,
        name: local?.name ?? row.opening_name,
      });
    }
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
  }
  return out;
}

function scannedGames(userId: number, color: TheoryColor, limit: number): GameRow[] {
  const rows = db.prepare(`
    SELECT g.id, g.pgn, g.user_color, a.moves_json,
           COALESCE(g.eco, a.opening_eco) AS eco,
           COALESCE(g.opening_name, a.opening_name) AS opening_name
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ? AND g.start_fen IS NULL
      AND g.user_color IS NOT NULL
    ORDER BY g.end_time DESC, g.id DESC
    LIMIT ?
  `).all(userId, SCORING_VERSION, limit) as GameRow[];
  return color === 'both' ? rows : rows.filter((r) => r.user_color === color);
}

/**
 * Scan one user's analysed games for opening theory gaps.
 *
 * Network failures never throw: they degrade to cached results, or to
 * `source: 'unavailable'` with an empty list.
 */
export async function scanTheoryGaps(
  userId: number,
  options: TheoryScanOptions = {},
): Promise<TheoryGapPayload> {
  const color = normalizeColor(options.color);
  const games = clampGames(options.games);
  const maxPly = options.maxPly ?? MAX_PLY;
  const opts = {
    fetchImpl: options.fetchImpl ?? (fetch as unknown as FetchLike),
    sleep: options.sleep ?? defaultSleep,
    now: options.now ?? (() => Date.now()),
    minIntervalMs: options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS,
  };

  const rows = scannedGames(userId, color, games);
  const candidates: Candidate[] = [];
  for (const row of rows) candidates.push(...gameCandidates(row, maxPly));

  // One explorer request per distinct position, cache first.
  const positions = new Map<string, ExplorerBody>();
  const reached = new Map<string, Set<number>>();
  for (const c of candidates) {
    if (!reached.has(c.fen)) reached.set(c.fen, new Set());
    reached.get(c.fen)!.add(c.gameId);
  }

  let networkHits = 0;
  for (const fen of reached.keys()) {
    const cached = readCache(fen);
    if (cached) {
      positions.set(fen, cached);
      continue;
    }
    const fetched = await fetchExplorer(fen, opts);
    if (fetched) {
      positions.set(fen, fetched);
      networkHits++;
    }
  }

  const dedupe = new Map<string, {
    gap: Omit<TheoryGap, 'games' | 'share' | 'eval_loss'> & {
      fen: string;
      eval_loss_sum: number;
      eval_n: number;
    };
    gameIds: Set<number>;
  }>();

  for (const c of candidates) {
    const explorer = positions.get(c.fen);
    if (!explorer || explorer.total <= 0 || explorer.moves.length === 0) continue;

    const top = explorer.moves[0]!;
    const topShare = top.games / explorer.total;
    if (top.games < TOP_MIN_GAMES || topShare < TOP_MIN_SHARE) continue;
    if (c.san === top.san) continue; // followed the main line

    const played = explorer.moves.find((m) => m.san === c.san);
    const playedShare = played ? played.games / explorer.total : 0;
    if (playedShare >= GAP_MAX_SHARE) continue;

    const key = `${c.sanLine.join(' ')}|${c.ply}`;
    let entry = dedupe.get(key);
    if (!entry) {
      entry = {
        gap: {
          eco: explorer.opening?.eco ?? c.eco,
          name: explorer.opening?.name ?? c.name,
          move_san: c.san,
          ply: c.ply,
          san_line: c.sanLine,
          explorer: explorer.moves,
          example_game_id: c.gameId,
          fen: c.fen,
          eval_loss_sum: 0,
          eval_n: 0,
        },
        gameIds: new Set(),
      };
      dedupe.set(key, entry);
    }
    entry.gameIds.add(c.gameId);
    if (c.evalLoss != null) {
      entry.gap.eval_loss_sum += c.evalLoss;
      entry.gap.eval_n += 1;
    }
  }

  const gaps: TheoryGap[] = [];
  for (const { gap, gameIds } of dedupe.values()) {
    const evalLoss = gap.eval_n > 0
      ? Math.round((gap.eval_loss_sum / gap.eval_n) * 10) / 10
      : null;
    // `fen` is the position before the move — the same node in every game
    // that reached this gap.
    const reachedCount = reached.get(gap.fen)?.size ?? 0;
    gaps.push({
      eco: gap.eco,
      name: gap.name,
      move_san: gap.move_san,
      ply: gap.ply,
      san_line: gap.san_line,
      games: gameIds.size,
      share: reachedCount > 0 ? Math.round((gameIds.size / reachedCount) * 1000) / 1000 : 0,
      eval_loss: evalLoss,
      explorer: gap.explorer,
      example_game_id: gap.example_game_id,
    });
  }

  gaps.sort((a, b) => {
    const rank = (g: TheoryGap) => g.games * (g.eval_loss ?? 0);
    return rank(b) - rank(a) || b.games - a.games || a.ply - b.ply;
  });

  let source: TheoryGapPayload['source'];
  if (positions.size === 0) {
    source = candidates.length === 0 ? 'local-book' : 'unavailable';
  } else {
    source = networkHits > 0 ? 'lichess-explorer' : 'local-book';
  }

  return {
    generated_at: new Date().toISOString(),
    color,
    scanned_games: rows.length,
    gaps: gaps.slice(0, MAX_GAPS),
    source,
  };
}
