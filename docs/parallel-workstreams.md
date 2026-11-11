# Parallel workstreams — contracts and file ownership

Wave 0 landed the shared scaffolding so four features can be built in parallel
without touching the same files. **The rule is one owner per file.** If you
need a change in someone else's file, send the patch to the owner; do not edit
it "quickly".

## What Wave 0 already provides (do not re-create)

| Thing | Location | Notes |
|---|---|---|
| Tables | `server/src/db.ts` | `error_events`, `pattern_snapshots`, `weekly_reports`, `theory_cache` — created idempotently at boot |
| Event store | `server/src/patterns/store.ts` | `recordGameEvents`, `listEvents`, `analysedGameCount`, `upsertPatternSnapshot`, `listPatternSnapshots`, `saveWeeklyReport`, `listWeeklyReports`, `hasEventsForGame`, `hasWeeklyReport` |
| API contracts | `server/src/patterns/contracts.ts` | `DiagnosisPayload`, `WeeklyProgressPayload`, `DrillPayload`, `TheoryGapPayload`, … |
| Web mirror of the contracts | `web/src/types.ts` | `PatternSummary`, `WeeklyProgressWeek`, `DrillPayload`, `TheoryGapPayload` |
| Pattern version | `server/src/chess/patterns.ts` | `PATTERN_VERSION = 1` — bump only with a backfill |
| Routes mounted | `server/src/index.ts` | `/api/progress`, `/api/train/drill`, `/api/openings/theory` (all `501` stubs today) |
| Web route + nav + palette + i18n | `App.tsx`, `Layout.tsx`, `CommandPalette.tsx`, `locales/*.json` | `/progress` page placeholder; `progress.*`, `train.drill.*`, `openings.theory.*` keys in **en, de, ru, pt** |

Locale rule: `de` and `ru` must keep **exact key parity** with `en`
(`locales.test.ts`). `pt`, `bg`, `es` may be partial. If you add an English
key, add the German and Russian translations in the same commit.

## Ownership matrix

| Workstream | Owns (exclusive) | Must not edit |
|---|---|---|
| **A — Persistence** | `scripts/backfill-patterns.ts` (new), the post-save block in `server/src/routes/analyze.ts`, `server/src/routes/diagnosis.ts` | `store.ts`, `index.ts` |
| **B — Pattern drills** | `server/src/routes/drill.ts`, `server/src/chess/drills.ts` (new), `web/src/pages/Train.tsx`, `web/src/components/DrillBoard.tsx` (new) | `train.ts` (unless coordinating), `store.ts` |
| **C — Progress** | `server/src/routes/progress.ts`, `server/src/patterns/report.ts` (new), `web/src/pages/Progress.tsx` | `diagnosis.ts`, `store.ts` |
| **D — Opening gaps** | `server/src/routes/theory.ts`, `server/src/openings/theory.ts` (new), the theory section of `web/src/pages/Openings.tsx` | `store.ts` |
| **E — Local mode / infra** | `server/src/config.ts`, `server/src/localMode.ts` (new), `server/src/routes/setup.ts`, the auth-gating block of `web/src/App.tsx`, `package.json`, `Dockerfile`, `docker-compose.yml`, README | `index.ts` route table |
| **F — Quality harness** | `server/test/patterns/*.test.ts` (new only) | everything else |

## Contract details

### A — Persistence
- Hook: after an analysis row is written, call
  `detectGamePatterns(moves, meta, split)` and
  `recordGameEvents(userId, gameId, events)`. Wrap in `try/catch`: a pattern
  failure must never fail the analysis response.
- Backfill CLI: for every `analyses` row with
  `scoring_version >= SCORING_VERSION` and no current-version events, run the
  detector and record. Idempotent; report progress with `--dry-run` and
  `--limit`.
- `GET /api/diagnosis` should switch from parsing `moves_json` to
  `listEvents(userId, { limitGames })` **while keeping the response byte-shape
  identical** (`DiagnosisPayload`). Keep the 60 s cache. Fall back to live
  detection when a game has no events yet, so the page never goes blank.

### B — Drills
- `GET /api/train/drill?pattern=<key|mixed>&count=10&mode=find_best|spot_threat`
- Source positions from `listEvents` filtered by motif, newest and severest
  first, de-duplicated by `(fen, best_uci)`. Never return a position without a
  `best_san`/`best_uci`.
- `solution_uci` = `best_move_uci` + the stored `best_pv`; clients validate
  move 1 only.
- `spot_threat` mode: same position, but the prompt asks what the opponent
  threatens and the answer is the engine's best reply — reuse the existing
  trainer's board component rather than a new one.
- Attempts are recorded through the existing `POST /api/train/attempt`
  contract (`game_id` + `ply` already identify the puzzle).

### C — Progress
- `GET /api/progress?weeks=12` → `WeeklyProgressPayload`.
- Current week is computed live (`partial: true`); closed weeks read from
  `weekly_reports` / `pattern_snapshots`, generating and freezing them on first
  read (`saveWeeklyReport`, `upsertPatternSnapshot`).
- Report text is templated (no LLM): 3–5 sentences naming the top motif, the
  accuracy delta and one concrete next step. Language: the user's
  `profile.language`, falling back to English; store the rendered text in
  `summary_text` so it never changes retroactively.

### D — Theory gaps
- `GET /api/openings/theory?color=white|black|both&games=100` →
  `TheoryGapPayload`.
- Walk the user's moves up to ply 24, query
  `https://explorer.lichess.ovh/lichess?fen=<FEN>&speeds=blitz,rapid,classical&topGames=0&moves=8`
  and cache every response in `theory_cache` (7 days).
- A *gap* is a user move the explorer plays in < 5 % of games while the
  explorer's top move has ≥ 50 games. Rank by `games × eval_loss`.
- Network failure → `source: 'unavailable'` with an empty gap list, never a 500.
  Respect a 1 request/second budget.

### E — Local mode
- `LOCAL_MODE=1` (or `CHESS_LOCAL=1`): single-user install. Bind `127.0.0.1`
  by default, skip the setup wizard, auto-create/auto-login the local user,
  hide sign-up/admin invite UI.
- This touches the auth-gating block in `web/src/App.tsx`; coordinate with the
  other streams before merging so the block is edited once.
- Rename remains a separate decision — leave `app.name` alone until told.

### F — Quality harness
- Label a small set of positions (JSON fixtures) with expected motif keys;
  assert recall/precision for `detectGamePatterns`.
- Add store tests: record → list → re-record is idempotent; `limitGames`
  window boundary; snapshot upsert replaces a week.
- No production file may change to make a test pass without an owner's review.

## Merge order

```
Wave 0 (this commit)
  ├─ A (persistence)      → merge first
  ├─ B, C, D (parallel)   → any order after A
  ├─ E (local mode)       → last, touches App.tsx
  └─ F (tests)            → can merge at any time
```

Each branch must pass `npm run typecheck && npm test` before it is proposed.
Backfills or migrations that rewrite rows must be safe to run twice.

## Definition of done per stream

- Route implements the exact `contracts.ts` shape; the stub `501` is gone.
- Web page consumes it with loading/empty/error states.
- New i18n keys exist in `en`, `de`, `ru` (parity) and `pt`.
- Tests cover the non-obvious branch (window boundary, empty data, network
  failure, idempotency).
- No file outside the owner's column is modified.
