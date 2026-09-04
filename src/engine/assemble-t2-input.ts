/**
 * Working return → the engine's `FederalT2Input` — the AUTHORITATIVE assembly.
 *
 * This is the single source of truth for what the engine computes: the server
 * assembles the engine input from the STORED, structured `returnInput`, so the
 * calculation and the frozen filing package are derived from ONE representation.
 * (The web keeps a live-preview projection, but the FILED result comes from here.)
 *
 * The stored return is a Mongo document (untyped Mixed) validated against
 * `ReturnInput` (`return-input-contract.ts`) at the HTTP boundary before it
 * ever reaches here — see `return-input-validation.ts`. Every field is still
 * read defensively via `num()`, since the runtime document a given request
 * carries can predate a schema change even after that validation.
 *
 * Whole dollars throughout (GIFI convention); `t2Engine.compute` converts to
 * cents at the tax-core boundary.
 */

import type {
  AdjustedAggregateInvestmentIncomeInput,
  AggregateInvestmentIncomeInput,
  CapitalDisposition,
  CcaClassInput,
  Class13Input,
  Class14Input,
  PermanentEstablishment,
  ReserveContinuityRow,
  Schedule12ResourceDeductionsInput,
} from '@classytic/ca-tax/t2';
import { leaseholdPeriods } from '@classytic/ca-tax/t2';
import { dividendsDeductibleS112, SCHEDULE_1_LINE_BY_NUMBER } from '@classytic/ca-tax/t2';
import type {
  At1DispositionCategory,
  CcaClass,
  Class13LeaseholdLayer,
  Class14LimitedLifeProperty,
  Disposition,
  PermanentEstablishmentValues,
  ReserveRow,
  ReturnInput,
} from './return-input-contract.js';

type Ri = ReturnInput;
type EngagementLike = { taxYearStart: unknown; taxYearEnd: unknown; program: string };

/** Blank / non-numeric ⇒ 0. */
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ''));

function periodOf(e: EngagementLike) {
  const end = iso(e.taxYearEnd);
  return { start: iso(e.taxYearStart), end, label: `${e.program} ${new Date(end).getFullYear()}` };
}

/**
 * Schedule 1 — book-to-tax reconciliation, keyed by CRA line number.
 *
 * The editor stores `{ '104': 50000, '403': 55000 }`, because the line number is
 * the transmission key. Each entry is resolved against the generated form table,
 * so the caption filed is the one printed on the form and a line the form does
 * not define is dropped HERE rather than transmitted.
 *
 * Book amortization is the one line this fills itself: it comes from the income
 * statement, and a preparer who entered it there should not key it again on 104.
 */
function scheduleOne(ri: Ri) {
  const entered = (ri.netIncome?.lines ?? {}) as Record<string, unknown>;
  const additions: { line: string; label: string; amount: number }[] = [];
  const deductions: { line: string; label: string; amount: number }[] = [];

  for (const [line, raw] of Object.entries(entered)) {
    const amount = num(raw);
    if (amount === 0) continue;
    const known = SCHEDULE_1_LINE_BY_NUMBER.get(line);
    if (!known) continue;
    // Totals and figures carried from another schedule are the engine's to
    // produce. Accepting one here would let a keyed value silently override a
    // computed figure, and the return would stop footing against its schedules.
    if (known.role !== 'input') continue;
    (known.side === 'add' ? additions : deductions).push({ line, label: known.caption, amount });
  }

  const amortization = num(ri.incomeStatement?.amortization);
  if (amortization > 0 && !additions.some((a) => a.line === '104')) {
    additions.push({
      line: '104',
      label: SCHEDULE_1_LINE_BY_NUMBER.get('104')?.caption ?? 'Amortization of tangible assets',
      amount: amortization,
    });
  }

  additions.sort((a, b) => Number(a.line) - Number(b.line));
  deductions.sort((a, b) => Number(a.line) - Number(b.line));
  return { schedule1Additions: additions, schedule1Deductions: deductions };
}

/** Schedule 8 — depreciable property by class (engine computes CCA/recapture/terminal loss). */
function scheduleEight(ri: Ri) {
  const ccaClasses = (ri.cca?.classes ?? [])
    .filter((c: CcaClass) => c?.ccaClass)
    .map((c: CcaClass) => ({
      ccaClass: String(c.ccaClass),
      openingUCC: num(c.openingUCC),
      additions: num(c.additions),
      dispositions: num(c.dispositions),
      immediateExpensing: num(c.immediateExpensing),
      ...(c.aiip ? { aiip: true } : {}),
      ...(c.classEmptied ? { classEmptied: true } : {}),
      // An explicit 0 is a real discretionary answer — "claim nothing on this
      // class federally" — and is NOT the same as leaving the box blank, which
      // claims the maximum. Alberta's AT1 Schedule 13 exists precisely to file
      // a class claimed provincially but not federally, so collapsing 0 into
      // blank made that case impossible to state. Blank still arrives as
      // `undefined` or `''` from the form and still means "maximum".
      ...(c.claim != null ? { claim: num(c.claim) } : {}),
    }));
  return ccaClasses.length ? { ccaClasses } : {};
}

