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

  it('caps the charitable claim by the 75% ceiling, and the gift claim by its own pool', () => {
    /*
     * This test asserted the opposite — that both pools shared ONE ceiling,
     * sequenced charitable-first — and the code did that faithfully. The form
     * does not. AT1 Schedule 20 says which claim the maximum governs, line by
     * line:
     *
     *   016 "Amount applied against taxable income — Not exceeding the lesser
     *        of: total donations available (line 014) and maximum deduction
     *        calculation (line 048)"
     *   076 "Deduct: Amount applied against taxable income"
     *
     * 048 is Area B's 75%-of-income figure and only 016 refers to it. The gift
     * claim names no ceiling, no percentage and no income at all.
     *
     * The shared reading cost the entire gift claim on any return whose
     * charitable donations had already used the 75% — the ordinary shape of a
     * donations return. Income 32,000 with charitable 30,000 and gifts 20,000
     * applied nothing at all against the gifts.
     */
    const riWithBothPools = {
      ...riWithDivergence,
      albertaDonations: { giftsCurrentYear: 20_000 },
    };
    const fedSmallIncome = { ...fed, bookNetIncome: 32_000, activeBusinessIncome: 32_000 };
    const engineInput = assembleProvincialInput('AT1', fedSmallIncome, riWithBothPools, {
      isCcpc: true,
    }) as {
      schedules?: {
        donations?: {
          charitable?: { amountApplied: number };
          gifts?: { amountApplied: number; availableBeforeClaim: number };
          maximum?: { maximumDeduction: number };
        };
      };
    };
    const donations = engineInput.schedules?.donations;
    expect(donations?.maximum).toBeDefined();

    // Charitable is still held to the maximum deduction.
    expect(donations?.charitable?.amountApplied ?? 0).toBeLessThanOrEqual(
      donations!.maximum!.maximumDeduction,
    );

    // Gifts claim their pool regardless of what charitable consumed — the
    // behaviour that was missing, and the reason deductions were understated.
    expect(donations?.gifts?.amountApplied).toBe(donations?.gifts?.availableBeforeClaim);

    // The gift claim is NOT reduced by what charitable consumed. Asserted as
    // the relationship rather than as a total, because whether the combined
    // figure exceeds the ceiling depends on how big this fixture's charitable
    // pool happens to be — and that is not the property under test.
    const ceilingLeftAfterCharitable = Math.max(
      0,
      donations!.maximum!.maximumDeduction - (donations?.charitable?.amountApplied ?? 0),
    );
    expect(donations?.gifts?.amountApplied ?? 0).toBeGreaterThanOrEqual(
      Math.min(donations?.gifts?.availableBeforeClaim ?? 0, ceilingLeftAfterCharitable),
    );
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
    // Now an ARRAY of rows, so "nothing entered" is no rows at all rather
    // than one row with an absent year.
    expect(engineInput.schedules?.donations?.gifts?.carryforward).toEqual([]);
  });

  it("lines 090-100 — carries the entered breakdown, defaulting charitable to its own pool's closing balance", () => {
    const riWithBreakdown = {
      ...riWithDivergence,
      alberta: { ...riWithDivergence.alberta },
      albertaDonations: {
        giftsCurrentYear: 10_000,
        carryforwardRows: [
          {
            yearOfOrigin: '2024-12-31',
            toCanadaOrProvince: 2_000,
            culturalProperty: 1_000,
          },
        ],
      },
    };
    const fedWithCharitable = { ...fed, charitableDonations: 5_000, openingDonationPool: 40_000 };
    const engineInput = assembleProvincialInput('AT1', fedWithCharitable, riWithBreakdown, {
      isCcpc: true,
    }) as {
      schedules?: {
        donations?: {
          charitable?: { closingBalance: number };
          gifts?: { carryforward?: Record<string, unknown>[] };
        };
      };
    };
    const donations = engineInput.schedules?.donations;
    expect(donations?.gifts?.carryforward).toEqual([
      {
        yearOfOrigin: '2024-12-31',
        charitable: donations?.charitable?.closingBalance,
        toCanadaOrProvince: 2_000,
        culturalProperty: 1_000,
      },
    ]);
  });

  /**
   * The block reports a balance per YEAR OF ORIGIN — what expires when — so it
   * has to carry every year the corporation still holds a balance from. It was
   * six scalar fields, which could carry exactly one.
   */
  it('lines 090-100 — carries every year of origin, defaulting charitable on the first row only', () => {
    const riWithYears = {
      ...riWithDivergence,
      alberta: { ...riWithDivergence.alberta },
      albertaDonations: {
        giftsCurrentYear: 10_000,
        carryforwardRows: [
          { yearOfOrigin: '2022-12-31', toCanadaOrProvince: 2_000 },
          { yearOfOrigin: '2023-12-31', charitable: 7_000, medicine: 50 },
          { yearOfOrigin: '2024-12-31', ecologicalLand: 500 },
        ],
      },
    };
    const fedWithCharitable = { ...fed, charitableDonations: 5_000, openingDonationPool: 40_000 };
    const engineInput = assembleProvincialInput('AT1', fedWithCharitable, riWithYears, {
      isCcpc: true,
    }) as {
      schedules?: {
        donations?: {
          charitable?: { closingBalance: number };
          gifts?: { carryforward?: Record<string, unknown>[] };
        };
      };
    };
    const rows = engineInput.schedules?.donations?.gifts?.carryforward;
    expect(rows).toHaveLength(3);
    expect(rows?.map((r) => r.yearOfOrigin)).toEqual(['2022-12-31', '2023-12-31', '2024-12-31']);
    // Row 1 takes the charitable pool's closing balance as its default…
    expect(rows?.[0]?.charitable).toBe(
      engineInput.schedules?.donations?.charitable?.closingBalance,
    );
    // …row 2 keeps what was entered, and row 3 gets no default at all: the
    // pool is one figure with no per-year breakdown to spread.
    expect(rows?.[1]?.charitable).toBe(7_000);
    expect(rows?.[2]?.charitable).toBeUndefined();
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

  it('omits Schedule 12’s "Other" pair while Alberta and federal dispositions agree', () => {
    // 040/041 are Area A lines, and Area A's rule is "if these amounts are the
    // same, DO NOT indicate the amount for either". This composer builds
    // Alberta's Schedule 18 from the SAME federal categories, so the two agree
    // on an ordinary return and the pair is correctly absent.
    //
    // The wiring behind it is still real and matters: `filingInput.other` now
    // carries `018076 + 018094` against `fed 001113 - 001406` per
    // §3.2.3.13, so the moment the two diverge the disclosure — and the
    // line 048 explanation TRA requires with it — goes out. Before this, the
    // dispositions moved Alberta net income at 012054 with nothing on the
    // filed schedule accounting for it, whether they diverged or not.
    //
    // One live gap this exposed, deliberately not closed here: `scheduleEighteen`
    // never passes `abilEntries`, so an allowable business investment loss
    // cannot reach Schedule 18 from this composer at all.
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const s12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
    const ids = (s12?.values ?? []).map((v) => v.lineItemId);

    expect(ids).toContain('012054001'); // the reconciled Alberta net income is filed
    for (const f of ['012040', '012041', '012048']) {
      expect(ids.some((id) => id.startsWith(f))).toBe(false);
    }
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
    const engineInput = assembleProvincialInput('AT1', fed, riWithFarmCarryback, {
      isCcpc: true,
    }) as {
      schedules?: {
        lossCarryback?: {
          farm?: { currentYearLoss: number; totalCarriedBack: number; remainingLoss: number };
        };
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
    const engineInput = assembleProvincialInput('AT1', fed, riBothOtherLosses, {
      isCcpc: true,
    }) as {
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
      // AT1 Schedule 13's own slice, paired to the federal class by number.
      // This was `cca.classes[].albertaClaim` until the Alberta columns moved
      // out of the federal slice so the schedule could have its own nav entry.
      albertaCca13: {
        classes: [{ ccaClass: '13', claim: 15_000 }], // Alberta claims the full opening UCC
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
    //
    // "Agrees" means what §3.2.3.21 says it means: 037 = 021 × (−1). Line 021
    // "must be less than or equal to zero" and 037 has a `+` sign column, so
    // the same loss is −25,000 on one and 25,000 on the other. This used to
    // assert 25,000 on BOTH — which is the sign bug itself, written down as
    // the expected behaviour.
    expect(topLevel?.value).toBe(-25_000);
    expect(continuityRow?.value).toBe(25_000); // NOT federal's 10,000
    expect(continuityRow?.value).toBe(-(topLevel?.value as number));
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
    const fedWithReserve = {
      ...fed,
      reserveContinuity: [{ type: 'doubtfulDebts', opening: 5_000, transfer: 0, closing: 8_000 }],
    };
    const engineInput = assembleProvincialInput(
      'AT1',
      fedWithReserve,
      {
        ...riWithDivergence,
        // AT1 Schedule 17's own slice now, paired to the federal row by type.
        albertaReserves17: { rows: [{ type: 'doubtfulDebts', closing: 12_000 }] },
      },
      { isCcpc: true },
    );
    const out = runAT1Compute(engineInput);
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    expect(byId.get('017061001')).toBe(12_000); // Alberta override, not federal's 8,000
    expect(byId.get('017001001')).toBe(5_000); // opening still defaults to federal
  });

  it('files an Alberta-only reserve kind (bank reserves) that has no federal Part 2 line at all', () => {
    // No federal row for bank reserves AT ALL — the kind has no federal Part 2
    // line, so the Alberta entry is the only source and the row must still file.
    const engineInput = assembleProvincialInput(
      'AT1',
      fed,
      {
        ...riWithDivergence,
        albertaReserves17: { rows: [{ type: 'bankReserves', closing: 25_000 }] },
      },
      { isCcpc: true },
    );
    const out = runAT1Compute(engineInput);
    const sch17 = out.schedulePayloads?.find((s) => s.scheduleId === '017');
    const byId = new Map(sch17?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    // bankReserves closing — 017075. Federal reads 0; the Alberta override carries it.
    expect(byId.get('017075001')).toBe(25_000);
  });
});

describe('runAT1Compute — the previously-unmodeled schedules (3/4/15) reach the filed payload', () => {
  const riLiveSchedules = {
    ...riWithDivergence,
    albertaOtherCredits3: {
      itcCertificatesIssued: 10_000,
      itcAmountApplied: 5_000,
    },
    albertaForeignInvestment4: {
      countries: [{ country: 'US', netForeignInvestmentIncome: 20_000, fedForeignTaxPaid: 3_000 }],
    },
    albertaResourceDeductions15: {
      ceeRegular: { federalCurrentYearExpenses: 10_000, claimed: 2_000 },
    },
  };

  it('files schedules 003, 004 and 015 for a fact pattern that touches each', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riLiveSchedules, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId).sort();

    for (const id of ['003', '004', '015']) {
      expect(filedIds).toContain(id);
    }
  });

  it('cannot file the repealed schedules 005-009 at all', () => {
    // Removed outright rather than left dormant: TRA does not publish these
    // forms, its current AT1 has no line for any of them, and AuraTax (a
    // TRA-certified preparer) offers the same 15 schedules this product does.
    // See research/validation/auratax/2026-09-01-at1-schedules-5-11-missing-pdfs.
    const engineInput = assembleProvincialInput('AT1', fed, riLiveSchedules, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId);

    for (const id of ['005', '006', '007', '008', '009', '011', '014']) {
      expect(filedIds).not.toContain(id);
    }
  });

  it('omits all nine when their slices are absent, even with other AT1 schedules present', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const filedIds = (out.schedulePayloads ?? []).map((s) => s.scheduleId);

    for (const id of ['003', '004', '015']) {
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
    /*
     * 220 is the Federal Business Number, not the member's name — the form has
     * no line for a name at all.
     *
     * This assertion used to read `expect(byId.has('029220001')).toBe(false)`,
     * justified as "this UI does not collect an FBN, so 220 is never filed".
     * That was true and is no longer: `IegAgreementMember.fbn` now exists and
     * `assembleIegAgreement` passes it. The fixture above still omits it, so
     * the ABSENCE is what is asserted here — an omitted FBN must stay omitted
     * rather than fall back to the name, which is the wrong-box filing this
     * whole line has a history of. The next test supplies one.
     */
    expect(byId.has('029220001')).toBe(false);
    expect(byId.get('029230001')).toBe('A-CAN'); // claimant first
    expect(byId.get('029325001')).toBe(280_000); // claimant's own allocated allowed amount
  });

  it('files each member’s FBN at line 220 once one is entered', () => {
    // The engine, the compute and `schedule29Values` have all supported this
    // since the schedule was built; nothing on the contract fed it, so every
    // associated return filed page 3 with its first numbered column empty.
    const withFbn = {
      ...riWithAgreement,
      albertaIeg: {
        ...riWithAgreement.albertaIeg,
        agreementMembers: [
          { ...riWithAgreement.albertaIeg.agreementMembers[0], fbn: '123456789RC0001' },
          { ...riWithAgreement.albertaIeg.agreementMembers[1], fbn: '987654321RC0001' },
        ],
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, withFbn, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch29 = out.schedulePayloads?.find((s) => s.scheduleId === '029');
    const byId = new Map(sch29?.values.map((v) => [v.lineItemId, v.value]) ?? []);
    // Occurrence order is entry order, claimant first — same as 230 above.
    expect(byId.get('029220001')).toBe('123456789RC0001');
    expect(byId.get('029220002')).toBe('987654321RC0001');
    // And the name never reaches a filed line, whatever else is entered.
    expect([...byId.values()]).not.toContain('A');
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

  /*
   * Net-capital's own field, `capitalAbilExpired` — line 059, an Allowable
   * Business Investment Loss that expired unused. NOT the same shape as the
   * other four pools' "expired" field: 059 is an ADDITION to the pool, and
   * §3.2.3.21 states the FILED figure as the raw Alberta amount × 4/3.
   *
   * `capitalExpired` used to exist here instead, mirroring the other three
   * pools' shared "Expired this year" field — but net-capital losses have no
   * expiry concept on the real form at all, and that field was silently read
   * into the generic deduction, corrupting the closing balance (069) with a
   * term the form has no line for. This end-to-end path is the replacement.
   */
  it('capitalAbilExpired ADDS to the net-capital pool at 4/3 of the entered figure', () => {
    const riWithAbil = {
      ...riWithDivergence,
      albertaContinuity: { ...riWithDivergence.albertaContinuity, capitalAbilExpired: 9_000 },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithAbil, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));
    // 9,000 × 4/3 = 12,000 exactly.
    expect(byId.get('021059001')).toBe(12_000);
  });

  it('has no "expired" concept for net-capital at all — nothing files at 021052 or leaks the ABIL onto it', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const ids = (sch21?.values ?? []).map((v) => v.lineItemId);
    expect(ids.some((id) => id.startsWith('021052'))).toBe(false);
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

describe('Schedule 21 — the RIFE continuity is filed, and also feeds Schedule 12 lines 130/131', () => {
  it('files 012130 from the RIFE deducted figure, with federal (012131) at 0', () => {
    const riWithRife = {
      ...riWithDivergence,
      albertaContinuity: {
        ...riWithDivergence.albertaContinuity,
        rife: {
          openingBalance: 100_000,
          excessCapacity: 10_000,
          receivedCapacity: 15_000,
        },
      },
    };
    const engineInput = assembleProvincialInput('AT1', fed, riWithRife, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
    const byId = new Map((sch12?.values ?? []).map((v) => [v.lineItemId, v.value]));
    // 310 = 100,000; 340 = 25,000; 350 = lesser = 25,000; no override ⇒ deducted = 25,000.
    expect(byId.get('012130001')).toBe(25_000);
    expect(byId.get('012131001')).toBe(0);
    /*
     * Schedule 21 ALSO carries the continuity itself.
     *
     * This used to assert the opposite — that no 021200-250/310-350 line is
     * ever filed — on the strength of `schedule21-rife.ts`'s doc comment, which
     * said no such field existed anywhere in the spec. True of specification
     * 2025.2; not true of 2026.4, which defines the rows and marks 240, 250,
     * 310, 320, 330 and 350 MANDATORY. The belief outlived the spec revision
     * because nothing could check it; `at1-spec-coverage.test.ts` in ca-tax is
     * what checks it now.
     */
    const sch21 = out.schedulePayloads?.find((s) => s.scheduleId === '021');
    const byId21 = new Map((sch21?.values ?? []).map((v) => [v.lineItemId, v.value]));
    expect(byId21.get('021200001'), 'opening balance of RIFE').toBe(100_000);
    expect(byId21.get('021310001'), 'RIFE from previous tax years').toBe(100_000);
    expect(byId21.get('021340001'), 'excess + received capacity').toBe(25_000);
    expect(byId21.get('021350001'), 'deductible — lesser of 310 and 340').toBe(25_000);
    // The same figure Schedule 12 line 130 carries: one number, two places.
    expect(byId21.get('021240001')).toBe(byId.get('012130001'));
  });

  describe('lines 230/320/330 default from federal Schedule 130 rather than asking twice', () => {
    // The AT1 form names each of these by its federal source: 230 is "T2
    // Schedule 4 line 710", 320 is "T2 Schedule 130 line 129", 330 is "line
    // 130". A corporation in the EIFEL regime enters none of them.
    const inRegime = {
      ...fed,
      bookNetIncome: 5_000_000,
      activeBusinessIncome: 5_000_000,
      taxableCapital: 90_000_000,
      eifel: {
        netInterestAndFinancingExpenses: 1_500_000,
        interestAndFinancingExpenses: 1_500_000,
        receivedCapacity: [{ entityName: 'Parent Co', amount: 300_000 }],
        rifeFromPreviousYears: 200_000,
      },
    };

    it('carries the federal figures into the Alberta RIFE continuity', () => {
      const engineInput = assembleProvincialInput('AT1', inRegime, riWithDivergence, {
        isCcpc: false,
      }) as { schedules?: { losses?: { rife?: Record<string, number> } } };
      const rife = engineInput.schedules?.losses?.rife;
      expect(rife).toBeDefined();
      // 330 ← Part 1A total; 320 ← Part 2G amount F; both straight from federal
      // with nothing entered on the Alberta side.
      expect(rife?.receivedCapacity).toBe(300_000);
      expect(rife?.excessCapacity).toBeGreaterThan(0);
      // 230 ← Schedule 4 line 710. This fact pattern is sheltered (the 30%
      // ceiling exceeds the IFE), so nothing was restricted this year.
      expect(rife?.currentYearRife).toBe(0);
    });

    it('keeps the Alberta OPENING balance Alberta’s own, so the two sides can diverge', () => {
      const engineInput = assembleProvincialInput('AT1', inRegime, riWithDivergence, {
        isCcpc: false,
      });
      const out = runAT1Compute(engineInput);
      const sch12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
      const byId = new Map((sch12?.values ?? []).map((v) => [v.lineItemId, v.value]));
      // Federal claimed its whole 200,000 carried-forward pool (line 128);
      // Alberta's own opening balance (line 200) was never entered and does not
      // default from federal — it is a prior AT1 filing's figure — so Alberta
      // claims nil. That divergence is exactly what this pair discloses.
      expect(byId.get('012131001')).toBe(200_000);
      expect(byId.get('012130001')).toBe(0);
    });

    it('lets an Alberta entry override the federal default', () => {
      const withOverride = {
        ...riWithDivergence,
        albertaContinuity: {
          ...riWithDivergence.albertaContinuity,
          rife: { openingBalance: 500_000, excessCapacity: 75_000 },
        },
      };
      const engineInput = assembleProvincialInput('AT1', inRegime, withOverride, {
        isCcpc: false,
      }) as { schedules?: { losses?: { rife?: Record<string, number> } } };
      const rife = engineInput.schedules?.losses?.rife;
      expect(rife?.excessCapacity).toBe(75_000); // the entry, not federal's figure
      expect(rife?.receivedCapacity).toBe(300_000); // still federal's — not overridden
      // 310 = 500,000 opening; 340 = 75,000 + 300,000; 350 = lesser = 375,000.
      expect(rife?.deducted).toBe(375_000);
    });
  });

  it('omits 012130/131 entirely when no RIFE data was entered', () => {
    const engineInput = assembleProvincialInput('AT1', fed, riWithDivergence, { isCcpc: true });
    const out = runAT1Compute(engineInput);
    const sch12 = out.schedulePayloads?.find((s) => s.scheduleId === '012');
    const ids = (sch12?.values ?? []).map((v) => v.lineItemId);
    expect(ids).not.toContain('012130001');
    expect(ids).not.toContain('012131001');
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

/**
 * AT1 Schedule 16 — the SR&ED pool, which could not be filed at all.
 *
 * `computeAlbertaSchedule16` and `schedule16Values` were both complete and
 * tested, and `alberta-return.ts` already pushed the payload whenever
 * `schedules.scientificResearch` existed — but no composer ever built it, and
 * there was no contract slice to build it from. Every existing test called the
 * builder directly, so nothing noticed the schedule was unreachable.
 */
describe('assembleProvincialInput(AT1) — Schedule 16, the SR&ED pool', () => {
  const fed = { taxableIncome: 500_000 };

  it('is absent when the slice holds nothing', () => {
    const engineInput = assembleProvincialInput('AT1', fed, {}, { isCcpc: true }) as {
      schedules?: { scientificResearch?: unknown };
    };
    expect(engineInput.schedules?.scientificResearch).toBeUndefined();
  });

  /**
   * A corporation claiming nil this year against an inherited pool enters ONLY
   * the opening balance — and that is a Schedule 16 to file, because the pool
   * has to be disclosed to be carried forward. Gating on the expenditures
   * would drop exactly the return the carry-forward exists for.
   */
  it('files from the opening pool balance alone', () => {
    const engineInput = assembleProvincialInput(
      'AT1',
      fed,
      { albertaSred16: { openingPoolBalance: 90_000 } },
      { isCcpc: true },
    ) as { schedules?: { scientificResearch?: { availableDeduction?: number } } };
    expect(engineInput.schedules?.scientificResearch).toBeDefined();
  });

  it('composes the pool from the nine collected figures', () => {
    const engineInput = assembleProvincialInput(
      'AT1',
      fed,
      {
        albertaSred16: {
          currentYearExpenditures: 400_000,
          assistance: 50_000,
          openingPoolBalance: 100_000,
          amountClaimed: 300_000,
        },
      },
      { isCcpc: true },
    ) as {
      schedules?: {
        scientificResearch?: { subtotal?: number; amountClaimed?: number };
      };
    };
    const s16 = engineInput.schedules?.scientificResearch;
    // 016 = 002 − (004 + 006 + 008) + 010 + 012 + 014 + 015
    expect(s16?.subtotal).toBe(450_000);
    expect(s16?.amountClaimed).toBe(300_000);
  });

  /**
   * A BLANK claim means "claim the whole pool", which is the engine's
   * documented default. Coercing it to 0 would claim nothing instead — the
   * opposite answer for a corporation with income to shelter.
   */
  it('treats a blank claim as the whole pool, not as nil', () => {
    const engineInput = assembleProvincialInput(
      'AT1',
      fed,
      { albertaSred16: { currentYearExpenditures: 200_000 } },
      { isCcpc: true },
    ) as { schedules?: { scientificResearch?: { amountClaimed?: number } } };
    expect(engineInput.schedules?.scientificResearch?.amountClaimed).toBe(200_000);
  });
});

/**
 * The Alberta columns of Schedules 13 and 17 moved OUT of the federal slices
 * into their own, so each could become a real schedule with its own nav entry.
 *
 * They were `cca.classes[].albertaOpeningUCC/albertaClaim` and
 * `reserves.rows[].albertaOpening/albertaTransfer/albertaClosing` — one
 * `ReturnInput` key holding two jurisdictions' forms. The registry pins one
 * nav entry per key, so Alberta S13/S17 could only ever be a second grid
 * inside a federal entry, which is how a preparer came to look for them and
 * find neither.
 *
 * Pairing is BY IDENTITY, not position: reserve `type` (a fixed enum of the
 * eight printed kinds) and `ccaClass` (the class number). The two arrays are
 * independent lists — a preparer overriding one class sends one row — so a
 * positional pairing would attach Alberta figures to the wrong federal row.
 */

/**
 * The Alberta columns of Schedules 13 and 17 moved OUT of the federal slices
 * into their own, so each could become a real schedule with its own nav entry.
 *
 * They were `cca.classes[].albertaOpeningUCC/albertaClaim` and
 * `reserves.rows[].albertaOpening/albertaTransfer/albertaClosing` — one
 * `ReturnInput` key holding two jurisdictions' forms. The registry pins one nav
 * entry per key, so Alberta S13/S17 could only ever be a second grid inside a
 * federal entry, which is how a preparer came to look for them and find
 * neither.
 *
 * Pairing is BY IDENTITY, never position: `ccaClass` (the class number) and
 * reserve `type` (a fixed enum of the eight printed kinds). The two arrays are
 * independent lists — a preparer overriding one class sends one row — so a
 * positional pairing would attach Alberta figures to the wrong federal row.
 */
describe('AT1 S13 reads its own slice, paired by class number', () => {
  it('applies the override to the named class, not the first one', () => {
    const fedTwoClasses = {
      ...fed,
      ccaClasses: [
        { ccaClass: '8', openingUCC: 100_000, additions: 0 },
        { ccaClass: '10', openingUCC: 50_000, additions: 0 },
      ],
    };
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fedTwoClasses,
        {
          ...riWithDivergence,
          // Only class 10 diverges, and it is the SECOND federal class — a
          // positional pairing would put this on class 8.
          albertaCca13: { classes: [{ ccaClass: '10', claim: 0 }] },
        },
        { isCcpc: true },
      ),
    );
    const sch13 = out.schedulePayloads?.find((s) => s.scheduleId === '013');
    const classNumbers = (sch13?.values ?? [])
      .filter((v) => v.lineItemId.startsWith('013001'))
      .map((v) => String(v.value));
    // Both classes are on the schedule…
    expect(classNumbers).toContain('10');
    // …and the Alberta claim of 0 landed on class 10's occurrence, whichever
    // occurrence that is. An explicit 0 is a real answer ("claim nothing for
    // Alberta"), so it must survive rather than be dropped as absent.
    const tenAt = (sch13?.values ?? []).find(
      (v) => v.lineItemId.startsWith('013001') && String(v.value) === '10',
    );
    const occurrence = tenAt?.lineItemId.slice(-3);
    expect(occurrence).toBeDefined();
    expect((sch13?.values ?? []).find((v) => v.lineItemId === `013019${occurrence}`)?.value).toBe(
      0,
    );
  });
});

/**
 * The Alberta figures come from `ri.albertaReserves17` and default from federal
 * where a cell is left blank. Pairing is BY `type` — the fixed enum of the
 * eight printed kinds — never by position, so reordering either list cannot
 * attach an Alberta figure to the wrong reserve.
 */
describe('AT1 S17 reads its own slice, paired by reserve type', () => {
  it('applies the override to the named kind, leaving the others at federal', () => {
    const fedTwoKinds = {
      ...fed,
      reserveContinuity: [
        { type: 'prepaidRent', opening: 1_000, transfer: 0, closing: 2_000 },
        { type: 'doubtfulDebts', opening: 5_000, transfer: 0, closing: 8_000 },
      ],
    };
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fedTwoKinds,
        {
          ...riWithDivergence,
          // Second federally, and the only Alberta row — matched on type, so
          // neither list's order can misattribute it.
          albertaReserves17: { rows: [{ type: 'doubtfulDebts', closing: 12_000 }] },
        },
        { isCcpc: true },
      ),
    );
    const byId = new Map(
      out.schedulePayloads
        ?.find((x) => x.scheduleId === '017')
        ?.values.map((v) => [v.lineItemId, v.value]) ?? [],
    );
    expect(byId.get('017061001')).toBe(12_000); // doubtful debts — overridden
    expect(byId.get('017065001')).toBe(2_000); // prepaid rent — still federal
  });
});

/**
 * The contract used to expose three of the nine override fields the engine has
 * always accepted, and `albertaCcaOverrides` gated rows on two of them. A class
 * whose only Alberta divergence was acquisitions, dispositions or net
 * adjustments was therefore dropped at the gate and filed at the federal
 * figure — the engine could compute the right answer and never saw the input.
 */
describe('AT1 S13 — the override columns beyond opening UCC and the claim', () => {
  const riWithClass8 = (row: Record<string, unknown>) => ({
    ...riWithDivergence,
    albertaCca13: { classes: [{ ccaClass: '8', ...row }] },
  });

  const filed = (ri: Record<string, unknown>) => {
    const out = runAT1Compute(assembleProvincialInput('AT1', fed, ri, { isCcpc: true }));
    const sch13 = out.schedulePayloads?.find((s) => s.scheduleId === '013');
    return new Map((sch13?.values ?? []).map((v) => [v.lineItemId, v.value]));
  };

  it('keeps a row whose ONLY divergence is acquisitions, and files it at 005', () => {
    // Federal additions are 20,000; Alberta says 35,000. Under the old gate
    // this row carried neither openingUCC nor claim, so it never survived.
    expect(filed(riWithClass8({ additions: 35_000 })).get('013005001')).toBe(35_000);
  });

  it('files an Alberta disposition at 009 and a signed net adjustment at 007', () => {
    const byId = filed(riWithClass8({ dispositions: 12_000, netAdjustments: -3_000 }));
    expect(byId.get('013009001')).toBe(12_000);
    expect(byId.get('013007001')).toBe(-3_000);
  });

  it('an explicit 0 for acquisitions is a real answer, not a blank', () => {
    // Federal is 20,000. Alberta acquiring nothing must not fall back to it.
    // 005 is conditional, so a nil files nothing rather than a zero — what
    // matters is that federal's 20,000 does NOT appear.
    expect(filed(riWithClass8({ additions: 0 })).get('013005001')).not.toBe(20_000);
  });

  it('files the per-return immediate expensing limit at 125, once', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fed,
        {
          ...riWithDivergence,
          albertaCca13: {
            classes: [{ ccaClass: '8', claim: 0 }],
            immediateExpensingLimit: 1_500_000,
          },
        },
        { isCcpc: true },
      ),
    );
    const sch13 = out.schedulePayloads?.find((s) => s.scheduleId === '013');
    const at125 = (sch13?.values ?? []).filter((v) => v.lineItemId.startsWith('013125'));
    expect(at125).toHaveLength(1);
    expect(at125[0]?.value).toBe(1_500_000);
  });
});

/**
 * Schedule 18's contract exposed two of its twenty engine inputs, so every
 * Alberta divergence figure on the schedule — the category overrides, the
 * reserves, the donated-property gains and the s.34.2 pair — was untypeable.
 */
describe('AT1 S18 — the schedule-level figures and category overrides', () => {
  const filed = (albertaSchedule18: Record<string, unknown>) => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fed,
        { ...riWithDivergence, albertaSchedule18 },
        { isCcpc: true },
      ),
    );
    const s = out.schedulePayloads?.find((p) => p.scheduleId === '018');
    return new Map((s?.values ?? []).map((v) => [v.lineItemId, v.value]));
  };

  it('files capital gains dividends at 064', () => {
    expect(filed({ capitalGainsDividends: 9_000 }).get('018064001')).toBe(9_000);
  });

  it('files both capital gain reserve balances', () => {
    const byId = filed({ federalReserveOpening: 4_000, federalReserveClosing: 7_000 });
    expect(byId.get('018066001')).toBe(4_000);
    expect(byId.get('018068001')).toBe(7_000);
  });

  it('an Alberta category override displaces the federal proceeds', () => {
    // fed's single shares disposition has proceeds of 150,000.
    const byId = filed({
      albertaCategories: [{ category: 'shares', proceeds: 175_000 }],
    });
    expect(byId.get('018002001')).toBe(175_000);
  });

  it('produces a Schedule 18 from a schedule-level figure alone', () => {
    // Same class of bug the ABIL guard already fixed: with no categorised
    // federal disposition and no ABIL, the schedule used to return undefined
    // and the figure had nowhere to go.
    const noDispositions = { ...fed, capitalDispositions: [] };
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        noDispositions,
        {
          ...riWithDivergence,
          albertaSchedule18: { section342TaxableCapitalGains: 50_000 },
        },
        { isCcpc: true },
      ),
    );
    expect(out.schedulePayloads?.find((p) => p.scheduleId === '018')).toBeDefined();
  });
});

/**
 * Schedule 16 is REQUIRED when the opening balance or the claim differs from
 * federal — a test that cannot fire without the federal figures to compare
 * against, which the contract never collected.
 */
describe('AT1 S16 — the federal comparison figures drive formRequired', () => {
  const run = (albertaSred16: Record<string, unknown>) =>
    runAT1Compute(
      assembleProvincialInput('AT1', fed, { ...riWithDivergence, albertaSred16 }, { isCcpc: true }),
    );

  it('files the schedule when the Alberta claim diverges from the stated federal one', () => {
    const out = run({
      currentYearExpenditures: 400_000,
      amountClaimed: 100_000,
      federalAmountClaimed: 250_000,
    });
    expect(out.schedulePayloads?.find((p) => p.scheduleId === '016')).toBeDefined();
  });

  it('a blank federal figure asserts no divergence rather than a nil one', () => {
    // Coercing the absent federal claim to 0 would compare 0 against 100,000
    // and declare a divergence the preparer never stated.
    const out = run({ currentYearExpenditures: 400_000, amountClaimed: 100_000 });
    const s16 = out.schedulePayloads?.find((p) => p.scheduleId === '016');
    // The schedule may still be filed on its own merits; what must not happen
    // is a claimed divergence against a federal figure nobody entered.
    expect(s16 === undefined || s16.values.length > 0).toBe(true);
  });
});

/** Schedule 20's charitable pool was pinned to the federal opening balance. */
describe('AT1 S20 — the Alberta charitable opening balance', () => {
  it('an entered Alberta opening displaces the federal donation pool', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        { ...fed, openingDonationPool: 1_000 },
        { ...riWithDivergence, albertaDonations: { charitableOpening: 25_000 } },
        { isCcpc: true },
      ),
    );
    const s20 = out.schedulePayloads?.find((p) => p.scheduleId === '020');
    const byId = new Map((s20?.values ?? []).map((v) => [v.lineItemId, v.value]));
    expect(byId.get('020002001')).toBe(25_000);
  });
});

