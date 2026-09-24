/**
 * Review-flag generator — the agentic review layer (deterministic first cut).
 *
 * Reads the computed return + the working inputs and emits colour-coded,
 * CITED diagnostics (red = blocks filing, amber = verify, green = check passed).
 * Every flag links to its ITA section / CRA line. That cited trail IS the
 * preparer's s.163.2 due-diligence record: it evidences what was checked, on
 * what authority, and who cleared it.
 *
 * Rules are deterministic today; an LLM pass can later ADD flags on top, but a
 * filed value must still originate engine/imported/human (never model) — so the
 * agent proposes, the engine/human disposes.
 */

import { hasExactRateYear } from '@classytic/ca-tax/t2';
import { createError } from '@classytic/repo-core/errors';
import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { ComputedReturnDocument } from '#resources/ledger/computed-return/computed-return.model.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { ReviewMemoDocument } from '#resources/workpapers/review-memo/review-memo.model.js';
import reviewMemoRepository from '#resources/workpapers/review-memo/review-memo.repository.js';
import { appendFact } from '#shared/append-fact.js';
import type { WithId } from '#shared/db.js';
import { type At1Identity, effectiveAt1Identity } from '../engine/at1-identity.js';
import type { ReturnInput } from '../engine/contracts/return-input.js';
import { getAlbertaRateBook, getFederalRateBook, getQuebecRateBook } from '../engine/tax-rates.js';
import { runDiagnostics } from './diagnostics.js';

