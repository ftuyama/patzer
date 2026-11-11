// Chess.com public API client. The API is unauthenticated but requires a User-Agent.

import type { TimeClass } from './timeClass.js';

const UA = 'patzer/3.1 (+https://github.com/SikamikanikoBG/patzer)';

// Chess.com usernames are 3–25 chars; we extend slightly for historical grandfathered handles.
const USERNAME_RE = /^[A-Za-z0-9_-]{2,40}$/;
function assertValidUsername(u: string): void {
  if (!USERNAME_RE.test(u)) throw new Error('invalid_username');
}

// Archive URLs come back from chess.com itself, but defense in depth: confirm
// each is on api.chess.com/pub/ before we GET it. Prevents an SSRF-style pivot
// if the archive list is ever influenced by an attacker.
function assertChessComUrl(u: string): void {
  let parsed: URL;
  try { parsed = new URL(u); } catch { throw new Error('invalid_url'); }
  if (parsed.protocol !== 'https:' || parsed.host !== 'api.chess.com' || !parsed.pathname.startsWith('/pub/')) {
    throw new Error('invalid_url');
  }
}

interface Archive { url: string }
interface ArchivesResponse { archives: string[] }

export interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

interface MonthlyArchive { games: ChessComGame[] }

async function get(url: string): Promise<unknown> {
  // 15s ceiling: stops a slow chess.com response from pinning a request handler.
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) throw new Error(`chesscom_${res.status}`);
  return res.json();
}

export async function getPlayer(username: string): Promise<{ username: string; avatar?: string; country?: string } | null> {
  try {
    assertValidUsername(username);
    const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`)) as Record<string, unknown>;
    return {
      username: String(data.username ?? username),
      avatar: typeof data.avatar === 'string' ? data.avatar : undefined,
      country: typeof data.country === 'string' ? data.country : undefined,
    };
  } catch {
    return null;
  }
}

export async function listArchives(username: string): Promise<string[]> {
  assertValidUsername(username);
  const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`)) as ArchivesResponse;
  return (data.archives ?? []).filter((u) => {
    try { assertChessComUrl(u); return true; } catch { return false; }
  });
}

export async function getMonth(archiveUrl: string): Promise<ChessComGame[]> {
  assertChessComUrl(archiveUrl);
  const data = (await get(archiveUrl)) as MonthlyArchive;
  return data.games ?? [];
}

// Fetch the most recent N games for a user, walking archives backwards in time.
export async function fetchRecentGames(username: string, limit: number): Promise<ChessComGame[]> {
  assertValidUsername(username);
  const archives = await listArchives(username);
  const out: ChessComGame[] = [];
  for (let i = archives.length - 1; i >= 0 && out.length < limit; i--) {
    const url = archives[i];
    if (!url) continue;
    const games = await getMonth(url);
    // Skip variants — we only analyze standard chess; importing king-of-the-hill
    // games and feeding them to a standard-chess classifier produces nonsense.
    const standard = games.filter((g) => g.rules === 'chess');
    standard.sort((a, b) => b.end_time - a.end_time);
    for (const g of standard) {
      out.push(g);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The four per-time-class ratings from chess.com's public stats endpoint.
 *  Returns null when the player has no chess.com account or the endpoint is
 *  down: an import must still succeed with games even if stats do not. */
export async function getPlayerRatings(username: string): Promise<Partial<Record<TimeClass, number>> | null> {
  try {
    assertValidUsername(username);
    const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`)) as Record<string, unknown>;
    return normalizeStats(data);
  } catch {
    return null;
  }
}

// chess.com keys its stats by rule set; Patzer collapses classical into rapid,
// exactly like `classifyTimeControl` does.
export function normalizeStats(data: Record<string, unknown>): Partial<Record<TimeClass, number>> {
  const sources: [string, TimeClass][] = [
    ['chess_bullet', 'bullet'],
    ['chess_blitz', 'blitz'],
    ['chess_rapid', 'rapid'],
    ['chess_daily', 'daily'],
  ];
  const out: Partial<Record<TimeClass, number>> = {};
  for (const [key, tc] of sources) {
    const last = (data[key] as { last?: { rating?: unknown } } | undefined)?.last;
    const rating = last?.rating;
    if (typeof rating === 'number' && Number.isFinite(rating) && rating > 0) {
      out[tc] = Math.round(rating);
    }
  }
  return out;
}
