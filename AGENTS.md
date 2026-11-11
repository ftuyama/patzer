# AGENTS.md

Guidance for AI coding agents working in this repository (Patzer, a self-hosted,
AI-coached chess app). Read this before making changes.

## Non-negotiable: never delete the user's cookies or browser sessions

**NEVER clear, delete, or reset the user's cookies, localStorage, IndexedDB,
site data, or logged-in sessions — in any browser, for any site.**

This applies to every browser tool (Playwright, brave-devtools, the in-app
browser) and to every profile. It is the user's real browser with their real
logins.

- Do not call `context.clearCookies()`, `Network.clearBrowserCookies`,
  `Storage.clearDataForOrigin`, `localStorage.clear()`, `sessionStorage.clear()`,
  `indexedDB.deleteDatabase()`, or any equivalent "clear site data" action.
- Do not delete or reset the browser profile directory.
- If a test genuinely needs a logged-out state, use an isolated/incognito browser
  context instead, and only touch the app's own domain (e.g.
  `clearCookies({ domain: "localhost" })`) after asking the user first.
- When in doubt, stop and ask. Losing a login is destructive and unrecoverable.

The same spirit applies to app data: **do not delete `data/` (SQLite DB, uploads),
`bin/` (Stockfish binary), or `.env`**. They are user state, not build artifacts.

## What this project is

Patzer = self-hosted Chess.com alternative. Node 20.11+ monorepo (npm workspaces:
`server`, `web`). Server is Hono + SQLite (better-sqlite3) + Stockfish UCI +
an Ollama/vLLM/DeepSeek coach. Web is React 18 + Vite + Tailwind + zustand +
react-query.

## Setup and commands

```bash
npm install
npm run setup        # downloads Stockfish 17 into ./bin/
npm run dev          # server :8800 + Vite :5173 (open http://localhost:5173)
```

Before considering any change done:

```bash
npm run typecheck    # tsc -b server web + server/test
npm test             # vitest
npm run build        # server tsc + web vite build
```

Targeted suites (each boots a real server on a throwaway DB):

```bash
npm run test:e2e        # PvP protocol over WebSocket      (touch ws/play.ts)
npm run test:resume     # reconnect/resume
npm run test:oidc       # SSO against a real OIDC provider (touch auth/oidc.ts)
npm run test:ui         # two real browsers clicking the board (needs playwright)
npm run test:resume-ui
npm run verify:lessons  # Stockfish audits lesson answers (needs ./bin Stockfish)
```

Playwright is deliberately **not** a project dependency:
`npm i -D playwright && npx playwright install chromium` only when needed.

## Repo layout

```
server/                 Node + Hono API, SQLite, Stockfish driver, Ollama client
  src/auth/             sessions, password hashing, middleware, OIDC
  src/chess/            Stockfish UCI, move classifier, glicko, chess.com import
  src/coach/            Ollama client, prompt assembly, contradiction check
  src/routes/           HTTP routes (zod-validated)
  src/ws/               WebSocket handlers (Play, Lobby)
  src/db.ts             schema + migrations
server/test/            unit/integration tests (kept out of dist)
web/src/components/     reusable UI (board, eval bar, captured pieces, …)
web/src/pages/          route-level pages
web/src/learn/          lesson content data + types
web/src/locales/        i18next dictionaries (UI + learn/)
web/src/lib/            sounds, TTS, markdown, helpers
scripts/                setup, lesson verification, tactics build, backfills
data/                   runtime SQLite DB — user data, never commit or delete
bin/                    Stockfish binary — installed by npm run setup
worktrees/              agent checkouts, gitignored (see below)
```

## Worktrees

Keep every worktree inside the checkout, never as a sibling directory:

```bash
git worktree add worktrees/<name> -b <branch>
```

`worktrees/` is gitignored. Agent tooling is configured to put new worktrees
there too (`worktree.directory` in the OpenCode config). Each worktree gets its
own `data/` SQLite DB, which is user state — do not delete it when removing a
worktree, and remove with `git worktree remove <path>` (ask first if the DB has
real data).

## Invariants (do not break these)

1. **The coach teaches, the server analyses.** The LLM never computes chess
   facts. `server/src/coach/coaching.ts` pre-computes them from Stockfish,
   chess.js and player history (`tactics.ts`, `memory.ts`), then
   `contradiction()` checks the answer against the engine verdict. If you need
   a fact, compute it server-side — never ask the model to figure it out.
2. **No user-facing config in env vars.** Runtime-changeable settings live in
   SQLite (Admin → System or Settings). Env vars are operational only
   (`PORT`, `DB_PATH`, `STOCKFISH_PATH`, `SESSION_SECRET`, …).
3. **Local-first.** No cloud dependencies, telemetry, or hosted features.
4. Standard chess only. Variants (960, king-of-the-hill, 3check) are out of scope.
5. **Every change ships with tests.** A bug fix needs a regression test that
   fails without the fix. Anything touching an external service (LLM, Lichess,
   chess.com) must be tested against a local fake that serves the real routes.

## Code style

- TypeScript strict; avoid `any` (justify with an eslint-disable if truly needed).
- Server is ESM: use `.js` extensions in relative imports.
- Tailwind for styling; custom CSS only for chessground overrides in
  `web/src/index.css`.
- Comments explain **why**, not what.
- Write commit messages in the imperative mood. Add a `## [Unreleased]` entry to
  `CHANGELOG.md` for user-visible changes.

## Localization

Every user-visible string is translated (en, bg, es, de, ru). Never hardcode
English in components: add a key to `web/src/locales/en.json` and the other
locales. Lesson text lives separately from lesson positions:

- `web/src/learn/content/<level>.json` — positions/solutions (no words)
- `web/src/locales/learn/<lang>.json` — the words, keyed `<lessonId>.<stepId>`

A translation can never change a solution. Adding a language is one entry per
table (see CONTRIBUTING.md); avoid `if (language === …)` branches.

## Tests and fixtures

- Unit tests: `server/test/*.test.ts`, and `*.test.ts(x)` next to web components.
- Component tests opt into happy-dom with a
  `// @vitest-environment happy-dom` pragma.
- If you touch `classifier.ts` or `glicko.ts`, extend the matching suite.
- Lesson content is validated by `web/src/learn/content.test.ts` (legality,
  mates, par, text presence) plus `npm run verify:lessons` (Stockfish).

## Things to avoid

- Adding heavy dependencies for small features.
- New top-level pages or major UX changes without a prior issue.
- Committing `data/`, `bin/`, `.env`, or build output.
- Rewriting/deleting files you did not need to change — investigate first.