type Severity = 'green' | 'amber' | 'red';
interface Flag {
  severity: Severity;
  code: string;
  message: string;
  citation?: string;
  line?: string;
  resolved: boolean;
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

interface ReviewInput {
  program: string;
  corpType?: string;
  businessNumber?: string;
  fold: Record<string, number>;
  /**
   * The working return, typed against the contract the API validates rather
   * than `Record<string, any>`.
   *
   * The `any` was load-bearing by accident: every slice below is reached as
   * `ri.sbd.activeBusinessIncome` and friends, and `any` made all of it compile
   * whether or not the field existed. A renamed or removed contract field would
   * have silently read `undefined` here and quietly changed which review flags
   * fire — on the layer whose whole job is catching mistakes before filing.
   */
  ri: Partial<ReturnInput>;
  /** True when the return's tax year has an EXACT certified rate table, in ITS OWN program's rate book. */
  rateYearCertified?: boolean;
  /** The return's tax year (for the rate-year flag message). */
  taxYear?: number;
  /**
   * Province of permanent establishment, from the client's registered address.
   *
   * The return input has no province field — there is no such control in the
   * return editor — so reading `ri.identification.province` alone left the
   * Schedule 5 flag printing "Provincial/territorial tax (undefined)".
   */
  province?: string;
}

/** The client's registered-address province, blank-safe. */
export const clientProvince = (
  client: { address?: { province?: string } | null; jurisdiction?: string } | null | undefined,
): string | undefined => {
  const v = client?.address?.province ?? client?.jurisdiction;
  return v && String(v).trim() !== '' ? String(v).trim() : undefined;
};

/** The rule set. Pure — takes the return data, returns the flags. Unit-testable. */
export function evaluateReviewFlags(input: ReviewInput): Flag[] {
  const { corpType, businessNumber, fold, ri } = input;
  const flags: Flag[] = [];
  const push = (
    severity: Severity,
    code: string,
    message: string,
    extra?: { citation?: string; line?: string },
  ) => flags.push({ severity, code, message, resolved: false, ...extra });

  // Fail-closed on the rate year: a return whose tax year lacks an exact certified
  // rate table would file on carried-forward rates. Red — blocks sign-off/transmit.
  if (input.rateYearCertified === false) {
    push(
      'red',
      'RATE_YEAR_UNCERTIFIED',
      `No certified rate table for tax year ${input.taxYear ?? '?'} — the return is computed on carried-forward rates and cannot be filed until the ${input.taxYear ?? ''} rate book is wired.`,
      { line: 'Rates' },
    );
  }

  const netIncomeForTax = fold.netIncomeForTax ?? 0;
  const taxableIncome = fold.taxableIncome ?? 0;
  const sbdIncome = fold.sbdIncome ?? 0;
  const partI = fold.partITaxPayable ?? 0;

  const isCcpc = (corpType ?? '').toUpperCase().includes('CCPC');
  const is = ri.incomeStatement ?? {};
  const bs = ri.balanceSheet ?? {};
  const sbd = ri.sbd ?? {};
  const cca = ri.cca ?? {};

  const bookNetIncome =
    num(is.revenue) -
    num(is.costOfSales) -
    num(is.salariesAndWages) -
    num(is.amortization) -
    num(is.otherExpenses);

  // ── Identification ────────────────────────────────────────────────────────
  if (!businessNumber || !/^\d{9}/.test(String(businessNumber))) {
    push(
      'red',
      'BN_MISSING',
      'Business Number is missing or not a valid 9-digit BN — cannot file.',
      { line: '001' },
    );
  }

  // ── Small business deduction (s.125) ──────────────────────────────────────
  if (sbdIncome > 0 && !isCcpc) {
    push(
      'red',
      'SBD_NOT_CCPC',
      'Small business deduction claimed but the corporation is not a CCPC — the SBD is only available to a Canadian-controlled private corporation.',
      { citation: 'ITA s.125(1)', line: '040' },
    );
  } else if (sbdIncome > 0 && isCcpc) {
    push(
      'green',
      'SBD_OK',
      `Small business deduction applied on ${money(sbdIncome)} of active business income (9% CCPC rate).`,
      { citation: 'ITA s.125', line: '430' },
    );
  }

  // Business limit / ABI (s.125(2)) — excess ABI taxed at the general rate.
  const abi = sbd.activeBusinessIncome != null ? num(sbd.activeBusinessIncome) : bookNetIncome;
  const limit = sbd.businessLimit != null ? num(sbd.businessLimit) : 500000;
  if (abi > limit && limit > 0) {
    push(
      'amber',
      'ABI_OVER_LIMIT',
      `Active business income (${money(abi)}) exceeds the business limit (${money(limit)}); the excess is taxed at the general rate, not 9%.`,
      { citation: 'ITA s.125(2)' },
    );
  }
  // Grind reminders. Taxable capital may be entered directly on S7 or computed
  // from the balance sheet on Schedule 33 (the fold line) — prefer the computed one.
  const taxableCapital = fold.taxableCapitalEmployedInCanada ?? num(sbd.taxableCapital);
  if (taxableCapital > 10_000_000) {
    push(
      'amber',
      'TAXABLE_CAPITAL_GRIND',
      `Taxable capital employed in Canada (${money(taxableCapital)}) exceeds $10M — the business limit is ground down (fully eliminated at $50M). Schedule 33 must be filed.`,
      { citation: 'ITA s.125(5.1), s.181.2', line: 'Sch 33' },
    );
  }
  if (num(sbd.aaii) > 50_000) {
    push(
      'amber',
      'AAII_GRIND',
      'Adjusted aggregate investment income exceeds $50k — the business limit is ground down $5 for every $1 of AAII over $50k.',
      { citation: 'ITA s.125(5.1)(b)' },
    );
  }

  // Associated group — the $500k limit is SHARED, not multiplied (Schedule 23).
  const associated = (sbd.associated ?? []) as { name?: string; allocatedLimit?: number }[];
  if (associated.some((m) => m.name || m.allocatedLimit)) {
    const thisShare = sbd.businessLimit != null ? num(sbd.businessLimit) : 500000;
    const totalAllocated = thisShare + associated.reduce((s, m) => s + num(m.allocatedLimit), 0);
    if (totalAllocated > 500000) {
      push(
        'red',
        'BUSINESS_LIMIT_OVER_ALLOCATED',
        `The associated group's Schedule 23 agreement allocates ${money(totalAllocated)} of the $500,000 business limit — over-allocated by ${money(totalAllocated - 500000)}. Associated CCPCs must share one limit.`,
        { citation: 'ITA s.125(3)', line: 'Sch 23' },
      );
    } else {
      push(
        'green',
        'BUSINESS_LIMIT_ALLOCATED',
        `Business limit shared across the associated group (Schedule 23): ${money(totalAllocated)} of $500,000 allocated, ${money(500000 - totalAllocated)} remaining.`,
        { citation: 'ITA s.125(3)', line: 'Sch 23' },
      );
    }
  }

  // ── Schedule 13 — continuity of reserves ──────────────────────────────────
  if (fold.reservesClosing != null && num(fold.reservesClosing) > 0) {
    push(
      'green',
      'RESERVES_CONTINUITY',
      `Prior-year reserves reversed into income and ${money(num(fold.reservesClosing))} of closing reserves deducted this year (Schedule 13).`,
      { citation: 'ITA s.20(1)(l)/(m), s.12(1)(e)', line: 'Sch 13' },
    );
  }

  // ── Schedule 1 reconciliation ─────────────────────────────────────────────
  if (num(is.amortization) > 0) {
    push(
      'green',
      'AMORT_ADDBACK',
      `Book amortization (${money(num(is.amortization))}) added back on Schedule 1; deduct CCA via Schedule 8 instead.`,
      { citation: 'ITA s.18(1)(b)', line: '104' },
    );
  }
  if (bookNetIncome !== 0) {
    const diff = Math.abs(netIncomeForTax - bookNetIncome);
    if (diff / Math.abs(bookNetIncome) > 0.5) {
      push(
        'amber',
        'BIG_BOOK_TAX_DIFF',
        `Large book-to-tax difference (${money(diff)}) — verify the Schedule 1 additions/deductions reconcile to the financial statements.`,
        { line: '300' },
      );
    }
  }

  // ── Capital cost allowance (Schedule 8) ───────────────────────────────────
  const ccaClasses = (cca.classes ?? []) as unknown[];
  const claimedCca = ccaClasses.length > 0;
  if (num(bs.capitalAssetsNet) > 0 && !claimedCca) {
    push(
      'amber',
      'NO_CCA',
      'Capital assets are on the balance sheet but no CCA was claimed on Schedule 8 — confirm whether a claim (or a deliberate nil claim) is intended.',
      { citation: 'ITA s.20(1)(a)', line: '403' },
    );
  }
  // Engine-computed CCA dispositions (Schedule 8): recapture is income, terminal
  // loss is a deduction — both are cited so the preparer confirms the disposition.
  if (num(fold.ccaRecapture) > 0) {
    push(
      'amber',
      'CCA_RECAPTURE',
      `Recapture of CCA (${money(num(fold.ccaRecapture))}) added to income — a class's proceeds of disposition exceeded its UCC. Confirm the disposition.`,
      { citation: 'ITA s.13(1)', line: '107' },
    );
  }
  if (num(fold.ccaTerminalLoss) > 0) {
    push(
      'green',
      'CCA_TERMINAL_LOSS',
      `Terminal loss (${money(num(fold.ccaTerminalLoss))}) deducted — a class was emptied with residual UCC.`,
      { citation: 'ITA s.20(16)', line: '404' },
    );
  }

  // ── Capital dispositions (Schedule 6) ─────────────────────────────────────
  if (num(fold.taxableCapitalGain) > 0) {
    push(
      'green',
      'TAXABLE_CAPITAL_GAIN',
      `Taxable capital gain (${money(num(fold.taxableCapitalGain))}) included in income at the ½ inclusion rate.`,
      { citation: 'ITA s.38(a)', line: '113' },
    );
  }
  if (num(fold.netCapitalLossCreated) > 0) {
    push(
      'green',
      'NET_CAPITAL_LOSS_CREATED',
      `Net capital loss (${money(num(fold.netCapitalLossCreated))}) created — carried forward to offset future taxable capital gains.`,
      { citation: 'ITA s.111(1)(b)', line: '332' },
    );
  }
  if (num(fold.lossCarriedBack) > 0) {
    push(
      'green',
      'LOSS_CARRIED_BACK',
      `Non-capital loss of ${money(num(fold.lossCarriedBack))} carried back to prior years (recovers previously-paid tax); the remainder carries forward.`,
      { citation: 'ITA s.111(1)', line: 'Sch 4' },
    );
  }

  // ── Charitable donations (Schedule 2) ─────────────────────────────────────
  if (num(fold.donationPoolClosing) > 0) {
    push(
      'amber',
      'DONATIONS_LIMITED',
      `Charitable donations exceed the 75%-of-net-income limit — ${money(num(fold.donationsClaimed))} claimed this year, ${money(num(fold.donationPoolClosing))} carried forward (usable within 5 years).`,
      { citation: 'ITA s.110.1(1)', line: 'Sch 2' },
    );
  } else if (num(fold.donationsClaimed) > 0) {
    push(
      'green',
      'DONATIONS_CLAIMED',
      `Charitable donations of ${money(num(fold.donationsClaimed))} claimed (within the 75%-of-net-income limit).`,
      { citation: 'ITA s.110.1(1)', line: 'Sch 2' },
    );
  }

  // ── Provincial/territorial tax (Schedule 5) ───────────────────────────────
  const province =
    (ri.identification as { province?: string } | undefined)?.province ?? input.province;
  // Multi-jurisdiction: PEs allocated across provinces (Reg 402). Each per-province
  // line is `provincialTax:<CODE>`; AB/QC among them must file their own return.
  const provinceLines = Object.keys(fold).filter((k) => k.startsWith('provincialTax:'));
  if (provinceLines.length > 0) {
    const codes = provinceLines.map((k) => k.split(':')[1]);
    push(
      'green',
      'MULTI_JURISDICTION_ALLOCATION',
      `Taxable income allocated across ${codes.length} jurisdiction(s) (${codes.join(', ')}) by Regulation 402 — federal Schedule 5 tax ${money(num(fold.provincialTax))}.`,
      { citation: 'ITR 402', line: 'Sch 5 Part 1' },
    );
    if (codes.includes('AB')) {
      push(
        'amber',
        'ALLOCATION_AB_SEPARATE',
        'Income was allocated to Alberta — file the separate AT1 return for the Alberta share.',
        { line: 'AT1' },
      );
    }
    if (codes.includes('QC')) {
      push(
        'amber',
        'ALLOCATION_QC_SEPARATE',
        'Income was allocated to Quebec — file the separate CO-17 return for the Quebec share.',
        { line: 'CO-17' },
      );
    }
  } else if (num(fold.provincialTax) > 0) {
    push(
      'green',
      'PROVINCIAL_TAX',
      `Provincial/territorial tax (${province}) of ${money(num(fold.provincialTax))} computed on Schedule 5 and added to total tax.`,
      { line: 'Sch 5' },
    );
  } else if (province === 'QC') {
    push(
      'amber',
      'QUEBEC_CO17',
      'Quebec administers its own corporate tax — file the separate CO-17 return in addition to the federal T2.',
      { line: 'CO-17' },
    );
  } else if (province === 'AB') {
    push(
      'green',
      'ALBERTA_AT1',
      'Alberta corporate tax is filed on the separate AT1 Net File (prepared from this engagement).',
      {},
    );
  }

  // ── GRIP / eligible dividends (Schedule 53) ───────────────────────────────
  if (num(fold.excessiveEligibleDividend) > 0) {
    push(
      'red',
      'EXCESSIVE_ELIGIBLE_DIVIDEND',
      `Eligible dividends designated exceed the GRIP by ${money(num(fold.excessiveEligibleDividend))} — an excessive eligible dividend designation, subject to Part III.1 tax. Reduce the designation or elect under s.185.1(2).`,
      { citation: 'ITA s.185.1', line: 'Sch 53' },
    );
  } else if (num(fold.gripClosing) > 0) {
    push(
      'green',
      'GRIP_CLOSING',
      `Closing GRIP of ${money(num(fold.gripClosing))} carries forward (available for future eligible dividend designations).`,
      { citation: 'ITA s.89(1)', line: 'Sch 53' },
    );
  }

  // ── Foreign tax credit (Schedule 21) ──────────────────────────────────────
  if (num(fold.foreignTaxCredit) > 0) {
    const carry = num(fold.businessFtcPoolClosing);
    const tail = carry > 0 ? ` ${money(carry)} of unused business credit carries forward.` : '';
    push(
      'green',
      'FOREIGN_TAX_CREDIT',
      `Foreign tax credit of ${money(num(fold.foreignTaxCredit))} applied against Part I tax (limited to the Canadian tax on the foreign income).${tail}`,
      { citation: 'ITA s.126', line: 'Sch 21' },
    );
  } else if (num(fold.businessFtcPoolClosing) > 0) {
    push(
      'amber',
      'FOREIGN_TAX_CREDIT_CARRIED',
      `No foreign tax credit usable this year — ${money(num(fold.businessFtcPoolClosing))} of business foreign tax carries forward (10-yr limit).`,
      { citation: 'ITA s.126(2)', line: 'Sch 21' },
    );
  }

  // ── Zero-emission technology manufacturing (Schedule 27) ──────────────────
  if (num(fold.zetmRateReduction) > 0) {
    push(
      'green',
      'ZETM_REDUCED_RATE',
      `Zero-emission technology manufacturing income taxed at the reduced rate (7.5% / 4.5%) — Part I tax reduced by ${money(num(fold.zetmRateReduction))}.`,
      { citation: 'ITA s.125.2', line: 'Sch 27' },
    );
  }

  // ── SR&ED investment tax credit (Schedule 31) ─────────────────────────────
  if (num(fold.sredItcEarned) > 0) {
    const refundable = num(fold.sredItcRefundable);
    const pool = num(fold.itcPoolClosing);
    const parts = [`SR&ED investment tax credit of ${money(num(fold.sredItcEarned))} earned`];
    if (refundable > 0) parts.push(`${money(refundable)} refundable (CCPC enhanced rate)`);
    if (pool > 0) parts.push(`${money(pool)} non-refundable carried forward`);
    push('green', 'SRED_ITC_EARNED', `${parts.join('; ')}.`, {
      citation: 'ITA s.127 / s.127.1',
      line: 'Sch 31',
    });
  }

  // ── Balance sheet (GIFI 100) ──────────────────────────────────────────────
  const assets =
    num(bs.cash) +
    num(bs.accountsReceivable) +
    num(bs.inventory) +
    num(bs.capitalAssetsNet) +
    num(bs.otherAssets);
  const liabEquity =
    num(bs.accountsPayable) +
    num(bs.loansPayable) +
    num(bs.otherLiabilities) +
    num(bs.shareCapital) +
    num(bs.retainedEarnings);
  if (assets > 0 || liabEquity > 0) {
    if (Math.abs(assets - liabEquity) > 1) {
      push(
        'red',
        'BS_UNBALANCED',
        `Balance sheet does not balance: assets ${money(assets)} ≠ liabilities + equity ${money(liabEquity)} (out by ${money(Math.abs(assets - liabEquity))}).`,
        { line: 'GIFI 100' },
      );
    } else {
      push('green', 'BS_BALANCED', 'Balance sheet balances (assets = liabilities + equity).', {
        line: 'GIFI 100',
      });
    }
  }

  // ── Sanity: tax on nil income ─────────────────────────────────────────────
  if (taxableIncome <= 0 && partI > 0) {
    push(
      'red',
      'TAX_ON_NIL',
      'Part I tax is positive but taxable income is nil or negative — check the inputs; a loss year should not produce Part I tax.',
      { line: '360' },
    );
  }

  // ── Provenance guarantee (our moat) ───────────────────────────────────────
  push(
    'green',
    'PROVENANCE_OK',
    'All computed lines originate from the engine (provenance-tagged) — no value on this return is model-guessed.',
    {},
  );

  return flags;
}

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(v || 0);

export interface RunReviewResult {
  memoId: string;
  flags: number;
  red: number;
  amber: number;
  green: number;
}

/**
 * Generate the review memo for an engagement's latest computed return and
 * upsert it (reuses the open draft memo, or creates one). Records a fact.
 */
/**
 * The AT1 needs identity the federal return never asks for, and none of it can be
 * worked out from the figures. `assertCriticalFields` refuses at render time and
 * `assertAt1MandatoryComplete` at filing time; both are correct and both are LATE
 * — by then the return is finished. Surfacing it in the review costs nothing and
 * moves the discovery to the first place a preparer looks after computing.
 */
export function at1ClientIdentityFlags(
  program: string,
  client: Record<string, unknown> | null,
): { severity: Severity; code: string; message: string; resolved: boolean }[] {
  if (program !== 'AT1') return [];
  const addr = (client?.address ?? {}) as Record<string, unknown>;
  const blank = (v: unknown) => v == null || String(v).trim() === '';

  const missing: string[] = [];
  if (blank(addr.street)) missing.push('mailing address (line 000012)');
  if (blank(addr.city)) missing.push('city (line 000014)');
  if (blank(client?.corporateAccountNumber))
    missing.push('Alberta corporate account number (000034)');
  if (blank(client?.contactPerson)) missing.push('contact person (000025)');
  if (blank(client?.contactTelephone)) missing.push('contact telephone (000026)');
  if (blank(client?.natureOfBusiness)) missing.push('nature of business (000028)');
  if (blank(client?.typeOfCorporation)) missing.push('type of corporation (000029)');
  if (blank(client?.authorizedEmail)) missing.push('authorized email (000105)');

  /*
   * Present but not in the shape Alberta accepts.
   *
   * Distinct from "missing", and worth its own flag: a field that LOOKS filled
   * in passes every emptiness check here and in the filing path, then fails at
   * TRA — the slowest possible place to learn about a typo. Both of these are
   * coded fields whose value is transmitted verbatim, so the code IS the
   * answer; prose in the box is not a formatting nicety but a different (and
   * unparseable) statement.
   *
   * The constraints are §3.2.3.1's own, and the type column is the authority
   * rather than the caption:
   *
   *   028  Nature of Business   N  4   "Must be a valid code from the SIC codes"
   *   029  Type of Corporation  N  1   codes 1-5
   *
   * Only the SHAPE is checked, not membership: the SIC list lives in the
   * specification's Section 3.5 and is not modelled here, so claiming a code is
   * "invalid" would assert more than this app knows. A four-digit number that
   * is not a real SIC code still reaches TRA — but "Holding company" typed into
   * a numeric field never can, and that is the mistake a preparer actually
   * makes.
   */
  const malformed: string[] = [];
  const sic = client?.natureOfBusiness;
  if (!blank(sic) && !/^\d{4}$/.test(String(sic).trim())) {
    malformed.push(
      `nature of business (000028) must be a 4-digit SIC code, e.g. 0198 — got "${String(sic).trim()}"`,
    );
  }
  const corpType = client?.typeOfCorporation;
  if (!blank(corpType) && !/^[1-5]$/.test(String(corpType).trim())) {
    malformed.push(
      `type of corporation (000029) must be a single digit 1-5 — got "${String(corpType).trim()}"`,
    );
  }

  const flags: { severity: Severity; code: string; message: string; resolved: boolean }[] = [];
  if (missing.length > 0) {
    flags.push({
      severity: 'red' as Severity,
      code: 'AT1_CLIENT_IDENTITY_INCOMPLETE',
      message:
        `The AT1 jacket is missing ${missing.length} identification field(s) Alberta requires: ` +
        `${missing.join(', ')}. Enter them on the AT1 Jacket (Schedule 000), then recompute — ` +
        'the Net File payload cannot be generated without them.',
      resolved: false,
    });
  }
  if (malformed.length > 0) {
    flags.push({
      severity: 'red' as Severity,
      code: 'AT1_CLIENT_IDENTITY_MALFORMED',
      message:
        `The AT1 jacket has ${malformed.length} identification field(s) Alberta will reject: ` +
        `${malformed.join('; ')}. These are transmitted exactly as entered, so TRA ` +
        'rejects the return rather than interpreting them. Correct them on the AT1 Jacket ' +
        '(Schedule 000), then recompute.',
      resolved: false,
    });
  }
  return flags;
}

/**
 * Claims that quietly compute to nothing on an AT1.
 *
 * The defect these exist for is SILENCE, not arithmetic. A schedule that is
 * present, answered, and worth real money can still produce zero because one
 * input nobody asked for is missing — and the return then files a nil claim
 * with nothing anywhere saying a claim was even attempted. The preparer sees a
 * schedule they filled in and a figure of $0 and has no way to tell whether
 * that is the right answer.
 *
 * Two real cases:
 *
 *   029  An Innovation Employment Grant with the agreement table filled but the
 *        associated-group MEMBERS ROSTER empty computes $0. Adding the roster
 *        on one test return flipped the grant from $0 to $31,250 — a figure the
 *        corporation is entitled to, silently forgone, with no warning at any
 *        point.
 *   062  An AT1 whose federal input schedules were never filled in has no
 *        income basis, so Alberta taxable income is nil and the whole tax side
 *        (068/070/080) follows it down. This is the app working as designed —
 *        the AT1 derives from the federal figures — but a preparer working
 *        behind the "AT1 only" nav filter cannot see WHY every number is zero.
 *        The flag names the cause and where to fix it.
 *
 * Amber, not red: each is a return that may legitimately be nil. The point is
 * that the preparer decides that, rather than the software deciding it silently.
 */
export function at1SilentNilFlags(
  program: string,
  ri: Partial<ReturnInput>,
  fold: Record<string, number>,
): Flag[] {
  if (program !== 'AT1') return [];
  const flags: Flag[] = [];

  const ieg = (ri.albertaIeg ?? {}) as Record<string, unknown>;
  const iegAttempted =
    num(ieg.federalAmount) > 0 ||
    num(ieg.albertaPortion) > 0 ||
    (Array.isArray(ieg.projects) && ieg.projects.length > 0);
  const roster = Array.isArray(ieg.group) ? ieg.group : [];
  if (iegAttempted && roster.length === 0) {
    flags.push({
      severity: 'amber',
      code: 'AT1_IEG_NO_GROUP_ROSTER',
      message:
        'Schedule 29 has an Innovation Employment Grant claim but no associated-group members roster, so the grant computes to $0. ' +
        'The roster supplies the taxable capital the grind is measured on — without it the claim cannot be calculated, and the ' +
        'return would file a nil grant. Add the members (the claimant corporation itself included) on Schedule 29, then recompute.',
      citation: 'Alberta Corporate Tax Act s.26.7',
      line: '029',
      resolved: false,
    });
  }

  /*
   * Alberta taxable income stated rather than derived.
   *
   * Not a problem — it is how an AT1 gets prepared when the T2 was done in
   * another package, and TRA's jacket types 062 as an input for that case. But
   * it bypasses the engine, so it must READ as entered: every other figure on
   * the return is derived and carries that provenance, and a stated one sitting
   * among them with no marking is the kind of thing a reviewer should see once,
   * not discover later.
   */
  const ab = (ri.alberta ?? {}) as Record<string, unknown>;
  const entered062 = ab.albertaTaxableIncome;
  if (entered062 != null && String(entered062).trim() !== '') {
    flags.push({
      severity: 'amber',
      code: 'AT1_TAXABLE_INCOME_ENTERED',
      message:
        `Alberta taxable income (062) was ENTERED as ${money(num(entered062))} rather than computed from the federal return. ` +
        'Basic tax, the small business deduction and tax payable all follow from it, so the figure carries the whole ' +
        'Alberta tax calculation — check it against the federal return it came from before signing off.',
      line: '062',
      resolved: false,
    });
  }

  /*
   * Schedule 2 typed with an Alberta figure larger than the all-jurisdiction
   * total. The factor then exceeds 1 and Alberta taxes more than the whole
   * of taxable income — never a real allocation, always a transposed pair.
   */
  const over = (part: unknown, whole: unknown) => part != null && num(part) > num(whole);
  if (
    over(ab.allocationAlbertaSalaries, ab.allocationTotalSalaries) ||
    over(ab.allocationAlbertaRevenue, ab.allocationTotalRevenue)
  ) {
    flags.push({
      severity: 'red',
      code: 'AT1_ALLOCATION_EXCEEDS_TOTAL',
      message:
        'Schedule 2 states more Alberta salaries or revenue than the total for all jurisdictions, so the ' +
        'allocation factor is above 100%. Check lines 002/004 and 006/008 — the Alberta amount is part of the total.',
      line: '065',
      resolved: false,
    });
  }

  /*
   * Alberta CCA overrides with no federal basis to override.
   *
   * `scheduleThirteen` starts `if (federalClasses.length === 0) return
   * undefined`, so a return carrying Alberta UCC and claims but no federal
   * Schedule 8 files no Schedule 13 at all and the entered figures vanish.
   *
   * This is the third appearance of one shape: a guard on the FEDERAL side
   * discarding ALBERTA-side input. The Innovation Employment Grant did it when
   * the associated group was empty, and Schedule 18 did it when no federal
   * disposition was categorized — both dropped figures a preparer had typed.
   *
   * The intake itself is a larger question (an Alberta row carries only a class,
   * an opening UCC and a claim — not additions, dispositions, AIIP or DIEP), so
   * this does not invent one. It makes the drop visible, which is the part that
   * is unambiguously wrong: a figure entered and silently discarded is worse
   * than one the software declines to accept.
   */
  /*
   * Counted by rows that carry SOMETHING, not by rows that exist.
   *
   * The first version counted `classes.length`, so a federal CCA schedule
   * holding blank rows — an editor grid opened and left empty, which is
   * ordinary — read as a basis and suppressed the flag. Exactly the return
   * that needs telling: Alberta overrides entered, federal side untouched, and
   * nothing said.
   */
  const carriesData = (row: unknown): boolean =>
    !!row &&
    typeof row === 'object' &&
    Object.values(row as Record<string, unknown>).some(
      (v) => v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v)),
    );
  const rowsWithData = (v: unknown): number =>
    Array.isArray((v as { classes?: unknown[] } | undefined)?.classes)
      ? ((v as { classes: unknown[] }).classes.filter(carriesData).length ?? 0)
      : 0;
  const albertaCcaRows = rowsWithData(ri.albertaCca13);
  const federalCcaRows = rowsWithData(ri.cca);
  if (albertaCcaRows > 0 && federalCcaRows === 0) {
    flags.push({
      severity: 'amber',
      code: 'AT1_CCA_NO_FEDERAL_BASIS',
      message:
        `Schedule 13 has ${albertaCcaRows} Alberta CCA class(es) with no federal Capital Cost Allowance (S8) ` +
        'basis. The schedule computes and files on the Alberta figures alone, which is correct when the federal ' +
        'T2 was prepared in another package. But Schedule 12 reconciles Alberta to federal by DIFFERENCE, so with ' +
        'no federal claim to net against, the whole Alberta claim becomes a reconciling DEDUCTION: confirm the ' +
        'federal net income entered on Schedule 12 does not already have this capital cost allowance deducted. ' +
        'If the T2 was prepared here, enter the classes on the S8 schedule so the two sides pair instead.',
      line: '013',
      resolved: false,
    });
  }

  /*
   * A federal basis exists, an Alberta override was entered on it, and the
   * whole schedule is STILL dropped — because the AT1 jacket's own two
   * divergence questions (000060 "reports different Alberta income" /
   * 000061 "elects different discretionary amounts") are unanswered.
   * `scheduleThirteen` (assemble-at1-schedules.ts) is correct to gate this
   * way: §3.2.3 forbids completing form 013 at all unless one of those is
   * Yes, so filing it regardless would file something the spec says cannot
   * exist. But the gate has no voice of its own — a preparer who fills the
   * Alberta CCA grid and never touches the jacket's two radios gets a row
   * that saves, survives reload, and produces NOTHING: no Schedule 13 in the
   * payload, no change to Alberta net income, and (before this flag) no
   * indication anywhere that the entry was ever read.
   *
   * The fifth appearance of the shape this file keeps finding: a figure
   * entered on the Alberta side, discarded by a gate on a DIFFERENT part of
   * the return the preparer had no reason to think was connected. IEG did it
   * on an empty group roster, Schedule 18 on an uncategorized disposition,
   * Schedule 13 on an empty federal basis (immediately above), Schedule 12
   * on an SR&ED-only divergence. This is the same schedule, the other gate.
   */
  const abDivergence = (ri.alberta ?? {}) as Record<string, unknown>;
  const divergenceDeclared =
    abDivergence.reportsDifferentAlbertaIncome === 'yes' ||
    abDivergence.electsDifferentDiscretionaryAmounts === 'yes';
  if (albertaCcaRows > 0 && federalCcaRows > 0 && !divergenceDeclared) {
    flags.push({
      severity: 'amber',
      code: 'AT1_CCA_DIVERGENCE_NOT_DECLARED',
      message:
        `Schedule 13 has ${albertaCcaRows} Alberta CCA class(es) entered against the federal claim, but neither ` +
        'AT1 jacket question ("Does the corporation report a different net income for Alberta purposes?" / ' +
        '"Does the corporation elect to claim different discretionary amounts for Alberta purposes?") is ' +
        'answered Yes — the specification forbids filing Schedule 13 in that state, so it is NOT filed and the ' +
        'Alberta override has no effect on Alberta taxable income. Answer one of those two jacket questions Yes ' +
        'to have the override reach the return, or clear the Alberta CCA row if it was entered in error.',
      line: '013',
      resolved: false,
    });
  }

  /*
   * TF_DEV_BUG_LIST_2026-09-18.md, BUG-114 — a permanent establishment row
   * with a province picked but no revenue or salaries entered.
   *
   * Blank cells are not the same as "no row" to the preparer who added it —
   * they may not have reached the money fields yet, or the PE genuinely has
   * nil activity this year, but either way the allocation math IGNORES the
   * row until a figure is entered (it contributes 0 to both totals, so a
   * corporation whose only OTHER province is the same one it started with
   * silently reverts to the single-jurisdiction default with no visible
   * sign anything changed). Fires per row, not once, since each blank row
   * is its own thing to go back and fill in or remove.
   */
  const provincialAllocation = (ri.provincialAllocation ?? {}) as {
    establishments?: { province?: string; grossRevenue?: number; salariesWages?: number }[];
  };
  const blankEstablishments = (provincialAllocation.establishments ?? []).filter(
    (pe) => pe?.province && !num(pe.grossRevenue) && !num(pe.salariesWages),
  );
  if (blankEstablishments.length > 0) {
    flags.push({
      severity: 'amber',
      code: 'AT1_PE_ROW_NO_ALLOCATION_BASIS',
      message:
        `Provincial Allocation has ${blankEstablishments.length} permanent establishment ` +
        `${blankEstablishments.length === 1 ? 'row' : 'rows'} with a province selected but no gross revenue or ` +
        'salaries and wages entered. A blank row contributes nothing to either allocation base, so it is treated ' +
        'as though it does not exist — the return files as if it were never added. Enter the figures, or remove ' +
        'the row if it was added by mistake.',
      line: '005',
      resolved: false,
    });
  }

  // No income basis at all — every federal input schedule empty.
  const albertaTaxableIncome = fold.albertaTaxableIncome ?? 0;
  const is = (ri.incomeStatement ?? {}) as Record<string, unknown>;
  const hasIncomeBasis =
    num(is.revenue) !== 0 ||
    num(is.costOfSales) !== 0 ||
    num(is.salariesAndWages) !== 0 ||
    num(is.amortization) !== 0 ||
    num(is.otherExpenses) !== 0;
  if (!hasIncomeBasis && albertaTaxableIncome === 0) {
    flags.push({
      severity: 'amber',
      code: 'AT1_NO_INCOME_BASIS',
      message:
        'Alberta taxable income (062) is $0 because no income has been entered, so basic tax (068), the small business ' +
        'deduction (070) and tax payable (080) are all nil. Right for a $NIL return (one filed only to claim the Innovation ' +
        'Employment Grant, say). Otherwise state the income: the federal net income on Schedule 12 line 002, or Alberta ' +
        'taxable income straight onto the jacket at 062 — or, when the T2 is prepared here, the income statement under ' +
        '"Federal figures".',
      line: '062',
      resolved: false,
    });
  }
  return flags;
}