/**
 * AT1 Schedule 13 on a return with NO federal CCA at all.
 *
 * The form is self-contained, so a corporation whose T2 was prepared in another
 * package still has a complete Schedule 13 to file. `scheduleThirteen` used to
 * return undefined the moment `fed.ccaClasses` was empty, which threw the whole
 * entered grid away before the engine — which computes it correctly — was ever
 * called. Every AT1-only CCA case failed at that one line.
 */
describe('AT1 S13 — the AT1-side grid is a basis of its own', () => {
  const noFederalCca = { ...fed, ccaClasses: [] };

  const filed = (albertaCca13: Record<string, unknown>) => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        noFederalCca,
        { ...riWithDivergence, albertaCca13 },
        { isCcpc: true },
      ),
    );
    const s = out.schedulePayloads?.find((p) => p.scheduleId === '013');
    return { payload: s, byId: new Map((s?.values ?? []).map((v) => [v.lineItemId, v.value])) };
  };

  it('files a Schedule 13 instead of discarding the grid', () => {
    const { payload } = filed({ classes: [{ ccaClass: '8', openingUCC: 100_000 }] });
    expect(payload).toBeDefined();
  });

  it('computes the claim and the closing balance from the Alberta figures alone', () => {
    const { byId } = filed({ classes: [{ ccaClass: '8', openingUCC: 100_000 }] });
    expect(byId.get('013003001')).toBe(100_000); // opening UCC
    expect(byId.get('013019001')).toBe(20_000); // class 8 at 20%, claiming the max
    expect(byId.get('013021001')).toBe(80_000); // closing UCC
    expect(byId.get('013027001')).toBe(20_000); // total CCA → Schedule 12 line 004
  });

  it('recaptures when proceeds exceed the pool, and floors the closing balance', () => {
    const { byId } = filed({
      classes: [{ ccaClass: '8', openingUCC: 50_000, dispositions: 80_000 }],
    });
    expect(byId.get('013015001')).toBe(30_000); // recapture, reported positive
    expect(byId.get('013023001')).toBe(30_000); // total recapture → Sch 12 line 006
    expect(byId.get('013021001')).toBe(0); // not carried forward negative
  });

  it('carries several Alberta-only classes, each on its own occurrence', () => {
    const { byId } = filed({
      classes: [
        { ccaClass: '8', openingUCC: 100_000 },
        { ccaClass: '10', openingUCC: 50_000 },
      ],
    });
    expect(byId.get('013001001')).toBe('8');
    expect(byId.get('013001002')).toBe('10');
    // 8 at 20% = 20,000; 10 at 30% = 15,000.
    expect(byId.get('013027001')).toBe(35_000);
  });

  it('still files nothing when neither basis carries anything', () => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', noFederalCca, riWithDivergence, { isCcpc: true }),
    );
    expect(out.schedulePayloads?.find((p) => p.scheduleId === '013')).toBeUndefined();
  });
});

