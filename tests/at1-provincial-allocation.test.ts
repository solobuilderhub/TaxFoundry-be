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

/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-112 — reported as "017 totals don't
 * reconcile to the grid": opening (021) and transfer (051) totals correctly
 * summed the entered rows, but the closing total (081) stayed $0 with
 * opening/transfer entered and no closing figure, which the report read as
 * "the derived closing column never computes."
 *
 * Does not reproduce as a defect. Schedule 17's closing balance is NOT a
 * continuity derivation of opening + transfer — a tax reserve under s.20(1)
 * is a fresh discretionary claim each year, so a reserve kind's closing
 * balance is its own independent figure (an entered Alberta override, or the
 * federal Schedule 13 closing balance by default), never arithmetic on the
 * other two columns. The report's own repro entered opening and transfer but
 * no closing figure and no federal Schedule 13 data — $0 is the correct
 * answer for "no reserve claimed this year," not a computation failure.
 *
 * The genuine gap was in the guided editor's copy, which said "the totals …
 * are computed" without saying they SUM the entered/defaulted rows rather
 * than deriving closing from the other two columns — fixed separately in
 * apps/web. This test exists to pin the actual arithmetic so nobody "fixes"
 * it into a wrong continuity derivation later.
 */
describe('AT1 S17 — closing is its own figure, never opening + transfer (BUG-112)', () => {
  const divergenceDeclared = {
    ...base,
    alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'yes' },
  };

  it("matches the report's own exact repro: two rows, opening/transfer entered, no closing → 081 stays 0, 091 sums the other two", () => {
    const fedNoReserves = { ...fed, reserveContinuity: [] };
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fedNoReserves,
        {
          ...divergenceDeclared,
          albertaReserves17: {
            rows: [
              { type: 'doubtfulDebts', opening: 10_000, transfer: 5_000 },
              { type: 'undeliveredGoodsAndServices', opening: 12_000, transfer: 8_000 },
            ],
          },
        },
        { isCcpc: true },
      ),
    );
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('017021001')).toBe(22_000); // opening total: sums the rows
    expect(byId.get('017051001')).toBe(13_000); // transfer total: sums the rows
    // 081 correctly stays 0 — no closing figure and no federal basis exist.
    expect(byId.get('017081001') ?? 0).toBe(0);
    expect(byId.get('017091001')).toBe(35_000); // 021 + 051, the one place addition applies
  });

  it('an entered closing figure files independently, unrelated to opening + transfer', () => {
    const fedNoReserves = { ...fed, reserveContinuity: [] };
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fedNoReserves,
        {
          ...divergenceDeclared,
          albertaReserves17: {
            rows: [{ type: 'doubtfulDebts', opening: 10_000, transfer: 5_000, closing: 999 }],
          },
        },
        { isCcpc: true },
      ),
    );
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    // NOT 15,000 (opening + transfer) — the entered figure, exactly.
    expect(byId.get('017061001')).toBe(999);
    expect(byId.get('017081001')).toBe(999);
  });
});