/**
 * AT1 line 090 — the Net File specification and the printed form disagree, and
 * this says so on any return where the disagreement changes the number.
 *
 * The engine files the PRINTED form's arithmetic:
 *
 *   090 = 080 − (129 + 082 + 085 + 086 + 115 + 087)
 *
 * §3.2.3.1's own line-090 rule instead nets the ELIMINATED Alberta SR&ED tax
 * credit (081) and omits both the Innovation Employment Grant (129) and the
 * Film and Television Tax Credit (115) — two credits the same document marks
 * mandatory. Following it overstated the balance by the whole grant. The full
 * evidence is on `AT1_BALANCE_CREDIT_LINES` in ca-tax's `at1/forms/jacket.ts`.
 *
 * AMBER, not red: the figure we file is the defensible one, so this must not
 * block sign-off. But a preparer transmitting a return whose balance differs
 * from the published formula should know before TRA tells them, not after —
 * and if TRA's validator turns out to enforce its own documented rule, this
 * flag is the breadcrumb that explains the rejection.
 */
export function at1BalanceFormulaFlags(
  program: string,
  fold: Record<string, unknown>,
): { severity: Severity; code: string; message: string; resolved: boolean }[] {
  if (program !== 'AT1') return [];
  // The two formulas differ by exactly these two credits; nothing else moves.
  const ieg = num(fold.innovationEmploymentGrant);
  const fttc = num(fold.filmAndTelevisionTaxCredit);
  const difference = ieg + fttc;
  if (difference === 0) return [];

  return [
    {
      severity: 'amber' as Severity,
      code: 'AT1_BALANCE_FORMULA_CONFLICT',
      message:
        `Line 090 is struck as TRA's printed AT1 strikes it, netting the ` +
        `Innovation Employment Grant${fttc > 0 ? ' and the Film and Television Tax Credit' : ''} ` +
        `(${difference}). The Net File specification's own line-090 rule omits ` +
        `${fttc > 0 ? 'both' : 'it'} and instead nets the Alberta SR&ED tax credit, which was ` +
        'eliminated for expenditures after 2019-12-31. Filing the specification’s ' +
        'version would overstate the balance by that amount. Reviewed and filed ' +
        'per the printed form.',
      resolved: false,
    },
  ];
}

