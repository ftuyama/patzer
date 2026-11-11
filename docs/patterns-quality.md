# Pattern detection quality

Measurement harness for `detectGamePatterns` (`server/src/chess/patterns.ts`).
It is deliberately **measurement only**: no production code depends on it, and a
fixture never gets "fixed" by loosening a label. If a fixture exposes a detector
bug, the label stays correct, the bug is documented below, and the reproduction
is an `it.fails` in `detection-quality.test.ts`.

```
server/test/patterns/
  fixtures/labelled.ts        hand-labelled positions, one block per motif
  fixtures/index.ts           chess.js loader + legality/continuity checks
  detection-quality.test.ts   precision/recall, negatives, version guard, known bugs
  summary.test.ts             ranking, recency, shrinkage, trend, breakdowns
```

Run just this harness (no engine, no network, no DB):

```sh
npx vitest run server/test/patterns
```

## The fixture set

27 fixtures: 21 positive, 6 negative. Every motif has at least two labelled
examples, and every fixture is replayed through `chess.js` by the test, so an
illegal FEN/SAN fails loudly instead of skewing the numbers.

| motif | labelled fixtures |
|---|---|
| `hung_piece` | 4 |
| `fork_exposed` | 3 |
| `allowed_mate` | 4 |
| `missed_win` | 3 |
| `back_rank` | 2 |
| `opening_leak` | 4 |
| `endgame_drift` | 2 |
| `promising_to_losing` | 2 |
| `queen_sortie` | 2 |

The negative fixtures cover: a quiet `good` move, a sound sacrifice
(`brilliant`), a forced recapture, a `book` move, a sub-40 cp mistake, and a
real positional mistake that has no structural motif. All six must produce
**zero** events.

## Measured precision / recall

Measured 2026-11-11 against `PATTERN_VERSION = 1`; 21 positive fixtures, 6
negative. Precision is per fixture set (`TP / (TP + FP)`), recall is
`TP / (TP + FN)`.

| motif | fixtures | precision | recall | TP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| `hung_piece` | 4 | 1.00 | 1.00 | 4 | 0 | 0 |
| `fork_exposed` | 3 | 1.00 | 1.00 | 3 | 0 | 0 |
| `allowed_mate` | 4 | 1.00 | 1.00 | 4 | 0 | 0 |
| `missed_win` | 3 | 1.00 | 1.00 | 3 | 0 | 0 |
| `back_rank` | 2 | 1.00 | 1.00 | 2 | 0 | 0 |
| `opening_leak` | 4 | 1.00 | 1.00 | 4 | 0 | 0 |
| `endgame_drift` | 2 | 1.00 | 1.00 | 2 | 0 | 0 |
| `promising_to_losing` | 2 | 1.00 | 1.00 | 2 | 0 | 0 |
| `queen_sortie` | 2 | 1.00 | 1.00 | 2 | 0 | 0 |
| **micro** | 27 | **1.00** | **1.00** | 26 | 0 | 0 |

26 TPs is the sum over motifs; a fixture such as
`promising_to_losing_black` contributes two TPs to two different rows.

## What the thresholds mean

`QUALITY_THRESHOLDS` is the single exported object in
`detection-quality.test.ts`:

* `per_motif[key].precision` / `.recall` — minimum for that motif. Currently
  `1.0` because every curated example is classified exactly. As real-world
  fixtures are added the first measurement will be lower; set the floor to the
  measured value (never below it) and note the change here.
* `micro.precision` / `micro.recall` — the same numbers pooled over all motifs,
  so one weak motif cannot hide behind eight perfect ones.
* `min_fixtures_per_motif` — guards against a motif silently losing coverage.
* `pattern_version` — must equal `EXPECTED_PATTERN_VERSION`, which must equal
  `PATTERN_VERSION` from `patterns.ts`. This is the regression guard: bumping
  the detector version without a deliberate review of the fixtures, thresholds
  and this table fails the test with a message explaining what to do.

Ratcheting process: change the detector → run the harness → if numbers improve,
raise the floor and update the table in the same commit. If they get worse, the
test fails; either fix the detector or record a reviewed, explicit exception.

## How to add a fixture

1. Pick a position and the move the analysed player actually made. Keep it
   legal and make both `eval_before_cp` and `eval_after_cp` realistic
   (white-perspective centipawns, as stored in the DB). Use
   `mate_before`/`mate_after` for mate scores (positive = White mates).
2. Add an object to `POSITIVE_FIXTURES` (or `NEGATIVE_FIXTURES`) in
   `fixtures/labelled.ts`:
   * `id` — unique, descriptive.
   * `user_color` — the analysed player. `ply` parity must match (odd = White,
     even = Black); the loader rejects a mismatch.
   * `end_time` — needed for recency/trend maths; ISO is fine.
   * `expected` — the **exact** motif set, not a superset. Multi-motif answers
     are normal (e.g. an opening trap that allows mate is both `allowed_mate`
     and `opening_leak`).
   * `moves` — use `fen_before` + `san` + `ply` + `classification` + evals +
     `centipawn_loss`. For a full game set `continuous: true`; the loader then
     checks every move starts where the previous one ended.
3. Run `npx vitest run server/test/patterns`. The failure message names the
   fixture and the predicted/expected sets.
