import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';

/**
 * AT1 Schedule 12 line 090 — "Taxable income for Alberta purposes or (loss)".
 *
 * The form strikes it as `054 − 080 + 082` and prints "Carried to AT1 page 2,
 * line 062" underneath. It is a COMPUTED line, and it used to be overridden on
 * every return with the engine's own `allocationFactor × federalTaxableIncome`,
 * on the reasoning that the schedule's sum is only as complete as the Division
 * C items modelled. That was wrong twice over, and both mistakes are checked
 * here:
 *
 *   1. The figure pushed in was the ALLOCATED one — line 066 — while 090 feeds
 *      062, which is taxable income BEFORE allocation. A corporation with a
 *      permanent establishment outside Alberta filed a schedule whose total
 *      contradicted the jacket line it is carried to.
 *
 *   2. It came from FEDERAL taxable income, so every deduction Area B carries
 *      that the federal return does not — the Alberta donations claim and the
 *      Alberta loss application, chiefly — was invisible to it. The schedule
 *      showed the deductions on its own rows, then reported a total as if they
 *      were not there, and the tax was computed on that total.
 *
 * A schedule whose total contradicts its own rows is not defensible whatever
 * the total is derived from, so the formula wins and only a figure the
 * preparer typed overrides it.
 */

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };

const base = {
  alberta: { reportsDifferentAlbertaIncome: 'yes', electsDifferentDiscretionaryAmounts: 'yes' },
  albertaSbd: { corporationStatus: 'ccpc' },
};

/**
 * Schedule 12 is filed only when something it reconciles exists — correctly,
 * since a return with nothing to disclose has no reconciliation to make. The
 * two fixtures below have no divergence of their own, so they state an Area B
 * item explicitly at zero: `hasAreaBInput` counts a stated zero as an answer
 * (it tests `!== undefined`), and a zero adds nothing to the deduction total,
 * which keeps 090 equal to the income figure these cases are measuring.
 */
const filesSchedule12 = { albertaSchedule12: { prospectorsShares: 0 } };

const compute = (fed: Record<string, unknown>, ri: Record<string, unknown>) => {
  const input = assembleProvincialInput('AT1', { period, ...fed } as never, ri, {
    isCcpc: true,
  }) as never;
  const out = runAT1Compute(input);
  const s12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
  const byId = new Map((s12?.values ?? []).map((v) => [v.lineItemId, v.value]));
  const field = (key: string) => out.fields?.find((f) => f.line === key)?.value;
  return { byId, field, input: input as { albertaTaxableIncome?: number } };
};

describe('Schedule 12 line 090 carries the deductions the schedule itself lists', () => {
  /*
   * The reported case, reduced to its facts: a corporation with $32,000 of
   * income, a $30,000 charitable pool (claimable to the 75% ceiling, $24,000)
   * and $20,000 of cultural/ecological gifts (no ceiling — the gifts pool is
   * deliberately exempt from the maximum). $44,000 of deductions against
   * $32,000 of income is a $12,000 loss, and the return filed a taxable income
   * of $8,000 and charged tax on it.
   */
  const phantomLoss = {
    bookNetIncome: 32_000,
    activeBusinessIncome: 32_000,
    charitableDonations: 30_000,
    openingDonationPool: 0,
    culturalEcologicalGifts: 20_000,
  };

  it('reports the loss the deductions produce, not a positive remainder', () => {
    const { byId } = compute(phantomLoss, base);
    // The rows the schedule states, unchanged — these were always right.
    expect(byId.get('012056001'), 'charitable donations applied').toBe(24_000);
    expect(byId.get('012058001'), 'cultural/ecological gifts').toBe(20_000);
    // 054 − (24,000 + 20,000) = −12,000.
    expect(byId.get('012090001'), 'taxable income for Alberta purposes').toBe(-12_000);
  });

  it('files 090 and 091 as one statement, so the divergence between them is real', () => {
    // Both totals sum the SAME Area B rows, one column each. Overriding one
    // side and deriving the other makes the difference an artefact of which
    // side was stated, and the difference is the whole point of the schedule.
    const { byId } = compute(phantomLoss, base);
    expect(byId.get('012091001')).toBe(byId.get('012090001'));
  });

  it('carries the loss to line 062 and charges no tax', () => {
    const { field, input } = compute(phantomLoss, base);
    // 062 is pre-allocation and may be negative; the engine floors at 066,
    // where nil tax is the correct consequence rather than a negative one.
    expect(input.albertaTaxableIncome).toBe(-12_000);
    expect(field('albertaTaxPayable')).toBe(0);
  });
});

describe('Schedule 12 line 090 is stated before allocation', () => {
  /*
   * 090 is carried to 062. 062 is taxable income; 066 is the part of it
   * taxable in Alberta, which is where the allocation factor belongs. Filing
   * the allocated figure at 090 understated the schedule against its own
   * jacket on every multi-jurisdiction return.
   */
  const multiJurisdiction = {
    bookNetIncome: 500_000,
    activeBusinessIncome: 500_000,
    allocation: {
      albertaSalaries: 725_000,
      totalSalaries: 1_000_000,
      albertaGrossRevenue: 725_000,
      totalGrossRevenue: 1_000_000,
    },
  };

  it('files the unallocated taxable income, not the Alberta share of it', () => {
    const { byId } = compute(multiJurisdiction, {
      ...base,
      ...filesSchedule12,
      albertaAllocation: multiJurisdiction.allocation,
    });
    expect(byId.get('012090001')).toBe(500_000);
    // 0.725 × 500,000 — what it used to file, and what belongs at 066.
    expect(byId.get('012090001')).not.toBe(362_500);
  });
});

describe('a taxable income the preparer states still overrides the formula', () => {
  it('files the entered figure at 090 and computes the return on it', () => {
    const { byId, input } = compute(
      { bookNetIncome: 500_000, activeBusinessIncome: 500_000 },
      { ...base, ...filesSchedule12, alberta: { ...base.alberta, albertaTaxableIncome: 410_000 } },
    );
    expect(byId.get('012090001')).toBe(410_000);
    expect(input.albertaTaxableIncome).toBe(410_000);
  });
});