/**
 * Schedule 8 — a NEW class 13 leasehold layer or class 14 property added THIS
 * year, the full per-layer/per-property mechanic (Reg 1100(1)(b)/Schedule III
 * and Reg 1100(1)(c) respectively) — distinct from `scheduleEight` above,
 * which only ever draws down an EXISTING 13/14 opening balance and refuses a
 * current-year addition (see `computeCcaClass`'s own doc comment in
 * `schedule8.ts`). The engine needs each layer's Schedule III PERIOD count,
 * not a lease-end date — `leaseholdPeriods` derives it here from the tax
 * year start and the lease dates the preparer actually has, rather than
 * asking them to count 12-month periods by hand.
 */
function scheduleEightNewLayers(
  ri: Ri,
  engagement: EngagementLike,
): { class13?: Class13Input; class14?: Class14Input } {
  const cca = ri.cca ?? {};
  const taxYearStart = iso(engagement.taxYearStart);

  const layers = (cca.class13Layers ?? [])
    .filter((l: Class13LeaseholdLayer) => l?.capitalCost)
    .map((l: Class13LeaseholdLayer) => ({
      ...(l.description ? { description: l.description } : {}),
      capitalCost: num(l.capitalCost),
      periods: leaseholdPeriods(
        taxYearStart,
        String(l.leaseEnd ?? ''),
        l.firstRenewalEnd ? String(l.firstRenewalEnd) : undefined,
      ),
      ...(l.claimedToDate != null ? { claimedToDate: num(l.claimedToDate) } : {}),
      ...(l.proceeds != null ? { proceeds: num(l.proceeds) } : {}),
      ...(l.isFirstYear ? { isFirstYear: true } : {}),
      ...(l.aiip ? { aiip: true } : {}),
    }));
  const class13: Class13Input | undefined = layers.length
    ? {
        layers,
        openingUCC: num(cca.class13OpeningUCC),
        ...(cca.class13Claim != null ? { claim: num(cca.class13Claim) } : {}),
      }
    : undefined;

  const properties = (cca.class14Properties ?? [])
    .filter((p: Class14LimitedLifeProperty) => p?.capitalCost)
    .map((p: Class14LimitedLifeProperty) => ({
      ...(p.description ? { description: p.description } : {}),
      capitalCost: num(p.capitalCost),
      lifeDaysAtAcquisition: num(p.lifeDaysAtAcquisition),
    }));
  const class14: Class14Input | undefined = properties.length
    ? {
        properties,
        openingUCC: num(cca.class14OpeningUCC),
        ...(cca.class14Claim != null ? { claim: num(cca.class14Claim) } : {}),
      }
    : undefined;

  return { ...(class13 ? { class13 } : {}), ...(class14 ? { class14 } : {}) };
}

/** Schedule 6 — capital dispositions. */
function scheduleSix(ri: Ri) {
  const dispositions = (ri.capitalGains?.dispositions ?? [])
    .filter((d: Disposition) => d?.description || d?.proceeds || d?.acb)
    .map((d: Disposition) => ({
      description: d.description,
      proceeds: num(d.proceeds),
      acb: num(d.acb),
      outlays: num(d.outlays),
      // Federal Schedule 6 doesn't use this — it's carried through so an AT1
      // engagement can bucket the same dispositions into Alberta Schedule
      // 18's six category totals without a second data-entry pass.
      ...(d.category ? { category: d.category } : {}),
    }));
  return dispositions.length ? { capitalDispositions: dispositions } : {};
}

/**
 * Schedule 2 — charitable donations AND gifts.
 *
 * Two genuinely different deductions, not one combined pool: charitable
 * donations are capped at 75% of net income for tax (the engine's own
 * `computeSchedule2` applies that limit); cultural property and
 * ecologically sensitive land gifts under ITA s.110.1(1)(b)/(c) are NOT
 * income-limited at all. Combining all three before the cap (the previous
 * shape here) meant a corporation with a large cultural or ecological gift
 * could have it silently capped alongside charitable donations — an
 * understatement, the dangerous direction for a deduction.
 */
function scheduleTwo(ri: Ri) {
  const don = ri.donations ?? {};
  const charitableDonations = num(don.charitable);
  const culturalEcologicalGifts = num(don.cultural) + num(don.ecological);
  if (
    charitableDonations <= 0 &&
    culturalEcologicalGifts <= 0 &&
    num(don.openingDonationPool) <= 0
  ) {
    return {};
  }
  return {
    ...(charitableDonations > 0 ? { charitableDonations } : {}),
    ...(culturalEcologicalGifts > 0 ? { culturalEcologicalGifts } : {}),
    ...(don.openingDonationPool != null
      ? { openingDonationPool: num(don.openingDonationPool) }
      : {}),
  };
}

/** Division C — s.112 dividend deduction only (donations→S2, losses→S4 continuity). */
function divisionC(ri: Ri) {
  const divisionCDeductions = [
    dividendsDeductibleS112(num(ri.dividends?.taxableReceivedConnected)),
  ].filter((l) => l.amount > 0);
  return { divisionCDeductions };
}

/** Schedule 3 / Part IV / RDTOH + Schedule 53 GRIP. */
function scheduleThree(ri: Ri) {
  const div = ri.dividends ?? {};
  return {
    portfolioDividendsReceived: num(div.taxableReceivedPortfolio),
    taxableDividendsPaid: num(div.taxableDividendsPaid),
    openingGrip: div.openingGrip != null ? num(div.openingGrip) : 0,
    ...(div.eligibleDividendsReceived != null
      ? { eligibleDividendsReceived: num(div.eligibleDividendsReceived) }
      : {}),
    ...(div.eligibleDividendsPaid != null
      ? { eligibleDividendsDesignated: num(div.eligibleDividendsPaid) }
      : {}),
  };
}