4. If the detector disagrees with your label, decide which is wrong. If the
   label is right, add an `it.fails` reproduction to
   `detection-quality.test.ts` and a bullet under *Known weaknesses* below.
   Do **not** edit `patterns.ts` from this workstream.
5. Update the table above. If coverage crossed a motif below two fixtures,
   add another one.

Legality is checked by replaying `fen_before` and the SAN through `chess.js`.
Evals are validated for presence, not accuracy; the reviewer is responsible for
plausible numbers.

## Known weaknesses / false-positive risks

These are properties of the current heuristics (`PATTERN_VERSION = 1`), found
while labelling the fixtures. The two reproduced bugs are marked `it.fails` in
`detection-quality.test.ts`.

### `hung_piece`
* **False positive, reproduced:** when no specific motif fires and
  `cp_loss >= 200`, the fallback labels the move `hung_piece` even if nothing
  was actually hanging. Repro: a quiet `h3` positional blunder worth 260 cp in
  `1r4k1/5ppp/8/8/8/8/5PPP/1R4K1 w - - 0 1`.
* "Hanging" is attacker/defender counting, not a static exchange: a piece that
  is attacked by something cheaper counts as hanging even when recapturing is
  fine, and pinned/overloaded defenders are not modelled.
* Only pieces attacked *immediately after* the move are seen. A piece lost to a
  two-move fork or a discovered attack is not `hung_piece`; it may fall through
  to the `cp_loss >= 200` fallback instead.
* A piece that was already hanging at its origin and moves while still hanging
  is explicitly excluded (`wasHanging` filter), so "ignored a hanging piece"
  can produce no event at all.

### `fork_exposed`
* Misnamed: it fires for **any** move that leaves two or more of the player's
  pieces newly hanging (total value ≥ 3). There need not be a fork, and a
  genuine fork *by the player* is not detected at all.
* One abandoned defender commonly exposes two pieces, so this motif over-fires
  in positions where the "fork" is really just a loose piece plus a second
  attacker.

### `allowed_mate`
* Only a mate **in one** for the opponent immediately after the move counts.
  Mate in two or a forced-mate pattern is invisible.
* `passTurn` refuses positions where the side to move is in check, so a move
  that leaves the player in check may not be checked for a mating reply.
* Any detected mate also suppresses `missed_win` for `miss` moves (by design),
  so the two labels are mutually exclusive on the same ply.

### `missed_win`
* Fires for every move the classifier labels `miss`, with no independent check
  that a win was actually available. It inherits every classifier limitation:
  a +1.5 positional edge counts as a "win", and a mate-score glitch can create
  a phantom miss.
* Suppressed when `allowed_mate` also fires, so a move that both missed a win
  and allowed mate is only reported as the latter.

### `back_rank`
* **False positive, reproduced:** the signature only checks whether the
  player's own back rank contains nothing but the king. It never checks that
  the opponent has a rook/queen to exploit it. Repro: `Nb5` in
  `6k1/5ppp/p7/8/3N4/8/5PPP/6K1 w - - 0 1`, where neither side owns a heavy
  piece, still emits `back_rank`.
* Conversely, a real back-rank weakness with one friendly piece left on the
  rank (pinned or overloaded) is missed.
* Requires `blunder` or `mistake`; an inaccuracy that exposes the rank does not
  fire.

### `opening_leak`
* Purely `phase === 'opening'` + a costly classification. A legitimate opening
  sacrifice that the classifier calls a mistake is labelled a leak.
* With a `null` phase split the opening is hard-coded to `ply <= 14`, so a
  genuine opening error on ply 15+ is bucketed as middlegame.

### `endgame_drift`
* Any inaccuracy/mistake/blunder in the endgame fires, so one technical
  inaccuracy in a long endgame reads the same as a repeated habit.
* Phase comes from the analysis `phase_split`; without it, `ply > 40` is the
  only endgame signal, and a long middlegame easily crosses that line.

### `promising_to_losing`
* Fixed centipawn thresholds (`before >= +120`, `after <= -50`) ignore the
  non-linearity of win probability and overlap heavily with `hung_piece` and
  `missed_win`.
* A swing from +90 to −10 can be a much bigger practical loss in win% terms but
  will not fire; a small cp move across the thresholds will.
* Evaluated from white-perspective stored evals with a colour sign flip, so bad
  mate normalisation upstream propagates directly here.

### `queen_sortie`
* Triggered by the SAN starting with `Q` in the opening (ply ≤ 24) with
  `cp_loss >= 100`, no matter why the queen moved. A necessary queen recapture
  in an open position can therefore be labelled a "sortie".
* Undetected if the early queen move is cheap in centipawns even when it loses
  time/development, and a queen move that loses the game after ply 24 is never
  a sortie.

## General thresholds worth remembering

* Moves must be classified `inaccuracy`/`mistake`/`blunder`/`miss` and lose at
  least 40 cp before any motif is considered.
* A move losing `< 2` win% also needs `cp_loss >= 100` to produce an event.
* `moveMotifs` runs only for costly moves or `cp_loss >= 150`, so two of the
  checks above (hanging pieces, mate) are skipped for cheap inaccuracies.
