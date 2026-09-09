import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };
const fed = {
  period,
  bookNetIncome: 900_000,
  activeBusinessIncome: 700_000,
  ccaClasses: [{ ccaClass: '8', openingUCC: 100_000, additions: 20_000 }],
  charitableDonations: 25_000,
  openingDonationPool: 0,
} as never;

const base = {
  alberta: { reportsDifferentAlbertaIncome: 'yes', electsDifferentDiscretionaryAmounts: 'yes' },
  albertaSbd: { corporationStatus: 'ccpc' },
};

const filed = (ri: Record<string, unknown>) => {
  const out = runAT1Compute(assembleProvincialInput('AT1', fed, ri, { isCcpc: true }) as never);
  const s12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
  return new Map((s12?.values ?? []).map((v) => [v.lineItemId, v.value]));
};

/**
 * AT1 Schedule 12 Area B — the five pairs the form tells the preparer to copy
 * off the federal T2. All five are mandatory in §3.2.3.13 and none of them had
 * anywhere to live before `ri.albertaSchedule12` existed, so they were absent
 * from every filed Schedule 12.
 */
describe('Schedule 12 Area B — items taken from the federal T2', () => {
  it('files all five pairs once the preparer supplies them', () => {
    const byId = filed({
      ...base,
      albertaSchedule12: {
        taxableDividendsDeductible: 40_000, // T2 line 320 → 060/061
        centralCreditUnionAllocation: 3_000, // T2 line 340 → 074/075
        prospectorsShares: 1_500, // T2 line 350 → 078/079
        nonQualifiedSecuritiesDeduction: 2_500, // T2 line 352 → 140/141
        section110_5Additions: 7_000, // T2 line 355 → 082/083
      },
    });
    // Alberta takes the federal figure unless it diverges, and Area B
    // transmits BOTH sides even when they agree.
    for (const [ab, fedLine, amount] of [
      ['012060001', '012061001', 40_000],
      ['012074001', '012075001', 3_000],
      ['012078001', '012079001', 1_500],
      ['012140001', '012141001', 2_500],
      ['012082001', '012083001', 7_000],
    ] as const) {
      expect(byId.get(ab), ab).toBe(amount);
      expect(byId.get(fedLine), fedLine).toBe(amount);
    }
  });

  it('files an Alberta override as a real divergence, including an explicit zero', () => {
    const byId = filed({
      ...base,
      albertaSchedule12: {
        taxableDividendsDeductible: 40_000,
        // Claimed federally, not provincially. A zero here is an answer, not a
        // blank — `??` rather than `||` in the composer is what preserves it.
        albertaTaxableDividendsDeductible: 0,
      },
    });
    expect(byId.get('012061001')).toBe(40_000);
    expect(byId.get('012060001')).toBe(0);
  });

  it('files NOTHING for an item the preparer left blank', () => {
    // Not a zero: a zero would assert the corporation has no such deduction.
    // Omission says we were not told, which is the truth.
    const byId = filed({ ...base, albertaSchedule12: { prospectorsShares: 1_500 } });
    expect(byId.get('012078001')).toBe(1_500);
    for (const line of ['012060001', '012061001', '012074001', '012140001', '012082001']) {
      expect(byId.has(line), line).toBe(false);
    }
  });

  it('still files the mandatory computed lines with no Area B input at all', () => {
    const byId = filed(base);
    for (const line of ['012050001', '012090001', '012091001', '012054001']) {
      expect(byId.has(line), line).toBe(true);
    }
  });
});

/**
 * `assembleAt1Schedules`'s own `schedules` object only attaches
 * `reconciliation` (Schedule 12's filing input) when one of six OLDER
 * reconciling schedules (cca/reserves/dispositions/losses/donations/
 * resourceDeductions) is present. `ri.albertaSchedule12` was added to the
 * form and the filing builder without being added to this gate, so a return
 * whose ONLY Alberta-specific fact was one of the five new Area B items
 * computed 050/090/091/054 but never filed them — `reconciliation` was
 * dropped from `schedules` before it ever reached ca-tax's engine.
 *
 * Caught by driving a real AT1 engagement through the actual UI end to end
 * and reading the persisted `schedulePayloads` back from the API — not by a
 * unit test that calls `schedule12Values` directly, which cannot see this
 * gate at all.
 */
describe('Schedule 12 is filed when Area B is the ONLY divergence', () => {
  it('attaches reconciliation with no CCA/reserves/dispositions/losses/donations/resource activity at all', () => {
    const engineInput = assembleProvincialInput(
      'AT1',
      fed,
      { ...base, albertaSchedule12: { prospectorsShares: 1_500 } },
      { isCcpc: true },
    ) as { schedules?: Record<string, unknown> };
    expect(engineInput.schedules?.reconciliation).toBeDefined();

    const byId = filed({ ...base, albertaSchedule12: { prospectorsShares: 1_500 } });
    expect(byId.get('012078001')).toBe(1_500);
    expect(byId.get('012079001')).toBe(1_500);
    // The mandatory computed lines ride along, which is the whole point.
    expect(byId.has('012050001')).toBe(true);
    expect(byId.has('012090001')).toBe(true);
  });
});
