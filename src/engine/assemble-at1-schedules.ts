/**
 * Federal T2 result + AT1-only inputs → the Alberta engine's `schedules` /
 * `ieg` composition.
 *
 * `assembleProvincialInput` already runs a full `computeFederalT2()` and used
 * to discard everything on the result except `.taxableIncome` — meaning the
 * running product filed only the AT1 jacket, never any of the 11 supporting
 * schedules the engine can compute. This is the composition layer that closes
 * that gap: for each schedule, reshape federal data (+ whatever AT1-only
 * input genuinely cannot be derived from anywhere else) into the AT1
 * schedule's own input, run ITS OWN compute function, and assemble the
 * results into the shape `AlbertaReturnInput.schedules` expects.
 *
 * One file per the existing convention in this directory (`assemble-t2-input.ts`
 * is the same shape: many small, named, single-purpose functions rather than
 * one undifferentiated blob) — each function imports only the named symbols
 * it uses from `@classytic/ca-tax/t2` (the only subpath this package
 * publishes AT1 symbols under; there is no narrower one to import from).
 *
 * ── What is filed, and why some schedules stay omitted ──────────────────────
 *
 * Schedules 13 (CCA), 17 (reserves) and 18 (dispositions) are RECONCILIATION
 * overlays: TRA's own specification forbids filing them at all unless the
 * preparer has indicated Alberta diverges from federal (AT1 jacket lines
 * 000060 / 000061). So for the common case — no divergence — these are
 * correctly and deliberately omitted, not a bug.
 *
 * Two gaps are NOT closed here, because the underlying calculation does not
 * exist on EITHER side of the engine yet — not a wiring gap, a missing
 * capability:
 *   - Schedule 16 (SR&ED pool) — no federal T661 pool module to derive from.
 *   - Schedule 18's ABIL entries, s.34.2 figures, donated-property gains and
 *     capital-gains reserve continuity — none of this is modelled federally
 *     either. Basic Schedule 18 (six category totals) IS wired.
 * Schedule 20's second continuity (gifts to Canada/province, cultural
 * property, ecological land) has no federal source and no UI yet — also
 * omitted, and worth flagging as a smaller follow-up.
 */
import {
  type AlbertaReturnInput,
  albertaCcaScheduleAdjustments,
  albertaCurrentYearLoss,
  albertaDispositionAdjustments,
  albertaReserveDifference,
  computeAlbertaSbd,
  computeAlbertaSchedule13,
  computeAlbertaSchedule17,
  computeAlbertaSchedule18,
  computeDonationMaximum,
  computeLimitedPartnershipLosses,
  computeLossContinuity,
  computeNonCapitalLossByYearOfOrigin,
  computeOtherLossByYearOfOrigin,
  computeSchedule20,
  type FederalT2Result,
  type IegAgreementInput,
  reconcileAlbertaNetIncome,
  type Schedule12Result,
  schedule12LossDeductions,
} from '@classytic/ca-tax/t2';
import { assembleSchedule3 } from './at1-schedule-composers/schedule-3-compose.js';
import { assembleSchedule4 } from './at1-schedule-composers/schedule-4-compose.js';
import { assembleSchedule5 } from './at1-schedule-composers/schedule-5-compose.js';
import { assembleSchedule6 } from './at1-schedule-composers/schedule-6-compose.js';
import { assembleSchedule7 } from './at1-schedule-composers/schedule-7-compose.js';
import { assembleSchedule8 } from './at1-schedule-composers/schedule-8-compose.js';
import { assembleSchedule9 } from './at1-schedule-composers/schedule-9-compose.js';
import { assembleSchedule11 } from './at1-schedule-composers/schedule-11-compose.js';
import { assembleSchedule15 } from './at1-schedule-composers/schedule-15-compose.js';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const yes = (v: unknown): boolean => v === 'yes';
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/** 000060 / 000061 — TRA forbids filing 13/17/18 unless divergence is declared. */
function divergenceFlags(ab: Ri) {
  return {
    reportsDifferentAlbertaIncome: yes(ab.reportsDifferentAlbertaIncome),
    electsDifferentDiscretionaryAmounts: yes(ab.electsDifferentDiscretionaryAmounts),
  };
}

// ── Schedule 13 — CCA ─────────────────────────────────────────────────────

/**
 * Alberta's per-class overrides. `undefined` falls back to the federal column
 * inside `computeAlbertaSchedule13`; an explicit `0` does not. Only classes
 * that actually carry an Alberta figure produce an override row, so a return
 * whose Alberta CCA matches federal sends none and Schedule 13 stays absent.
 */
