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
 */
import {
  type AlbertaReturnInput,
  albertaCcaScheduleAdjustments,
  albertaCurrentYearLoss,
  albertaDispositionAdjustments,
  albertaReserveDifference,
  albertaResourceDeductionDifference,
  computeAlbertaSbd,
  computeAlbertaSchedule13,
  computeAlbertaSchedule17,
  computeAlbertaSchedule18,
  computeDonationMaximum,
  computeLimitedPartnershipLosses,
  computeLossCarryback,
  computeLossContinuity,
  computeNonCapitalLossByYearOfOrigin,
  computeOtherLossByYearOfOrigin,
  computeSchedule20,
  type FederalT2Result,
  type IegAgreementInput,
  type LimitedPartnershipLossesResult,
  reconcileAlbertaNetIncome,
  type Schedule12FilingInput,
  type Schedule12Result,
  schedule12LossDeductions,
} from '@classytic/ca-tax/t2';
import type { ComposedFederalInput } from './assemble-t2-input.js';
import { assembleSchedule3 } from './at1-schedule-composers/schedule-3-compose.js';
import { assembleSchedule4 } from './at1-schedule-composers/schedule-4-compose.js';
import { assembleSchedule5 } from './at1-schedule-composers/schedule-5-compose.js';
import { assembleSchedule6 } from './at1-schedule-composers/schedule-6-compose.js';
import { assembleSchedule7 } from './at1-schedule-composers/schedule-7-compose.js';
import { assembleSchedule8 } from './at1-schedule-composers/schedule-8-compose.js';
import { assembleSchedule9 } from './at1-schedule-composers/schedule-9-compose.js';
import { assembleSchedule15 } from './at1-schedule-composers/schedule-15-compose.js';
import type {
  AlbertaAssociatedCorpMember,
  AlbertaContinuityValues,
  AlbertaIegValues,
  AlbertaSbdValues,
  AlbertaValues,
  CcaClass,
  IegAgreementMember,
  IegGroupMember,
  ReturnInput,
} from './return-input-contract.js';

/** `fed` — the assembled federal engine input every composer reads from. */
type Fed = ComposedFederalInput;
/** `ri` — the full structured working return. */
type Ri = ReturnInput;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const yes = (v: unknown): boolean => v === 'yes';
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/** 000060 / 000061 — TRA forbids filing 13/17/18 unless divergence is declared. */
function divergenceFlags(ab: AlbertaValues) {
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
    .filter((c: CcaClass) => c?.ccaClass && (present(c.albertaOpeningUCC) || present(c.albertaClaim)))
    .map((c: CcaClass) => ({
      ccaClass: String(c.ccaClass),
      ...(present(c.albertaOpeningUCC) ? { openingUCC: num(c.albertaOpeningUCC) } : {}),
      ...(present(c.albertaClaim) ? { claim: num(c.albertaClaim) } : {}),
    }));
}