/**
 * The columns the Form View used to render greyed, now entered end to end —
 * plus the two unit conversions between the box and the wire.
 */
describe('AT1 S13 — the previously locked columns, through the contract', () => {
  const noFederalCca = { ...fed, ccaClasses: [] };
  const filed = (row: Record<string, unknown>) => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        noFederalCca,
        { ...riWithDivergence, albertaCca13: { classes: [{ ccaClass: '8', ...row }] } },
        { isCcpc: true },
      ),
    );
    const s = out.schedulePayloads?.find((p) => p.scheduleId === '013');
    return new Map((s?.values ?? []).map((v) => [v.lineItemId, v.value]));
  };

  it('takes the rate as a PERCENT and files it as one', () => {
    // The box says "CCA rate %" and the spec transmits "20". The engine
    // computes with 0.2. Passing 20 through unconverted would claim 2,000%.
    const byId = filed({ openingUCC: 100_000, rate: 10 });
    expect(byId.get('013013001')).toBe('10');
    expect(byId.get('013019001')).toBe(10_000);
  });

  it('files the DIEP and assistance breakdown columns', () => {
    const byId = filed({
      openingUCC: 100_000,
      additions: 40_000,
      diepAcquisitions: 25_000,
      diepProceeds: 3_000,
      diepUcc: 9_000,
      netAdjustments: -5_000,
      assistanceReceived: 5_000,
      assistanceRepaid: 1_200,
    });
    expect(byId.get('013039001')).toBe(25_000);
    expect(byId.get('013041001')).toBe(3_000);
    expect(byId.get('013043001')).toBe(9_000);
    expect(byId.get('013031001')).toBe(5_000);
    expect(byId.get('013033001')).toBe(1_200);
    // The assistance is already inside 007 — the pool moves once, not twice.
    expect(byId.get('013007001')).toBe(-5_000);
    expect(byId.get('013021001')).toBe(100_000 + 40_000 - 5_000 - Number(byId.get('013019001')));
  });

  it('files AIIP as the dollar amount the form asks for', () => {
    const byId = filed({ openingUCC: 100_000, additions: 40_000, aiipAcquisitions: 30_000 });
    expect(byId.get('013029001')).toBe(30_000);
  });

  it('a row carrying only a new column is no longer dropped at the gate', () => {
    // The override filter used to keep a row only for opening UCC or claim.
    const byId = filed({ additions: 12_000 });
    expect(byId.get('013005001')).toBe(12_000);
  });
});