function albertaCcaOverrides(ri: Ri) {
  return (ri.cca?.classes ?? [])
    .filter((c: Ri) => c?.ccaClass && (present(c.albertaOpeningUCC) || present(c.albertaClaim)))
    .map((c: Ri) => ({
      ccaClass: String(c.ccaClass),
      ...(present(c.albertaOpeningUCC) ? { openingUCC: num(c.albertaOpeningUCC) } : {}),
      ...(present(c.albertaClaim) ? { claim: num(c.albertaClaim) } : {}),
    }));
}

function scheduleThirteen(fed: Ri, ab: Ri, ri: Ri) {
  const federalClasses = fed.ccaClasses ?? [];
  if (federalClasses.length === 0) return undefined;
  const albertaOverrides = albertaCcaOverrides(ri);
  const result = computeAlbertaSchedule13({
    federalClasses,
    ...(albertaOverrides.length ? { albertaOverrides } : {}),
    ...divergenceFlags(ab),
  });
  // TRA forbids completing the form at all when neither divergence flag is
  // set — filing it anyway would be filing something the spec says cannot
  // exist, even if the underlying figures happen to differ.
  return result.formPermitted ? result : undefined;
}

// ── Schedule 17 — reserves ────────────────────────────────────────────────

/**
 * `fed.reserveContinuity` rows carry a controlled `type` (see
 * `apps/web/.../_config/options.ts`'s `RESERVE_TYPE_OPTIONS`, matching AT1's
 * own `At1ReserveKind` enum) rather than free text, so this maps 1:1 with no
 * fuzzy matching. Each row also carries optional `albertaOpening` /
 * `albertaTransfer` / `albertaClosing` overrides — present only where Alberta
 * actually diverges from federal. `insurancePolicyReserves` and
 * `bankReserves` are Alberta-only kinds with no federal Part 2 equivalent, so
 * for those rows `federalReserves` always reads as 0 and the Alberta override
 * fields are effectively the only source of the figure.
 */
function scheduleSeventeen(fed: Ri, ab: Ri) {
  const rows: Ri[] = fed.reserveContinuity ?? [];
  if (rows.length === 0) return undefined;
  const federalReserves: Record<string, { opening: number; transfer: number; closing: number }> =
    {};
  const albertaReserves: Record<string, { opening?: number; transfer?: number; closing?: number }> =
    {};
  for (const r of rows) {
    if (!r.type) continue;
    federalReserves[r.type] = {
      opening: num(r.opening),
      transfer: num(r.transfer),
      closing: num(r.closing),
    };
    if (present(r.albertaOpening) || present(r.albertaTransfer) || present(r.albertaClosing)) {
      albertaReserves[r.type] = {
        ...(present(r.albertaOpening) ? { opening: num(r.albertaOpening) } : {}),
        ...(present(r.albertaTransfer) ? { transfer: num(r.albertaTransfer) } : {}),
        ...(present(r.albertaClosing) ? { closing: num(r.albertaClosing) } : {}),
      };
    }
  }
  if (Object.keys(federalReserves).length === 0) return undefined;
  const result = computeAlbertaSchedule17({
    federalReserves: federalReserves as never,
    ...(Object.keys(albertaReserves).length ? { albertaReserves: albertaReserves as never } : {}),
    ...divergenceFlags(ab),
  });
  return result.formPermitted ? result : undefined;
}

// ── Schedule 18 — dispositions (basic: six category totals) ─────────────────

/**
 * Federal `capitalDispositions` is a flat, uncategorized list; AT1 needs six
 * category totals. A disposition entered with no `category` (see
 * `capital-gains.ts`'s new select field) cannot be bucketed and is left out
 * of the AT1 side — it still files correctly on the federal T2, just not on
 * this schedule. ABIL / s.34.2 / donated-property / capital-gains-reserve
 * figures are not modelled on the federal side and are not wired here.
 */
function scheduleEighteen(fed: Ri, ab: Ri) {
  const dispositions: Ri[] = fed.capitalDispositions ?? [];
  const categorized = dispositions.filter((d) => d.category);
  if (categorized.length === 0) return undefined;

  const federalCategories: Record<string, { proceeds: number; acb: number; outlays: number }> = {};
  for (const d of categorized) {
    const bucket = federalCategories[d.category] ?? { proceeds: 0, acb: 0, outlays: 0 };
    bucket.proceeds += num(d.proceeds);
    bucket.acb += num(d.acb);
    bucket.outlays += num(d.outlays);
    federalCategories[d.category] = bucket;
  }

  const result = computeAlbertaSchedule18({
    federalCategories: federalCategories as never,
    ...divergenceFlags(ab),
  });
  return result.formPermitted ? result : undefined;
}

