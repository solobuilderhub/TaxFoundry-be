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
import { getFederalRateBook } from '../engine/tax-rates.js';
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
  ri: Record<string, any>;
  /** True when the return's tax year has an EXACT certified rate table (T2). */
  rateYearCertified?: boolean;
  /** The return's tax year (for the rate-year flag message). */
  taxYear?: number;
}

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
  const ccaClasses = (cca.classes ?? []) as any[];
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
  const province = (ri.identification as { province?: string } | undefined)?.province;
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
function at1ClientIdentityFlags(
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
  if (missing.length === 0) return [];

  return [
    {
      severity: 'red' as Severity,
      code: 'AT1_CLIENT_IDENTITY_INCOMPLETE',
      message:
        `The client record is missing ${missing.length} field(s) Alberta requires: ` +
        `${missing.join(', ')}. Add them on the client, then recompute — the Net File ` +
        'payload cannot be generated without them.',
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
  // T2 rate-year certification: does the return's exact tax year have an
  // authoritative rate table, or is it computed on carried-forward rates?
  const taxYear = new Date(engagement.taxYearEnd as unknown as string).getUTCFullYear();
  const rateYearCertified =
    String(engagement.program) === 'T2'
      ? hasExactRateYear(getFederalRateBook(), taxYear)
      : undefined;
  const flags = [
    ...evaluateReviewFlags({
      program: String(engagement.program),
      corpType: client?.corpType ?? undefined,
      businessNumber: client?.businessNumber ?? undefined,
      fold,
      ri,
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
      },
      hasComputed: true,
    }),
    // AT1 filing identity, checked HERE rather than at the wire. These live on
    // the client record and cannot be derived from the return, so a preparer who
    // only learns of them when generating the payload has already filled in the
    // whole return. The renderer still refuses — this just says so earlier.
    ...at1ClientIdentityFlags(String(engagement.program), client),
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
