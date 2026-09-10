/**
 * The filed-lines corpus — run, flatten, diff.
 *
 * This module is shared by the recorder (`scripts/record-corpus.ts`) and the
 * gate (`tests/filed-lines-corpus.test.ts`) so the two cannot drift: a value is
 * compared exactly the way it was recorded, by the same code.
 *
 * ── What this is, and what it is NOT ────────────────────────────────────────
 *
 * A golden corpus asserts **"did this change?"**, never **"is this right?"**.
 * Correctness is the job of `ca-tax`'s certification fixtures, whose every
 * expected figure is derived from first principles in a comment beside it. This
 * catches something those cannot: the FAN-OUT. A rate-year registration or a
 * composer fix moves dozens of filed values at once, and hand-written
 * expectations only cover the dozen lines somebody thought to assert.
 *
 * Measured before building this: a filed AT1 payload carries ~40 line values for
 * a modest return and the suite asserted 13 of them, most only checking WHICH
 * schedules appeared. Three defects of exactly that shape were found by reading
 * code this session — jacket 087/115, Schedule 12's dropped dispositions, and
 * Schedule 18's five unfiled ABIL columns — each a figure that moved the return
 * with no line disclosing it. This is the mechanical net for that class.
 *
 * ── Why it is flattened ─────────────────────────────────────────────────────
 *
 * Everything a run produces is reduced to one flat `path → value` map:
 *
 *   field:partITaxPayable        17550
 *   013:013021001                80000
 *   issue:0                      "…"
 *
 * so a difference is reported as a LIST OF CHANGED LINES rather than as a diff
 * of two large nested objects. That matters more than it looks: the failure
 * mode of every golden corpus is re-recording without reading the diff, and an
 * unreadable diff guarantees it. `tax-ca`'s own README warns about precisely
 * this — "never re-record to make CI green without reading the diff; that is the
 * entire safety mechanism". A legible delta is how that warning is made
 * followable rather than merely stated.
 */
import { computeFederalT2, type FederalT2Input } from '@classytic/ca-tax/t2';
import { assembleProvincialInput } from '../../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../../src/engine/at1-compute.js';
import { runT2Compute } from '../../src/engine/t2-compute.js';
import { type CorpusScenario, SCENARIOS } from './scenarios.js';

export type FlatCorpus = Record<string, string | number | boolean | null>;

export interface Recording {
  scenario: string;
  title: string;
  program: 'T2' | 'AT1';
  /** Sorted `path → value`. Sorted so a re-record never churns on key order. */
  lines: FlatCorpus;
}

/**
 * A tax year's period. Scenarios that model a SHORT year carry their own
 * `periodStart`/`periodEnd` (business-limit proration under s.125(5)(b) depends
 * on it), so those win over the calendar year — feeding a full year to a short-
 * year scenario would silently record the wrong figures as correct.
 */
function periodFor(input: Record<string, unknown>, taxYear: number) {
  const start = typeof input.periodStart === 'string' ? input.periodStart : `${taxYear}-01-01`;
  const end = typeof input.periodEnd === 'string' ? input.periodEnd : `${taxYear}-12-31`;
  return { start: new Date(start), end: new Date(end), label: String(taxYear) };
}

/** Run one scenario and flatten everything it files into a sorted map. */
export function runScenario(scenario: CorpusScenario): Recording {
  const flat: FlatCorpus = {};
  const put = (key: string, value: unknown) => {
    flat[key] =
      typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
        ? value
        : value === null || value === undefined
          ? null
          : JSON.stringify(value);
  };

  let out: {
    fields: { line: string; value: unknown }[];
    schedulePayloads?: { scheduleId: string; values: { lineItemId: string; value: unknown }[] }[];
    issues?: string[];
  };

  if (scenario.program === 'T2') {
    const input = scenario.input as unknown as Record<string, unknown>;
    out = runT2Compute({ ...input, period: periodFor(input, scenario.taxYear) });
  } else {
    const period = periodFor({}, scenario.taxYear);
    const fed = { ...scenario.fed, period } as Record<string, unknown>;
    // The AT1 chain a real filing takes: the federal result feeds the Alberta
    // assembler, which decides which schedules TRA permits, and only then does
    // the AT1 engine run. Driving `runAT1Compute` directly would skip the
    // assembler — which is where the schedule gates live, and therefore the
    // part most worth guarding.
    const engineInput = assembleProvincialInput('AT1', fed, scenario.returnInput, {
      isCcpc: scenario.isCcpc,
    });
    out = runAT1Compute(engineInput);
  }

  for (const f of out.fields) put(`field:${f.line}`, f.value);
  for (const p of out.schedulePayloads ?? []) {
    for (const v of p.values) put(`${p.scheduleId}:${v.lineItemId}`, v.value);
  }
  (out.issues ?? []).forEach((issue, i) => put(`issue:${i}`, issue));

  const lines: FlatCorpus = {};
  for (const key of Object.keys(flat).sort()) lines[key] = flat[key]!;

  return { scenario: scenario.id, title: scenario.title, program: scenario.program, lines };
}

export function runAll(): Recording[] {
  return SCENARIOS.map(runScenario);
}

export interface Delta {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  before?: string | number | boolean | null;
  after?: string | number | boolean | null;
}

/** Every difference between a recording and a fresh run, as a readable list. */
export function diff(recorded: FlatCorpus, actual: FlatCorpus): Delta[] {
  const deltas: Delta[] = [];
  for (const path of [...new Set([...Object.keys(recorded), ...Object.keys(actual)])].sort()) {
    const before = recorded[path];
    const after = actual[path];
    if (!(path in recorded)) deltas.push({ kind: 'added', path, after });
    else if (!(path in actual)) deltas.push({ kind: 'removed', path, before });
    else if (before !== after) deltas.push({ kind: 'changed', path, before, after });
  }
  return deltas;
}

/** One line per difference — this is what a failure prints, and what a re-record prints. */
export function formatDeltas(scenario: string, deltas: Delta[]): string {
  return deltas
    .map((d) =>
      d.kind === 'changed'
        ? `  ${scenario}  changed  ${d.path}: ${d.before} → ${d.after}`
        : d.kind === 'added'
          ? `  ${scenario}  ADDED    ${d.path} = ${d.after}`
          : `  ${scenario}  REMOVED  ${d.path} (was ${d.before})`,
    )
    .join('\n');
}

/** Federal engine result, for scenarios that assert against the pure engine. */
export function federalResult(input: FederalT2Input) {
  return computeFederalT2(input);
}