// ── Schedule 1 — small business deduction ────────────────────────────────

/**
 * Filed as SUPPORTING DISCLOSURE — the actual Alberta tax rate reduction is
 * computed independently by `computeAlbertaTax` (which this composer does not
 * touch). This schedule reconciles the eligibility test and reports the
 * income that attracts the small-business rate; it does not itself change
 * what tax is payable.
 */
function scheduleOne(fed: Ri, ri: Ri, albertaTaxableIncome: number, defaultBusinessLimit: number) {
  const ab = ri.alberta ?? {};
  if (!ab.corporationStatus) return undefined; // no eligibility answer ⇒ nothing to claim
  const sbd = ri.sbd ?? {};
  // Reuses the FEDERAL associated-group facts (same corporations, same ITA
  // test) — there is no AT1-specific association UI, and the group a
  // corporation is associated with for SBD purposes does not change by
  // jurisdiction.
  const isAssociated = (sbd.associated ?? []).some((m: Ri) => m?.name || m?.allocatedLimit);

  const result = computeAlbertaSbd(
    {
      albertaTaxableIncome,
      activeBusinessIncome: num(fed.activeBusinessIncome),
      status: ab.corporationStatus,
      wasCcpcThroughoutYear: ab.wasCcpcThroughoutYear === 'no' ? false : undefined,
      ...(isAssociated ? { isAssociated: true } : {}),
      ...(isAssociated && sbd.businessLimit != null
        ? { allocatedBusinessLimit: num(sbd.businessLimit) }
        : {}),
    },
    defaultBusinessLimit,
  );

  return {
    result,
    activeBusinessIncome: num(fed.activeBusinessIncome),
    albertaTaxableIncome,
    ...(ab.royaltyTaxDeduction != null ? { royaltyTaxDeduction: num(ab.royaltyTaxDeduction) } : {}),
  };
}

// ── Schedule 10 / 21 — loss carry-back and continuity ────────────────────

/** Schedule 10 reuses the federal non-capital carry-back request verbatim — same engine, same figures. */
function scheduleTen(federal: FederalT2Result) {
  if (!federal.lossCarryback) return undefined;
  return {
    nonCapital: federal.lossCarryback,
    precedingYearEnds: federal.lossCarryback.carrybacks.map((c) => c.taxYearEnd),
  };
}

/**
 * The one figure Alberta's own loss continuity can NEVER derive: the opening
 * balance carried forward from a prior AT1 filing. Everything else the SPEC
 * says "defaults to federal, enter Alberta's own amount when it differs"
 * (§3.2.3.21, lines 041/043/045/047 for non-capital and equivalents per pool)
 * — `{pool}Applied`/`{pool}Expired` are exactly that override, undefined
 * meaning "same as federal". `{pool}WindUpTransfer`/`{pool}Section80Adjustment`/
 * `{pool}OtherAdjustments` have NO federal equivalent at all — federal
 * Schedule 4 does not track them — so they are plain Alberta-only entries,
 * defaulting to nil, not an override of anything. Listed personal property
 * has no federal pairing at all, so its full continuity is Alberta-only input
 * (unchanged, see below).
 */