/** Schedule 4 — loss pools + carry-back. */
function scheduleFour(ri: Ri) {
  const loss = ri.losses ?? {};
  const lossCarrybacks = (loss.carrybacks ?? [])
    .filter((c) => c?.taxYearEnd && c?.amount)
    .map((c) => ({ taxYearEnd: String(c.taxYearEnd), amount: num(c.amount) }));
  return {
    ...(lossCarrybacks.length ? { lossCarrybacks } : {}),
    openingNonCapitalLoss: num(loss.nonCapitalOpening),
    nonCapitalLossToApply: num(loss.nonCapitalApplied),
    openingNetCapitalLoss: num(loss.netCapitalOpening),
    netCapitalLossToApply: num(loss.netCapitalApplied),
    // Restricted classes. A blank `*Applied` means "claim the maximum", so an
    // explicit claim is only forwarded when the preparer actually entered one —
    // sending 0 would silently claim nothing.
    ...(loss.farmOpening != null ? { openingFarmLoss: num(loss.farmOpening) } : {}),
    ...(loss.farmApplied != null ? { farmLossToApply: num(loss.farmApplied) } : {}),
    ...(loss.restrictedFarmOpening != null
      ? { openingRestrictedFarmLoss: num(loss.restrictedFarmOpening) }
      : {}),
    ...(loss.restrictedFarmApplied != null
      ? { restrictedFarmLossToApply: num(loss.restrictedFarmApplied) }
      : {}),
    ...(loss.farmingIncome != null ? { farmingIncome: num(loss.farmingIncome) } : {}),
    ...(loss.limitedPartnershipOpening != null
      ? { openingLimitedPartnershipLoss: num(loss.limitedPartnershipOpening) }
      : {}),
    ...(loss.limitedPartnershipApplied != null
      ? { limitedPartnershipLossToApply: num(loss.limitedPartnershipApplied) }
      : {}),
    ...(loss.partnershipIncome != null ? { partnershipIncome: num(loss.partnershipIncome) } : {}),
    // At-risk is deliberately NOT defaulted: absent means nothing may be
    // applied, which is the fail-closed reading of s.96(2.2).
    ...(loss.atRiskAmount != null ? { atRiskAmount: num(loss.atRiskAmount) } : {}),
  };
}

/**
 * Schedule 43 — Part VI.1 on dividends paid on taxable preferred shares.
 * Omitted entirely when no such dividends were paid, so a return with no
 * preferred shares carries no empty schedule.
 */
function scheduleFortyThree(ri: Ri) {
  const ps = ri.preferredShares ?? {};
  const shortTerm = num(ps.shortTermPreferredDividends);
  const other = num(ps.otherPreferredDividends);
  if (shortTerm <= 0 && other <= 0) return {};
  return {
    preferredShareDividends: {
      shortTermPreferredDividends: shortTerm,
      otherPreferredDividends: other,
      ...(ps.electedUnder191_2 === true ? { electedUnder191_2: true } : {}),
      ...(ps.priorYearPreferredDividends != null
        ? { priorYearPreferredDividends: num(ps.priorYearPreferredDividends) }
        : {}),
      ...(ps.isAssociated === true ? { isAssociated: true } : {}),
      // Only forward an allocation when the group actually filed one — an
      // absent allocation means a nil allowance under s.191.1(2).
      ...(ps.isAssociated === true && ps.allocatedAllowance != null
        ? { allocatedAllowance: num(ps.allocatedAllowance) }
        : {}),
    },
  };
}

/**
 * EIFEL (s.18.2) excluded-entity facts. Always forwarded — the engine assesses
 * every return, and resolves the small-CCPC exception from the corporation type
 * and the taxable capital schedule without any of these fields.
 */
function eifelFacts(ri: Ri) {
  const e = ri.eifel ?? {};
  const facts: Record<string, unknown> = {};
  if (e.netInterestAndFinancingExpenses != null)
    facts.netInterestAndFinancingExpenses = num(e.netInterestAndFinancingExpenses);
  if (e.groupTaxableCapital != null) facts.groupTaxableCapital = num(e.groupTaxableCapital);
  if (e.domesticExceptionApplies === true) facts.domesticExceptionApplies = true;
  return Object.keys(facts).length > 0 ? { eifel: facts } : {};
}

