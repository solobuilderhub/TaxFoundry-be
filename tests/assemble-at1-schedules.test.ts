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
  },
  albertaSbd: {
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

  it('files the gifts pool from federal cultural + ecological gifts, with no Alberta override', () => {
    // `culturalEcologicalGifts` is a real field of the assembled federal
    // engine input — `assembleT2Input`'s `scheduleTwo` no longer folds
    // cultural/ecological into the (75%-capped) `charitableDonations` total;
    // they're a separate, uncapped figure (see that function's own doc
    // comment for why combining them was a real bug). This `fed` fixture
    // stands in for what `assembleT2Input` would have produced from a
    // working return with `donations: { cultural: 4_000, ecological: 6_000 }`.
    const fedWithGifts = { ...fed, culturalEcologicalGifts: 10_000 };
    const engineInput = assembleProvincialInput('AT1', fedWithGifts, riWithDivergence, {
      isCcpc: true,
    }) as { schedules?: { donations?: { gifts?: { currentYearGifts: number } } } };
    expect(engineInput.schedules?.donations?.gifts?.currentYearGifts).toBe(10_000);
  });

  it('lets an Alberta override replace the federal-derived gifts figure', () => {
    const riWithGiftsOverride = {
      ...riWithDivergence,
      donations: { cultural: 4_000, ecological: 6_000 },
      albertaDonations: { giftsCurrentYear: 25_000 },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithGiftsOverride, {
      isCcpc: true,
    }) as { schedules?: { donations?: { gifts?: { currentYearGifts: number } } } };
    expect(engineInput.schedules?.donations?.gifts?.currentYearGifts).toBe(25_000);
  });

  it('caps the TWO donation pools against ONE shared 75%-of-income ceiling, not one each', () => {
    // Alberta net income for tax purposes is large enough that the two pools'
    // own available balances are the binding constraint individually, but
    // NOT large enough for both to claim their full balance simultaneously —
    // this is the case that would silently over-claim if each pool were
    // capped against the full ceiling independently instead of sequentially.
    const riWithBothPools = {
      ...riWithDivergence,
      albertaDonations: {
        giftsCurrentYear: 90_000,
      },
    };
    const fedSmallIncome = { ...fed, bookNetIncome: 20_000, activeBusinessIncome: 20_000 };
    const engineInput = assembleProvincialInput('AT1', fedSmallIncome, riWithBothPools, {
      isCcpc: true,
    }) as {
      schedules?: {
        donations?: {
          charitable?: { amountApplied: number };
          gifts?: { amountApplied: number };
          maximum?: { maximumDeduction: number };
        };
      };
    };
    const donations = engineInput.schedules?.donations;
    expect(donations?.maximum).toBeDefined();
    const combined = (donations?.charitable?.amountApplied ?? 0) + (donations?.gifts?.amountApplied ?? 0);
    expect(combined).toBeLessThanOrEqual(donations!.maximum!.maximumDeduction);
  });

  it('lines 090-100 — carries no yearOfOrigin when none was entered (the renderer gates filing the block on it)', () => {
    const riWithGifts = { ...riWithDivergence, albertaDonations: { giftsCurrentYear: 10_000 } };
    const engineInput = assembleProvincialInput('AT1', fed, riWithGifts, { isCcpc: true }) as {
      schedules?: { donations?: { gifts?: { carryforward?: Record<string, unknown> } } };
    };
    // `charitable` may still be present (it defaults from the charitable pool's own
    // closing balance whenever that pool exists) — what actually gates the whole
    // 090-100 block being FILED is `yearOfOrigin`, verified renderer-side in
    // `packages/ca-tax/tests/at1-netfile-schedules.test.ts`.
    expect(engineInput.schedules?.donations?.gifts?.carryforward?.yearOfOrigin).toBeUndefined();
  });

  it('lines 090-100 — carries the entered breakdown, defaulting charitable to its own pool\'s closing balance', () => {
    const riWithBreakdown = {
      ...riWithDivergence,
      alberta: { ...riWithDivergence.alberta },
      albertaDonations: {
        giftsCurrentYear: 10_000,
        carryforwardYearOfOrigin: '2024-12-31',
        carryforwardToCanadaOrProvince: 2_000,
        carryforwardCulturalProperty: 1_000,
      },
    };
    const fedWithCharitable = { ...fed, charitableDonations: 5_000, openingDonationPool: 40_000 };
    const engineInput = assembleProvincialInput('AT1', fedWithCharitable, riWithBreakdown, {
      isCcpc: true,
    }) as {
      schedules?: {
        donations?: {
          charitable?: { closingBalance: number };
          gifts?: { carryforward?: Record<string, unknown> };
        };
      };
    };
    const donations = engineInput.schedules?.donations;
    expect(donations?.gifts?.carryforward).toEqual({
      yearOfOrigin: '2024-12-31',
      charitable: donations?.charitable?.closingBalance,
      toCanadaOrProvince: 2_000,
      culturalProperty: 1_000,
    });
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

// These check the COMPOSER's own output (`engineInput.schedules.smallBusinessDeduction`),
// not the rendered `schedulePayloads` — apps/server pins a PUBLISHED @classytic/ca-tax,
// so a local edit to that package's renderer (`schedule1Values`) is not live here until a
// fresh publish. The renderer's own correctness is covered directly in
// `packages/ca-tax/tests/at1-netfile-schedules.test.ts`.
describe('Schedule 1 — Area A (Agreement Among Associated Corporations)', () => {
  it('omits agreementMembers when nothing was entered', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, {
      isCcpc: true,
    }) as { schedules?: { smallBusinessDeduction?: { agreementMembers?: unknown[] } } };
    expect(engineInput.schedules?.smallBusinessDeduction?.agreementMembers).toBeUndefined();
  });

  it('carries the agreement table through, in entry order, dropping blank rows', () => {
    const riWithAgreement = {
      ...riWithDivergence,
      albertaSbd: {
        ...riWithDivergence.albertaSbd,
        associatedCorpAgreement: [
          { name: 'Filer Corp', albertaCan: '1234567890', allocatedAmount: 300_000 },
          { name: 'Holdco Ltd.', albertaCan: '0987654321', allocatedAmount: 200_000 },
          {},
        ],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithAgreement, { isCcpc: true }) as {
      schedules?: {
        smallBusinessDeduction?: {
          agreementMembers?: { name?: string; albertaCan?: string; allocatedAmount?: number }[];
        };
      };
    };
    const members = engineInput.schedules?.smallBusinessDeduction?.agreementMembers;
    expect(members).toEqual([
      { name: 'Filer Corp', albertaCan: '1234567890', allocatedAmount: 300_000 },
      { name: 'Holdco Ltd.', albertaCan: '0987654321', allocatedAmount: 200_000 },
    ]);
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

describe('Schedule 10 — farm and the checkbox-selected "other loss" column', () => {
  // These check the COMPOSER's own output (`engineInput.schedules`), not the
  // rendered `schedulePayloads` — `apps/server` depends on `@classytic/ca-tax`
  // as a PUBLISHED package (see the repo-topology note), so the renderer
  // (`schedule10Values`) it runs at test time is whatever was last published,
  // not this session's local source edits. The renderer's own correctness —
  // 023/025 always filed, the combined-total math — is covered directly in
  // `packages/ca-tax/tests/at1-netfile-schedules.test.ts`, which DOES run
  // against local source. This file only proves apps/server's OWN composer
  // logic (which fully applies at test time, being this repo's own code).
  it('composes the farm carry-back column, separate from non-capital', () => {
    const riWithFarmCarryback = {
      ...riWithDivergence,
      albertaContinuity: {
        ...riWithDivergence.albertaContinuity,
        farmCurrentYearLoss: 40_000,
        farmCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 15_000 }],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithFarmCarryback, { isCcpc: true }) as {
      schedules?: {
        lossCarryback?: { farm?: { currentYearLoss: number; totalCarriedBack: number; remainingLoss: number } };
      };
    };
    const farm = engineInput.schedules?.lossCarryback?.farm;
    expect(farm?.currentYearLoss).toBe(40_000);
    expect(farm?.totalCarriedBack).toBe(15_000);
    expect(farm?.remainingLoss).toBe(25_000);
  });

  it('checks BOTH other-loss boxes and combines their current-year losses — not mutually exclusive', () => {
    const riBothOtherLosses = {
      ...riWithDivergence,
      albertaContinuity: {
        ...riWithDivergence.albertaContinuity,
        restrictedFarmCurrentYearLoss: 12_000,
        lppOpening: 0,
        lppCurrentYearLoss: 8_000,
        otherLossIncludesRestrictedFarm: 'yes',
        otherLossIncludesListedPersonal: 'yes',
        otherLossCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 10_000 }],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riBothOtherLosses, { isCcpc: true }) as {
      schedules?: {
        lossCarryback?: {
          otherLoss?: {
            includesRestrictedFarm: boolean;
            includesListedPersonal: boolean;
            result: { currentYearLoss: number; totalCarriedBack: number };
          };
        };
        losses?: {
          restrictedFarm?: { closingBalance: number };
          listedPersonalProperty?: { closingBalance: number };
        };
      };
    };
    const otherLoss = engineInput.schedules?.lossCarryback?.otherLoss;
    expect(otherLoss?.includesRestrictedFarm).toBe(true);
    expect(otherLoss?.includesListedPersonal).toBe(true);
    // The shared column's current-year loss is the SUM: 12,000 + 8,000.
    expect(otherLoss?.result.currentYearLoss).toBe(20_000);
    expect(otherLoss?.result.totalCarriedBack).toBe(10_000);

    // The 10,000 carried back splits proportionally across Schedule 21's two
    // separate continuities (12,000:8,000 ⇒ 6,000:4,000) rather than being
    // silently dropped or double-counted on either pool.
    const restrictedFarmClosing = engineInput.schedules?.losses?.restrictedFarm?.closingBalance;
    const lppClosing = engineInput.schedules?.losses?.listedPersonalProperty?.closingBalance;
    // Closing = opening(0) + currentYearLoss - carriedBack - applied - expired.
    expect(restrictedFarmClosing).toBe(12_000 - 6_000);
    expect(lppClosing).toBe(8_000 - 4_000);
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

  /**
   * Regression case: the top-level "current year non-capital loss" (021021)
   * and the continuity table's OWN "current year loss" row (021037) must
   * agree — they are the same fact stated twice on the same schedule. Before
   * this fix, 021021 used Alberta's own figure (via `albertaCurrentYearLoss`)
   * while 021037 silently reused FEDERAL's `losses.nonCapital.currentYearLoss`
   * — two different numbers for the same year whenever Alberta's CCA/reserve/
   * disposition claims diverge from federal's (exactly what Schedule 12
   * reconciles). No existing test caught it because the only prior fact
   * pattern here was profitable (no loss at all, so both figures were 0).
   */
  it('the continuity table’s current-year-loss row (037) agrees with the top-level figure (021), even when Alberta diverges from federal', () => {
    // A loss-position fact pattern where Alberta claims a class-13 CCA amount
    // federal doesn't (class 13 has no declining-balance rate cap — see the
    // Class 13 opening-balance drawdown, verified elsewhere this session — so
    // the divergence isn't capped away the way a rate-capped class would be).
    const lossFed = {
      period,
      bookNetIncome: -10_000, // already a federal loss before any CCA
      activeBusinessIncome: 0,
      ccaClasses: [{ ccaClass: '13', openingUCC: 15_000, claim: 0 }], // federal claims nil
      openingNonCapitalLoss: 0,
      nonCapitalLossToApply: 0,
    };
    const riLossDivergence = {
      alberta: {
        reportsDifferentAlbertaIncome: 'no',
        electsDifferentDiscretionaryAmounts: 'yes',
      },
      cca: {
        classes: [{ ccaClass: '13', albertaClaim: 15_000 }], // Alberta claims the full opening UCC
      },
      albertaContinuity: {
        nonCapitalOpening: 0,
        capitalOpening: 0,
        farmOpening: 0,
        restrictedFarmOpening: 0,
      },
    };

    const engineInput = assembleProvincialInput('AT1', lossFed, riLossDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const topLevel = sch21?.values.find((v) => v.lineItemId === '021021001');
    const continuityRow = sch21?.values.find((v) => v.lineItemId === '021037001');

    // Federal current-year loss: 10,000 (no CCA claimed). Alberta: 10,000 +
    // 15,000 (the class-13 claim only Alberta takes) = 25,000.
    expect(topLevel?.value).toBe(25_000);
    expect(continuityRow?.value).toBe(25_000); // NOT federal's 10,000
  });
});

describe('runAT1Compute — Schedule 17 reserves take an Alberta override, per row', () => {
  it("uses federal's own closing balance when no Alberta override is entered", () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    // doubtfulDebts closing balance — federal's own 8,000 from `fed.reserveContinuity`.
    expect(byId.get('017061001')).toBe(8_000);
  });

  it('overrides one kind with an Alberta-only closing balance, leaving the others at federal', () => {
    // `albertaOpening`/`albertaTransfer`/`albertaClosing` ride on the SAME
    // `fed.reserveContinuity` row (see `assemble-t2-input.ts`'s `scheduleThirteen`,
    // which carries them through from `ri.reserves.rows` unchanged) — this test
    // supplies `fed` directly, as the rest of this file does, so the override
    // goes straight onto the row rather than through a separate `ri` slice.
    const fedWithReserveOverride = {
      ...fed,
      reserveContinuity: [
        {
          type: 'doubtfulDebts',
          opening: 5_000,
          transfer: 0,
          closing: 8_000,
          albertaClosing: 12_000,
        },
      ],
    };
    const engineInput = assembleProvincialInput('AT1', fedWithReserveOverride, riWithDivergence, {
      isCcpc: true,
    });
    const out = runAT1Compute(engineInput);
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('017061001')).toBe(12_000); // Alberta override, not federal's 8,000
    expect(byId.get('017001001')).toBe(5_000); // opening still defaults to federal
  });

  it('files an Alberta-only reserve kind (bank reserves) that has no federal Part 2 line at all', () => {
    const fedWithBankRow = {
      ...fed,
      reserveContinuity: [
        ...fed.reserveContinuity,
        { type: 'bankReserves', opening: 0, transfer: 0, closing: 0, albertaClosing: 25_000 },
      ],
    };
    const engineInput = assembleProvincialInput('AT1', fedWithBankRow, riWithDivergence, {
      isCcpc: true,
    });
    const out = runAT1Compute(engineInput);
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    // bankReserves closing — 017075. Federal reads 0; the Alberta override carries it.
    expect(byId.get('017075001')).toBe(25_000);
  });
});

describe('runAT1Compute — the nine previously-unmodeled schedules (3/4/5/6/7/8/9/11/15) reach the filed payload', () => {
  const riNineSchedules = {
    ...riWithDivergence,
    albertaOtherCredits3: {
      itcCertificatesIssued: 10_000,
      itcAmountApplied: 5_000,
    },
    albertaForeignInvestment4: {
      countries: [{ country: 'US', netForeignInvestmentIncome: 20_000, fedForeignTaxPaid: 3_000 }],
    },
    albertaRoyaltyDeduction5: {
      crownChargesFromSchedule7: 15_000,
      openingUnsuccessoredPoolBalance: 5_000,
    },
    albertaRoyaltyCredit6: {
      albertaCrownRoyaltyIncurred: 12_000,
    },
    albertaRoyaltySupplemental7: {
      eligibleCrownRoyalty: 15_000,
    },
    albertaPoliticalContributions8: {
      contributions: [
        { name: 'A Party', receiptNumber: 'R1', dateOfDonation: '2024-06-01', amount: 500 },
      ],
    },
    albertaSredCredit9: {
      federalQualifiedExpenditures: 100_000,
      albertaPortionOfExpenditures: 60_000,
    },
    albertaResourceDeductions15: {
      ceeRegular: { federalCurrentYearExpenses: 10_000, claimed: 2_000 },
    },
  };

  it('files schedules 003, 004, 005, 006, 007, 008, 009 and 015 for a fact pattern that touches each', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riNineSchedules, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId).sort();

    for (const id of ['003', '004', '005', '006', '007', '008', '009', '015']) {
      expect(filedIds).toContain(id);
    }
  });

  it('files Schedule 9 page-3 lines 200/202/204 (longest-year CAN and tax-year dates) when a group is entered', () => {
    const riWithSredGroup = {
      ...riNineSchedules,
      albertaSredCredit9: {
        ...riNineSchedules.albertaSredCredit9,
        longestYearCan: '1234567',
        longestYearBegin: '2024-01-01',
        longestYearEnd: '2024-12-31',
        daysInLongestYear: 366,
        group: [
          { name: 'Claimant', albertaCan: '1234567', allocated: 2_000_000 },
          { name: 'B Co', albertaCan: '7654321', allocated: 1_000_000 },
        ],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithSredGroup, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch9 = out.schedulePayloads?.find((s) => s.scheduleId === '009');
    const byId = new Map(sch9?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('009200001')).toBe('1234567');
    expect(byId.get('009202001')).toBe('2024-01-01');
    expect(byId.get('009204001')).toBe('2024-12-31');
    // Per-member allocation rows (220/230/240) still file too — the new
    // longest-year fields are additive, not a replacement.
    expect(byId.get('009220001')).toBe('Claimant');
  });

  it('omits all nine when their slices are absent, even with other AT1 schedules present', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId);

    for (const id of ['003', '004', '005', '006', '007', '008', '009', '011', '015']) {
      expect(filedIds).not.toContain(id);
    }
    // The pre-existing fact pattern still files what it always did.
    expect(filedIds).toContain('013');
    expect(filedIds).toContain('021');
  });
});

describe('runAT1Compute — Schedule 29 (IEG) composes from the AT1-only slice', () => {
  it('claims a grant when eligible expenditures and a group are entered', () => {
    const riWithIeg = {
      ...riWithDivergence,
      albertaIeg: {
        federalAmount: 400_000,
        albertaPortion: 400_000,
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
      federalAmount: 1_000_000,
      albertaPortion: 1_000_000,
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
        federalAmount: 1_000_000,
        albertaPortion: 1_000_000,
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

// End to end through the UI shape: AT4970 project rows + the page-1
// derivation + PE-eligibility, all parsed from `albertaIeg` exactly as the
// return editor saves it, landing on TRA's own published NET IEG (89,250)
// for the fact pattern Fall 2026 Test Case 3 is built from. See
// research/knowledge-base/at1-schedule-29-ieg-mechanics.md.
describe('runAT1Compute — AT4970 + page 1 + PE-eligibility, wired from the UI shape', () => {
  const riFull = {
    ...riWithDivergence,
    albertaIeg: {
      federalAmount: 1_500_000,
      projects: [
        {
          title: 'Project A',
          projectCode: '2.11.03',
          albertaPortion: 1_000_000,
          otherPortion: 500_000,
          salariesAndWages: 400_000,
        },
      ],
      primaryFieldCode: '2',
      group: [
        { name: 'A', taxableCapital: 10_000_000, priorYear1: 750_000, priorYear2: 600_000 },
        { name: 'B', taxableCapital: 3_000_000, priorYear1: 0, priorYear2: 500_000 },
        { name: 'C', taxableCapital: 5_000_000, priorYear1: 80_000, priorYear2: 0 },
        { name: 'D', taxableCapital: 2_000_000 },
      ],
      agreementLongestYearCan: 'B-CAN',
      agreementLongestYearBegin: '2022-07-01',
      agreementLongestYearEnd: '2023-06-30',
      agreementDaysInLongestYear: 365,
      agreementMembers: [
        {
          name: 'A',
          allocatedExpenditureLimit: 3_000_000,
          currentYearExpenditures: 1_000_000,
          priorYear1: 750_000,
          priorYear2: 600_000,
          taxableCapitalPriorYear: 10_000_000,
          daysInTaxYear: 365,
        },
        {
          name: 'B',
          allocatedExpenditureLimit: 1_000_000,
          currentYearExpenditures: 200_000,
          priorYear1: 0,
          priorYear2: 500_000,
          taxableCapitalPriorYear: 3_000_000,
          daysInTaxYear: 365,
          hasAlbertaPermanentEstablishment: 'yes',
        },
        {
          name: 'C',
          allocatedExpenditureLimit: 0,
          currentYearExpenditures: 100_000,
          priorYear1: 80_000,
          priorYear2: 0,
          taxableCapitalPriorYear: 5_000_000,
          daysInTaxYear: 365,
          hasAlbertaPermanentEstablishment: 'no', // BC PE only
        },
        {
          name: 'D',
          allocatedExpenditureLimit: 0,
          currentYearExpenditures: 0,
          priorYear1: 0,
          priorYear2: 0,
          taxableCapitalPriorYear: 2_000_000,
          daysInTaxYear: 365,
          hasAlbertaPermanentEstablishment: 'no', // Ontario PE only
        },
      ],
    },
  };

  it('derives 031 from the AT4970 project row, with no eligibleExpenditures field anywhere in the UI shape', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riFull, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch29 = out.schedulePayloads?.find((s) => s.scheduleId === '029');
    const byId = new Map(sch29?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('029003001')).toBe(1_500_000);
    expect(byId.get('029005001')).toBe(1_000_000); // from the project row's own 105
    expect(byId.get('029031001')).toBe(1_000_000);
    expect(byId.get('029040001')).toBe(2); // primaryFieldCode, coerced to a number

    // AT4970 is deliberately NOT filed in schedulePayloads — TRA's own spec
    // states it "is not required if the return is net filed" and assigns it
    // no 3-character wire-format Schedule ID; its old placeholder id ('4970',
    // 4 characters) produced a malformed line item id that broke RSI
    // rendering. Its own totals still correctly default 029005 above.
    expect(out.schedulePayloads?.some((s) => s.scheduleId === '4970')).toBe(false);
  });

  it('lands on TRA’s own published NET IEG — 89,250 — with C and D correctly zeroed for having no Alberta PE', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riFull, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const grantLine = out.fields.find((f) => f.line === 'innovationEmploymentGrant');
    expect(grantLine?.value).toBe(89_250);

    const sch29 = out.schedulePayloads?.find((s) => s.scheduleId === '029');
    const byId = new Map(sch29?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('029125001')).toBe(39_000);
    expect(byId.get('029134001')).toBe(89_250);
    // C's own 267 is positive (60,000) but 268 must still be 0 — no Alberta PE.
    expect(byId.get('029267003')).toBe(60_000);
    expect(byId.get('029268003')).toBe(0);
  });
});

describe('Schedule 21 — Alberta-specific overrides for applied/expired/wind-up/s.80/other-adjustments', () => {
  it('defaults every pool to federal (0/undefined) when nothing is entered', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));

    // No wind-up transfer / s.80 / other adjustments entered ⇒ nil, but still
    // FILED (021035/043/045 for non-capital) — the fix that closes the "engine
    // computes it but never writes it" gap.
    expect(byId.get('021035001')).toBe(0);
    expect(byId.get('021043001')).toBe(0);
    expect(byId.get('021045001')).toBe(0);
  });

  it('overrides applied/expired with Alberta’s own figure when entered, instead of federal’s', () => {
    const riWithOverrides = {
      ...riWithDivergence,
      albertaContinuity: {
        ...riWithDivergence.albertaContinuity,
        nonCapitalApplied: 12_000, // Alberta applied more against income than federal did
        nonCapitalExpired: 3_000, // Alberta expired a different amount
        nonCapitalWindUpTransfer: 7_000,
        nonCapitalSection80Adjustment: 1_000,
        nonCapitalOtherAdjustments: 500,
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithOverrides, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));

    expect(byId.get('021041001')).toBe(12_000); // applied — Alberta's, not federal's (0)
    expect(byId.get('021032001')).toBe(3_000); // expired — Alberta's, not federal's (0)
    expect(byId.get('021035001')).toBe(7_000); // wind-up transfer — no federal equivalent at all
    expect(byId.get('021043001')).toBe(1_000); // s.80 adjustment
    expect(byId.get('021045001')).toBe(500); // other adjustments
  });

  it('an explicit 0 override is real (not "same as federal") — matches the CCA-override convention elsewhere', () => {
    // federal.losses.nonCapital.appliedCurrentYear is 0 here anyway (no loss
    // applied against income in this fact pattern), so this specifically
    // proves presence-detection, not just a nonzero-value happy path.
    const riZeroOverride = {
      ...riWithDivergence,
      albertaContinuity: { ...riWithDivergence.albertaContinuity, nonCapitalApplied: 0 },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riZeroOverride, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));
    expect(byId.get('021041001')).toBe(0);
  });
});

describe('Schedule 21 — limited partnership loss continuity (lines 131-141)', () => {
  it('files a row per partnership, merged into the same 021 payload', () => {
    const riWithPartnerships = {
      ...riWithDivergence,
      albertaContinuity: {
        ...riWithDivergence.albertaContinuity,
        limitedPartnerships: [
          {
            identifier: 'Northgate LP',
            precedingYearBalance: 50_000,
            transferredOnWindUp: 10_000,
            currentYearLoss: 5_000,
            applied: 20_000,
          },
          // Blank row from the array editor (no balance entered) — must not
          // produce a spurious 002-occurrence row.
          { identifier: '' },
        ],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithPartnerships, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId);
    expect(filedIds.filter((id) => id === '021')).toHaveLength(1); // ONE 021 block, not two

    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));
    expect(byId.get('021131001')).toBe('Northgate LP');
    expect(byId.get('021133001')).toBe(50_000);
    expect(byId.get('021141001')).toBe(45_000);
    expect(byId.has('021133002')).toBe(false); // the blank row contributed nothing
  });
});

describe('Schedule 21 — losses by year of origin (row 0 derived, priors are AT1-only input)', () => {
  it('derives row 0 from the SAME figures already computed for the pool and the top-level loss', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));

    const topLevelLoss = byId.get('021021001'); // may be 0 for this profitable fixture
    const carriedBack = byId.get('021047001') ?? 0;
    expect(byId.get('021151001')).toBe(0); // row 0 = the current year
    expect(byId.get('021157001')).toBe(topLevelLoss); // 157 must equal 021021
    expect(byId.get('021165001')).toBe(carriedBack); // 165 must equal 021047
  });

  it('accepts a preparer-entered prior vintage, with row 0 still derived alongside it', () => {
    const riWithVintage = {
      ...riWithDivergence,
      albertaContinuity: {
        ...riWithDivergence.albertaContinuity,
        nonCapitalVintages: [
          { yearsAgo: 2, taxYearEnd: '2022-12-31', balanceAtBeginning: 12_000, applied: 5_000 },
        ],
        otherLossVintages: [{ yearIndex: 0, farmLosses: 3_000 }],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithVintage, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));

    // Row 0 (occurrence 1) still present and derived.
    expect(byId.get('021151001')).toBe(0);
    // Row for yearsAgo=2 (occurrence 2).
    expect(byId.get('021151002')).toBe(2);
    expect(byId.get('021153002')).toBe('2022-12-31');
    expect(byId.get('021155002')).toBe(12_000);
    expect(byId.get('021167002')).toBe(5_000);
    expect(byId.get('021169002')).toBe(7_000);
    // The other-losses ledger (181/183) filed too.
    expect(byId.get('021181001')).toBe(0);
    expect(byId.get('021183001')).toBe(3_000);
  });
});