function scheduleTwentyOne(federal: FederalT2Result, ri: Ri, schedule12: Schedule12Result) {
  const c = ri.albertaContinuity;
  if (!c) return undefined; // no Alberta loss history entered ⇒ nothing to file

  // NOT a spread of `fed` — it is a `LossContinuityResult`, which carries its
  // OWN `openingBalance` (federal's, always 0 here on a first AT1 filing) and
  // `closingBalance`. Spreading it after `openingBalance: opening` would
  // silently overwrite the Alberta figure with federal's — pick the four
  // in-year fields explicitly instead.
  const carryForward = (
    opening: number,
    fed: {
      currentYearLoss: number;
      carriedBack: number;
      appliedCurrentYear: number;
      expired: number;
    },
    // Override the current-year LOSS AMOUNT with Alberta's own figure when one
    // exists — the continuity table's "current year loss" row must agree with
    // whatever Schedule 21 line 021 states, or the schedule contradicts itself
    // on the same fact. Only non-capital has a computed Alberta-specific
    // figure today (`albertaCurrentYearLoss`); the others still reuse
    // federal's, per pool-specific notes below.
    currentYearLossOverride?: number,
    // The AT1-only slice for this pool (undefined for a pool with no prefix
    // entered — everything then defaults to federal / nil, same as before).
    poolInput?: {
      applied?: unknown;
      expired?: unknown;
      windUpTransfer?: unknown;
      section80Adjustment?: unknown;
      otherAdjustments?: unknown;
    },
  ) =>
    computeLossContinuity({
      openingBalance: opening,
      currentYearLoss: currentYearLossOverride ?? fed.currentYearLoss,
      carriedBack: fed.carriedBack,
      appliedCurrentYear: present(poolInput?.applied)
        ? num(poolInput?.applied)
        : fed.appliedCurrentYear,
      expired: present(poolInput?.expired) ? num(poolInput?.expired) : fed.expired,
      windUpTransfer: num(poolInput?.windUpTransfer),
      section80Adjustment: num(poolInput?.section80Adjustment),
      otherAdjustments: num(poolInput?.otherAdjustments),
    });

  const currentYearNonCapitalLoss = albertaCurrentYearLoss(schedule12);

  const nonCapital = carryForward(
    num(c.nonCapitalOpening),
    federal.losses.nonCapital,
    currentYearNonCapitalLoss,
    {
      applied: c.nonCapitalApplied,
      expired: c.nonCapitalExpired,
      windUpTransfer: c.nonCapitalWindUpTransfer,
      section80Adjustment: c.nonCapitalSection80Adjustment,
      otherAdjustments: c.nonCapitalOtherAdjustments,
    },
  );

  // The seventh section — non-capital losses by year of origin. Row 0 (the
  // current year) is DERIVED from figures already computed above — the spec
  // requires 021157 = 021021 (this schedule's own current-year loss) and
  // 021165 = 021047 (the pool's total carried back) — only the 20 preceding
  // vintages are genuinely AT1-only input, same "cannot be derived" pattern
  // as every other opening balance on this schedule.
  const nonCapitalVintages = Array.isArray(c.nonCapitalVintages) ? c.nonCapitalVintages : [];
  const nonCapitalByYearOfOrigin = computeNonCapitalLossByYearOfOrigin({
    currentYearLoss: currentYearNonCapitalLoss,
    currentYearCarriedBack: nonCapital.carriedBack,
    priorVintages: nonCapitalVintages
      .filter((v: Ri) => present(v?.yearsAgo))
      .map((v: Ri) => ({
        yearsAgo: num(v.yearsAgo),
        ...(present(v.taxYearEnd) ? { taxYearEnd: String(v.taxYearEnd) } : {}),
        balanceAtBeginning: num(v.balanceAtBeginning),
        adjustments: num(v.adjustments),
        applied: num(v.applied),
      })),
  });

  // The eighth section — farm/restricted-farm/LPP by year of origin. No
  // derivable row here (none of these have a "must equal" cross-reference to
  // a figure this engine already computes), so every row is direct AT1-only
  // input, same as the limited-partnership grid.
  const otherLossVintages = Array.isArray(c.otherLossVintages) ? c.otherLossVintages : [];
  const otherLossesByYearOfOrigin =
    otherLossVintages.length > 0
      ? computeOtherLossByYearOfOrigin(
          otherLossVintages
            .filter((v: Ri) => present(v?.yearIndex))
            .map((v: Ri) => ({
              yearIndex: num(v.yearIndex),
              farmLosses: num(v.farmLosses),
              restrictedFarmLosses: num(v.restrictedFarmLosses),
              listedPersonalPropertyLosses: num(v.listedPersonalPropertyLosses),
            })),
        )
      : undefined;

  return {
    currentYearNonCapitalLoss,
    nonCapital,
    nonCapitalByYearOfOrigin,
    ...(otherLossesByYearOfOrigin ? { otherLossesByYearOfOrigin } : {}),
    // The net capital loss for the year is confirmed the SAME as federal by
    // TRA's own Fall 2026 test case text ("the current year net capital loss
    // should be the same as federal") — reusing federal's figure here is
    // correct, not a shortcut.
    capital: carryForward(num(c.capitalOpening), federal.losses.netCapital, undefined, {
      applied: c.capitalApplied,
      expired: c.capitalExpired,
      windUpTransfer: c.capitalWindUpTransfer,
      section80Adjustment: c.capitalSection80Adjustment,
      otherAdjustments: c.capitalOtherAdjustments,
    }),
    // Farm / restricted-farm's CURRENT-YEAR LOSS AMOUNT still reuses federal's
    // (no Alberta-specific farm-loss figure is computed anywhere yet, unlike
    // non-capital's `albertaCurrentYearLoss` — a narrower, documented gap)
    // — but applied/expired/wind-up/s.80/other-adjustments are now overridable
    // the same as every other pool, since those genuinely have no dependency
    // on that missing figure.
    farm: carryForward(num(c.farmOpening), federal.losses.farm, undefined, {
      applied: c.farmApplied,
      expired: c.farmExpired,
      windUpTransfer: c.farmWindUpTransfer,
      section80Adjustment: c.farmSection80Adjustment,
      otherAdjustments: c.farmOtherAdjustments,
    }),
    restrictedFarm: carryForward(
      num(c.restrictedFarmOpening),
      federal.losses.restrictedFarm,
      undefined,
      {
        applied: c.restrictedFarmApplied,
        expired: c.restrictedFarmExpired,
        windUpTransfer: c.restrictedFarmWindUpTransfer,
        section80Adjustment: c.restrictedFarmSection80Adjustment,
        otherAdjustments: c.restrictedFarmOtherAdjustments,
      },
    ),
    listedPersonalProperty: computeLossContinuity({
      openingBalance: num(c.lppOpening),
      currentYearLoss: num(c.lppCurrentYearLoss),
      appliedCurrentYear: num(c.lppApplied),
      expired: num(c.lppExpired),
      otherAdjustments: num(c.lppOtherAdjustments),
    }),
    // The sixth section — one row per LIMITED PARTNERSHIP, not per
    // jurisdiction. Only rows that actually carry a preceding-year balance
    // are computed; a blank row from the array editor contributes nothing.
    ...(Array.isArray(c.limitedPartnerships) && c.limitedPartnerships.length > 0
      ? {
          limitedPartnershipLosses: computeLimitedPartnershipLosses(
            c.limitedPartnerships
              .filter((p: Ri) => present(p?.precedingYearBalance))
              .map((p: Ri) => ({
                ...(present(p.identifier) ? { identifier: String(p.identifier) } : {}),
                precedingYearBalance: num(p.precedingYearBalance),
                transferredOnWindUp: num(p.transferredOnWindUp),
                currentYearLoss: num(p.currentYearLoss),
                applied: num(p.applied),
              })),
          ),
        }
      : {}),
  };
}