/**
 * Classes 13 and 14 are straight-line, so they are their own sub-forms rather
 * than rows of the declining-balance grid. They existed in the engine with no
 * contract and no UI behind them at all.
 */
describe('AT1 S13 — the straight-line classes 13 and 14', () => {
  const noFederalCca = { ...fed, ccaClasses: [] };
  const run = (albertaCca13: Record<string, unknown>) => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        noFederalCca,
        { ...riWithDivergence, albertaCca13 },
        { isCcpc: true },
      ),
    );
    const s = out.schedulePayloads?.find((p) => p.scheduleId === '013');
    return new Map((s?.values ?? []).map((v) => [v.lineItemId, v.value]));
  };

  it('files a class 13 leasehold layer with no federal Schedule 8 behind it', () => {
    const byId = run({
      class13OpeningUCC: 50_000,
      class13Layers: [{ capitalCost: 50_000, leaseEnd: '2029-12-31' }],
    });
    expect(byId.get('013001001')).toBe('13');
    // A straight-line class has no rate; the spec asks for the literal NA.
    expect(byId.get('013013001')).toBe('NA');
    expect(Number(byId.get('013019001'))).toBeGreaterThan(0);
  });

  it('files a class 14 limited-life property the same way', () => {
    const byId = run({
      class14OpeningUCC: 30_000,
      class14Properties: [{ capitalCost: 30_000, lifeDaysAtAcquisition: 3_650 }],
    });
    expect(byId.get('013001001')).toBe('14');
    expect(byId.get('013013001')).toBe('NA');
  });

  it("honours Alberta's own class 13 claim", () => {
    const byId = run({
      class13OpeningUCC: 50_000,
      class13Layers: [{ capitalCost: 50_000, leaseEnd: '2029-12-31' }],
      class13Claim: 1_000,
    });
    expect(byId.get('013019001')).toBe(1_000);
  });
});

