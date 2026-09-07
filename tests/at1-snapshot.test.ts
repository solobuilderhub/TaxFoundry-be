/**
 * An AT1 computation must be reproducible, and must be computed at OUR rates.
 *
 * Two defects, one place. The federal path stripped every caller-supplied rate
 * and year field before computing and recorded a full reproducibility snapshot;
 * the Alberta path did neither.
 *
 * 1. `runAT1Compute` spread the validated request into the engine and overrode
 *    only `rateBook`. But `computeAlbertaReturn` prefers `input.rates` (an
 *    already-resolved table) over the book, and the AT1 engine prefers
 *    `input.taxYear` over the year derived from `period.end`. A provincial
 *    engagement sent in the engine's own shape is passed straight through by the
 *    compute service, so both were reachable from a request.
 *
 * 2. No snapshot meant a stored AT1 computed-return had a null
 *    `rateTableVersion`, a null `formVersion` and a null `resultHash`. The T183
 *    officer authorization binds to `resultHash`; bound to null it cannot be
 *    shown to belong to the computation that was filed.
 */
import { describe, expect, it } from 'vitest';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: '2024' };

const base = {
  period,
  federalTaxableIncome: 500_000,
  activeBusinessIncome: 500_000,
};

describe('runAT1Compute — untrusted rate and year overrides', () => {
  it('ignores a caller-supplied resolved rate table', () => {
    const honest = runAT1Compute(base);
    // A rate table a client would love: no Alberta tax at all.
    const attacked = runAT1Compute({
      ...base,
      rates: { generalRate: 0, smallBusinessRate: 0, smallBusinessThreshold: 0 },
    });
    expect(attacked.obligation.totalOwing).toBe(honest.obligation.totalOwing);
  });

  it('ignores a caller-supplied tax year', () => {
    const honest = runAT1Compute(base);
    const attacked = runAT1Compute({ ...base, taxYear: 1999 });
    expect(attacked.obligation.totalOwing).toBe(honest.obligation.totalOwing);
  });

  it('does not store the stripped fields in the snapshot input', () => {
    const out = runAT1Compute({ ...base, rates: { generalRate: 0 }, taxYear: 1999 });
    const input = out.snapshot?.validatedInput as Record<string, unknown>;
    expect(input).toBeDefined();
    expect(input.rates).toBeUndefined();
    expect(input.taxYear).toBeUndefined();
    expect(input.rateBook).toBeUndefined();
  });
});

describe('runAT1Compute — the reproducibility record', () => {
  it('emits a snapshot with every version and hash the federal return has', () => {
    const out = runAT1Compute(base);
    expect(out.snapshot).toBeDefined();
    expect(out.snapshot?.engineBuild).toBe(out.engineVersion);
    expect(out.snapshot?.formVersion).toMatch(/^at1-form@/);
    // Non-empty content hashes — this is what the computed-return persists as
    // `rateTableVersion`, `inputHash` and `resultHash`, and what the T183
    // authorization is bound to.
    expect(out.snapshot?.rateTableVersion).toMatch(/^[0-9a-f]{16,}$/);
    expect(out.snapshot?.inputHash).toMatch(/^[0-9a-f]{16,}$/);
    expect(out.snapshot?.resultHash).toMatch(/^[0-9a-f]{16,}$/);
  });

  it('hashes the same input to the same result — a recompute is comparable', () => {
    const a = runAT1Compute(base);
    const b = runAT1Compute(base);
    expect(b.snapshot?.inputHash).toBe(a.snapshot?.inputHash);
    expect(b.snapshot?.resultHash).toBe(a.snapshot?.resultHash);
  });

  it('changes the result hash when the return changes', () => {
    const a = runAT1Compute(base);
    const b = runAT1Compute({ ...base, federalTaxableIncome: 600_000 });
    expect(b.snapshot?.resultHash).not.toBe(a.snapshot?.resultHash);
  });

  it('stores the rate table actually used, not a reference to the live book', () => {
    const out = runAT1Compute(base);
    expect(out.snapshot?.rateTable).toBeDefined();
  });
});