// ── Schedule 20 — donations (charitable pool only) ───────────────────────

/**
 * The charitable-donations continuity reshapes directly from what the
 * federal side already collects. The "gifts to Canada/province, cultural
 * property, ecological land" continuity (lines 062-078) has no federal
 * source and no UI yet — omitted, not guessed.
 */
function scheduleTwenty(fed: Ri, schedule12: Schedule12Result) {
  const currentYearGifts = num(fed.charitableDonations);
  const openingBalance = num(fed.openingDonationPool);
  if (currentYearGifts === 0 && openingBalance === 0) return undefined;

  const maximum = computeDonationMaximum({
    albertaNetIncomeForTax: schedule12.albertaNetIncomeForTax,
  });
  const charitable = computeSchedule20({
    openingBalance,
    currentYearGifts,
    incomeLimit: maximum.maximumDeduction,
  });
  return { charitable, maximum };
}

// ── Schedule 12 — reconciliation (composed LAST — needs 13/17/18/21's results) ──

function scheduleTwelve(
  federal: FederalT2Result,
  cca: ReturnType<typeof scheduleThirteen>,
  reserves: ReturnType<typeof scheduleSeventeen>,
  dispositions: ReturnType<typeof scheduleEighteen>,
  nonCapitalContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  capitalContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  restrictedFarmContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  farmContinuity: ReturnType<typeof computeLossContinuity> | undefined,
): {
  result: Schedule12Result;
  filingInput: AlbertaReturnInput['schedules'] extends infer S
    ? S extends { reconciliation?: infer R }
      ? R
      : never
    : never;
} {
  const adjustments = [
    ...(cca
      ? albertaCcaScheduleAdjustments(
          {
            totalCca: cca.albertaTotalCca,
            totalRecapture: cca.albertaTotalRecapture,
            totalTerminalLoss: cca.albertaTotalTerminalLoss,
          },
          {
            totalCca: cca.federalTotalCca,
            totalRecapture: federal.cca?.totalRecapture ?? 0,
            totalTerminalLoss: federal.cca?.totalTerminalLoss ?? 0,
          },
        )
      : []),
    ...(dispositions
      ? albertaDispositionAdjustments(
          {
            taxableCapitalGain: dispositions.taxableCapitalGain,
            allowableBusinessInvestmentLoss: dispositions.allowableBusinessInvestmentLoss,
          },
          {
            taxableCapitalGain: federal.capitalGains?.taxableCapitalGain ?? 0,
            allowableBusinessInvestmentLoss: 0, // no federal ABIL schedule in this engine yet
          },
        )
      : []),
    ...(reserves
      ? [
          albertaReserveDifference(
            reserves.netIncomeEffect,
            (federal.reserves?.schedule1Deduction ?? 0) -
              (federal.reserves?.schedule1Addition ?? 0),
          ),
        ]
      : []),
  ];

  const result = reconcileAlbertaNetIncome(federal.netIncomeForTax, adjustments);

  const lossDeductions = schedule12LossDeductions(
    {
      nonCapital: nonCapitalContinuity,
      capital: capitalContinuity,
      restrictedFarm: restrictedFarmContinuity,
      farm: farmContinuity,
    },
    {
      nonCapital: federal.losses.nonCapital,
      capital: federal.losses.netCapital,
      restrictedFarm: federal.losses.restrictedFarm,
      farm: federal.losses.farm,
    },
  );

  const filingInput = {
    federalNetIncomeForTax: federal.netIncomeForTax,
    albertaNetIncomeForTax: result.albertaNetIncomeForTax,
    ...(cca
      ? {
          cca: { alberta: cca.albertaTotalCca, federal: cca.federalTotalCca },
          recapture: {
            alberta: cca.albertaTotalRecapture,
            federal: federal.cca?.totalRecapture ?? 0,
          },
          terminalLoss: {
            alberta: cca.albertaTotalTerminalLoss,
            federal: federal.cca?.totalTerminalLoss ?? 0,
          },
        }
      : {}),
    ...(reserves
      ? {
          reservesDeductedPriorYear: {
            alberta: reserves.totalOpening + reserves.totalTransfer,
            federal: federal.reserves?.schedule1Addition ?? 0,
          },
          reservesClaimedCurrentYear: {
            alberta: reserves.totalClosing,
            federal: federal.reserves?.schedule1Deduction ?? 0,
          },
        }
      : {}),
    lossDeductions,
  };

  return { result, filingInput: filingInput as never };
}