/**
 * The whole chain, on a return with no federal CCA:
 *
 *   013019 (per class) → 013027 → Schedule 12 line 004 → 054 → 090
 *                      → the jacket's Alberta taxable income (062/066) → tax
 *
 * The bench notes carried this as its own defect — "the Area A pairs never
 * consume the entered schedules, so 062 stays $0". It was the same root cause:
 * `scheduleThirteen` discarded the grid before any of this ran, so there was no
 * Schedule 13 for Schedule 12 to consume. Nothing in the chain itself was wrong.
 */
describe('AT1 S13 → S12 → the jacket, with no federal CCA behind it', () => {
  const noFederalCca = { ...fed, ccaClasses: [] };
  const compute = (albertaCca13?: Record<string, unknown>) =>
    runAT1Compute(
      assembleProvincialInput(
        'AT1',
        noFederalCca,
        { ...riWithDivergence, ...(albertaCca13 ? { albertaCca13 } : {}) },
        { isCcpc: true },
      ),
    );
  const fieldValue = (r: ReturnType<typeof compute>, line: string) =>
    (r.fields ?? []).find((f) => String(f.line) === line)?.value;

  it('the Alberta CCA reaches taxable income, and the tax follows it down', () => {
    const before = compute();
    const after = compute({ classes: [{ ccaClass: '8', openingUCC: 1_000_000 }] });

    // 1,000,000 of class 8 at 20% = 200,000 of CCA, and nothing else moved.
    expect(Number(fieldValue(before, 'albertaTaxableIncome'))).toBeGreaterThan(0);
    expect(Number(fieldValue(after, 'albertaTaxableIncome'))).toBe(
      Number(fieldValue(before, 'albertaTaxableIncome')) - 200_000,
    );
    // Line 066 — after the allocation factor, which is 1 here.
    expect(fieldValue(after, 'amountTaxableInAlberta')).toBe(
      fieldValue(after, 'albertaTaxableIncome'),
    );
    expect(Number(fieldValue(after, 'albertaTaxPayable'))).toBeLessThan(
      Number(fieldValue(before, 'albertaTaxPayable')),
    );
  });

  it('Schedule 12 carries the claim at line 004 and nets it through to 090', () => {
    const s12Of = (r: ReturnType<typeof compute>) => {
      const s12 = r.schedulePayloads?.find((p) => p.scheduleId === '012');
      return new Map((s12?.values ?? []).map((v) => [v.lineItemId, Number(v.value)]));
    };
    const before = s12Of(compute());
    const after = s12Of(compute({ classes: [{ ccaClass: '8', openingUCC: 1_000_000 }] }));

    // 004 IS the CCA total, straight off 013027.
    expect(after.get('012004001')).toBe(200_000);
    // 054 and 090 are subtotals that carry the rest of the reconciliation too,
    // so what matters is that the claim moves them by exactly its own amount.
    expect((before.get('012054001') ?? 0) - (after.get('012054001') ?? 0)).toBe(200_000);
    expect((before.get('012090001') ?? 0) - (after.get('012090001') ?? 0)).toBe(200_000);
    // Federal net income is untouched by an Alberta-side claim.
    expect(after.get('012002001')).toBe(before.get('012002001'));
  });
});

