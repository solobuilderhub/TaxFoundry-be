/**
 * The base federal T2 schedules — reused as INPUT by every provincial program
 * (AT1 taxes federal taxable income allocated to Alberta; CO-17 similarly for
 * Québec), so these are not "T2-only" in the sense of who reads them, only in
 * the sense of which return they are the T2's own schedules for. See
 * `return-input.ts` in this directory for the composed whole.
 */
import { z } from 'zod';

export const CcaClass = z
  .object({
    ccaClass: z.string().optional(),
    openingUCC: z.number().optional(),
    additions: z.number().optional(),
    dispositions: z.number().optional(),
    immediateExpensing: z.number().optional(),
    aiip: z.boolean().optional(),
    classEmptied: z.boolean().optional(),
    claim: z
      .number()
      .optional()
      .describe('Amount to claim; blank = the maximum. An explicit 0 claims nothing.'),
    albertaOpeningUCC: z
      .number()
      .optional()
      .describe(
        'AT1 Schedule 13 — the Alberta figures for this class, when they diverge from ' +
          'federal. Both are OVERRIDES: blank takes the federal figure, so a class that ' +
          'matches federally needs nothing here. An explicit `0` is a real answer (claim ' +
          'nothing for Alberta), not an absent one.\n\n' +
          'Alberta permits a different discretionary CCA claim from federal — a corporation ' +
          'may claim a class federally and not provincially, or the reverse. Filing these ' +
          'requires jacket line 000060 or 000061 to be "yes"; TRA forbids Schedule 13 ' +
          'outright when the return declares no divergence.\n\n' +
          '013003 — Alberta opening UCC, when it differs from federal.',
      ),
    albertaClaim: z
      .number()
      .optional()
      .describe('013019 — the Alberta discretionary claim. Blank = the same as federal.'),
  })
  .meta({ id: 'CcaClass' });

/**
 * AT1 Schedule 18's six category buckets. Federal Schedule 6 does not
 * categorize dispositions — this exists so ONE list of dispositions can feed
 * both the federal computation (which ignores it) and the Alberta one (which
 * needs the category to bucket proceeds/ACB/outlays into its six totals).
 */
export const AT1_DISPOSITION_CATEGORY_VALUES = [
  'shares',
  'realEstate',
  'bonds',
  'otherProperties',
  'personalUse',
  'listedPersonal',
] as const;
export const At1DispositionCategory = z
  .enum(AT1_DISPOSITION_CATEGORY_VALUES)
  .meta({ id: 'At1DispositionCategory' });

export const Disposition = z
  .object({
    description: z.string().optional(),
    proceeds: z.number().optional(),
    acb: z.number().optional(),
    outlays: z.number().optional(),
    category: At1DispositionCategory.optional().describe(
      'Feeds AT1 Schedule 18 only; the federal Schedule 6 computation ignores it.',
    ),
  })
  .meta({ id: 'Disposition' });

export const Shareholder = z
  .object({
    name: z.string().optional(),
    bnOrSin: z.string().optional(),
    percentCommon: z.number().optional(),
    percentPreferred: z.number().optional(),
  })
  .meta({ id: 'Shareholder' });

export const IdentificationValues = z
  .object({
    corpType: z.string().optional(),
    province: z
      .string()
      .optional()
      .describe('Province/territory of the permanent establishment (Schedule 5 provincial tax).'),
    quebecId: z
      .string()
      .optional()
      .describe(
        'Québec enterprise number (NEQ) / Revenu Québec identification number — the CO-17 ' +
          'filing identifier. Only meaningful for a CO17 engagement.',
      ),
    acquisitionOfControl: z.boolean().optional(),
    deemedYearEnd: z.boolean().optional(),
    professionalCorp: z.boolean().optional(),
    inactive: z.boolean().optional(),
    // T2 jacket status questions
    addressChanged: z.boolean().optional(),
    firstReturn: z.boolean().optional(),
    nonResident: z.boolean().optional(),
    amalgamation: z.boolean().optional(),
    windUp: z.boolean().optional(),
    finalReturn: z.boolean().optional(),
    // Foreign-reporting information-return triggers
    relatedCorporations: z.boolean().optional(),
    foreignAffiliates: z.boolean().optional(),
    foreignPropertyOver100k: z.boolean().optional(),
    nonArmsLengthNonResidentTransactions: z.boolean().optional(),
  })
  .meta({ id: 'IdentificationValues' });

export const PermanentEstablishmentValues = z
  .object({
    province: z.string().optional(),
    grossRevenue: z.number().optional(),
    salariesWages: z.number().optional(),
  })
  .meta({ id: 'PermanentEstablishmentValues' });