// ── Schedule 29 — the Innovation Employment Grant ────────────────────────

/**
 * `yes`/`no`/unanswered → `true`/`false`/`undefined`. Kept distinct from
 * `undefined` deliberately: the engine's own fail-closed default (claimant
 * `true`, every other member `false` plus an issue) only fires when this is
 * genuinely `undefined`, not when the preparer explicitly answered `no`.
 */
function yesNoOrUndefined(v: unknown): boolean | undefined {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined;
}

/**
 * The formal Agreement Among Associated Corporations (Schedule 29 page 3).
 * Separate from `group` above: `group` sets the informal base level of
 * spending and the taxable-capital grind; the Agreement — filed only when
 * `agreementMembers` is non-empty — switches the grant to the ASSOCIATED
 * formula (line 125) via `claimantAllocatedAllowedAmount`. Put the claiming
 * corporation first in `agreementMembers`, matching the UI's own instruction.
 */
function assembleIegAgreement(iegInput: Ri): IegAgreementInput {
  const members: Ri[] = iegInput.agreementMembers ?? [];
  return {
    longestYearCan: iegInput.agreementLongestYearCan ?? '',
    longestYearBegin: iegInput.agreementLongestYearBegin ?? '',
    longestYearEnd: iegInput.agreementLongestYearEnd ?? '',
    daysInLongestYear: iegInput.agreementDaysInLongestYear ?? 365,
    members: members.map((m, i) => {
      const hasAlbertaPermanentEstablishment = yesNoOrUndefined(m.hasAlbertaPermanentEstablishment);
      return {
        name: m.name || `Member ${i + 1}`,
        ...(m.albertaCan ? { albertaCan: m.albertaCan } : {}),
        ...(m.currentTaxationYearEnd ? { currentTaxationYearEnd: m.currentTaxationYearEnd } : {}),
        allocatedExpenditureLimit: num(m.allocatedExpenditureLimit),
        currentYearExpenditures: num(m.currentYearExpenditures),
        priorYear1: num(m.priorYear1),
        priorYear2: num(m.priorYear2),
        taxableCapitalPriorYear: num(m.taxableCapitalPriorYear),
        ...(m.daysInTaxYear != null ? { daysInTaxYear: num(m.daysInTaxYear) } : {}),
        ...(hasAlbertaPermanentEstablishment !== undefined
          ? { hasAlbertaPermanentEstablishment }
          : {}),
      };
    }),
  };
}

