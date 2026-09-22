/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-114 — "An incomplete 005 province row
 * zeroes the entire return": adding a permanent-establishment row (province
 * picked, both money cells left blank) to an otherwise single-jurisdiction
 * Alberta return silently dropped the allocation factor to 0%, zeroing basic
 * tax, the SBD and the amount payable — with no flag explaining why.
 *
 * Root cause: `albertaAllocationFrom` only fell back to the safe
 * `SINGLE_JURISDICTION_ALBERTA_FACTOR` when the PE array was EMPTY
 * (`pes.length === 0`). One entered-but-blank row has `pes.length === 1`,
 * so it passed that guard and reached `computeAllocationFactor` with both
 * totals at zero — which has no "nothing entered" branch of its own and
 * falls through to `else factor = 0`, a real answer ("0% of taxable income
 * is Alberta's") the input never asserted.
 *
 * Fixed by extending the same fallback to "every PE is Alberta and neither
 * base has any figure" — structurally the same "no usable allocation basis"
 * state the empty-array case already defaults for. A genuinely multi-
 * province PE list is deliberately NOT covered by this fallback (see the
 * function's own doc comment) — that case has a real Reg 402(4)/(5) answer
 * of its own (equal split), which the federal `computeProvincialAllocation`
 * primitive already implements correctly and this narrower fix does not
 * need to duplicate.
 */
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';
import { at1SilentNilFlags } from '../src/review/review-generator.service.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };
const fed = {
  period,
  bookNetIncome: 200_000,
  activeBusinessIncome: 200_000,
  ccaClasses: [],
  capitalDispositions: [],
  charitableDonations: 0,
  openingDonationPool: 0,
  reserveContinuity: [],
  openingNonCapitalLoss: 0,
  nonCapitalLossToApply: 0,
};
const base = {
  alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
  albertaSbd: { corporationStatus: 'ccpc' },
};

const allocationFactor = (out: ReturnType<typeof runAT1Compute>) =>
  (out.fields ?? []).find((f) => String(f.line) === 'allocationFactor')?.value;
const taxPayable = (out: ReturnType<typeof runAT1Compute>) =>
  (out.fields ?? []).find((f) => String(f.line) === 'albertaTaxPayable')?.value;

describe('AT1 provincial allocation — an incomplete PE row no longer zeroes the return', () => {
  it('baseline: no permanent establishments at all → 100% single-jurisdiction', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        { ...fed, permanentEstablishments: [] } as never,
        base as never,
        { isCcpc: true },
      ),
    );
    expect(allocationFactor(out)).toBe(1);
    expect(taxPayable(out)).toBe(4_000);
  });

  it('one PE row with a province but BOTH money fields blank: same factor and tax as the baseline, not 0%', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        {
          ...fed,
          permanentEstablishments: [{ province: 'AB', grossRevenue: 0, salariesWages: 0 }],
        } as never,
        base as never,
        { isCcpc: true },
      ),
    );
    expect(allocationFactor(out)).toBe(1);
    expect(taxPayable(out)).toBe(4_000);
  });

  it('a review flag names the blank row so the preparer knows it is being ignored', () => {
    const flags = at1SilentNilFlags(
      'AT1',
      {
        ...base,
        provincialAllocation: {
          establishments: [{ province: 'AB', grossRevenue: undefined, salariesWages: undefined }],
        },
      } as never,
      {},
    );
    expect(flags.map((f) => f.code)).toContain('AT1_PE_ROW_NO_ALLOCATION_BASIS');
  });

  it('the flag does not fire once the row carries a real figure', () => {
    const flags = at1SilentNilFlags(
      'AT1',
      {
        ...base,
        provincialAllocation: {
          establishments: [{ province: 'AB', grossRevenue: 500_000, salariesWages: 0 }],
        },
      } as never,
      {},
    );
    expect(flags.map((f) => f.code)).not.toContain('AT1_PE_ROW_NO_ALLOCATION_BASIS');
  });

  it('a real second-province allocation still splits correctly — the fix does not swallow genuine multi-province data', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        {
          ...fed,
          permanentEstablishments: [
            { province: 'AB', grossRevenue: 500_000, salariesWages: 300_000 },
            { province: 'ON', grossRevenue: 500_000, salariesWages: 300_000 },
          ],
        } as never,
        base as never,
        { isCcpc: true },
      ),
    );
    expect(allocationFactor(out)).toBe(0.5);
  });

  it('a real row plus a blank duplicate-province row: the blank row contributes nothing, math unaffected', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        {
          ...fed,
          permanentEstablishments: [
            { province: 'AB', grossRevenue: 500_000, salariesWages: 300_000 },
            { province: 'AB', grossRevenue: 0, salariesWages: 0 },
          ],
        } as never,
        base as never,
        { isCcpc: true },
      ),
    );
    expect(allocationFactor(out)).toBe(1);
  });
});