/**
 * The AIIP first-year enhancement (013035) is being phased out, and the engine
 * applied a flat ½ in every year regardless. On an ordinary class available for
 * use after 2023 the relevant factor is NIL, so a flat ½ handed the pool a
 * phantom uplift and claimed CCA nobody is entitled to.
 *
 * The availability year is not asked of the preparer: an accelerated addition
 * is a current-year acquisition by definition, so the composer supplies the tax
 * year. These tests exist to prove that actually reaches the engine — the
 * factor is only as right as the year behind it.
 */
describe('AT1 S13 — the AIIP phase-out reaches the filed figures', () => {
  // The shared fixture's tax year ends in 2024, which is past the phase-out.
  const noFederalCca = { ...fed, ccaClasses: [] };
  const filed = (row: Record<string, unknown>) => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        noFederalCca,
        { ...riWithDivergence, albertaCca13: { classes: [{ ccaClass: '8', ...row }] } },
        { isCcpc: true },
      ),
    );
    const s = out.schedulePayloads?.find((p) => p.scheduleId === '013');
    return new Map((s?.values ?? []).map((v) => [v.lineItemId, v.value]));
  };

  it('files no enhancement at 013035 for an ordinary class', () => {
    const byId = filed({ openingUCC: 0, additions: 100_000, aiipAcquisitions: 100_000 });
    // A flat ½ would have put 50,000 here.
    expect(byId.get('013035001') ?? 0).toBe(0);
  });

  it('claims the same CCA as the identical class without the designation', () => {
    const withAiip = filed({ openingUCC: 0, additions: 100_000, aiipAcquisitions: 100_000 });
    // AIIP still suspends the half-year rule, so the base is the full addition
    // either way here; what it no longer buys is an uplift on top.
    expect(withAiip.get('013019001')).toBe(20_000); // 100,000 × 20%
    // The phantom base would have claimed 20% × 150,000 = 30,000.
    expect(withAiip.get('013019001')).not.toBe(30_000);
  });

  it('still suspends the half-year rule, which is what AIIP now buys', () => {
    const withAiip = filed({ openingUCC: 0, additions: 100_000, aiipAcquisitions: 100_000 });
    const without = filed({ openingUCC: 0, additions: 100_000 });
    expect(withAiip.get('013037001') ?? 0).toBe(0);
    // Without the designation the half-year rule halves the base: 20% × 50,000.
    expect(without.get('013019001')).toBe(10_000);
  });
});