/** Schedule 7 — SBD inputs + Schedule 23 group + Schedule 27 ZETM. */
function scheduleSeven(ri: Ri, bookNetIncome: number) {
  const sbd = ri.sbd ?? {};
  const otherAssociates = (sbd.associated ?? []).filter((m) => m?.name || m?.allocatedLimit);
  const businessLimit = sbd.businessLimit != null ? num(sbd.businessLimit) : 500000;
  return {
    activeBusinessIncome:
      sbd.activeBusinessIncome != null ? num(sbd.activeBusinessIncome) : bookNetIncome,
    businessLimit,
    ...(otherAssociates.length
      ? {
          associatedMembers: [
            { name: 'This corporation', allocatedLimit: businessLimit },
            ...otherAssociates.map((m) => ({
              name: m.name,
              allocatedLimit: num(m.allocatedLimit),
            })),
          ],
        }
      : {}),
    // Only pass an explicit prior-year taxable capital when the preparer entered
    // one on S7 — otherwise omit it so Schedule 33 (the `capital` slice) can derive
    // it. An unconditional 0 here would beat the S33 figure (`0 ?? s33` → 0).
    ...(sbd.taxableCapital != null ? { taxableCapital: num(sbd.taxableCapital) } : {}),
    // Conditional, NOT `aaii: num(sbd.aaii)` unconditionally: an explicit 0
    // would beat `aaiiDetail`'s derived figure the same way an unconditional
    // `taxableCapital: 0` would have beaten Schedule 33's derivation above.
    ...(sbd.aaii != null ? { aaii: num(sbd.aaii) } : {}),
    ...(sbd.aaiiDetail
      ? {
          adjustedAggregateInvestmentIncomeDetail: {
            ...(sbd.aaiiDetail.taxableCapitalGains != null
              ? { taxableCapitalGains: num(sbd.aaiiDetail.taxableCapitalGains) }
              : {}),
            ...(sbd.aaiiDetail.allowableCapitalLosses != null
              ? { allowableCapitalLosses: num(sbd.aaiiDetail.allowableCapitalLosses) }
              : {}),
            ...(sbd.aaiiDetail.incomeFromProperty != null
              ? { incomeFromProperty: num(sbd.aaiiDetail.incomeFromProperty) }
              : {}),
            ...(sbd.aaiiDetail.exemptIncome != null
              ? { exemptIncome: num(sbd.aaiiDetail.exemptIncome) }
              : {}),
            ...(sbd.aaiiDetail.agriInvestFundReceived != null
              ? { agriInvestFundReceived: num(sbd.aaiiDetail.agriInvestFundReceived) }
              : {}),
            ...(sbd.aaiiDetail.dividendsFromConnectedCorporations != null
              ? {
                  dividendsFromConnectedCorporations: num(
                    sbd.aaiiDetail.dividendsFromConnectedCorporations,
                  ),
                }
              : {}),
            ...(sbd.aaiiDetail.trustPropertyIncome != null
              ? { trustPropertyIncome: num(sbd.aaiiDetail.trustPropertyIncome) }
              : {}),
            ...(sbd.aaiiDetail.lossesFromProperty != null
              ? { lossesFromProperty: num(sbd.aaiiDetail.lossesFromProperty) }
              : {}),
            ...(sbd.aaiiDetail.subsection91_4Deduction != null
              ? { subsection91_4Deduction: num(sbd.aaiiDetail.subsection91_4Deduction) }
              : {}),
          },
        }
      : {}),
    ...(sbd.aggregateInvestmentIncome != null
      ? { aggregateInvestmentIncome: num(sbd.aggregateInvestmentIncome) }
      : {}),
    ...(sbd.aiiDetail
      ? {
          aggregateInvestmentIncomeDetail: {
            ...(sbd.aiiDetail.taxableCapitalGains != null
              ? { taxableCapitalGains: num(sbd.aiiDetail.taxableCapitalGains) }
              : {}),
            ...(sbd.aiiDetail.allowableCapitalLosses != null
              ? { allowableCapitalLosses: num(sbd.aiiDetail.allowableCapitalLosses) }
              : {}),
            ...(sbd.aiiDetail.netCapitalLossesClaimed != null
              ? { netCapitalLossesClaimed: num(sbd.aiiDetail.netCapitalLossesClaimed) }
              : {}),
            ...(sbd.aiiDetail.incomeFromProperty != null
              ? { incomeFromProperty: num(sbd.aiiDetail.incomeFromProperty) }
              : {}),
            ...(sbd.aiiDetail.exemptIncome != null
              ? { exemptIncome: num(sbd.aiiDetail.exemptIncome) }
              : {}),
            ...(sbd.aiiDetail.agriInvestFundReceived != null
              ? { agriInvestFundReceived: num(sbd.aiiDetail.agriInvestFundReceived) }
              : {}),
            ...(sbd.aiiDetail.taxableDividendsDeductible != null
              ? { taxableDividendsDeductible: num(sbd.aiiDetail.taxableDividendsDeductible) }
              : {}),
            ...(sbd.aiiDetail.trustPropertyIncome != null
              ? { trustPropertyIncome: num(sbd.aiiDetail.trustPropertyIncome) }
              : {}),
            ...(sbd.aiiDetail.lossesFromProperty != null
              ? { lossesFromProperty: num(sbd.aiiDetail.lossesFromProperty) }
              : {}),
          },
        }
      : {}),
    ...(num(sbd.zetmIncome) > 0 ? { zetmIncome: num(sbd.zetmIncome) } : {}),
  };
}

/** Schedule 21 — foreign tax credit. */
function scheduleTwentyOne(ri: Ri) {
  const f = ri.foreign ?? {};
  const hasForeign =
    num(f.foreignNonBusinessIncome) > 0 ||
    num(f.foreignBusinessIncome) > 0 ||
    num(f.foreignNonBusinessTaxPaid) > 0 ||
    num(f.foreignBusinessTaxPaid) > 0 ||
    num(f.openingBusinessFtcPool) > 0;
  if (!hasForeign) return {};
  return {
    foreignNonBusinessIncome: num(f.foreignNonBusinessIncome),
    foreignNonBusinessTaxPaid: num(f.foreignNonBusinessTaxPaid),
    foreignBusinessIncome: num(f.foreignBusinessIncome),
    foreignBusinessTaxPaid: num(f.foreignBusinessTaxPaid),
    ...(f.openingBusinessFtcPool != null
      ? { openingBusinessFtcPool: num(f.openingBusinessFtcPool) }
      : {}),
  };
}

