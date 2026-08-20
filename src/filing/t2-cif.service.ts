/**
 * Prepare the federal T2 CIF payload for review (read-only, no filing-record).
 *
 * Mirrors prepareAt1NetFile: compose the CIF data from the client identity + the
 * latest computed return, render it, and return { xml, payloadHash }. Preparing
 * does NOT transmit and does NOT write a filing-record — a rendered-but-unsent
 * return must never look filed.
 */
import { createHash } from 'node:crypto';
import {
  computeT2Settlement,
  hasExactRateYear,
  renderT2DraftReturn,
  type T2CifData,
  type T2CifGifi,
} from '@classytic/ca-tax/t2';
import { buildGifiReturn } from '@classytic/ledger-ca/cor';
import { createError } from '@classytic/repo-core/errors';
import { t2SoftwareCode } from '#config/t2-transmitter.js';
import { getFederalRateBook } from '../engine/tax-rates.js';

const nn = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Map the return's structured balance sheet + income statement onto GIFI codes
 * and build the Schedule 100/125/141 structures via @classytic/ledger-ca (which
 * owns the GIFI chart + the accounting-identity validation). Totals (2599 / 3640
 * / 8299 / 9999) are computed so CRA's balancing rule can be checked.
 */
function buildGifiFromReturn(ri: {
  balanceSheet?: Record<string, unknown>;
  incomeStatement?: Record<string, unknown>;
  gifiNotes?: Record<string, unknown>;
}): { gifi: T2CifGifi; validation: { balanced: boolean; errors: string[] } } | undefined {
  const bs = ri.balanceSheet;
  const is = ri.incomeStatement;
  if (!bs && !is) return undefined;

  const values: Record<string, number> = {};
  if (bs) {
    const cash = nn(bs.cash),
      ar = nn(bs.accountsReceivable),
      inv = nn(bs.inventory);
    const capital = nn(bs.capitalAssetsNet),
      otherA = nn(bs.otherAssets);
    const ap = nn(bs.accountsPayable),
      loans = nn(bs.loansPayable),
      otherL = nn(bs.otherLiabilities);
    const shareCap = nn(bs.shareCapital),
      retained = nn(bs.retainedEarnings);
    const totalAssets = cash + ar + inv + capital + otherA;
    const totalLiab = ap + loans + otherL;
    const totalEquity = shareCap + retained;
    Object.assign(values, {
      '1001': cash,
      '1060': ar,
      '1120': inv,
      '1740': capital,
      '1480': otherA,
      '1599': cash + ar + inv + otherA, // total current-ish assets
      '2599': totalAssets, // TOTAL ASSETS
      '2620': ap,
      '2700': loans,
      '2960': otherL,
      '3499': totalLiab, // total liabilities
      '3500': shareCap,
      '3600': retained,
      '3620': totalEquity, // total equity
      '3640': totalLiab + totalEquity, // TOTAL LIABILITIES + EQUITY
    });
  }
  if (is) {
    const rev = nn(is.revenue),
      cogs = nn(is.costOfSales),
      sal = nn(is.salariesAndWages);
    const amort = nn(is.amortization),
      other = nn(is.otherExpenses);
    Object.assign(values, {
      '8299': rev, // TOTAL REVENUE
      '8320': cogs,
      '9060': sal,
      '8670': amort,
      '9270': other,
      '9999': rev - cogs - sal - amort - other, // NET INCOME/LOSS
    });
  }

  const notes = ri.gifiNotes;
  const built = buildGifiReturn({
    values,
    ...(notes
      ? {
          notes: {
            preparedByAccountant: Boolean(notes.preparedByAccountant),
            assuranceLevel: notes.auditEngagement
              ? 'audit'
              : notes.reviewEngagement
                ? 'review'
                : 'compilation',
            notesIncluded: Boolean(notes.financialStatementsIncluded),
          },
        }
      : {}),
  });

  return {
    gifi: {
      schedule100: built.schedule100.map((l) => ({ code: l.code, amount: l.amount })),
      schedule125: built.schedule125.map((l) => ({ code: l.code, amount: l.amount })),
      ...(built.schedule141 ? { notes: built.schedule141 } : {}),
    },
    validation: { balanced: built.validation.balanced, errors: built.validation.errors },
  };
}