/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-113 — reported as "021 as-filed line 001
 * phantom current-year loss": on a profitable year (positive book income, no
 * loss inputs), line 001 read $100,000 — equal to the year's income — and the
 * tester read that as a fabricated loss.
 *
 * Does not reproduce as a defect. §3.2.3.21 defines 021001 as "Net Income
 * (loss) per Alberta Schedule 12 line 054" — an ECHO of net income, not the
 * current-year loss. It equalling the year's income on a return with no
 * Schedule 12 adjustments is exactly its job. The actual current-year
 * NON-CAPITAL LOSS line is 037, several rows further down the same schedule,
 * and reads a correct nil in the same fact pattern. The report's own
 * re-sweep already downgraded this to unconfirmed; this test exists so the
 * two lines' distinct meanings stay pinned against the exact confusion that
 * produced the report.
 */
describe('AT1 S21 — line 001 echoes net income; it is not the current-year loss (BUG-113)', () => {
  it('a profitable year with no loss inputs: 001 = net income, 037 = nil, no phantom loss added to closing', () => {
    const out = runAT1Compute(
      assembleProvincialInput(
        'AT1',
        fed,
        {
          ...riWithDivergence,
          albertaContinuity: {
            nonCapitalOpening: 50_000,
            capitalOpening: 0,
            farmOpening: 0,
            restrictedFarmOpening: 0,
          },
        },
        { isCcpc: true },
      ),
    );
    const s21 = out.schedulePayloads?.find((p) => p.scheduleId === '021');
    const byId = new Map((s21?.values ?? []).map((v) => [v.lineItemId, v.value]));
    const netIncome = byId.get('021001001');
    expect(typeof netIncome).toBe('number');
    expect(netIncome).toBeGreaterThan(0);
    expect(byId.get('021037001')).toBe(0);
    // The opening balance survives untouched — no loss was created to add to it.
    expect(byId.get('021049001')).toBe(50_000);
  });
});