/**
 * Schedule 13 — continuity of reserves (Part 2, other reserves → S1).
 *
 * `albertaOpening`/`albertaTransfer`/`albertaClosing` have no federal meaning
 * at all — the federal computation reads only `type`/`opening`/`transfer`/
 * `closing` — but they ride along on the same row so AT1 Schedule 17
 * (`assemble-at1-schedules.ts`'s `scheduleSeventeen`) can read its overrides
 * straight off `fed.reserveContinuity` without a second federal→AT1 lookup.
 */
function scheduleThirteen(ri: Ri) {
  const present = (v: unknown): boolean => v != null && v !== '';
  const rows = (ri.reserves?.rows ?? [])
    .filter(
      (r: ReserveRow) =>
        r?.type ||
        r?.opening ||
        r?.transfer ||
        r?.closing ||
        present(r?.albertaOpening) ||
        present(r?.albertaTransfer) ||
        present(r?.albertaClosing),
    )
    .map((r: ReserveRow) => ({
      type: r.type,
      opening: num(r.opening),
      transfer: num(r.transfer),
      closing: num(r.closing),
      ...(present(r.albertaOpening) ? { albertaOpening: num(r.albertaOpening) } : {}),
      ...(present(r.albertaTransfer) ? { albertaTransfer: num(r.albertaTransfer) } : {}),
      ...(present(r.albertaClosing) ? { albertaClosing: num(r.albertaClosing) } : {}),
    }));
  return rows.length ? { reserveContinuity: rows } : {};
}

/** Schedule 33 — taxable capital employed in Canada (balance-sheet detail → grind). */
function scheduleThirtyThree(ri: Ri) {
  const c = ri.capital ?? {};
  const keys = [
    'reservesNotDeducted',
    'capitalStock',
    'retainedEarnings',
    'contributedSurplus',
    'otherSurpluses',
    'deferredForexGains',
    'loansAndAdvances',
    'bondsAndDebentures',
    'dividendsDeclaredUnpaid',
    'otherLongTermDebt',
    'partnershipInterest',
    'deferredTaxDebit',
    'deficitInEquity',
    'patronageDeducted',
    'deferredForexLosses',
    'sharesOfOtherCorporations',
    'loansToOtherCorporations',
    'bondsOfOtherCorporations',
    'longTermDebtOfFinancialInstitution',
    'dividendsReceivable',
    'partnershipObligations',
    'partnershipInterestAsset',
    'taxableIncomeEarnedInCanada',
  ];
  const detail: Record<string, number> = {};
  let any = false;
  for (const k of keys) {
    const v = c[k as keyof typeof c];
    if (v != null) {
      detail[k] = num(v);
      any = true;
    }
  }
  return any ? { taxableCapitalDetail: detail } : {};
}

/** Schedule 31 — SR&ED ITC. */
function scheduleThirtyOne(ri: Ri) {
  const c = ri.credits ?? {};
  if (num(c.sredQualifiedExpenditures) <= 0 && num(c.openingItcPool) <= 0) return {};
  return {
    sredQualifiedExpenditures: num(c.sredQualifiedExpenditures),
    ...(c.openingItcPool != null ? { openingItcPool: num(c.openingItcPool) } : {}),
  };
}

/** Book net income per the income statement — the ABI fallback. */
export function bookNetIncomeOf(ri: Ri): number {
  const is = ri.incomeStatement ?? {};
  return (
    num(is.revenue) -
    num(is.costOfSales) -
    num(is.salariesAndWages) -
    num(is.amortization) -
    num(is.otherExpenses)
  );
}

/**
 * Schedule 88 — internet business activities. Information only. The engine
 * normalizes the list (top five sites by gross revenue) and clamps the
 * percentage, so nothing is trimmed here.
 */
function scheduleEightyEight(ri: Ri) {
  const ib = ri.internetBusiness ?? {};
  if (ib.hasInternetBusiness !== true) return {};
  return {
    internetBusiness: {
      hasInternetBusiness: true,
      ...(ib.webPageCount != null ? { webPageCount: num(ib.webPageCount) } : {}),
      urls: (ib.urls ?? []).map((u) => String(u?.url ?? '').trim()).filter(Boolean),
      percentOfGrossRevenue: num(ib.percentOfGrossRevenue),
    },
  };
}

