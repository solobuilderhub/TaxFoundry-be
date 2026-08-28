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
  computeLossContinuity,
  computeSchedule20,
  type FederalT2Result,
  type IegAgreementInput,
  reconcileAlbertaNetIncome,
  type Schedule12Result,
  schedule12LossDeductions,
} from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const yes = (v: unknown): boolean => v === 'yes';

/** 000060 / 000061 — TRA forbids filing 13/17/18 unless divergence is declared. */
function divergenceFlags(ab: Ri) {
  return {
    reportsDifferentAlbertaIncome: yes(ab.reportsDifferentAlbertaIncome),
    electsDifferentDiscretionaryAmounts: yes(ab.electsDifferentDiscretionaryAmounts),
  };
}

// ── Schedule 13 — CCA ─────────────────────────────────────────────────────

function scheduleThirteen(fed: Ri, ab: Ri) {
  const federalClasses = fed.ccaClasses ?? [];
  if (federalClasses.length === 0) return undefined;
  const result = computeAlbertaSchedule13({ federalClasses, ...divergenceFlags(ab) });
  // TRA forbids completing the form at all when neither divergence flag is
  // set — filing it anyway would be filing something the spec says cannot
  // exist, even if the underlying figures happen to differ.
  return result.formPermitted ? result : undefined;
}

// ── Schedule 17 — reserves ────────────────────────────────────────────────

/**
 * `fed.reserveContinuity` rows now carry a controlled `type` (see
 * `apps/web/.../_config/options.ts`'s `RESERVE_TYPE_OPTIONS`, matching AT1's
 * own `At1ReserveKind` enum) rather than free text, so this maps 1:1 with no
 * fuzzy matching. Two AT1-only kinds (insurance policy reserves, bank
 * reserves) have no UI yet — narrow enough (insurance/bank corporations only)
 * to defer rather than build blind.
 */
function scheduleSeventeen(fed: Ri, ab: Ri) {
  const rows: Ri[] = fed.reserveContinuity ?? [];
  if (rows.length === 0) return undefined;
  const federalReserves: Record<string, { opening: number; transfer: number; closing: number }> =
    {};
  for (const r of rows) {
    if (!r.type) continue;
    federalReserves[r.type] = {
      opening: num(r.opening),
      transfer: num(r.transfer),
      closing: num(r.closing),
    };
  }
  if (Object.keys(federalReserves).length === 0) return undefined;
  const result = computeAlbertaSchedule17({
    federalReserves: federalReserves as never,
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
 * balance carried forward from a prior AT1 filing. Everything else
 * (current-year loss creation, what was applied, what expired) reuses the
 * federal Schedule 4 result for the four pools with a federal equivalent —
 * this is a documented simplification (single-jurisdiction in-year timing);
 * Schedule 12 already reconciles the LOSS AMOUNT itself where Alberta and
 * federal net income diverge. Listed personal property has no federal
 * equivalent at all, so its full continuity is Alberta-only input.
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
  ) =>
    computeLossContinuity({
      openingBalance: opening,
      currentYearLoss: fed.currentYearLoss,
      carriedBack: fed.carriedBack,
      appliedCurrentYear: fed.appliedCurrentYear,
      expired: fed.expired,
    });

  return {
    currentYearNonCapitalLoss: albertaCurrentYearLoss(schedule12),
    nonCapital: carryForward(num(c.nonCapitalOpening), federal.losses.nonCapital),
    capital: carryForward(num(c.capitalOpening), federal.losses.netCapital),
    farm: carryForward(num(c.farmOpening), federal.losses.farm),
    restrictedFarm: carryForward(num(c.restrictedFarmOpening), federal.losses.restrictedFarm),
    listedPersonalProperty: computeLossContinuity({
      openingBalance: num(c.lppOpening),
      currentYearLoss: num(c.lppCurrentYearLoss),
      appliedCurrentYear: num(c.lppApplied),
      expired: num(c.lppExpired),
    }),
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
    members: members.map((m, i) => ({
      name: m.name || `Member ${i + 1}`,
      ...(m.albertaCan ? { albertaCan: m.albertaCan } : {}),
      ...(m.currentTaxationYearEnd ? { currentTaxationYearEnd: m.currentTaxationYearEnd } : {}),
      allocatedExpenditureLimit: num(m.allocatedExpenditureLimit),
      currentYearExpenditures: num(m.currentYearExpenditures),
      priorYear1: num(m.priorYear1),
      priorYear2: num(m.priorYear2),
      taxableCapitalPriorYear: num(m.taxableCapitalPriorYear),
      ...(m.daysInTaxYear != null ? { daysInTaxYear: num(m.daysInTaxYear) } : {}),
    })),
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

  return {
    eligibleExpenditures: num(iegInput.eligibleExpenditures),
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

  const cca = scheduleThirteen(fed, ab);
  const reserves = scheduleSeventeen(fed, ab);
  const dispositions = scheduleEighteen(fed, ab);
  const lossCarryback = scheduleTen(federal);
  const smallBusinessDeduction = scheduleOne(fed, ri, albertaTaxableIncome, defaultBusinessLimit);

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
    ...(lossCarryback ? { lossCarryback } : {}),
    // Schedule 12 is filed only when at least one reconciling item exists —
    // an all-agree reconciliation is not a divergence to disclose.
    ...(cca || reserves || dispositions || losses ? { reconciliation } : {}),
    ...(cca ? { cca } : {}),
    ...(reserves ? { reserves } : {}),
    ...(dispositions ? { dispositions } : {}),
    ...(donations ? { donations } : {}),
    ...(losses ? { losses } : {}),
  };

  return { schedules, ieg: assembleIeg(ri) };
}