export const ProvincialAllocationValues = z
  .object({
    establishments: z.array(PermanentEstablishmentValues).optional(),
  })
  .meta({ id: 'ProvincialAllocationValues' });

export const BalanceSheetValues = z
  .object({
    cash: z.number().optional(),
    accountsReceivable: z.number().optional(),
    inventory: z.number().optional(),
    capitalAssetsNet: z.number().optional(),
    otherAssets: z.number().optional(),
    accountsPayable: z.number().optional(),
    loansPayable: z.number().optional(),
    otherLiabilities: z.number().optional(),
    shareCapital: z.number().optional(),
    retainedEarnings: z.number().optional(),
  })
  .meta({ id: 'BalanceSheetValues' });

export const IncomeStatementValues = z
  .object({
    revenue: z.number().optional(),
    costOfSales: z.number().optional(),
    salariesAndWages: z.number().optional(),
    amortization: z.number().optional(),
    otherExpenses: z.number().optional(),
  })
  .meta({ id: 'IncomeStatementValues' });

export const GifiNotesValues = z
  .object({
    financialStatementsIncluded: z.boolean().optional(),
    preparedByAccountant: z.boolean().optional(),
    reviewEngagement: z.boolean().optional(),
    auditEngagement: z.boolean().optional(),
  })
  .meta({ id: 'GifiNotesValues' });

export const NetIncomeValues = z
  .object({
    lines: z
      .record(z.string(), z.number().optional())
      .optional()
      .describe(
        'Schedule 1, keyed by CRA line number: { "104": 50000, "403": 55000 }.\n\n' +
          "The line number is the transmission key, so storing it as the key means what the " +
          "preparer typed is already in the shape the return is filed in. The former " +
          "{ description, amount }[] shape reconciled on screen and could not be filed — a " +
          "transmitted return has no field for a preparer's own wording.",
      ),
  })
  .meta({ id: 'NetIncomeValues' });

export const DonationsValues = z
  .object({
    charitable: z.number().optional(),
    cultural: z.number().optional(),
    ecological: z.number().optional(),
    openingDonationPool: z
      .number()
      .optional()
      .describe('Unclaimed donation pool carried forward — auto-filled from last year.'),
  })
  .meta({ id: 'DonationsValues' });

export const DividendsValues = z
  .object({
    taxableReceivedConnected: z.number().optional(),
    taxableReceivedPortfolio: z.number().optional(),
    eligibleDividendsReceived: z.number().optional(),
    taxableDividendsPaid: z.number().optional(),
    eligibleDividendsPaid: z.number().optional(),
    openingGrip: z
      .number()
      .optional()
      .describe('Opening GRIP (Schedule 53) — auto-filled from last year on compute.'),
  })
  .meta({ id: 'DividendsValues' });

export const LossesValues = z
  .object({
    nonCapitalOpening: z.number().optional(),
    nonCapitalApplied: z.number().optional(),
    netCapitalOpening: z.number().optional(),
    netCapitalApplied: z.number().optional(),
    carrybacks: z
      .array(z.object({ taxYearEnd: z.string().optional(), amount: z.number().optional() }))
      .optional()
      .describe('Carry a current-year loss back to prior years (up to 3).'),
    // Restricted classes — each may only offset a specific income base, so the
    // base is captured alongside the pool.
    farmOpening: z.number().optional().describe("Farm loss, s.111(1)(d) — offsets any income."),
    farmApplied: z.number().optional(),
    restrictedFarmOpening: z
      .number()
      .optional()
      .describe('Restricted farm loss, s.111(1)(c) — farming income ONLY.'),
    restrictedFarmApplied: z.number().optional(),
    farmingIncome: z
      .number()
      .optional()
      .describe('Farming income this year — the ceiling for the restricted farm pool.'),
    limitedPartnershipOpening: z
      .number()
      .optional()
      .describe('Limited partnership loss, s.111(1)(e) — that partnership’s income only.'),
    limitedPartnershipApplied: z.number().optional(),
    partnershipIncome: z.number().optional(),
    atRiskAmount: z
      .number()
      .optional()
      .describe('At-risk amount, s.96(2.2). Absent means nothing can be applied.'),
  })
  .meta({ id: 'LossesValues' });

/** Schedule 43 — Part VI.1 on dividends paid on taxable preferred shares. */
export const PreferredSharesValues = z
  .object({
    shortTermPreferredDividends: z.number().optional(),
    otherPreferredDividends: z.number().optional(),
    electedUnder191_2: z.boolean().optional(),
    priorYearPreferredDividends: z.number().optional(),
    isAssociated: z.boolean().optional(),
    allocatedAllowance: z.number().optional(),
  })
  .meta({ id: 'PreferredSharesValues' });