export async function runReview(params: {
  engagementId: string;
  orgId: string;
  userId: string;
}): Promise<RunReviewResult> {
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');

  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed) throw createError(422, 'Compute the return before running review');

  const client = await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  });

  const fold: Record<string, number> = {};
  for (const f of (computed.fields ?? []) as { line: string; value: unknown }[]) {
    fold[f.line] = Number(f.value);
  }

  const ri = (engagement.returnInput ?? {}) as Record<string, unknown>;
  /**
   * Rate-year certification, for EVERY program rather than only the federal one.
   *
   * The question is the same in all three: does this return's exact tax year
   * have an authoritative rate table, or is it computed on rates carried
   * forward from an earlier year? `resolveRates` carries the newest earlier
   * entry forward rather than throwing, by design, so a return with no table
   * for its year computes cleanly and says nothing.
   *
   * This check used to run only when the program was T2, and returned
   * `undefined` otherwise — which the flag reads as "not applicable" and skips.
   * The Québec book ships 2024 only and no deployment registers more, so a 2025
   * CO-17 was computed on 2024 Québec rates and reviewed green. Alberta escaped
   * only by coincidence: its 2025 table is a copy of 2024. The same hole opens
   * for Alberta in 2026, which `rate-years.ts` deliberately declines to
   * register without a published table.
   *
   * Each program is checked against ITS OWN book. A federal book with a 2025
   * entry says nothing about whether Québec has one.
   */
  const taxYear = new Date(engagement.taxYearEnd as unknown as string).getUTCFullYear();
  const rateBookForProgram = {
    T2: getFederalRateBook,
    AT1: getAlbertaRateBook,
    CO17: getQuebecRateBook,
  }[String(engagement.program)];
  const rateYearCertified = rateBookForProgram
    ? hasExactRateYear(rateBookForProgram() as Parameters<typeof hasExactRateYear>[0], taxYear)
    : undefined;
  const flags = [
    ...evaluateReviewFlags({
      program: String(engagement.program),
      corpType: client?.corpType ?? undefined,
      businessNumber: client?.businessNumber ?? undefined,
      fold,
      ri,
      province: clientProvince(client),
      ...(rateYearCertified !== undefined ? { rateYearCertified, taxYear } : {}),
    }),
    // Line-level completeness / consistency diagnostics (data-driven).
    ...runDiagnostics({
      program: String(engagement.program),
      fold,
      ri,
      client: {
        businessNumber: client?.businessNumber ?? undefined,
        corpType: client?.corpType ?? undefined,
        // The return editor has NO province control — the value is captured on
        // the client record alone. Without it here the diagnostic reported
        // "province not set" against a province that was set.
        province: clientProvince(client),
      },
      hasComputed: true,
    }),
    // AT1 filing identity, checked HERE rather than at the wire. These live on
    // the client record and cannot be derived from the return, so a preparer who
    // only learns of them when generating the payload has already filled in the
    // whole return. The renderer still refuses — this just says so earlier.
    ...at1ClientIdentityFlags(
      String(engagement.program),
      effectiveAt1Identity(client as At1Identity | null, ri) as Record<string, unknown>,
    ),
    ...at1BalanceFormulaFlags(String(engagement.program), fold),
    // A claim that computes to nothing, said out loud. See the doc comment —
    // the defect is the silence, not the arithmetic.
    ...at1SilentNilFlags(String(engagement.program), ri, fold),
  ];

  // Upsert the open (not signed-off) memo for this engagement.
  const existing = (await reviewMemoRepository.getOne(
    {
      engagementYearId: engagement._id,
      organizationId: params.orgId,
      status: { $ne: 'signed_off' },
    },
    { sort: { createdAt: -1 } },
  )) as WithId<ReviewMemoDocument> | null;

  const memo = (
    existing
      ? await reviewMemoRepository.update(String(existing._id), {
          flags,
          computedReturnId: computed._id,
        })
      : await reviewMemoRepository.create({
          engagementYearId: engagement._id,
          computedReturnId: computed._id,
          status: 'draft',
          flags,
          organizationId: params.orgId,
          createdBy: params.userId,
        })
  ) as WithId<ReviewMemoDocument> | null;

  const count = (s: Severity) => flags.filter((f) => f.severity === s).length;

  // Ledger fact (imported = derived by the review engine from computed data).
  await appendFact({
    engagementYearId: engagement._id,
    orgId: params.orgId,
    actor: params.userId,
    type: 'DiagnosticRaised',
    provenance: 'imported',
    reason: `Review generated: ${flags.length} flag(s), ${count('red')} red`,
    payload: {
      memoId: String(memo?._id ?? existing?._id),
      red: count('red'),
      amber: count('amber'),
      green: count('green'),
    },
  });

  return {
    memoId: String(memo?._id ?? existing?._id),
    flags: flags.length,
    red: count('red'),
    amber: count('amber'),
    green: count('green'),
  };
}

