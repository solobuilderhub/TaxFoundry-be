import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diff, formatDeltas, type Recording, runScenario } from './corpus/harness.js';
import { SCENARIOS } from './corpus/scenarios.js';

/**
 * The filed-lines corpus gate.
 *
 * Every value a scenario files is recorded in `corpus/recorded/*.json`. This
 * re-runs each scenario and fails on any difference — a line that changed, a
 * line that appeared, a line that vanished.
 *
 * It asserts **"did this change?"**, never **"is this right?"**. Correctness is
 * `@classytic/ca-tax`'s certification fixtures, whose every expected figure is
 * derived from first principles beside it. This exists because those cover a
 * dozen headline totals each and a filed AT1 payload carries a hundred and more:
 * a rate-year registration or a composer fix moves values in bulk, and nothing
 * was watching the bulk.
 *
 * ── It has already earned its place ─────────────────────────────────────────
 *
 * The first run of `AB5-non-ccpc` found that a non-CCPC was being granted the
 * Alberta small-business rate — $6,000 of tax payable on $300,000 of income
 * instead of $24,000 — because `computeAlbertaReturn` never forwarded
 * `status` to `computeAlbertaTax`. The engine printed "only a CCPC … may claim
 * the small business deduction" in its own issues list while claiming it. No
 * test asserted a non-CCPC's Alberta tax, so nothing else was looking. Fixed in
 * ca-tax with `tests/at1-engine-forwards-eligibility.test.ts` as its guard; this
 * corpus is what noticed.
 *
 * ── When this fails ─────────────────────────────────────────────────────────
 *
 * A rate change, a formula fix, or a new filed line SHOULD fail it. The failure
 * message is a list of changed lines, not a diff of two large objects, because
 * the only way a golden corpus stays honest is if the diff is actually read.
 * Accept a change with:
 *
 *     npx tsx scripts/record-corpus.ts            # review first
 *     npx tsx scripts/record-corpus.ts --write    # then accept
 *
 * Re-recording without reading the diff turns this file into a green check that
 * means nothing, and it will hide the one line that moved for a reason nobody
 * intended.
 */
const DIR = join(import.meta.dirname, 'corpus/recorded');

const recordings = new Map<string, Recording>(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const r = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Recording;
      return [r.scenario, r];
    }),
);

describe('filed lines match the recorded corpus', () => {
  it('every scenario has a recording, and every recording a scenario', () => {
    // A scenario added without recording it would otherwise silently pass by
    // never being compared to anything.
    expect([...recordings.keys()].sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s files exactly what was recorded', (id, scenario) => {
    const recorded = recordings.get(id);
    expect(recorded, `no recording for ${id} — run scripts/record-corpus.ts --write`).toBeDefined();
    if (!recorded) return;

    const deltas = diff(recorded.lines, runScenario(scenario).lines);
    expect(
      deltas.length === 0 ? '' : `\n${formatDeltas(id, deltas)}\n`,
      `${id}: ${deltas.length} filed line(s) differ from the recording`,
    ).toBe('');
  });

  /**
   * A cheap structural check that runs even when the values are all fine: the
   * SET of filed lines. This is the defect class that kept recurring — jacket
   * 087/115, Schedule 12's dropped dispositions, Schedule 18's five unfiled ABIL
   * columns — a figure moving the return with no line disclosing it, or a line
   * quietly disappearing from the payload.
   */
  it('files the expected number of lines in total', () => {
    const total = SCENARIOS.reduce((n, s) => n + Object.keys(runScenario(s).lines).length, 0);
    const recordedTotal = [...recordings.values()].reduce(
      (n, r) => n + Object.keys(r.lines).length,
      0,
    );
    expect(total).toBe(recordedTotal);
  });
});
