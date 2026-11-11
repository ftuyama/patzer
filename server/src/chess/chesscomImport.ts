// Chess.com games → `games` rows. Shared by the "Import" button and any other
// caller that needs chess.com games deduped and labelled identically.

import { db } from '../db.js';
import { fetchRecentGames, getPlayerRatings, type ChessComGame } from './chesscom.js';

export async function importChessComGames(userId: number, username: string, limit: number): Promise<{ imported: number; total: number; ratings: number }> {
  const [games, chesscomRatings] = await Promise.all([
    fetchRecentGames(username, limit),
    getPlayerRatings(username),
  ]);

  // Playing on chess.com is not playing here: the games stay unrated in
  // Patzer's Glicko pool. Their chess.com rating is stored separately so the
  // home screen has a number to show for an imported-only profile.
  const ratings = chesscomRatings ? saveExternalRatings(userId, 'chesscom', chesscomRatings) : 0;

  // Imported chess.com games are NEVER rated in Patzer's pool — they have their
  // own chess.com rating that lives there. Only PvP games inside Patzer count.
  const stmt = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated)
    VALUES (?, 'chesscom', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);

  const lcUsername = username.toLowerCase();
  let imported = 0;
  for (const g of games) {
    const userColor: 'white' | 'black' | null =
      g.white.username.toLowerCase() === lcUsername ? 'white' :
      g.black.username.toLowerCase() === lcUsername ? 'black' : null;
    const result = resultFor(g, userColor);
    // chess.com sends `time_class` directly — use it as the source of truth.
    const timeClass = ['bullet', 'blitz', 'rapid', 'daily'].includes(g.time_class) ? g.time_class : null;
    const r = stmt.run(
      userId,
      g.url,
      g.pgn,
      g.white.username,
      g.black.username,
      result,
      g.time_control,
      timeClass,
      new Date(g.end_time * 1000).toISOString(),
      userColor,
    );
    if (r.changes > 0) imported++;
  }
  return { imported, total: games.length, ratings };
}

/** Upsert one source's per-time-class numbers. Returns how many rows it wrote;
 *  an empty map (a player who never played a rated game there) writes none. */
export function saveExternalRatings(
  userId: number,
  source: string,
  ratings: Partial<Record<string, number>>,
): number {
  const stmt = db.prepare(`
    INSERT INTO external_ratings (user_id, source, time_class, rating, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, source, time_class) DO UPDATE SET
      rating = excluded.rating,
      updated_at = excluded.updated_at
  `);
  let written = 0;
  for (const [timeClass, rating] of Object.entries(ratings)) {
    if (typeof rating !== 'number' || !Number.isFinite(rating)) continue;
    stmt.run(userId, source, timeClass, Math.round(rating));
    written++;
  }
  return written;
}

function resultFor(g: ChessComGame, userColor: 'white' | 'black' | null): string {
  if (!userColor) return g.white.result;
  const r = userColor === 'white' ? g.white.result : g.black.result;
  if (r === 'win') return 'win';
  if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(r)) return 'draw';
  return 'loss';
}