/**
 * Schedule 12 — resource-related deductions (depletion/CEE/CDE/COGPE/foreign).
 *
 * The ONLY place this app collects these figures today is
 * `ri.albertaResourceDeductions15` — the AT1-only "Resource Related
 * Deductions (S15)" guided-editor page (`programs: ["AT1"]`), which already
 * has a `federal<X>` field for every figure this schedule needs (it exists
 * to give AT1's own Schedule 15 reconciliation a federal baseline to diff
 * against). Those `federal<X>` figures were being collected and then
 * discarded — read only by the AT1 diff, never fed into the federal
 * computation itself, so federal Schedule 1 lines 340-345 were always 0
 * even when a preparer had entered real federal pool data here. This
 * function closes that gap by reusing the SAME data as this module's own
 * federal input.
 *
 * A real, disclosed limitation: because the source page is AT1-only, a
 * PURE T2 (non-AT1) filer currently has no guided-editor surface to enter
 * resource deductions at all — `ri.albertaResourceDeductions15` will always
 * be empty for them, and this schedule will correctly compute nothing.
 * Giving pure-T2 filers their own entry point is a separate, not-yet-built
 * piece of work.
 *
 * Per-country SFEDE/CFRE rows are summed into one flat figure per column —
 * see `computeSchedule12ResourceDeductions`'s own doc comment on why (the
 * form's per-country allocation is a preparer-side exercise this engine
 * does not perform).
 */
function scheduleTwelve(ri: Ri) {
  const s15 = ri.albertaResourceDeductions15;
  if (!s15) return {};

  const sum = (rows: readonly { [k: string]: unknown }[] | undefined, key: string): number =>
    (rows ?? []).reduce((s, r) => s + num(r[key]), 0);

  const resourceDeductions = {
    depletion: {
      edaRegularOpening: num(s15.edaRegular?.federalOpeningBalance),
      edaSuccessorOpening: num(s15.edaSuccessor?.federalOpeningBalance),
      cmedbOpening: num(s15.cmedb?.federalOpeningBalance),
    },
    cee: {
      regularOpening: num(s15.ceeRegular?.federalOpeningBalance),
      regularCurrentYearExpenses: num(s15.ceeRegular?.federalCurrentYearExpenses),
      regularOtherAdditions: num(s15.ceeRegular?.federalOtherAdditions),
      regularGovernmentAssistance: num(s15.ceeRegular?.federalGovernmentAssistance),
      regularOtherDeductions: num(s15.ceeRegular?.federalOtherDeductions),
      successorOpening: num(s15.ceeSuccessor?.federalOpeningBalance),
      successorOtherDeductions: num(s15.ceeSuccessor?.federalOtherDeductions),
    },
    cde: {
      regularOpening: num(s15.cdeRegular?.federalOpeningBalance),
      regularCurrentYearExpenses: num(s15.cdeRegular?.federalCurrentYearExpenses),
      regularOtherAdditions: num(s15.cdeRegular?.federalOtherAdditions),
      regularGovernmentAssistance: num(s15.cdeRegular?.federalGovernmentAssistance),
      regularReceivableOnDisposition: num(s15.cdeRegular?.federalReceivableOnDisposition),
      regularOtherDeductions: num(s15.cdeRegular?.federalOtherDeductions),
      successorOpening: num(s15.cdeSuccessor?.federalOpeningBalance),
      successorOtherDeductions: num(s15.cdeSuccessor?.federalOtherDeductions),
    },
    cogpe: {
      regularOpening: num(s15.ccogpeRegular?.federalOpeningBalance),
      regularCurrentYearExpenses: num(s15.ccogpeRegular?.federalCurrentYearExpenses),
      regularOtherAdditions: num(s15.ccogpeRegular?.federalOtherAdditions),
      regularReceivableOnDisposition: num(s15.ccogpeRegular?.federalReceivableOnDisposition),
      regularGovernmentAssistance: num(s15.ccogpeRegular?.federalGovernmentAssistance),
      regularOtherDeductions: num(s15.ccogpeRegular?.federalOtherDeductions),
      successorOpening: num(s15.ccogpeSuccessor?.federalOpeningBalance),
      successorReceivableOnDisposition: num(s15.ccogpeSuccessor?.federalReceivableOnDisposition),
      successorOtherDeductions: num(s15.ccogpeSuccessor?.federalOtherDeductions),
    },
    foreignExploration: {
      regularOpening: num(s15.fedeRegular?.federalOpeningBalance),
      regularOtherDeductions: num(s15.fedeRegular?.federalOtherDeductions),
      regularForeignResourceIncome: num(s15.fedeRegular?.federalForeignResourceIncome),
      successorOpening: num(s15.fedeSuccessor?.federalOpeningBalance),
      successorOtherDeductions: num(s15.fedeSuccessor?.federalOtherDeductions),
      successorForeignResourceIncome: num(s15.fedeSuccessor?.federalForeignResourceIncome),
    },
    specifiedForeignRegular: {
      openingBalance: sum(s15.sfedeRegular, 'federalOpeningBalance'),
      otherDeductions: sum(s15.sfedeRegular, 'federalOtherDeductions'),
      foreignResourceIncome: sum(s15.sfedeRegular, 'federalForeignResourceIncome'),
    },
    specifiedForeignSuccessor: {
      openingBalance: sum(s15.sfedeSuccessor, 'federalOpeningBalance'),
      otherDeductions: sum(s15.sfedeSuccessor, 'federalOtherDeductions'),
      foreignResourceIncome: sum(s15.sfedeSuccessor, 'federalForeignResourceIncome'),
    },
    cumulativeForeignRegular: {
      openingBalance: sum(s15.cfreRegular, 'federalOpeningBalance'),
      currentYearExpenses: sum(s15.cfreRegular, 'federalCurrentYearExpenses'),
      otherDeductions: sum(s15.cfreRegular, 'federalOtherDeductions'),
      foreignResourceIncome: sum(s15.cfreRegular, 'federalForeignResourceIncome'),
    },
    cumulativeForeignSuccessor: {
      openingBalance: sum(s15.cfreSuccessor, 'federalOpeningBalance'),
      otherDeductions: sum(s15.cfreSuccessor, 'federalOtherDeductions'),
      foreignResourceIncome: sum(s15.cfreSuccessor, 'federalForeignResourceIncome'),
    },
    ...(s15.daysInTaxYear != null ? { daysInTaxYear: num(s15.daysInTaxYear) } : {}),
  };

  return { resourceDeductions };
}

