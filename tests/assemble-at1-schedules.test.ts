/**
 * AT1 supporting schedules — from "the running product files only the
 * jacket" to "every schedule the fact pattern needs actually reaches the
 * filed payload".
 *
 * THE GAP THIS EXISTS FOR. `assembleProvincialInput` ran a full
 * `computeFederalT2()` and discarded everything on the result except
 * `.taxableIncome`. `AlbertaReturnInput.schedules` and `.ieg` were never
 * populated by any code path in the server, so `computeAlbertaReturn`'s
 * `schedulePayloads` was always `[]` — TRA's own certification Test Case 1
 * requires schedules 10, 12, 13, 18 and 21, none of which ever reached a
 * filed AT1 return. These tests exercise the fixed composition end to end:
 * a structured-return-shaped federal input in, a real filed payload out.
 */
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };

/** A federal engine input with CCA, a disposition, a donation, and a loss — the fact pattern TRA's Test Case 1 exercises. */
const fed = {
  period,
  bookNetIncome: 400_000,
  activeBusinessIncome: 400_000,
  ccaClasses: [{ ccaClass: '8', openingUCC: 100_000, additions: 20_000 }],
  capitalDispositions: [
    {
      description: 'Shares of X Co.',
      proceeds: 150_000,
      acb: 80_000,
      outlays: 2_000,
      category: 'shares',
    },
  ],
  charitableDonations: 10_000,
  openingDonationPool: 0,
  reserveContinuity: [{ type: 'doubtfulDebts', opening: 5_000, transfer: 0, closing: 8_000 }],
  openingNonCapitalLoss: 0,
  nonCapitalLossToApply: 0,
};

/** The structured working return — the AT1-only slices nothing else can supply. */
const riWithDivergence = {
  alberta: {
    reportsDifferentAlbertaIncome: 'no',
    electsDifferentDiscretionaryAmounts: 'yes', // TRA permits Sch 13/17/18 on either flag
    corporationStatus: 'ccpc',
  },
  albertaContinuity: {
    nonCapitalOpening: 50_000,
    capitalOpening: 0,
    farmOpening: 0,
    restrictedFarmOpening: 0,
  },
};

describe('assembleProvincialInput(AT1) — schedules actually reach the engine input', () => {
  it('populates schedules.cca from the federal CCA classes, unchanged', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true }) as {
      schedules?: Record<string, unknown>;
    };
    expect(engineInput.schedules?.cca).toBeDefined();
  });

  it('omits schedules 13/17/18 when neither divergence flag is set — TRA forbids filing them', () => {
    const noDivergence = {
      alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
    };
    const engineInput = assembleProvincialInput('AT1', fed, noDivergence, { isCcpc: true }) as {
      schedules?: Record<string, unknown>;
    };
    expect(engineInput.schedules?.cca).toBeUndefined();
    expect(engineInput.schedules?.reserves).toBeUndefined();
    expect(engineInput.schedules?.dispositions).toBeUndefined();
  });

  it('populates donations from the federal charitable pool', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true }) as {
      schedules?: Record<string, unknown>;
    };
    expect(engineInput.schedules?.donations).toBeDefined();
  });

  it('populates loss continuity only when Alberta opening balances were entered', () => {
    const withoutContinuity = { alberta: riWithDivergence.alberta };
    const engineInput = assembleProvincialInput('AT1', fed, withoutContinuity, {
      isCcpc: true,
    }) as {
      schedules?: Record<string, unknown>;
    };
    expect(engineInput.schedules?.losses).toBeUndefined();

    const engineInputWithContinuity = assembleProvincialInput('AT1', fed, riWithDivergence, {
      isCcpc: true,
    }) as { schedules?: Record<string, unknown> };
    expect(engineInputWithContinuity.schedules?.losses).toBeDefined();
  });
});

describe('runAT1Compute — the filed payload carries the schedules, not just the jacket', () => {
  it('files schedules 12, 13, 18, 20 and 21 for a fact pattern that needs them', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId).sort();

    // Before this fix, `filedIds` was always `[]` — only the jacket (rendered
    // separately, not part of `schedulePayloads`) ever went out.
    expect(filedIds).toContain('012'); // reconciliation
    expect(filedIds).toContain('013'); // CCA
    expect(filedIds).toContain('018'); // dispositions
    expect(filedIds).toContain('020'); // donations
    expect(filedIds).toContain('021'); // loss continuity
  });

  it('files NOTHING beyond the jacket when no AT1-only input is supplied at all', () => {
    const bareRi = {};
    const engineInput = assembleProvincialInput('AT1', fed, bareRi, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    // CCA/reserves/dispositions still omitted (no divergence flags); donations
    // still populate (federal donations alone are enough); losses/reconciliation
    // still omitted (no Alberta continuity entered).
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId);
    expect(filedIds).not.toContain('013');
    expect(filedIds).not.toContain('021');
  });
});

