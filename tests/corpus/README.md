# The filed-lines corpus

Every value each scenario files is recorded in `recorded/*.json`.
`tests/filed-lines-corpus.test.ts` re-runs the scenarios and fails on any
difference — a line that changed, appeared, or vanished.

```
npm run corpus          # what would change (dry run — read this)
npm run corpus:accept   # accept it
```

## What it is for

It asserts **"did this change?"**, never **"is this right?"**.

Correctness belongs to `@classytic/ca-tax`'s certification fixtures, where every
expected figure is derived from first principles in a comment beside it. Those
are stronger than a corpus — but each covers about eleven headline totals, and a
filed AT1 payload carries a hundred and more. A rate-year registration or a
composer fix moves values in bulk. Nothing was watching the bulk.

Measured before this existed: a filed AT1 payload had ~40 line values for a
modest return and the suite asserted 13, most only checking *which* schedules
appeared.

## It found a real defect on its first run

`AB5-non-ccpc` showed a non-CCPC being granted the Alberta small-business rate:
**$6,000** of tax payable on $300,000 of income instead of **$24,000**.
`computeAlbertaReturn` never forwarded `status` to `computeAlbertaTax`, so the
eligibility gate — which exists, and which Schedule 1 correctly applied — was
unreachable through the engine every host calls. The return printed *"only a
CCPC … may claim the small business deduction"* in its own issues list while
claiming it. The jacket and its own supporting schedule disagreed, and the
jacket is what gets filed.

The same omission left `AB_GENERAL_RATE_BANDS` — the whole 2006–2020 band table
— dead through the engine path, so a straddling prior year was taxed at a flat
rate instead of the day-weighted blend the specification requires.

Both fixed in ca-tax, guarded by `tests/at1-engine-forwards-eligibility.test.ts`.

## Reading a failure

The failure is a list of lines, not a diff of two large objects:

```
  AB4-schedule18-abil-only  changed  018:018090001: 99999 → 90000
  AB4-schedule18-abil-only  ADDED    018:018092001 = 500
  AB4-schedule18-abil-only  REMOVED  018:018999001 (was 1)
```

`field:<name>` is a jacket/summary figure, `<scheduleId>:<lineItemId>` a filed
schedule line, `issue:<n>` something the engine wants the preparer to see.

**Read the diff before accepting it.** A corpus re-recorded reflexively is worse
than no corpus: a green check that means nothing, which will hide the one line
that moved for a reason nobody intended. That is why the recorder's default is a
dry run and `--write` is a second, deliberate act.

## Why the scenarios are curated, not generated

Equisoft's `tax-ca` grids 8,572 calls because its functions take four scalars.
Ours take a whole return — almost every combination of a return's hundreds of
optional fields is not a valid return at all, so a generated grid would be mostly
meaningless and far too large to read.

So: a small set, each chosen for a path that would otherwise go unwatched, small
enough that a human reads the diff. That readability is the only property that
makes a golden corpus worth having.

The federal cases are the differential-test scenarios already written for the
AuraTax comparison (`scripts/validate/scenarios.ts`), reused rather than
duplicated. The Alberta cases are authored in `scenarios.ts` because nothing else
drove the AT1 assembler — including `AB3` and `AB4`, which cover the two schedule
gates fixed this cycle (Schedule 12 Area B on preparer input alone, and
Schedule 18 ABIL rows with no categorized federal disposition).

## Adding a scenario

Add it to `scenarios.ts`, run `npm run corpus:accept`, commit the new JSON. The
gate asserts scenarios and recordings are in one-to-one correspondence, so a
scenario added without a recording fails rather than silently passing by never
being compared to anything.

`recorded/` is generated. It is excluded from biome in `biome.json` — a
reformat would rewrite every file at once and read as if the *engine* had
drifted.