import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { WithId } from '#shared/db.js';

export interface PrepareT2CifResult {
  payloadHash: string;
  xml: string;
}

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ''));

export interface ComposeT2FilingParams {
  engagementId: string;
  orgId: string;
  /** Certifier — included in the payload at transmit time; omitted for a preview. */
  certification?: { firstName: string; lastName: string; position: string };
  /**
   * True on the actual filing path. Enforces the exact-year rate table + GIFI
   * balancing + mandatory completeness. A draft/preview (false) is lenient.
   */
  forFiling?: boolean;
}

/**
 * Compose the reviewed T2 filing DATA (`T2CifData`) from the frozen computed
 * return — the single structured representation of the return. Rendering is a
 * SEPARATE step: previews render a draft (`renderT2DraftReturn`), and only a
 * CRA-certified serializer may turn this data into a fileable payload. The
 * draft XML is never transmitted.
 */
export async function composeT2FilingData(params: ComposeT2FilingParams): Promise<T2CifData> {
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'T2')
    throw createError(400, 'CIF preparation applies to T2 engagements');

  // Fail-closed on the rate year for a real filing: the rate book resolver
  // carries the latest earlier table forward so DRAFTS always compute, but a
  // fileable return must be computed on the exact-year certified table.
  const taxYear = new Date(engagement.taxYearEnd as unknown as string).getUTCFullYear();
  if (params.forFiling && !hasExactRateYear(getFederalRateBook(), taxYear)) {
    throw createError(
      422,
      `No certified rate table for tax year ${taxYear} — filing is blocked until the ${taxYear} rate book is wired. ` +
        '(Drafts still preview using the latest known rates.)',
    );
  }

  const client = await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  });
  if (!client) throw createError(404, 'Client not found');

  const computed = await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  );
  if (!computed) throw createError(409, 'No computed return yet — run compute first');

  const fields = computed.fields as { line: string; value: unknown }[];
  const v = (line: string): number => {
    const f = fields.find((x) => x.line === line);
    return f ? Number(f.value) : 0;
  };
  const has = (line: string): boolean => fields.some((x) => x.line === line);

  // Fail closed on the total: use the engine's dollar-denominated tax-payable
  // line, never the cents `totalOwing` (obligation-boundary balance semantics).
  // A snapshot predating `totalTaxPayable` must be recomputed, not fudged.
  if (!has('totalTaxPayable')) {
    throw createError(
      422,
      'Computed return predates the tax-payable line — recompute before preparing the CIF',
    );
  }
  const totalTaxPayable = v('totalTaxPayable');

  // Read the FROZEN filing input captured with this computed return — NOT the
  // live editor document — so GIFI, shareholders, questionnaire, address and
  // instalments in the payload are exactly what was computed and reviewed.
  //
  // The fallback to the live input exists for returns computed before freezing
  // existed, and it is a DRAFT-ONLY concession. On the filing path it would
  // silently defeat the freeze: compute, obtain review sign-off, edit the
  // return, and the transmitted payload would carry the unreviewed edits. So a
  // filing refuses instead and asks for a recompute, which re-freezes.
  const frozenFilingInput = (computed as { filingInput?: unknown }).filingInput;
  if (params.forFiling && frozenFilingInput === undefined) {
    throw createError(
      422,
      'This computed return predates filing-input freezing, so the filing content ' +
        'cannot be proven to match what was computed and reviewed. Recompute the ' +
        'return before filing.',
    );
  }
  const ri = (frozenFilingInput ?? engagement.returnInput ?? {}) as {
    identification?: {
      province?: string;
      corpType?: string;
      acquisitionOfControl?: boolean;
      deemedYearEnd?: boolean;
      professionalCorp?: boolean;
      inactive?: boolean;
      firstReturn?: boolean;
      headOffice?: Record<string, unknown>;
      addressChanged?: boolean;
      nonResident?: boolean;
      amalgamation?: boolean;
      windUp?: boolean;
      finalReturn?: boolean;
      relatedCorporations?: boolean;
      foreignAffiliates?: boolean;
      foreignPropertyOver100k?: boolean;
      nonArmsLengthNonResidentTransactions?: boolean;
    };
    balanceSheet?: Record<string, unknown>;
    incomeStatement?: Record<string, unknown>;
    gifiNotes?: Record<string, unknown>;
    donations?: Record<string, number>;
    dividends?: Record<string, number>;
    losses?: Record<string, unknown>;
    capitalGains?: { dispositions?: unknown[] };
    credits?: { sredQualifiedExpenditures?: number };
    foreign?: Record<string, number>;
    sbd?: { associated?: unknown[]; zetmIncome?: number; aaii?: number };
    shareholders?: {
      list?: Array<{ name?: string; sin?: string; commonPct?: number; preferredPct?: number }>;
    };
    payments?: { instalmentsPaid?: number };
  };
  const province = ri.identification?.province;

  // GIFI Schedule 100/125/141 — built + VALIDATED by @classytic/ledger-ca. On the
  // filing path an unbalanced Schedule 100 (assets ≠ liabilities + equity) or a
  // missing mandatory total is a hard reject — the accounting identity must hold.
  const gifiBuilt = buildGifiFromReturn(ri);
  if (params.forFiling && gifiBuilt && !gifiBuilt.validation.balanced) {
    throw createError(422, `GIFI validation failed — ${gifiBuilt.validation.errors.join('; ')}`);
  }
  const gifi = gifiBuilt?.gifi;

  // T2 jacket questionnaire — the SMART part: most answers are DERIVED from the
  // return's own data (the app already knows the corp donated / has SR&ED / is
  // associated), so the preparer never re-answers what the schedules already say.
  // Only the genuinely un-inferable questions (address change, non-resident,
  // foreign affiliates/property, related corps) come from explicit input.
  const idn = ri.identification ?? {};
  const anyPositive = (o?: Record<string, unknown>) =>
    !!o && Object.values(o).some((v) => typeof v === 'number' && v > 0);
  const associated = Array.isArray(ri.sbd?.associated) && ri.sbd!.associated.length > 0;
  const sredPresent = nn(ri.credits?.sredQualifiedExpenditures) > 0;
  const questionnaire = {
    // Explicit status questions (from Identification).
    ...(idn.acquisitionOfControl != null
      ? { acquisitionOfControl: Boolean(idn.acquisitionOfControl) }
      : {}),
    ...(idn.professionalCorp != null ? { professionalCorp: Boolean(idn.professionalCorp) } : {}),
    ...(idn.inactive != null ? { inactive: Boolean(idn.inactive) } : {}),
    ...(idn.firstReturn != null ? { firstYear: Boolean(idn.firstReturn) } : {}),
    ...(idn.addressChanged != null ? { addressChanged: Boolean(idn.addressChanged) } : {}),
    ...(idn.nonResident != null ? { nonResident: Boolean(idn.nonResident) } : {}),
    ...(idn.amalgamation != null ? { amalgamation: Boolean(idn.amalgamation) } : {}),
    ...(idn.windUp != null ? { windUp: Boolean(idn.windUp) } : {}),
    ...(idn.finalReturn != null ? { finalReturn: Boolean(idn.finalReturn) } : {}),
    // DERIVED from the return data — no re-asking.
    associated,
    associatedClaimingExpenditureLimit: associated && sredPresent,
    charitableDonations: anyPositive(ri.donations),
    dividends: anyPositive(ri.dividends),
    claimingLosses: anyPositive(ri.losses as Record<string, unknown>),
    provincialCreditOrMultiJurisdiction: Boolean(province),
    capitalGains: (ri.capitalGains?.dispositions?.length ?? 0) > 0,
    investmentIncome: nn(ri.sbd?.aaii) > 0,
    manufacturingOrZetm: nn(ri.sbd?.zetmIncome) > 0,
    investmentTaxCredit: sredPresent,
    sredExpenditures: sredPresent,
    foreignTaxCredits: anyPositive(ri.foreign),
    // Explicit foreign-reporting questions (information returns), from Identification.
    ...(idn.relatedCorporations != null
      ? { relatedCorporations: Boolean(idn.relatedCorporations) }
      : {}),
    ...(idn.foreignAffiliates != null ? { foreignAffiliates: Boolean(idn.foreignAffiliates) } : {}),
    ...(idn.foreignPropertyOver100k != null
      ? { foreignPropertyOver100k: Boolean(idn.foreignPropertyOver100k) }
      : {}),
    ...(idn.nonArmsLengthNonResidentTransactions != null
      ? { nonArmsLengthNonResidentTransactions: Boolean(idn.nonArmsLengthNonResidentTransactions) }
      : {}),
  };

  // Schedule 50 — shareholders (private corporations).
  const shareholders = (ri.shareholders?.list ?? [])
    .filter((s) => s.name)
    .map((s) => ({
      name: String(s.name),
      ...(s.sin ? { identifier: String(s.sin) } : {}),
      ...(s.commonPct != null ? { commonPct: nn(s.commonPct) } : {}),
      ...(s.preferredPct != null ? { preferredPct: nn(s.preferredPct) } : {}),
    }));

  const ho = idn.headOffice;
  const headOfficeAddress = ho
    ? {
        ...(ho.line1 ? { line1: String(ho.line1) } : {}),
        ...(ho.city ? { city: String(ho.city) } : {}),
        ...(ho.province ? { province: String(ho.province) } : {}),
        ...(ho.postalCode ? { postalCode: String(ho.postalCode) } : {}),
      }
    : undefined;

  // Per-class CCA from the fold's `ccaClosingUCC:{class}` lines.
  const ccaClasses = fields
    .filter((f) => typeof f.line === 'string' && f.line.startsWith('ccaClosingUCC:'))
    .map((f) => ({ ccaClass: f.line.slice('ccaClosingUCC:'.length), closingUCC: Number(f.value) }));

  // Identity comes from the FROZEN snapshot captured at compute time — NOT the
  // live client/engagement records — so a post-sign-off edit to the client can't
  // change the transmitted return. Falls back to live records only for returns
  // computed before identity-freezing existed.
  const frozen = (computed as { identity?: Record<string, unknown> }).identity;
  const data: T2CifData = {
    identity: {
      softwareCode: t2SoftwareCode,
      businessNumber: String(frozen?.businessNumber ?? client.businessNumber ?? ''),
      corporationName: String(frozen?.legalName ?? client.name ?? ''),
      corpType: String(frozen?.corporationType ?? client.corpType ?? '') || undefined,
      ...(province ? { province } : {}),
      ...(headOfficeAddress && Object.keys(headOfficeAddress).length ? { headOfficeAddress } : {}),
      taxYearStart: String(frozen?.taxYearStart ?? iso(engagement.taxYearStart)),
      taxYearEnd: String(frozen?.taxYearEnd ?? iso(engagement.taxYearEnd)),
    },
    ...(gifi ? { gifi } : {}),
    ...(Object.keys(questionnaire).length ? { questionnaire } : {}),
    ...(shareholders.length ? { shareholders } : {}),
    // Settlement — always present: tax payable (770) less payments (840).
    settlement: computeT2Settlement({
      totalTaxPayable,
      instalmentsPaid: nn(ri.payments?.instalmentsPaid),
    }),
    schedule1: { netIncomeForTax: v('netIncomeForTax') },
    ...(has('taxableCapitalGain')
      ? { capitalGains: { taxableCapitalGain: v('taxableCapitalGain') } }
      : {}),
    ...(ccaClasses.length || has('ccaClaimed')
      ? {
          cca: {
            classes: ccaClasses,
            totalCca: v('ccaClaimed'),
            ...(v('ccaRecapture') ? { recapture: v('ccaRecapture') } : {}),
            ...(v('ccaTerminalLoss') ? { terminalLoss: v('ccaTerminalLoss') } : {}),
          },
        }
      : {}),
    losses: {
      nonCapitalApplied: v('nonCapitalLossApplied'),
      nonCapitalClosing: v('nonCapitalLossClosing'),
      netCapitalApplied: v('netCapitalLossApplied'),
      netCapitalClosing: v('netCapitalLossClosing'),
      ...(has('lossCarriedBack') ? { nonCapitalCarriedBack: v('lossCarriedBack') } : {}),
    },
    ...(has('donationsClaimed')
      ? {
          donations: {
            donationsClaimed: v('donationsClaimed'),
            closingPool: v('donationPoolClosing'),
          },
        }
      : {}),
    ...(has('zetmRateReduction') ? { zetm: { rateReduction: v('zetmRateReduction') } } : {}),
    ...(has('foreignTaxCredit')
      ? {
          foreignTaxCredit: {
            totalFtc: v('foreignTaxCredit'),
            closingBusinessFtcPool: v('businessFtcPoolClosing'),
          },
        }
      : {}),
    ...(has('sredItcEarned')
      ? {
          sredItc: {
            itcEarned: v('sredItcEarned'),
            refundableItc: v('sredItcRefundable'),
            closingItcPool: v('itcPoolClosing'),
          },
        }
      : {}),
    ...(has('gripClosing')
      ? {
          grip: {
            closingGrip: v('gripClosing'),
            ...(has('excessiveEligibleDividend')
              ? { excessiveDesignation: v('excessiveEligibleDividend') }
              : {}),
          },
        }
      : {}),
    // Serialize the ENGINE's SBD amount — never recompute the rate in the filing
    // layer (calculation and filing must not be able to disagree).
    sbd: { sbdIncome: v('sbdIncome'), smallBusinessDeduction: v('sbdDeduction') },
    rdtoh: {
      partIvTax: v('partIVTaxPayable'),
      ...(has('erdtohClosing') ? { erdtohClosing: v('erdtohClosing') } : {}),
      ...(has('nerdtohClosing') ? { nerdtohClosing: v('nerdtohClosing') } : {}),
      dividendRefund: v('dividendRefund'),
    },
    ...(has('provincialTax') && province
      ? { provincial: { province, provincialTax: v('provincialTax') } }
      : {}),
    taxableIncome: v('taxableIncome'),
    ...(has('partIBasicTax')
      ? {
          partIBuildUp: {
            basicTax: v('partIBasicTax'),
            abatement: v('federalAbatement'),
            smallBusinessDeduction: v('sbdDeduction'),
            generalRateReduction: v('generalRateReduction'),
          },
        }
      : {}),
    partITax: v('partITaxPayable'),
    // 710 / 724 — inside totalFederalTax, so they must be disclosed or 770 will
    // not equal the sum of its components on the filed return.
    ...(has('partIII1TaxPayable') ? { partIII1Tax: v('partIII1TaxPayable') } : {}),
    ...(has('partVI1TaxPayable') ? { partVI1Tax: v('partVI1TaxPayable') } : {}),
    ...(has('totalFederalTax') ? { totalFederalTax: v('totalFederalTax') } : {}),
    // Tax payable (before instalments/payments) — the engine's dollar figure.
    totalTax: totalTaxPayable,
    ...(params.certification ? { certification: params.certification } : {}),
  };

  return data;
}

/**
 * Render the DRAFT/PREVIEW CIF (structural, not certified). Composition + draft
 * render. This is for on-screen preview and working papers ONLY — it is NEVER
 * transmitted; the transmit path serializes via the certified serializer.
 */
export async function prepareT2Cif(params: ComposeT2FilingParams): Promise<PrepareT2CifResult> {
  const data = await composeT2FilingData(params);
  // The renderer's forFiling flag still enforces mandatory GIFI/address/S50 content
  // for a would-be filing, even though the draft output itself is never sent.
  const xml = renderT2DraftReturn(data, { forFiling: Boolean(params.forFiling) });
  const payloadHash = createHash('sha256').update(xml).digest('hex');
  return { payloadHash, xml };
}