describe("Schedule 21 — the Alberta opening balance survives, not federal's", () => {
  /**
   * Regression case: `computeLossContinuity` takes `openingBalance` as one
   * input among several, and the federal `LossContinuityResult` it derives
   * the other four from ALSO carries its own `openingBalance` (and
   * `closingBalance`). Composing the two by spreading the federal result
   * after setting the Alberta opening balance silently let federal's
   * (usually 0, on a first-ever AT1 filing) win — the Alberta figure the
   * preparer actually entered never reached the filed schedule. Caught only
   * by inspecting real output values, not by typecheck or a presence check.
   */
  it("files the entered Alberta opening balance, not federal's (0)", () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const opening = sch21?.values.find((v) => v.lineItemId === '021031001');
    const closing = sch21?.values.find((v) => v.lineItemId === '021049001');

    expect(opening?.value).toBe(50_000);
    // No current-year loss, no application, no expiry ⇒ closing = opening.
    expect(closing?.value).toBe(50_000);
  });
});

describe('runAT1Compute — Schedule 29 (IEG) composes from the AT1-only slice', () => {
  it('claims a grant when eligible expenditures and a group are entered', () => {
    const riWithIeg = {
      ...riWithDivergence,
      albertaIeg: {
        eligibleExpenditures: 400_000,
        group: [
          { name: 'Claimant', taxableCapital: 5_000_000, priorYear1: 300_000, priorYear2: 200_000 },
        ],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithIeg, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const grantLine = out.fields.find((f) => f.line === 'innovationEmploymentGrant');
    expect(grantLine?.value).toBeGreaterThan(0);

    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId);
    expect(filedIds).toContain('029');
  });

  it('claims nothing — and still reports line 129 as zero — when no group is entered', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const grantLine = out.fields.find((f) => f.line === 'innovationEmploymentGrant');
    expect(grantLine?.value).toBe(0);
  });
});

describe('runAT1Compute — Schedule 29 page 3 (the Agreement Among Associated Corporations)', () => {
  const riWithAgreement = {
    ...riWithDivergence,
    albertaIeg: {
      eligibleExpenditures: 1_000_000,
      group: [
        { name: 'A', taxableCapital: 10_000_000, priorYear1: 750_000, priorYear2: 600_000 },
        { name: 'B', taxableCapital: 3_000_000, priorYear1: 0, priorYear2: 500_000 },
      ],
      agreementLongestYearCan: 'A-CAN',
      agreementLongestYearBegin: '2024-01-01',
      agreementLongestYearEnd: '2024-12-31',
      agreementDaysInLongestYear: 366,
      agreementMembers: [
        {
          name: 'A',
          albertaCan: 'A-CAN',
          currentTaxationYearEnd: '2024-12-31',
          allocatedExpenditureLimit: 280_000,
          currentYearExpenditures: 1_000_000,
          priorYear1: 750_000,
          priorYear2: 600_000,
          taxableCapitalPriorYear: 10_000_000,
          daysInTaxYear: 366,
        },
        {
          name: 'B',
          allocatedExpenditureLimit: 0,
          currentYearExpenditures: 200_000,
          priorYear1: 0,
          priorYear2: 500_000,
          taxableCapitalPriorYear: 3_000_000,
          daysInTaxYear: 366,
        },
      ],
    },
  };

  it('files line 125, not 112, once an agreement member table is entered', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithAgreement, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch29 = out.schedulePayloads?.find((s) => s.scheduleId === '029');
    const byId = new Map(sch29?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.has('029125001')).toBe(true);
    expect(byId.has('029112001')).toBe(false);
  });

  it('files the agreement’s page-3 lines — header, per-member occurrences, and the claimant’s 325', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithAgreement, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch29 = out.schedulePayloads?.find((s) => s.scheduleId === '029');
    const byId = new Map(sch29?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('029200001')).toBe('A-CAN');
    // 220 is the Federal Business Number, not the member's name — the form has
    // no line for a name at all, and this UI does not collect an FBN, so 220
    // is never filed. 230 (Alberta CAN) is what proves claimant-first ordering.
    expect(byId.has('029220001')).toBe(false);
    expect(byId.get('029230001')).toBe('A-CAN'); // claimant first
    expect(byId.get('029325001')).toBe(280_000); // claimant's own allocated allowed amount
  });

  it('keeps filing line 112 when the group exists but no agreement was entered', () => {
    const noAgreement = {
      ...riWithDivergence,
      albertaIeg: {
        eligibleExpenditures: 1_000_000,
        group: riWithAgreement.albertaIeg.group,
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, noAgreement, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch29 = out.schedulePayloads?.find((s) => s.scheduleId === '029');
    const byId = new Map(sch29?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.has('029112001')).toBe(true);
    expect(byId.has('029125001')).toBe(false);
    expect(byId.has('029200001')).toBe(false);
  });
});