/** EIFEL — excluded-entity facts (s.18.2). Most CCPCs clear this automatically. */
export const EifelValues = z
  .object({
    netInterestAndFinancingExpenses: z.number().optional(),
    groupTaxableCapital: z.number().optional(),
    domesticExceptionApplies: z.boolean().optional(),
  })
  .meta({ id: 'EifelValues' });

export const SbdValues = z
  .object({
    activeBusinessIncome: z.number().optional(),
    businessLimit: z.number().optional(),
    taxableCapital: z.number().optional(),
    aaii: z.number().optional(),
    zetmIncome: z
      .number()
      .optional()
      .describe('Zero-emission technology manufacturing income — reduced rate (Schedule 27).'),
    associated: z
      .array(z.object({ name: z.string().optional(), allocatedLimit: z.number().optional() }))
      .optional()
      .describe('Other associated CCPCs sharing the $500k limit (Schedule 23).'),
  })
  .meta({ id: 'SbdValues' });

export const CcaValues = z.object({ classes: z.array(CcaClass).optional() }).meta({ id: 'CcaValues' });

export const CapitalGainsValues = z
  .object({ dispositions: z.array(Disposition).optional() })
  .meta({ id: 'CapitalGainsValues' });

export const CreditsValues = z
  .object({
    sredQualifiedExpenditures: z
      .number()
      .optional()
      .describe('Qualified SR&ED expenditures for the year (Schedule 31 ITC base).'),
    openingItcPool: z
      .number()
      .optional()
      .describe('Non-refundable ITC pool carried forward — auto-filled from last year.'),
  })
  .meta({ id: 'CreditsValues' });

export const ForeignValues = z
  .object({
    foreignNonBusinessIncome: z.number().optional(),
    foreignNonBusinessTaxPaid: z.number().optional(),
    foreignBusinessIncome: z.number().optional(),
    foreignBusinessTaxPaid: z.number().optional(),
    openingBusinessFtcPool: z
      .number()
      .optional()
      .describe('Unused business FTC carried forward — auto-filled from last year.'),
  })
  .meta({ id: 'ForeignValues' });

export const PaymentsValues = z
  .object({
    instalmentsPaid: z
      .number()
      .optional()
      .describe(
        'Tax paid by instalments during the year (line 840) — drives balance owing/refund.',
      ),
  })
  .meta({ id: 'PaymentsValues' });

export const ShareholdersValues = z
  .object({ list: z.array(Shareholder).optional() })
  .meta({ id: 'ShareholdersValues' });

/** Schedule 88 — internet business activities (information). */
export const InternetBusinessValues = z
  .object({
    hasInternetBusiness: z.boolean().optional(),
    webPageCount: z.number().optional(),
    urls: z
      .array(z.object({ url: z.string().optional() }))
      .optional()
      .describe('CRA reports the top five by gross revenue; extras are dropped on compute.'),
    percentOfGrossRevenue: z.number().optional(),
  })
  .meta({ id: 'InternetBusinessValues' });

/** Schedule 101 / 24 — first return after incorporation, amalgamation or wind-up. */
export const FirstReturnValues = z
  .object({
    isFirstReturn: z.boolean().optional(),
    event: z.enum(['incorporation', 'amalgamation', 'windUpOfSubsidiary']).optional(),
    eventDate: z.string().optional(),
    predecessorBusinessNumbers: z
      .string()
      .optional()
      .describe('Comma-separated in the form; split at the engine boundary.'),
    openingAssets: z.number().optional(),
    openingLiabilities: z.number().optional(),
    openingEquity: z.number().optional(),
  })
  .meta({ id: 'FirstReturnValues' });

/**
 * AT1 Schedule 17's reserve kinds. A controlled list rather than free text so
 * the Alberta reconciliation can map each row exactly — a free-text "type"
 * cannot be matched reliably against AT1's own kind enum. The federal
 * computation only reads opening/transfer/closing, so this is a safe,
 * additive change for existing federal-only data too.
 */
export const RESERVE_TYPE_VALUES = [
  'doubtfulDebts',
  'undeliveredGoodsAndServices',
  'prepaidRent',
  'returnableContainers',
  'unpaidAmounts',
  'insurancePolicyReserves',
  'bankReserves',
  'otherTaxReserves',
] as const;
export const ReserveType = z.enum(RESERVE_TYPE_VALUES).meta({ id: 'ReserveType' });