/**
 * AT4970 — Listing of Innovation Employment Grant Projects. A separate
 * attachment, filed only when at least one project is listed. Its totals
 * feed Schedule 29 page 1's eligible-expenditure lines — see
 * `assembleIegEligible` below, which defaults from these totals unless the
 * preparer overrode them directly.
 */
function assembleAt4970(iegInput: Ri): NonNullable<AlbertaReturnInput['ieg']>['at4970'] {
  const projects: Ri[] = iegInput.projects ?? [];
  if (projects.length === 0) return undefined;

  const jurisdictions: Ri[] = iegInput.jurisdictions ?? [];

  return {
    projects: projects.map((p) => ({
      title: p.title || 'Untitled project',
      ...(p.projectCode ? { projectCode: p.projectCode } : {}),
      albertaPortion: num(p.albertaPortion),
      otherPortion: num(p.otherPortion),
      salariesAndWages: num(p.salariesAndWages),
      federalProxyAmount: num(p.federalProxyAmount),
      albertaProxyAmount: num(p.albertaProxyAmount),
    })),
    ...(jurisdictions.length > 0
      ? {
          jurisdictions: jurisdictions
            .filter((j) => j.jurisdiction)
            .map((j) => ({ jurisdiction: j.jurisdiction, amountIncurred: num(j.amountIncurred) })),
        }
      : {}),
  };
}

/**
 * Schedule 29 page 1 — the eligible-expenditures derivation. Always built
 * when the IEG is claimed at all (`federalAmount` is a mandatory input to
 * the derivation, not an optional add-on) — an earlier version of this
 * composition collected only a bare `eligibleExpenditures` number with
 * nothing to derive it from.
 */
function assembleIegEligible(iegInput: Ri): NonNullable<AlbertaReturnInput['ieg']>['eligible'] {
  return {
    federalAmount: num(iegInput.federalAmount),
    ...(iegInput.albertaPortion != null ? { albertaPortion: num(iegInput.albertaPortion) } : {}),
    ...(iegInput.federalProxyAmount != null
      ? { federalProxyAmount: num(iegInput.federalProxyAmount) }
      : {}),
    ...(iegInput.albertaProxyAmount != null
      ? { albertaProxyAmount: num(iegInput.albertaProxyAmount) }
      : {}),
    ...(iegInput.iegReducingFederalExpenditure != null
      ? { iegReducingFederalExpenditure: num(iegInput.iegReducingFederalExpenditure) }
      : {}),
    ...(iegInput.repaymentOrContractPayment != null
      ? { repaymentOrContractPayment: num(iegInput.repaymentOrContractPayment) }
      : {}),
  };
}

/**
 * Builds `AlbertaReturnInput['ieg']` (the top-level grant input
 * `computeAlbertaReturn` composes with the associated-group layer) from the
 * AT1-only IEG slice. Entirely new data — federal SR&ED has no Alberta split
 * and no associated-group taxable-capital/prior-spend detail.
 */
function assembleIeg(ri: Ri): AlbertaReturnInput['ieg'] {
  const iegInput = ri.albertaIeg;
  const members: Ri[] = iegInput?.group ?? [];
  if (members.length === 0) return undefined;

  const agreementMembers: Ri[] = iegInput.agreementMembers ?? [];
  const primaryFieldCode = Number(iegInput.primaryFieldCode);

  return {
    eligible: assembleIegEligible(iegInput),
    at4970: assembleAt4970(iegInput),
    ...([1, 2, 3, 4].includes(primaryFieldCode)
      ? { primaryFieldCode: primaryFieldCode as 1 | 2 | 3 | 4 }
      : {}),
    group: members.map((m, i) => ({
      name: m.name || `Member ${i + 1}`,
      taxableCapital: num(m.taxableCapital),
      priorYearAlbertaExpenditures: [num(m.priorYear1), num(m.priorYear2)],
    })),
    ...(iegInput.allocatedLimit != null ? { allocatedLimit: num(iegInput.allocatedLimit) } : {}),
    ...(iegInput.recapture != null ? { recapture: num(iegInput.recapture) } : {}),
    // An empty member table means no agreement was filed — the grant then
    // uses the non-associated formula (line 112), not the associated one.
    ...(agreementMembers.length > 0 ? { agreement: assembleIegAgreement(iegInput) } : {}),
  };
}

