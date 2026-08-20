/**
 * Working return → the engine's `FederalT2Input` — the AUTHORITATIVE assembly.
 *
 * This is the single source of truth for what the engine computes: the server
 * assembles the engine input from the STORED, structured `returnInput`, so the
 * calculation and the frozen filing package are derived from ONE representation.
 * (The web keeps a live-preview projection, but the FILED result comes from here.)
 *
 * The stored return is a Mongo document (untyped Mixed), so this reads fields
 * defensively via `num()` rather than importing the web's `ReturnInput` type —
 * no cross-app type coupling, no duplicated storage contract.
 *
 * Whole dollars throughout (GIFI convention); `t2Engine.compute` converts to
 * cents at the tax-core boundary.
 */

import { SCHEDULE_1_LINE_BY_NUMBER } from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
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
    .filter((c: Ri) => c?.ccaClass)
    .map((c: Ri) => ({
      ccaClass: String(c.ccaClass),
      openingUCC: num(c.openingUCC),
      additions: num(c.additions),
      dispositions: num(c.dispositions),
      immediateExpensing: num(c.immediateExpensing),
      ...(c.aiip ? { aiip: true } : {}),
      ...(c.classEmptied ? { classEmptied: true } : {}),
      ...(c.claim != null && c.claim !== 0 ? { claim: num(c.claim) } : {}),
    }));
  return ccaClasses.length ? { ccaClasses } : {};
}

/** Schedule 6 — capital dispositions. */
function scheduleSix(ri: Ri) {
  const dispositions = (ri.capitalGains?.dispositions ?? [])
    .filter((d: Ri) => d?.description || d?.proceeds || d?.acb)
    .map((d: Ri) => ({
      description: d.description,
      proceeds: num(d.proceeds),
      acb: num(d.acb),
      outlays: num(d.outlays),
    }));
  return dispositions.length ? { capitalDispositions: dispositions } : {};
}

/** Schedule 2 — charitable donations (engine applies the 75% limit + carryforward). */
function scheduleTwo(ri: Ri) {
  const don = ri.donations ?? {};
  const charitableDonations = num(don.charitable) + num(don.cultural) + num(don.ecological);
  if (charitableDonations <= 0 && num(don.openingDonationPool) <= 0) return {};
  return {
    charitableDonations,
    ...(don.openingDonationPool != null
      ? { openingDonationPool: num(don.openingDonationPool) }
      : {}),
  };
}

/** Division C — s.112 dividend deduction only (donations→S2, losses→S4 continuity). */
function divisionC(ri: Ri) {
  const divisionCDeductions = [
    {
      label: 'Taxable dividends deductible s.112 (S3)',
      amount: num(ri.dividends?.taxableReceivedConnected),
    },
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
    .filter((c: Ri) => c?.taxYearEnd && c?.amount)
    .map((c: Ri) => ({ taxYearEnd: String(c.taxYearEnd), amount: num(c.amount) }));
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
  const otherAssociates = (sbd.associated ?? []).filter((m: Ri) => m?.name || m?.allocatedLimit);
  const businessLimit = sbd.businessLimit != null ? num(sbd.businessLimit) : 500000;
  return {
    activeBusinessIncome:
      sbd.activeBusinessIncome != null ? num(sbd.activeBusinessIncome) : bookNetIncome,
    businessLimit,
    ...(otherAssociates.length
      ? {
          associatedMembers: [
            { name: 'This corporation', allocatedLimit: businessLimit },
            ...otherAssociates.map((m: Ri) => ({
              name: m.name,
              allocatedLimit: num(m.allocatedLimit),
            })),
          ],
        }
      : {}),
    // Only pass an explicit prior-year taxable capital when the preparer entered
    // one on S7 — otherwise omit it so Schedule 33 (the `capital` slice) can derive
    // it. An unconditional 0 here would beat the S33 figure (`0 ?? s33` → 0).
    ...(sbd.taxableCapital != null && sbd.taxableCapital !== ''
      ? { taxableCapital: num(sbd.taxableCapital) }
      : {}),
    aaii: num(sbd.aaii),
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

/** Schedule 13 — continuity of reserves (Part 2, other reserves → S1). */
function scheduleThirteen(ri: Ri) {
  const rows = (ri.reserves?.rows ?? [])
    .filter((r: Ri) => r?.type || r?.opening || r?.transfer || r?.closing)
    .map((r: Ri) => ({
      type: r.type,
      opening: num(r.opening),
      transfer: num(r.transfer),
      closing: num(r.closing),
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
  const detail: Ri = {};
  let any = false;
  for (const k of keys) {
    if (c[k] != null && c[k] !== '') {
      detail[k] = num(c[k]);
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
      urls: (ib.urls ?? []).map((u: Ri) => String(u?.url ?? '').trim()).filter(Boolean),
      percentOfGrossRevenue: num(ib.percentOfGrossRevenue),
    },
  };
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

/** Assemble the engine's `FederalT2Input` (+ period) from the stored working return. */
export function assembleT2Input(ri: Ri, engagement: EngagementLike): Record<string, unknown> {
  const returnInput: Ri = ri ?? {};
  const bookNetIncome = bookNetIncomeOf(returnInput);
  const province = returnInput.identification?.province;

  const permanentEstablishments = (returnInput.provincialAllocation?.establishments ?? [])
    .filter((pe: Ri) => pe?.province)
    .map((pe: Ri) => ({
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
    ...scheduleTwentyOne(returnInput),
    ...scheduleThirtyOne(returnInput),
    ...scheduleThirteen(returnInput),
    ...scheduleThirtyThree(returnInput),
    ...scheduleFortyThree(returnInput),
    ...eifelFacts(returnInput),
    ...scheduleEightyEight(returnInput),
    ...scheduleOneOhOne(returnInput),
    ...divisionC(returnInput),
  };
}