/**
 * Schedule 101 / 24 — first return after incorporation, amalgamation or wind-up.
 * The form collects predecessor BNs as one comma-separated string; the engine
 * wants a list, so the split happens at this boundary rather than in the schema.
 */
function scheduleOneOhOne(ri: Ri) {
  const fr = ri.firstReturn ?? {};
  if (fr.isFirstReturn !== true) return {};
  const predecessorBusinessNumbers = String(fr.predecessorBusinessNumbers ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  return {
    firstReturn: {
      isFirstReturn: true,
      ...(fr.event ? { event: fr.event } : {}),
      ...(fr.eventDate ? { eventDate: iso(fr.eventDate).slice(0, 10) } : {}),
      ...(predecessorBusinessNumbers.length > 0 ? { predecessorBusinessNumbers } : {}),
      openingAssets: num(fr.openingAssets),
      openingLiabilities: num(fr.openingLiabilities),
      openingEquity: num(fr.openingEquity),
    },
  };
}

/**
 * What `assembleT2Input` actually returns: `FederalT2Input`'s own fields,
 * `period` (the engine wraps `periodStart`/`periodEnd` into this too — see
 * that field's own note below), and the schedule-keyed additions each
 * `scheduleN` helper above contributes. Declared explicitly, not inferred via
 * `ReturnType<typeof assembleT2Input>` — several of the `scheduleN` helpers
 * return from more than one `return` statement with a DIFFERENT shape per
 * branch (e.g. `scheduleTwo` returns `{}` when there is nothing to report),
 * which makes TypeScript infer the whole function's return type as a UNION
 * of those shapes rather than one shape with optional fields; spreading many
 * such unions into one object literal then loses fields a inference can't
 * reliably carry through (confirmed: `fed.charitableDonations` came back
 * "does not exist" under the inferred version, even though every branch that
 * matters produces it). A hand-declared interface is also, per the review
 * this fixes, the point: every composer gets one real, stable type to
 * destructure against.
 */
export interface AssembledFederalInput {
  period: { start: string; end: string; label: string };
  periodStart: string;
  periodEnd: string;
  bookNetIncome: number;
  province?: string;
  permanentEstablishments?: PermanentEstablishment[];

  // Schedule 1 — book-to-tax reconciliation.
  schedule1Additions: { line: string; label: string; amount: number }[];
  schedule1Deductions: { line: string; label: string; amount: number }[];

  // Schedule 2 — charitable donations AND gifts, as two SEPARATE figures —
  // `charitableDonations` (75%-of-income capped) and `culturalEcologicalGifts`
  // (uncapped, s.110.1(1)(b)/(c)) — see `scheduleTwo`'s own doc comment for
  // why combining them (the previous shape here) was a real correctness bug.
  charitableDonations?: number;
  openingDonationPool?: number;
  culturalEcologicalGifts?: number;

  // Schedule 3 / Part IV / RDTOH + Schedule 53 GRIP.
  portfolioDividendsReceived: number;
  taxableDividendsPaid: number;
  openingGrip: number;
  eligibleDividendsReceived?: number;
  eligibleDividendsDesignated?: number;

  // Schedule 4 — loss pools + carry-back.
  lossCarrybacks?: { taxYearEnd: string; amount: number }[];
  openingNonCapitalLoss: number;
  nonCapitalLossToApply: number;
  openingNetCapitalLoss: number;
  netCapitalLossToApply: number;
  openingFarmLoss?: number;
  farmLossToApply?: number;
  openingRestrictedFarmLoss?: number;
  restrictedFarmLossToApply?: number;
  farmingIncome?: number;
  openingLimitedPartnershipLoss?: number;
  limitedPartnershipLossToApply?: number;
  partnershipIncome?: number;
  atRiskAmount?: number;

  // Schedule 6 — capital dispositions. `category` is AT1-only (federal Schedule
  // 6 ignores it) — see `Disposition`'s own doc comment in return-input-contract.ts.
  capitalDispositions?: (CapitalDisposition & { category?: At1DispositionCategory })[];

  // Schedule 7 — SBD inputs + Schedule 23 group + Schedule 27 ZETM.
  activeBusinessIncome: number;
  businessLimit: number;
  associatedMembers?: { name?: string; allocatedLimit: number }[];
  taxableCapital?: number;
  aaii?: number;
  adjustedAggregateInvestmentIncomeDetail?: AdjustedAggregateInvestmentIncomeInput;
  aggregateInvestmentIncome?: number;
  aggregateInvestmentIncomeDetail?: AggregateInvestmentIncomeInput;
  zetmIncome?: number;

  // Schedule 8 — depreciable property by class.
  ccaClasses?: CcaClassInput[];
  // Schedule 8 — a NEW class 13 leasehold layer / class 14 property added this year.
  class13?: Class13Input;
  class14?: Class14Input;

  // Schedule 21 — foreign tax credit.
  foreignNonBusinessIncome?: number;
  foreignNonBusinessTaxPaid?: number;
  foreignBusinessIncome?: number;
  foreignBusinessTaxPaid?: number;
  openingBusinessFtcPool?: number;

  // Schedule 31 — SR&ED ITC.
  sredQualifiedExpenditures?: number;
  openingItcPool?: number;

  // Schedule 13 (federal Part 2) — continuity of reserves. `albertaOpening` /
  // `albertaTransfer` / `albertaClosing` have no federal meaning — see this
  // field's own note in `scheduleThirteen` above.
  reserveContinuity?: (ReserveContinuityRow & {
    albertaOpening?: number;
    albertaTransfer?: number;
    albertaClosing?: number;
  })[];

  // Schedule 33 — taxable capital employed in Canada.
  taxableCapitalDetail?: Record<string, number>;

  // Schedule 43 — Part VI.1 on dividends paid on taxable preferred shares.
  preferredShareDividends?: {
    shortTermPreferredDividends: number;
    otherPreferredDividends: number;
    electedUnder191_2?: boolean;
    priorYearPreferredDividends?: number;
    isAssociated?: boolean;
    allocatedAllowance?: number;
  };

  // EIFEL (s.18.2) excluded-entity facts.
  eifel?: {
    netInterestAndFinancingExpenses?: number;
    groupTaxableCapital?: number;
    domesticExceptionApplies?: boolean;
  };

  // Schedule 88 — internet business activities.
  internetBusiness?: {
    hasInternetBusiness: boolean;
    webPageCount?: number;
    urls: string[];
    percentOfGrossRevenue: number;
  };

  // Schedule 101 / 24 — first return after incorporation, amalgamation or wind-up.
  firstReturn?: {
    isFirstReturn: boolean;
    event?: 'incorporation' | 'amalgamation' | 'windUpOfSubsidiary';
    eventDate?: string;
    predecessorBusinessNumbers?: string[];
    openingAssets: number;
    openingLiabilities: number;
    openingEquity: number;
  };

  // Division C — s.112 dividend deduction only.
  divisionCDeductions: { label: string; amount: number }[];

  // Schedule 12 — resource-related deductions. See `scheduleTwelve`'s own
  // doc comment for where this data actually comes from today.
  resourceDeductions?: Schedule12ResourceDeductionsInput;
}

/** Assemble the engine's `FederalT2Input` (+ period) from the stored working return. */
export function assembleT2Input(ri: Ri, engagement: EngagementLike): AssembledFederalInput {
  const returnInput: Ri = ri ?? {};
  const bookNetIncome = bookNetIncomeOf(returnInput);
  const province = returnInput.identification?.province;

  const permanentEstablishments = (returnInput.provincialAllocation?.establishments ?? [])
    .filter((pe: PermanentEstablishmentValues) => pe?.province)
    .map((pe: PermanentEstablishmentValues) => ({
      province: String(pe.province),
      grossRevenue: num(pe.grossRevenue),
      salariesWages: num(pe.salariesWages),
    }));

  return {
    period: periodOf(engagement),
    // The engine reads periodStart/periodEnd (NOT `period`) for short-year
    // proration (s.125(5)(b), Reg 1100(3)) and mid-year provincial rate weighting;
    // pass the engagement's tax year so those fire on a real (host) computation.
    periodStart: iso(engagement.taxYearStart),
    periodEnd: iso(engagement.taxYearEnd),
    bookNetIncome,
    ...(province ? { province } : {}),
    ...(permanentEstablishments.length > 0 ? { permanentEstablishments } : {}),
    ...scheduleOne(returnInput),
    ...scheduleTwo(returnInput),
    ...scheduleThree(returnInput),
    ...scheduleFour(returnInput),
    ...scheduleSix(returnInput),
    ...scheduleSeven(returnInput, bookNetIncome),
    ...scheduleEight(returnInput),
    ...scheduleEightNewLayers(returnInput, engagement),
    ...scheduleTwentyOne(returnInput),
    ...scheduleThirtyOne(returnInput),
    ...scheduleThirteen(returnInput),
    ...scheduleThirtyThree(returnInput),
    ...scheduleFortyThree(returnInput),
    ...eifelFacts(returnInput),
    ...scheduleEightyEight(returnInput),
    ...scheduleOneOhOne(returnInput),
    ...scheduleTwelve(returnInput),
    ...divisionC(returnInput),
  };
}

/**
 * What every AT1 composer (`assemble-at1-schedules.ts` and its
 * `at1-schedule-composers/*` siblings) actually receives as `fed`:
 * `AssembledFederalInput`, except `period` — `coerceEngineInput`
 * (`engagement-compute.service.ts`) rewrites `period.start`/`period.end`
 * from the ISO strings this file produces into real `Date` instances before
 * any composer runs, because `at1Engine.validate` (downstream) requires
 * `Date`, not string. One field, so this is a targeted `Omit` + override
 * rather than modelling the whole coercion step in the type system.
 */
export type ComposedFederalInput = Omit<AssembledFederalInput, 'period'> & {
  period?: { start: Date; end: Date; label: string };
};
