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

/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-104 — the s.110.5 addition floor.
 *
 * A section 110.5 / 115(1)(a)(vii) addition exists precisely so a
 * loss-year corporation can elect to be taxed on enough income to use a
 * foreign tax credit that would otherwise expire — so the whole point is
 * that it CAN turn a loss into positive taxable income. The report found a
 * build where it could not: additions rendered in the as-filed Schedule 12
 * block but 090/062 stayed pinned at $0 regardless.
 *
 * That was fixed by 10f7152 ("Let Schedule 12 line 090 be the taxable
 * income the return is computed on") reading 062 off the SAME
 * `schedule12Values` render the wire gets, rather than a second unflored/
 * flored derivation that could disagree with it. This test exists so the
 * exact reported repro — a $20,000 loss year, no CCA, a $30,000 Alberta
 * s.110.5 addition — stays pinned to the report's own expected figures.
 */
describe('AT1 S12 — the s.110.5 addition floor (BUG-104)', () => {
  /*
   * §3.2.3.13's own instruction, printed under 090: "If there is an amount
   * at line 082 and line 054 − line 080 is negative, then line 090 must equal
   * line 082" — not the algebraic sum. A corporation whose deductions exhaust
   * its income reports its s.110.5 addition AS the figure. This is not a
   * magnitude comparison ("does the addition exceed the loss") — it fires on
   * ANY positive addition against a negative base, transcribed verbatim in
   * `derive()` in at1-schedule-line-items.ts.
   */
  const lossYearFed = {
    ...fed,
    bookNetIncome: -20_000,
    activeBusinessIncome: -20_000,
    ccaClasses: [],
  } as never;

  const filedLoss = (ri: Record<string, unknown>) => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', lossYearFed, ri, { isCcpc: true }) as never,
    );
    const s12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
    return new Map((s12?.values ?? []).map((v) => [v.lineItemId, v.value]));
  };

  it("matches the report's own exact repro: a $20,000 loss, a $30,000 addition → $30,000 taxable, $2,400 tax", () => {
    const byId = filedLoss({
      ...base,
      albertaSchedule12: { albertaSection110_5Additions: 30_000 },
    });
    expect(byId.get('012002001')).toBe(-20_000);
    expect(byId.get('012082001')).toBe(30_000);
    // The floor rule: 090 = 082 ALONE, not 054 + 082 (-20,000 + 30,000 = 10,000).
    expect(byId.get('012090001')).toBe(30_000);

    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        lossYearFed,
        { ...base, albertaSchedule12: { albertaSection110_5Additions: 30_000 } },
        { isCcpc: true },
      ) as never,
    );
    const fieldValue = (line: string) =>
      (out.fields ?? []).find((f) => String(f.line) === line)?.value;
    expect(fieldValue('albertaTaxableIncome')).toBe(30_000);
    expect(fieldValue('amountTaxableInAlberta')).toBe(30_000);
    expect(fieldValue('albertaTaxPayable')).toBe(2_400);
  });

  it('the floor rule is binary, not a magnitude comparison — a smaller addition still becomes 090 alone', () => {
    const byId = filedLoss({
      ...base,
      albertaSchedule12: { albertaSection110_5Additions: 5_000 },
    });
    // NOT -20,000 + 5,000 = -15,000. The rule fires on any positive addition
    // against a negative base, regardless of whether it exceeds the loss.
    expect(byId.get('012090001')).toBe(5_000);
  });

  it('no addition at all — the loss stays a loss, unfloored, and no tax follows', () => {
    const byId = filedLoss(base);
    expect(byId.get('012090001')).toBe(-20_000);
    const out = runAT1Compute(
      assembleProvincialInput('AT1', lossYearFed, base, { isCcpc: true }) as never,
    );
    const fieldValue = (line: string) =>
      (out.fields ?? []).find((f) => String(f.line) === line)?.value;
    // 066 floors a negative 062 at nil — a different line, a different rule.
    expect(fieldValue('amountTaxableInAlberta')).toBe(0);
    expect(Number(fieldValue('albertaTaxPayable'))).toBe(0);
  });

  it('a positive-income year applies the ordinary additive formula, not the floor rule', () => {
    const without = filed(base);
    const withAddition = filed({
      ...base,
      albertaSchedule12: { albertaSection110_5Additions: 10_000 },
    });
    // The shared `fed` fixture nets well above zero, so 054 − 080 is
    // positive and the addition moves 090 by exactly its own amount —
    // isolated from the fixture's own deductions rather than assumed nil.
    expect(Number(without.get('012090001'))).toBeGreaterThan(0);
    expect(Number(withAddition.get('012090001'))).toBe(Number(without.get('012090001')) + 10_000);
  });
});
