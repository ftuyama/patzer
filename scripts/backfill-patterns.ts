// Backfill the pattern read model (`error_events`) for analyses that predate
// the event store — or for a PATTERN_VERSION bump. Reads every analysis at the
// current SCORING_VERSION, re-runs the pure detector and records the events.
//
// Idempotent: games that already have current-version events are skipped, and
// recording replaces a game's previous rows. Safe to run twice, or to stop and
// resume with --limit.
//
// Usage:
//   npm run patterns:backfill                  # every eligible game
//   npm run patterns:backfill -- --dry-run     # report only
//   npm run patterns:backfill -- --limit 50    # examine the 50 newest games
//   npm run patterns:backfill -- --user 3      # one user
//
// --limit caps the number of analysis rows examined (newest first), so a
// dry-run with the same flag predicts the real run exactly.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameMeta } from '../server/src/chess/patterns.js';
import type { AnalyzedMove, PhaseSplit } from '../server/src/types.js';

// The repo root package.json is CommonJS, so a script under scripts/ is loaded
// as CJS by tsx and `import.meta.dirname` inside server/src/config.ts would be
// undefined. Import the server modules with dynamic import() instead: they
// live under server/package.json ("type": "module") and load as ESM, exactly
// as they do when the server itself runs.
type ServerModules = {
  db: typeof import('../server/src/db.js')['db'];
  SCORING_VERSION: typeof import('../server/src/chess/classifier.js')['SCORING_VERSION'];
  PATTERN_VERSION: typeof import('../server/src/chess/patterns.js')['PATTERN_VERSION'];
  detectGamePatterns: typeof import('../server/src/chess/patterns.js')['detectGamePatterns'];
  hasEventsForGame: typeof import('../server/src/patterns/store.js')['hasEventsForGame'];
  recordGameEvents: typeof import('../server/src/patterns/store.js')['recordGameEvents'];
};

let modulesPromise: Promise<ServerModules> | null = null;

function serverModules(): Promise<ServerModules> {
  modulesPromise ??= (async () => {
    const [{ db }, classifier, patterns, store] = await Promise.all([
      import('../server/src/db.js'),
      import('../server/src/chess/classifier.js'),
      import('../server/src/chess/patterns.js'),
      import('../server/src/patterns/store.js'),
    ]);
    return {
      db,
      SCORING_VERSION: classifier.SCORING_VERSION,
      PATTERN_VERSION: patterns.PATTERN_VERSION,
      detectGamePatterns: patterns.detectGamePatterns,
      hasEventsForGame: store.hasEventsForGame,
      recordGameEvents: store.recordGameEvents,
    };
  })();
  return modulesPromise;
}

export interface BackfillOptions {
  dryRun?: boolean;
  limit?: number | null;
  user?: number | null;
}

export interface BackfillSummary {
  version: number;
  scoringVersion: number;
  /** Analysis rows examined. */
  scanned: number;
  /** Games that had no current-version events (would be / were recorded). */
  pending: number;
  /** Games actually written (always 0 with --dry-run). */
  recorded: number;
  /** Games already at PATTERN_VERSION. */
  skipped: number;
  failed: number;
  events: number;
}

interface CandidateRow {
  game_id: number;
  user_id: number;
  user_color: 'white' | 'black' | null;
  end_time: string | null;
  white: string | null;
  black: string | null;
  result: string | null;
  moves_json: string;
  phase_split_json: string | null;
  opening_eco: string | null;
  opening_name: string | null;
}

function candidates(m: ServerModules, opts: BackfillOptions): CandidateRow[] {
  const params: Record<string, unknown> = { version: m.SCORING_VERSION };
  const where = [
    'a.scoring_version >= @version',
    "(g.start_fen IS NULL OR g.start_fen = '')",
  ];
  if (opts.user != null) {
    where.push('g.user_id = @user');
    params.user = opts.user;
  }
  let sql = `
    SELECT g.id AS game_id, g.user_id, g.user_color, g.end_time,
           g.white, g.black, g.result,
           a.moves_json, a.phase_split_json, a.opening_eco, a.opening_name
      FROM analyses a JOIN games g ON g.id = a.game_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(g.end_time, g.created_at) DESC, g.id DESC
  `;
  if (opts.limit != null && opts.limit > 0) {
    sql += ' LIMIT @limit';
    params.limit = opts.limit;
  }
  return m.db.prepare(sql).all(params) as CandidateRow[];
}

export async function runBackfill(opts: BackfillOptions = {}): Promise<BackfillSummary> {
  const m = await serverModules();
  const summary: BackfillSummary = {
    version: m.PATTERN_VERSION,
    scoringVersion: m.SCORING_VERSION,
    scanned: 0, pending: 0, recorded: 0, skipped: 0, failed: 0, events: 0,
  };

  for (const row of candidates(m, opts)) {
    summary.scanned++;
    // Never re-detect what the store already has at this version.
    if (m.hasEventsForGame(row.game_id, m.PATTERN_VERSION)) {
      summary.skipped++;
      continue;
    }
    summary.pending++;

    let moves: AnalyzedMove[] = [];
    try { moves = JSON.parse(row.moves_json) as AnalyzedMove[]; } catch { moves = []; }
    const split = row.phase_split_json
      ? (JSON.parse(row.phase_split_json) as PhaseSplit)
      : null;
    const color = row.user_color ?? 'white';
    const meta: GameMeta = {
      game_id: row.game_id,
      user_color: color,
      end_time: row.end_time,
      eco: row.opening_eco,
      opening_name: row.opening_name,
      opponent: color === 'white' ? row.black : row.white,
      result: row.result,
    };

    try {
      const events = m.detectGamePatterns(moves, meta, split);
      if (!opts.dryRun) {
        m.recordGameEvents(row.user_id, row.game_id, events);
        summary.recorded++;
      }
      summary.events += events.length;
    } catch (err) {
      summary.failed++;
      console.warn(`[patterns:backfill] game ${row.game_id}:`, err instanceof Error ? err.message : err);
    }
  }

  return summary;
}

function parseArgs(argv: string[]): BackfillOptions & { help?: boolean } {
  const out: BackfillOptions & { help?: boolean } = { dryRun: false, limit: null, user: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.split('=', 2);
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--limit') {
      const n = Number(value());
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit must be a positive integer');
      out.limit = n;
    } else if (flag === '--user') {
      const n = Number(value());
      if (!Number.isInteger(n) || n <= 0) throw new Error('--user must be a user id');
      out.user = n;
    } else if (flag === '--help' || flag === '-h') out.help = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return out;
}

async function main(): Promise<void> {
  let opts: BackfillOptions & { help?: boolean };
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error('usage: backfill-patterns [--dry-run] [--limit N] [--user ID]');
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log('usage: backfill-patterns [--dry-run] [--limit N] [--user ID]');
    return;
  }

  const summary = await runBackfill(opts);
  const suffix = opts.dryRun ? ' (dry run — nothing written)' : '';
  console.log(`[patterns:backfill] v${summary.version} / scoring v${summary.scoringVersion}${suffix}`);
  console.log(`  scanned ${summary.scanned} · skipped ${summary.skipped} · pending ${summary.pending}`);
  console.log(`  recorded ${summary.recorded} games · ${summary.events} events · ${summary.failed} failed`);
  if (summary.failed > 0) process.exitCode = 1;
}

// Only run when invoked as a script (vitest imports runBackfill directly).
const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invoked && invoked === import.meta.url) void main();