function scheduleThirteen(fed: Fed, ab: AlbertaValues, ri: Ri) {
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
function scheduleSeventeen(fed: Fed, ab: AlbertaValues) {
  const rows = fed.reserveContinuity ?? [];
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
    federalReserves,
    ...(Object.keys(albertaReserves).length ? { albertaReserves } : {}),
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
function scheduleEighteen(fed: Fed, ab: AlbertaValues) {
  const dispositions = fed.capitalDispositions ?? [];
  const categorized = dispositions.filter((d) => d.category);
  if (categorized.length === 0) return undefined;

  const federalCategories: Record<string, { proceeds: number; acb: number; outlays: number }> = {};
  for (const d of categorized) {
    const bucket = federalCategories[d.category as string] ?? { proceeds: 0, acb: 0, outlays: 0 };
    bucket.proceeds += num(d.proceeds);
    bucket.acb += num(d.acb);
    bucket.outlays += num(d.outlays);
    federalCategories[d.category as string] = bucket;
  }

  const result = computeAlbertaSchedule18({
    federalCategories,
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
function scheduleOne(fed: Fed, ri: Ri, albertaTaxableIncome: number, defaultBusinessLimit: number) {
  const ab: AlbertaSbdValues = ri.albertaSbd ?? {};
  if (!ab.corporationStatus) return undefined; // no eligibility answer ⇒ nothing to claim
  const sbd = ri.sbd ?? {};
  // Reuses the FEDERAL associated-group facts (same corporations, same ITA
  // test) — there is no AT1-specific association UI, and the group a
  // corporation is associated with for SBD purposes does not change by
  // jurisdiction.
  const isAssociated = (sbd.associated ?? []).some((m) => m?.name || m?.allocatedLimit);

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

  // Area A — the associated group's own allocation table (041/043/045),
  // filed alongside line 001. Re-entered by the preparer, not joined against
  // `sbd.associated` by array index — see this schedule's own doc comment.
  const agreementMembers = (ab.associatedCorpAgreement ?? [])
    .filter((m: AlbertaAssociatedCorpMember) => m?.name || m?.albertaCan || m?.allocatedAmount != null)
    .map((m: AlbertaAssociatedCorpMember) => ({
      name: m?.name,
      albertaCan: m?.albertaCan,
      allocatedAmount: m?.allocatedAmount != null ? num(m.allocatedAmount) : undefined,
    }));

  return {
    result,
    activeBusinessIncome: num(fed.activeBusinessIncome),
    albertaTaxableIncome,
    ...(ab.royaltyTaxDeduction != null ? { royaltyTaxDeduction: num(ab.royaltyTaxDeduction) } : {}),
    ...(agreementMembers.length > 0 ? { agreementMembers } : {}),
  };
}

// ── Schedule 10 / 21 — loss carry-back and continuity ────────────────────

/**
 * Schedule 10 has two columns: non-capital reuses the federal carry-back
 * request verbatim (same engine, same figures — federal T2 has no separate
 * request of its own). Capital has NO federal equivalent to reuse at all —
 * neither this engine's federal T2 nor its Schedule 4 accepts a net-capital
 * carry-back request — so it is built here from the Alberta-only
 * `albertaContinuity.capitalCarrybacks` input against the current-year
 * net-capital loss federal already computed (Schedule 6 → federal Schedule 4,
 * confirmed by TRA's own Fall 2026 test-case text to equal Alberta's).
 * `computeLossCarryback` is the same jurisdiction-agnostic primitive federal
 * uses for its own non-capital request — see `loss-carryback.ts`.
 */
/**
 * `otherLoss`'s two checkboxes (023 restricted farm / 025 listed personal
 * property) are NOT mutually exclusive — confirmed against TRA's own
 * Chapter 3 spec, not just the printed PDF. When both are checked, the
 * shared column's current-year-loss is the SUM of both pools' own current-
 * year losses (021097 + 021117).
 */
function scheduleTen(federal: FederalT2Result, ri: Ri) {
  const c: AlbertaContinuityValues = ri.albertaContinuity ?? {};
  const nonCapital = federal.lossCarryback;

  const rowsFrom = (
    field: 'capitalCarrybacks' | 'farmCarrybacks' | 'otherLossCarrybacks',
  ): { taxYearEnd: string; amount: number }[] =>
    (c[field] ?? [])
      .filter((r) => present(r?.amount))
      .map((r) => ({ taxYearEnd: String(r.taxYearEnd), amount: num(r.amount) }));

  const capitalCarrybackRows = rowsFrom('capitalCarrybacks');
  const capital =
    capitalCarrybackRows.length > 0
      ? computeLossCarryback({
          currentYearLoss: federal.losses.netCapital.currentYearLoss,
          carrybacks: capitalCarrybackRows,
        })
      : undefined;

  const farmCarrybackRows = rowsFrom('farmCarrybacks');
  const farmCurrentYearLoss = present(c.farmCurrentYearLoss)
    ? num(c.farmCurrentYearLoss)
    : federal.losses.farm.currentYearLoss;
  const farm =
    farmCarrybackRows.length > 0
      ? computeLossCarryback({ currentYearLoss: farmCurrentYearLoss, carrybacks: farmCarrybackRows })
      : undefined;

  const includesRestrictedFarm = yes(c.otherLossIncludesRestrictedFarm);
  const includesListedPersonal = yes(c.otherLossIncludesListedPersonal);
  const restrictedFarmCurrentYearLoss = present(c.restrictedFarmCurrentYearLoss)
    ? num(c.restrictedFarmCurrentYearLoss)
    : federal.losses.restrictedFarm.currentYearLoss;
  const lppCurrentYearLoss = num(c.lppCurrentYearLoss); // no federal source at all — direct AT1-only entry
  const otherLossCarrybackRows = rowsFrom('otherLossCarrybacks');
  const otherLossResult =
    (includesRestrictedFarm || includesListedPersonal) && otherLossCarrybackRows.length > 0
      ? computeLossCarryback({
          currentYearLoss:
            (includesRestrictedFarm ? restrictedFarmCurrentYearLoss : 0) +
            (includesListedPersonal ? lppCurrentYearLoss : 0),
          carrybacks: otherLossCarrybackRows,
        })
      : undefined;
  const otherLoss = otherLossResult
    ? { includesRestrictedFarm, includesListedPersonal, result: otherLossResult }
    : undefined;

  // When BOTH boxes are checked, Schedule 10 reports one COMBINED figure —
  // TRA's spec doesn't attribute it back to the two pools' own separate
  // Schedule 21 continuities, so this splits the total carried back
  // proportionally to each pool's share of the combined current-year loss
  // (remainder to restricted farm, matching the form's own 023-before-025
  // order) — a considered choice, not derived from the spec, which is
  // silent on this specific sub-allocation.
  let restrictedFarmCarriedBack: number | undefined;
  let lppCarriedBack: number | undefined;
  if (otherLossResult) {
    const combinedBase =
      (includesRestrictedFarm ? restrictedFarmCurrentYearLoss : 0) +
      (includesListedPersonal ? lppCurrentYearLoss : 0);
    if (includesRestrictedFarm && includesListedPersonal && combinedBase > 0) {
      lppCarriedBack = Math.round(
        (lppCurrentYearLoss / combinedBase) * otherLossResult.totalCarriedBack,
      );
      restrictedFarmCarriedBack = otherLossResult.totalCarriedBack - lppCarriedBack;
    } else if (includesRestrictedFarm) {
      restrictedFarmCarriedBack = otherLossResult.totalCarriedBack;
    } else if (includesListedPersonal) {
      lppCarriedBack = otherLossResult.totalCarriedBack;
    }
  }

  if (!nonCapital && !capital && !farm && !otherLoss) return undefined;

  // Every column's preceding-year date fields (003/005/007) are shared on
  // the live form, so they need the same three years — whichever column
  // has data first supplies the dates.
  const precedingYearEnds = (nonCapital ?? farm ?? otherLoss?.result ?? capital)!.carrybacks.map(
    (cb) => cb.taxYearEnd,
  );

  return {
    ...(nonCapital ? { nonCapital } : {}),
    ...(farm ? { farm } : {}),
    ...(otherLoss ? { otherLoss } : {}),
    ...(capital ? { capital } : {}),
    precedingYearEnds,
    // Schedule 21 override inputs — see the split note above.
    ...(farm ? { farmCarriedBack: farm.totalCarriedBack } : {}),
    ...(restrictedFarmCarriedBack !== undefined ? { restrictedFarmCarriedBack } : {}),
    ...(lppCarriedBack !== undefined ? { lppCarriedBack } : {}),
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
function scheduleTwentyOne(
  federal: FederalT2Result,
  ri: Ri,
  schedule12: Schedule12Result,
  /**
   * Total net-capital loss carried back this year (Schedule 10's capital
   * column, computed by `scheduleTen`). `federal.losses.netCapital.carriedBack`
   * is always 0 — federal has no net-capital carry-back request of its own —
   * so without this override the Alberta continuity would silently ignore a
   * capital carry-back that was actually requested and ship a closing balance
   * that hasn't been reduced by it.
   */
  capitalCarriedBack?: number,
  /**
   * Total farm / restricted-farm / listed-personal-property loss carried
   * back this year (Schedule 10's farm and "other loss" columns, computed
   * by `scheduleTen`). Federal's own `carriedBack` for these pools is
   * always 0 — same reasoning as `capitalCarriedBack` above. The
   * restricted-farm/LPP split, when Schedule 10's shared "other loss"
   * column covers both in the same year, is `scheduleTen`'s own considered
   * allocation (proportional to each pool's current-year loss) — TRA's
   * spec doesn't attribute the combined figure back to the two pools.
   */
  farmCarriedBack?: number,
  restrictedFarmCarriedBack?: number,
  lppCarriedBack?: number,
) {
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
    // on the same fact. Non-capital's is computed automatically
    // (`albertaCurrentYearLoss`, from Schedule 12's reconciliation);
    // farm/restricted-farm take a direct AT1-only entry instead, since no
    // federal input breaks a loss down by farm activity for anything to
    // derive it from; capital has none — see pool-specific notes below.
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
      .filter((v) => present(v?.yearsAgo))
      .map((v) => ({
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
            .filter((v) => present(v?.yearIndex))
            .map((v) => ({
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
    // correct, not a shortcut. `carriedBack` is NOT reused from federal,
    // though: federal has no net-capital carry-back request at all (always
    // 0), so it is overridden with Schedule 10's Alberta-only capital column
    // total whenever one was actually requested — see `capitalCarriedBack`'s
    // doc comment above.
    capital: carryForward(
      num(c.capitalOpening),
      capitalCarriedBack !== undefined
        ? { ...federal.losses.netCapital, carriedBack: capitalCarriedBack }
        : federal.losses.netCapital,
      undefined,
      {
        applied: c.capitalApplied,
        expired: c.capitalExpired,
        windUpTransfer: c.capitalWindUpTransfer,
        section80Adjustment: c.capitalSection80Adjustment,
        otherAdjustments: c.capitalOtherAdjustments,
      },
    ),
    // Farm / restricted-farm's CURRENT-YEAR LOSS AMOUNT defaults to federal's
    // but, like non-capital, is overridable — no federal input in this engine
    // breaks a loss down by farm activity, so unlike non-capital (derived from
    // Schedule 12's reconciliation) this can only be a direct AT1-only entry.
    farm: carryForward(
      num(c.farmOpening),
      farmCarriedBack !== undefined
        ? { ...federal.losses.farm, carriedBack: farmCarriedBack }
        : federal.losses.farm,
      present(c.farmCurrentYearLoss) ? num(c.farmCurrentYearLoss) : undefined,
      {
        applied: c.farmApplied,
        expired: c.farmExpired,
        windUpTransfer: c.farmWindUpTransfer,
        section80Adjustment: c.farmSection80Adjustment,
        otherAdjustments: c.farmOtherAdjustments,
      },
    ),
    restrictedFarm: carryForward(
      num(c.restrictedFarmOpening),
      restrictedFarmCarriedBack !== undefined
        ? { ...federal.losses.restrictedFarm, carriedBack: restrictedFarmCarriedBack }
        : federal.losses.restrictedFarm,
      present(c.restrictedFarmCurrentYearLoss)
        ? num(c.restrictedFarmCurrentYearLoss)
        : undefined,
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
      carriedBack: lppCarriedBack ?? 0,
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
              .filter((p) => present(p?.precedingYearBalance))
              .map((p) => ({
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
 * Two continuities. Charitable (Area A, lines 002-018) reshapes directly
 * from what federal already collects, with Alberta-only overrides for the
 * fields federal has no equivalent of at all (expired, wind-up transfer,
 * acquisition-of-control, the amount applied). Gifts (lines 062-078 — gifts
 * to Canada/province, cultural property, ecological land) has no federal
 * source whatsoever: its current-year figure defaults to federal's cultural
 * + ecological total, and its opening balance is Alberta-only input that can
 * never be derived — same rule as every other AT1-only opening balance.
 *
 * Area B (the 75%-of-income ceiling, `computeDonationMaximum`) now also
 * takes the gains/recapture inputs on gifted capital property — previously
 * always zero because nothing populated them.
 */
function scheduleTwenty(fed: Fed, ri: Ri, schedule12: Schedule12Result) {
  const d = ri.albertaDonations ?? {};

  const charitableCurrentYear = num(fed.charitableDonations);
  const charitableOpening = num(fed.openingDonationPool);
  // `fed.charitableDonations` is CHARITABLE ONLY and `fed.culturalEcologicalGifts`
  // is the combined cultural + ecological total — two separate fields since
  // `scheduleTwo` in `assemble-t2-input.ts` stopped combining them (they're
  // capped differently federally: only charitable is limited to 75% of net
  // income). Both are real `fed` fields now; no need to reach into `ri.donations`
  // directly for this default any more.
  const giftsCurrentYear = present(d.giftsCurrentYear)
    ? num(d.giftsCurrentYear)
    : num(fed.culturalEcologicalGifts);
  const giftsOpening = num(d.giftsOpening);

  const hasCharitable = charitableCurrentYear !== 0 || charitableOpening !== 0;
  const hasGifts = giftsCurrentYear !== 0 || giftsOpening !== 0;
  if (!hasCharitable && !hasGifts) return undefined;

  const maximum = computeDonationMaximum({
    albertaNetIncomeForTax: schedule12.albertaNetIncomeForTax,
    ...(present(d.taxableCapitalGainsOnGifts)
      ? { taxableCapitalGainsOnGifts: num(d.taxableCapitalGainsOnGifts) }
      : {}),
    ...(present(d.deemedGiftGains) ? { deemedGiftGains: num(d.deemedGiftGains) } : {}),
    ...(present(d.recaptureOnGifts) ? { recaptureOnGifts: num(d.recaptureOnGifts) } : {}),
    ...(present(d.proceedsNetOfOutlays) ? { proceedsNetOfOutlays: num(d.proceedsNetOfOutlays) } : {}),
    ...(present(d.capitalCost) ? { capitalCost: num(d.capitalCost) } : {}),
  });

  // Area B computes ONE ceiling for the WHOLE schedule, not one per pool —
  // the two pools' claims (016 charitable, 076 gifts) share it. Sequenced
  // charitable-first (the form's own page order): charitable draws against
  // the full ceiling, gifts draws against whatever's left. A preparer who
  // wants a different split can override `charitableApplied`/`giftsApplied`
  // directly — both already accept an explicit claim amount.
  const charitable = hasCharitable
    ? computeSchedule20({
        openingBalance: charitableOpening,
        currentYearGifts: charitableCurrentYear,
        expired: num(d.charitableExpired),
        transferredIn: num(d.charitableTransferredIn),
        acquisitionOfControlAdjustment: num(d.charitableAcquisitionOfControlAdjustment),
        ...(present(d.charitableApplied) ? { amountApplied: num(d.charitableApplied) } : {}),
        incomeLimit: maximum.maximumDeduction,
      })
    : undefined;

  const remainingCeiling = Math.max(0, maximum.maximumDeduction - (charitable?.amountApplied ?? 0));

  // 090-100 — carryforward available, by category. Filed only when the
  // preparer entered a year of origin; charitable (092) defaults to the
  // charitable pool's own closing balance, the other three categories have
  // no federal source to default from at all (see this schedule's own doc
  // comment in `alberta-donations.ts`).
  const carryforwardYearOfOrigin = present(d.carryforwardYearOfOrigin)
    ? String(d.carryforwardYearOfOrigin)
    : undefined;
  const albertaCarryforward = carryforwardYearOfOrigin
    ? {
        yearOfOrigin: carryforwardYearOfOrigin,
        ...(present(d.carryforwardCharitable) ? { charitable: num(d.carryforwardCharitable) } : {}),
        ...(present(d.carryforwardToCanadaOrProvince)
          ? { toCanadaOrProvince: num(d.carryforwardToCanadaOrProvince) }
          : {}),
        ...(present(d.carryforwardCulturalProperty)
          ? { culturalProperty: num(d.carryforwardCulturalProperty) }
          : {}),
        ...(present(d.carryforwardEcologicalLand) ? { ecologicalLand: num(d.carryforwardEcologicalLand) } : {}),
        ...(present(d.carryforwardMedicine) ? { medicine: num(d.carryforwardMedicine) } : {}),
      }
    : undefined;

  const gifts = hasGifts
    ? computeSchedule20({
        openingBalance: giftsOpening,
        currentYearGifts: giftsCurrentYear,
        expired: num(d.giftsExpired),
        transferredIn: num(d.giftsTransferredIn),
        acquisitionOfControlAdjustment: num(d.giftsAcquisitionOfControlAdjustment),
        ...(present(d.giftsApplied) ? { amountApplied: num(d.giftsApplied) } : {}),
        incomeLimit: remainingCeiling,
        ...(charitable ? { federalCarryforward: { charitable: charitable.closingBalance } } : {}),
        ...(albertaCarryforward ? { albertaCarryforward } : {}),
      })
    : undefined;

  return { ...(charitable ? { charitable } : {}), ...(gifts ? { gifts } : {}), maximum };
}

// ── Schedule 12 — reconciliation (composed LAST — needs 13/17/18/21's results) ──

/**
 * Schedule 12 lines 022/023 (Depletion), 026/027 (CEE), 028/029 (CDE),
 * 030/031 (Foreign exploration/development), 032/033 (COGPE) — AT1 Schedule
 * 15's own five claim totals, verified against the rendered
 * `AT1SCH12-income-loss-reconciliation-TRA11732.pdf` page 1: Depletion =
 * Schedule 15 lines 007+019+031 (EDA regular + EDA successor + CMEDB
 * claims); CEE = 061+081; CDE = 115+141; COGPE = 169+189; Foreign =
 * 209+221 (FEDE) plus the SFEDE/CFRE per-country claims. Shared between the
 * net-income adjustment and the filed-payload figures below so both read
 * from one computation, not two.
 */
function aggregateResourceDeductionClaims(
  resourceDeductions: NonNullable<ReturnType<typeof assembleSchedule15>>,
) {
  const r = resourceDeductions;
  const sumClaims = (rows: readonly { claim: number }[] | undefined) =>
    (rows ?? []).reduce((s, row) => s + row.claim, 0);
  return {
    depletion: (r.eda?.regular.claim ?? 0) + (r.eda?.successor.claim ?? 0) + (r.cmedb?.claim ?? 0),
    cee: (r.cee?.regular.claim ?? 0) + (r.cee?.successor.claim ?? 0),
    cde: (r.cde?.regular.claim ?? 0) + (r.cde?.successor.claim ?? 0),
    cogpe: (r.ccogpe?.regular.claim ?? 0) + (r.ccogpe?.successor.claim ?? 0),
    foreign:
      (r.fede?.regular.claim ?? 0) +
      (r.fede?.successor.claim ?? 0) +
      sumClaims(r.sfede?.regular) +
      sumClaims(r.sfede?.successor) +
      sumClaims(r.cfre?.regular) +
      sumClaims(r.cfre?.successor),
  };
}

function resourceDeductionAdjustments(
  alberta: ReturnType<typeof aggregateResourceDeductionClaims>,
  federal: FederalT2Result,
) {
  const fed = federal.resourceDeductions;
  return [
    albertaResourceDeductionDifference(
      'Depletion',
      'AT1 Sch 15 vs T2 Sch 12 (022/023)',
      alberta.depletion,
      fed?.depletionClaim ?? 0,
    ),
    albertaResourceDeductionDifference(
      'Canadian exploration expenses',
      'AT1 Sch 15 vs T2 Sch 12 (026/027)',
      alberta.cee,
      fed?.ceeClaim ?? 0,
    ),
    albertaResourceDeductionDifference(
      'Canadian development expenses',
      'AT1 Sch 15 vs T2 Sch 12 (028/029)',
      alberta.cde,
      fed?.cdeClaim ?? 0,
    ),
    albertaResourceDeductionDifference(
      'Foreign exploration and development expenses',
      'AT1 Sch 15 vs T2 Sch 12 (030/031)',
      alberta.foreign,
      fed?.foreignClaim ?? 0,
    ),
    albertaResourceDeductionDifference(
      'Canadian oil and gas property expenses',
      'AT1 Sch 15 vs T2 Sch 12 (032/033)',
      alberta.cogpe,
      fed?.cogpeClaim ?? 0,
    ),
  ];
}

function scheduleTwelve(
  federal: FederalT2Result,
  cca: ReturnType<typeof scheduleThirteen>,
  reserves: ReturnType<typeof scheduleSeventeen>,
  dispositions: ReturnType<typeof scheduleEighteen>,
  nonCapitalContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  capitalContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  restrictedFarmContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  farmContinuity: ReturnType<typeof computeLossContinuity> | undefined,
  limitedPartnershipLosses: LimitedPartnershipLossesResult | undefined,
  // Area B, lines 056-059 — undefined on the first (pre-donations) call.
  donations: ReturnType<typeof scheduleTwenty> | undefined,
  culturalEcologicalGiftsFederal: number,
  // Area A, lines 022/023, 026-033 — AT1 Schedule 15 vs federal Schedule 12.
  resourceDeductions: ReturnType<typeof assembleSchedule15> | undefined,
): {
  result: Schedule12Result;
  filingInput: Schedule12FilingInput;
} {
  const albertaResourceDeductionClaims = resourceDeductions
    ? aggregateResourceDeductionClaims(resourceDeductions)
    : undefined;

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
    ...(albertaResourceDeductionClaims
      ? resourceDeductionAdjustments(albertaResourceDeductionClaims, federal)
      : []),
  ];

  const result = reconcileAlbertaNetIncome(federal.netIncomeForTax, adjustments);

  const lossDeductions = {
    ...schedule12LossDeductions(
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
    ),
    // 012072/073 — NOT `LossContinuityResult`-shaped (one row per
    // partnership, not a pool), so built directly rather than through
    // `schedule12LossDeductions`. Alberta = Schedule 21's own total when its
    // limited-partnership table has rows; otherwise federal's own applied
    // figure — same fallback shape as the four pools above, per the spec.
    limitedPartnership: {
      alberta: limitedPartnershipLosses
        ? limitedPartnershipLosses.totalApplied
        : (federal.losses.limitedPartnershipApplied ?? 0),
      federal: federal.losses.limitedPartnershipApplied ?? 0,
    },
  };

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
    ...(albertaResourceDeductionClaims
      ? {
          depletion: {
            alberta: albertaResourceDeductionClaims.depletion,
            federal: federal.resourceDeductions?.depletionClaim ?? 0,
          },
          cee: {
            alberta: albertaResourceDeductionClaims.cee,
            federal: federal.resourceDeductions?.ceeClaim ?? 0,
          },
          cde: {
            alberta: albertaResourceDeductionClaims.cde,
            federal: federal.resourceDeductions?.cdeClaim ?? 0,
          },
          foreignExploration: {
            alberta: albertaResourceDeductionClaims.foreign,
            federal: federal.resourceDeductions?.foreignClaim ?? 0,
          },
          cogpe: {
            alberta: albertaResourceDeductionClaims.cogpe,
            federal: federal.resourceDeductions?.cogpeClaim ?? 0,
          },
        }
      : {}),
    lossDeductions,
    // Area B, 056-059 — same "always both sides once the pool exists" shape
    // as lossDeductions above. `donations.charitable`/`.gifts` are each only
    // present when Schedule 20 actually computed that pool (real activity),
    // matching `alwaysPair`'s own "omit when this composer has no data at
    // all" rule in `schedule12Values`.
    ...((donations?.charitable ?? donations?.gifts)
      ? {
          donations: {
            ...(donations.charitable
              ? {
                  charitable: {
                    alberta: donations.charitable.amountApplied,
                    federal: federal.donations?.donationsClaimed ?? 0,
                  },
                }
              : {}),
            ...(donations.gifts
              ? {
                  gifts: {
                    alberta: donations.gifts.amountApplied,
                    federal: culturalEcologicalGiftsFederal,
                  },
                }
              : {}),
          },
        }
      : {}),
  };

  return { result, filingInput };
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
function assembleIegAgreement(iegInput: AlbertaIegValues): IegAgreementInput {
  const members: IegAgreementMember[] = iegInput.agreementMembers ?? [];
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
function assembleAt4970(
  iegInput: AlbertaIegValues,
): NonNullable<AlbertaReturnInput['ieg']>['at4970'] {
  const projects = iegInput.projects ?? [];
  if (projects.length === 0) return undefined;

  const jurisdictions = iegInput.jurisdictions ?? [];

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
            .filter((j): j is typeof j & { jurisdiction: NonNullable<typeof j.jurisdiction> } =>
              Boolean(j.jurisdiction),
            )
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
function assembleIegEligible(
  iegInput: AlbertaIegValues,
): NonNullable<AlbertaReturnInput['ieg']>['eligible'] {
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
  if (!iegInput) return undefined;
  const members: IegGroupMember[] = iegInput.group ?? [];
  if (members.length === 0) return undefined;

  const agreementMembers: IegAgreementMember[] = iegInput.agreementMembers ?? [];
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
  fed: Fed,
  ri: Ri,
  albertaTaxableIncome: number,
  defaultBusinessLimit: number,
): { schedules: AlbertaReturnInput['schedules']; ieg: AlbertaReturnInput['ieg'] } {
  const ab = ri.alberta ?? {};

  const cca = scheduleThirteen(fed, ab, ri);
  const reserves = scheduleSeventeen(fed, ab);
  const dispositions = scheduleEighteen(fed, ab);
  const lossCarryback = scheduleTen(federal, ri);
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
    undefined,
    undefined,
    0,
    resourceDeductions,
  );

  const losses = scheduleTwentyOne(
    federal,
    ri,
    schedule12Result,
    lossCarryback?.capital?.totalCarriedBack,
    lossCarryback?.farmCarriedBack,
    lossCarryback?.restrictedFarmCarriedBack,
    lossCarryback?.lppCarriedBack,
  );
  const donations = scheduleTwenty(fed, ri, schedule12Result);

  // Re-run Schedule 12 once the continuities exist, so lines 064-073 (losses
  // of preceding years deducted, including limited partnership losses) are
  // populated too.
  const { filingInput: reconciliation } = scheduleTwelve(
    federal,
    cca,
    reserves,
    dispositions,
    losses?.nonCapital,
    losses?.capital,
    losses?.restrictedFarm,
    losses?.farm,
    losses?.limitedPartnershipLosses,
    donations,
    fed.culturalEcologicalGifts ?? 0,
    resourceDeductions,
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
    // Schedule 12 is filed when at least one reconciling item exists. Most
    // of these (cca/reserves/dispositions/losses) are Area A pairs, omitted
    // when Alberta agrees with federal — genuinely "nothing to disclose".
    // `donations` is different: Area B's 056-059 are mandatory-disclosure,
    // always-both-sides lines (see `Schedule12FilingInput.donations`'s own
    // doc comment) that populate whenever real donation/gift activity
    // exists AT ALL, whether or not Alberta diverges from federal — so it
    // belongs in this gate too, or a donations-only return never produces a
    // Schedule 12 payload despite `reconciliation.donations` genuinely
    // having data.
    ...(cca || reserves || dispositions || losses || donations || resourceDeductions
      ? { reconciliation }
      : {}),
    ...(cca ? { cca } : {}),
    ...(resourceDeductions ? { resourceDeductions } : {}),
    ...(reserves ? { reserves } : {}),
    ...(dispositions ? { dispositions } : {}),
    ...(donations ? { donations } : {}),
    ...(losses ? { losses } : {}),
  };

  return { schedules, ieg: assembleIeg(ri) };
}