export const ReserveRow = z
  .object({
    type: ReserveType.optional(),
    opening: z.number().optional().describe('Balance at the beginning of the year (reversed into income).'),
    transfer: z.number().optional().describe('Transfer on an amalgamation / wind-up of a subsidiary.'),
    closing: z.number().optional().describe('Balance at the end of the year (deducted this year).'),
    albertaOpening: z
      .number()
      .optional()
      .describe(
        'AT1 Schedule 17 — the Alberta figures for this reserve, when they diverge from ' +
          'federal. All three are OVERRIDES: blank takes the federal figure, so a reserve ' +
          'that matches federally needs nothing here. An explicit `0` is a real answer, not ' +
          'an absent one. For `insurancePolicyReserves` / `bankReserves` — Alberta-only ' +
          'kinds with no federal Part 2 equivalent — federal always reads as 0, so these ' +
          'three fields are effectively the only source of the figure.',
      ),
    albertaTransfer: z.number().optional(),
    albertaClosing: z.number().optional(),
  })
  .meta({ id: 'ReserveRow' });

/** Schedule 13 — continuity of reserves (Part 2, other reserves). */
export const ReservesValues = z.object({ rows: z.array(ReserveRow).optional() }).meta({ id: 'ReservesValues' });

/** Schedule 33 — taxable capital employed in Canada (balance-sheet detail). */
export const CapitalValues = z
  .object({
    // Capital additions (lines 101-112)
    reservesNotDeducted: z.number().optional(),
    capitalStock: z.number().optional(),
    retainedEarnings: z.number().optional(),
    contributedSurplus: z.number().optional(),
    otherSurpluses: z.number().optional(),
    deferredForexGains: z.number().optional(),
    loansAndAdvances: z.number().optional(),
    bondsAndDebentures: z.number().optional(),
    dividendsDeclaredUnpaid: z.number().optional(),
    otherLongTermDebt: z.number().optional(),
    partnershipInterest: z.number().optional(),
    // Capital deductions (lines 121-124)
    deferredTaxDebit: z.number().optional(),
    deficitInEquity: z.number().optional(),
    patronageDeducted: z.number().optional(),
    deferredForexLosses: z.number().optional(),
    // Investment allowance (lines 401-407)
    sharesOfOtherCorporations: z.number().optional(),
    loansToOtherCorporations: z.number().optional(),
    bondsOfOtherCorporations: z.number().optional(),
    longTermDebtOfFinancialInstitution: z.number().optional(),
    dividendsReceivable: z.number().optional(),
    partnershipObligations: z.number().optional(),
    partnershipInterestAsset: z.number().optional(),
    // Part 4 allocation (optional)
    taxableIncomeEarnedInCanada: z.number().optional(),
  })
  .meta({ id: 'CapitalValues' });

// A same-named TS type per exported schema — see common.ts's own comment on this pattern.
export type CcaClass = z.infer<typeof CcaClass>;
export type At1DispositionCategory = z.infer<typeof At1DispositionCategory>;
export type Disposition = z.infer<typeof Disposition>;
export type Shareholder = z.infer<typeof Shareholder>;
export type IdentificationValues = z.infer<typeof IdentificationValues>;
export type PermanentEstablishmentValues = z.infer<typeof PermanentEstablishmentValues>;
export type ProvincialAllocationValues = z.infer<typeof ProvincialAllocationValues>;
export type BalanceSheetValues = z.infer<typeof BalanceSheetValues>;
export type IncomeStatementValues = z.infer<typeof IncomeStatementValues>;
export type GifiNotesValues = z.infer<typeof GifiNotesValues>;
export type NetIncomeValues = z.infer<typeof NetIncomeValues>;
export type DonationsValues = z.infer<typeof DonationsValues>;
export type DividendsValues = z.infer<typeof DividendsValues>;
export type LossesValues = z.infer<typeof LossesValues>;
export type PreferredSharesValues = z.infer<typeof PreferredSharesValues>;
export type EifelValues = z.infer<typeof EifelValues>;
export type SbdValues = z.infer<typeof SbdValues>;
export type CcaValues = z.infer<typeof CcaValues>;
export type CapitalGainsValues = z.infer<typeof CapitalGainsValues>;
export type CreditsValues = z.infer<typeof CreditsValues>;
export type ForeignValues = z.infer<typeof ForeignValues>;
export type PaymentsValues = z.infer<typeof PaymentsValues>;
export type ShareholdersValues = z.infer<typeof ShareholdersValues>;
export type InternetBusinessValues = z.infer<typeof InternetBusinessValues>;
export type FirstReturnValues = z.infer<typeof FirstReturnValues>;
export type ReserveType = z.infer<typeof ReserveType>;
export type ReserveRow = z.infer<typeof ReserveRow>;
export type ReservesValues = z.infer<typeof ReservesValues>;
export type CapitalValues = z.infer<typeof CapitalValues>;