/**
 * The composition entry point. `federal` is the FederalT2Result already
 * computed inside `assembleProvincialInput` (previously discarded beyond
 * `.taxableIncome`); `fed` is the federal engine INPUT (for raw echoes like
 * `ccaClasses`); `ri` is the structured working return (for the AT1-only
 * slices nothing else can supply); `albertaTaxableIncome` /
 * `defaultBusinessLimit` come from the caller, which already has the
 * allocation factor and resolved Alberta rates in scope.
 */
export function assembleAt1Schedules(
  federal: FederalT2Result,
  fed: Ri,
  ri: Ri,
  albertaTaxableIncome: number,
  defaultBusinessLimit: number,
): { schedules: AlbertaReturnInput['schedules']; ieg: AlbertaReturnInput['ieg'] } {
  const ab = ri.alberta ?? {};

  const cca = scheduleThirteen(fed, ab, ri);
  const reserves = scheduleSeventeen(fed, ab);
  const dispositions = scheduleEighteen(fed, ab);
  const lossCarryback = scheduleTen(federal);
  const smallBusinessDeduction = scheduleOne(fed, ri, albertaTaxableIncome, defaultBusinessLimit);

  // Nine standalone Alberta-only credit/deduction schedules — none are
  // reconciliation overlays like 13/17/18, so none read `ab`'s divergence
  // flags; each is filed whenever its own `ri.*` slice has real data.
  const otherDeductionsCredits = assembleSchedule3(ri);
  const foreignInvestmentTaxCredit = assembleSchedule4(ri);
  const royaltyTaxDeduction = assembleSchedule5(ri);
  const royaltyTaxCredit = assembleSchedule6(ri);
  const royaltySupplemental = assembleSchedule7(ri);
  const politicalContributions = assembleSchedule8(ri);
  const sredTaxCredit9 = assembleSchedule9(ri);
  const manufacturingProcessing = assembleSchedule11(fed, ri);
  const resourceDeductions = assembleSchedule15(ri);

  // Schedule 12 needs 13/17/18's results AND the loss continuities' results —
  // but the continuities need Schedule 12's OWN current-year-loss figure.
  // Break the cycle the way the form itself does: compute the reconciliation
  // from 13/17/18 first (their income effect does not depend on the loss
  // pools), derive the current-year loss from THAT, then compute the
  // continuities, matching `albertaCurrentYearLoss`'s documented use.
  const { result: schedule12Result } = scheduleTwelve(
    federal,
    cca,
    reserves,
    dispositions,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  const losses = scheduleTwentyOne(federal, ri, schedule12Result);
  const donations = scheduleTwenty(fed, schedule12Result);

  // Re-run Schedule 12 once the continuities exist, so lines 064-071 (losses
  // of preceding years deducted) are populated too.
  const { filingInput: reconciliation } = scheduleTwelve(
    federal,
    cca,
    reserves,
    dispositions,
    losses?.nonCapital,
    losses?.capital,
    losses?.restrictedFarm,
    losses?.farm,
  );

  const schedules: AlbertaReturnInput['schedules'] = {
    ...(smallBusinessDeduction ? { smallBusinessDeduction } : {}),
    ...(otherDeductionsCredits ? { otherDeductionsCredits } : {}),
    ...(foreignInvestmentTaxCredit ? { foreignInvestmentTaxCredit } : {}),
    ...(royaltyTaxDeduction ? { royaltyTaxDeduction } : {}),
    ...(royaltyTaxCredit ? { royaltyTaxCredit } : {}),
    ...(royaltySupplemental ? { royaltySupplemental } : {}),
    ...(politicalContributions ? { politicalContributions } : {}),
    ...(sredTaxCredit9 ? { sredTaxCredit: sredTaxCredit9 } : {}),
    ...(lossCarryback ? { lossCarryback } : {}),
    ...(manufacturingProcessing ? { manufacturingProcessing } : {}),
    // Schedule 12 is filed only when at least one reconciling item exists —
    // an all-agree reconciliation is not a divergence to disclose.
    ...(cca || reserves || dispositions || losses ? { reconciliation } : {}),
    ...(cca ? { cca } : {}),
    ...(resourceDeductions ? { resourceDeductions } : {}),
    ...(reserves ? { reserves } : {}),
    ...(dispositions ? { dispositions } : {}),
    ...(donations ? { donations } : {}),
    ...(losses ? { losses } : {}),
  };

  return { schedules, ieg: assembleIeg(ri) };
}