/** Mark a flag (by its code) resolved on a review memo — the human clearing a diagnostic. */
export async function resolveReviewFlag(params: {
  memoId: string;
  orgId: string;
  userId: string;
  code: string;
}): Promise<{ resolved: string; unresolvedReds: number }> {
  const now = new Date();
  const isObjectId = /^[a-f0-9]{24}$/i.test(params.userId);

  // Positional array-filter $set — updates only the matching flag element
  // atomically. A whole-array replace via update() does not persist reliably
  // for subdocument arrays, so we target the single element by its code.
  const set: Record<string, unknown> = {
    'flags.$[f].resolved': true,
    'flags.$[f].resolvedAt': now,
  };
  if (isObjectId) set['flags.$[f].resolvedBy'] = params.userId;

  const updated = (await reviewMemoRepository.findOneAndUpdate(
    { _id: params.memoId, organizationId: params.orgId },
    { $set: set },
    { arrayFilters: [{ 'f.code': params.code }], returnDocument: 'after' },
  )) as WithId<ReviewMemoDocument> | null;
  if (!updated) throw createError(404, 'Review memo not found');

  const unresolvedReds = ((updated.flags ?? []) as Flag[]).filter(
    (f) => f.severity === 'red' && !f.resolved,
  ).length;
  return { resolved: params.code, unresolvedReds };
}
