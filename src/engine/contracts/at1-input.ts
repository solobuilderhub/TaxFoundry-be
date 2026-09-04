/**
 * Every AT1-only schedule slice — Alberta jacket lines the federal schedules
 * don't carry, plus the nine standalone AT1 schedules (3/4/5/6/7/8/9/11/15).
 * See `return-input.ts` in this directory for the composed whole.
 */
import { z } from 'zod';
import { YesNo } from './common.js';

/**
 * Alberta AT1 jacket — the mandatory fields the federal schedules do not
 * carry.
 *
 * TRA states a requirement per field, and §3.2.3 makes "mandatory" an
 * obligation on the OUTPUT: every mandatory field ID must be filed,
 * defaulting to zero only where the value genuinely cannot be determined.
 * Nothing here can be defaulted — a corporation has gross revenue, and an
 * unanswered question is not "No" (the specification encodes No as `2`, a
 * positive answer the corporation gives).
 *
 * So the filing path REFUSES when any of these is blank rather than filing a
 * guess. Everything else on the AT1 jacket is derived from the federal
 * return or from the client record; only what cannot be derived is
 * collected here.
 */
export const AlbertaValues = z
  .object({
    grossRevenue: z.number().optional().describe('000047 — gross revenue per the financial statements.'),
    totalAssets: z.number().optional().describe('000048 — total assets. Must equal federal GIFI 2599.'),
    associatedWithCcpcs: YesNo.optional().describe(
      '000001 — associated with one or more Canadian-controlled private corporations? Not derived ' +
        "from Schedule 1's own association test: that derivation is undefined whenever the " +
        'corporation is not claiming the Alberta SBD, but this jacket line is unconditionally mandatory.',
    ),
    windUpOfSubsidiary: YesNo.optional().describe(
      '000031 — wind-up of a subsidiary under ITA s.88 during the year?',
    ),
    firstYearAfterAmalgamation: YesNo.optional().describe(
      '000032 — first year of filing after an amalgamation?',
    ),
    taxYearEndChanged: YesNo.optional().describe('000038 — tax year end changed since the last return?'),
    finalReturn: YesNo.optional().describe('000050 — final return?'),
    transferOfProperty: YesNo.optional().describe(
      '000054 — transfer of property under ITA 85(1), 85(2) or 97(2)?',
    ),
    reportsDifferentAlbertaIncome: YesNo.optional().describe(
      '000060 — reporting different taxable income for Alberta than federally? TRA FORBIDS ' +
        'Schedule 13 when this and 000061 are both "No".',
    ),
    electsDifferentDiscretionaryAmounts: YesNo.optional().describe(
      '000061 — elected different discretionary amounts, or opening balances differ?',
    ),
    preparedByTaxPreparerForFee: YesNo.optional().describe(
      '000095 — was the return prepared by a tax preparer for a fee?',
    ),
  })
  .meta({ id: 'AlbertaValues' });

/**
 * One member of Area A's Agreement Among Associated Corporations (line
 * 041/043/045). Re-entered here rather than joined against `sbd.associated`
 * (federal Schedule 23) by array index — the same reason Schedule 29's own
 * Agreement page re-enters its members: an index-matched join silently
 * desyncs if the federal list is later reordered or edited.
 */
export const AlbertaAssociatedCorpMember = z
  .object({
    name: z.string().optional().describe('041 — put the corporation filing this return FIRST.'),
    albertaCan: z
      .string()
      .optional()
      .describe('043 — Alberta CAN. Must match the same corp’s fed 023100 (federal Schedule 23).'),
    allocatedAmount: z
      .number()
      .optional()
      .describe('045 — this member’s allocated share of the base amount, same percentage split as federal.'),
  })
  .meta({ id: 'AlbertaAssociatedCorpMember' });

/**
 * AT1 Schedule 1 (Alberta Small Business Deduction) eligibility — its own
 * nav entry (num "001"), not a subsection of the jacket. Everything else the
 * schedule needs (active business income, Alberta taxable income) is
 * already derived from the federal return; these three cannot be.
 */
export const AlbertaSbdValues = z
  .object({
    corporationStatus: z
      .enum(['ccpc', 'albertaCoopOrCreditUnion', 'section149Exempt', 'other'])
      .optional()
      .describe('Eligibility gate — only a CCPC, or an Alberta co-op/credit union, may claim the SBD.'),
    wasCcpcThroughoutYear: YesNo.optional().describe(
      'CCPC status must hold THROUGHOUT the year; a mid-year change bars the claim.',
    ),
    royaltyTaxDeduction: z
      .number()
      .optional()
      .describe('001005 / 001011 — Alberta Royalty Tax Deduction (Schedule 5), oil & gas only.'),
    associatedCorpAgreement: z
      .array(AlbertaAssociatedCorpMember)
      .optional()
      .describe('Area A (041/043/045) — filed only when associated with one or more CCPCs (line 001).'),
  })
  .meta({ id: 'AlbertaSbdValues' });

/**
 * AT1 Schedule 20 — Alberta's own two donation continuities, plus the Area B
 * maximum-deduction gains inputs. Alberta carries the SAME 75%-of-income
 * ceiling federal does (Schedule 20's own Area B, not a looser Alberta
 * rule), so nothing here changes what may be claimed — only what the
 * schedule has to disclose to file it.
 *
 * The charitable pool (lines 002-018) reuses federal's opening balance and
 * current-year gifts (`donations.openingDonationPool` / `.charitable`);
 * these fields are only the parts with no federal equivalent at all —
 * expired, transferred on wind-up, an acquisition-of-control adjustment,
 * and the amount actually applied (blank = claim the maximum both ceilings
 * allow, same "blank ≠ zero" rule as Schedule 21's pools).
 *
 * The gifts pool (lines 062-078 — gifts to Canada/a province, certified
 * cultural property, ecologically sensitive land) has NO federal source at
 * all: `giftsCurrentYear` defaults to federal's `cultural + ecological`
 * (the closest federal concept), but the pool's own opening balance can
 * never be derived — same rule as every other AT1-only opening balance in
 * this engine.
 */
export const AlbertaDonationsValues = z
  .object({
    charitableExpired: z.number().optional().describe('020004 — charitable gifts expired this year. No federal equivalent.'),
    charitableTransferredIn: z.number().optional().describe('020008 — charitable gifts transferred in on amalgamation or wind-up.'),
    charitableAcquisitionOfControlAdjustment: z.number().optional().describe('020013 — adjustment for an acquisition of control.'),
    charitableApplied: z.number().optional().describe('020016 — amount applied against Alberta taxable income. Blank = claim the maximum.'),
    giftsOpening: z.number().optional().describe(
      '020062 — gifts pool opening balance. Cannot be derived — this is the first AT1 filing ' +
        'with real schedules for many corporations.',
    ),
    giftsExpired: z.number().optional().describe('020064 — gifts expired this year.'),
    giftsTransferredIn: z.number().optional().describe('020068 — gifts transferred in on amalgamation or wind-up.'),
    giftsCurrentYear: z.number().optional().describe(
      '020070 — total current-year gifts. Blank = federal cultural + ecological gifts, this year’s total.',
    ),
    giftsAcquisitionOfControlAdjustment: z.number().optional().describe('020073 — adjustment for an acquisition of control.'),
    giftsApplied: z.number().optional().describe('020076 — amount applied against Alberta taxable income. Blank = claim the maximum.'),
    taxableCapitalGainsOnGifts: z.number().optional().describe('020032 — taxable capital gains arising on gifts of capital property.'),
    deemedGiftGains: z.number().optional().describe('020034 — taxable capital gain on deemed gifts of non-qualifying securities.'),
    recaptureOnGifts: z.number().optional().describe('020036 — recapture of capital cost allowance on charitable gifts.'),
    proceedsNetOfOutlays: z.number().optional().describe('020038 — proceeds of disposition less outlays and expenses, on the gifted property.'),
    capitalCost: z.number().optional().describe('020040 — the capital cost of the gifted property.'),
    carryforwardYearOfOrigin: z.string().optional().describe(
      '020090-100 — carryforward available, broken out by category. Charitable (092) and the ' +
        'gifts pool (062-078) are each ONE combined continuity on this schedule; these four ' +
        'report how much of the gifts pool’s closing balance belongs to each of the three ' +
        'federal source categories, plus the medicine-gift deduction (ITA s.110.1(1)(a.1)), ' +
        'which nothing else models. Filed only when 090 (year of origin) is present — leave ' +
        'all five blank to omit the whole block. Charitable (092) defaults to the charitable ' +
        'pool’s own closing balance when 090 is present but 092 is left blank; the other four ' +
        'have no default at all, since the engine tracks them as one combined figure.',
    ),
    carryforwardCharitable: z.number().optional().describe('020092 — blank = the charitable pool’s own closing balance.'),
    carryforwardToCanadaOrProvince: z.number().optional().describe('020094 — gifts to Canada, a province or territory. No default.'),
    carryforwardCulturalProperty: z.number().optional().describe('020096 — certified cultural property. No default.'),
    carryforwardEcologicalLand: z.number().optional().describe('020098 — ecologically sensitive land. No default.'),
    carryforwardMedicine: z.number().optional().describe('020100 — additional deduction for gifts of medicine. No default.'),
  })
  .meta({ id: 'AlbertaDonationsValues' });

/** AT1 Schedule 21, lines 151-169 — ONE prior vintage (1-20 years ago) of the non-capital loss pool. */
export const NonCapitalLossVintageRow = z
  .object({
    yearsAgo: z.number().optional().describe('1 = the immediately preceding taxation year, up to 20 (the expiry limit).'),
    taxYearEnd: z.string().optional(),
    balanceAtBeginning: z.number().optional(),
    adjustments: z.number().optional().describe('Signed — an addition or a reduction to this vintage.'),
    applied: z.number().optional().describe('Applied to reduce taxable income this year, from THIS vintage specifically.'),
  })
  .meta({ id: 'NonCapitalLossVintageRow' });

/** AT1 Schedule 21, lines 181-187 — one row per vintage year (0 = current, 1-20 = preceding). */
export const OtherLossVintageRow = z
  .object({
    yearIndex: z.number().optional(),
    farmLosses: z.number().optional(),
    restrictedFarmLosses: z.number().optional(),
    listedPersonalPropertyLosses: z
      .number()
      .optional()
      .describe('Refused (zeroed) beyond yearIndex 7 — listed personal property expires after 7 years, not 20.'),
  })
  .meta({ id: 'OtherLossVintageRow' });

/** AT1 Schedule 21, lines 131-141 — one row per limited partnership. */
export const LimitedPartnershipLossRow = z
  .object({
    identifier: z.string().optional(),
    precedingYearBalance: z.number().optional(),
    transferredOnWindUp: z.number().optional(),
    currentYearLoss: z.number().optional(),
    applied: z.number().optional().describe('Capped at precedingYearBalance + transferredOnWindUp; blank = nothing applied.'),
  })
  .meta({ id: 'LimitedPartnershipLossRow' });

/**
 * AT1 Schedule 21 — Alberta's own loss-pool CONTINUITY. Unlike the pools
 * Schedule 12 reconciles against federal figures, the OPENING balance here
 * can never be derived: it is Alberta's own carried-forward balance from a
 * PRIOR AT1 filing, and federal has no equivalent concept to default it
 * from. Blank is not the same as zero — a corporation's first AT1 filing
 * with real schedules genuinely has no history yet, and that has to be
 * stated, not assumed.
 *
 * Four of the five pools (non-capital, capital, farm, restricted farm)
 * reuse the federal return's CURRENT YEAR activity (loss created, applied,
 * expired) by default — only the opening balance is Alberta-only. The
 * current year's LOSS AMOUNT can still diverge from federal per pool and is
 * overridable: non-capital derives its Alberta figure automatically
 * (Schedule 12's reconciliation), farm/restricted farm take a direct
 * `{prefix}CurrentYearLoss` override since no federal input breaks losses
 * down by farm activity, and capital is confirmed by TRA's own Fall 2026
 * test-case text to always equal federal, so it has none. Listed personal
 * property has no federal equivalent at all, so its full continuity is
 * collected here.
 *
 * The four pools with a federal equivalent (non-capital, capital, farm,
 * restricted farm) each get the SAME five override/entry fields — applied
 * and expired default to federal's own figure when left blank (AT1 spec:
 * "if the Alberta amount differs from federal, enter it; otherwise the
 * value equals the federal amount"); wind-up transfer, the s.80 adjustment
 * and other adjustments have no federal equivalent to default from at all,
 * so they are plain entries (blank = nil, not "same as federal"). Written
 * out per-prefix here (`nonCapital`/`capital`/`farm`/`restrictedFarm` ×
 * `Applied`/`Expired`/`WindUpTransfer`/`Section80Adjustment`/
 * `OtherAdjustments`) — the source `_lib/return-input.ts` expresses this as
 * a template-literal mapped type; Zod has no equivalent generic, so this is
 * the 20 fields it expands to, spelled out.
 */
export const AlbertaContinuityValues = z
  .object({
    nonCapitalOpening: z.number().optional(),
    capitalOpening: z.number().optional(),
    farmOpening: z.number().optional(),
    farmCurrentYearLoss: z.number().optional().describe(
      'Blank = same as federal. Unlike non-capital (whose current-year loss is derived ' +
        'automatically from Schedule 12’s Alberta reconciliation), no federal input in this ' +
        'engine breaks losses down by farm/non-farm activity, so a genuine Alberta-federal ' +
        'divergence here can only be stated directly.',
    ),
    restrictedFarmOpening: z.number().optional(),
    restrictedFarmCurrentYearLoss: z.number().optional().describe('Blank = same as federal — see `farmCurrentYearLoss`.'),
    lppOpening: z.number().optional().describe('Listed personal property — no federal equivalent; the whole pool is Alberta-only.'),
    lppCurrentYearLoss: z.number().optional(),
    lppApplied: z.number().optional(),
    lppExpired: z.number().optional(),
    lppOtherAdjustments: z.number().optional(),
    limitedPartnerships: z
      .array(LimitedPartnershipLossRow)
      .optional()
      .describe('The sixth section of the live form — one row per partnership, not per jurisdiction.'),
    nonCapitalVintages: z
      .array(NonCapitalLossVintageRow)
      .optional()
      .describe(
        'The SEVENTH section — non-capital losses by year of origin. Row 0 (the current year) ' +
          'is fully derived server-side (must equal the schedule’s own current-year loss and ' +
          'total carried-back) — only PRIOR vintages (1-20 years ago) are entered here; that ' +
          'history cannot be derived.',
      ),
    otherLossVintages: z
      .array(OtherLossVintageRow)
      .optional()
      .describe('The EIGHTH section — farm/restricted-farm/LPP by year of origin, one row per vintage (0-20).'),
    capitalCarrybacks: z
      .array(z.object({ taxYearEnd: z.string().optional(), amount: z.number().optional() }))
      .optional()
      .describe(
        'Net-capital loss carry-back request (AT1 Schedule 10’s capital column, lines 042-048) ' +
          '— Alberta-only. Federal has no equivalent request (the engine has no federal ' +
          'net-capital-carryback input at all), so unlike the non-capital carry-back this ' +
          'cannot default from federal and must be entered here even when the amounts happen ' +
          'to match federal’s own current-year net-capital loss.',
      ),
    farmCarrybacks: z
      .array(z.object({ taxYearEnd: z.string().optional(), amount: z.number().optional() }))
      .optional()
      .describe(
        'Farm loss carry-back request (AT1 Schedule 10’s farm column, lines 012-020) — ' +
          'Alberta-only, same reasoning as `capitalCarrybacks`: federal has no farm loss ' +
          'carry-back input of its own to default from.',
      ),
    otherLossIncludesRestrictedFarm: YesNo.optional().describe(
      'The printed Schedule 10 has ONE shared "Other Losses" column for restricted farm and ' +
        'listed personal property loss — but, per TRA’s own Chapter 3 spec (not just the ' +
        'printed PDF), the two checkboxes are NOT mutually exclusive: check either or both. ' +
        'When both are checked, the shared column’s current-year-loss is the SUM of both pools’.',
    ),
    otherLossIncludesListedPersonal: YesNo.optional(),
    otherLossCarrybacks: z
      .array(z.object({ taxYearEnd: z.string().optional(), amount: z.number().optional() }))
      .optional()
      .describe('The carry-back request for whichever of the two loss types above is checked (combined, if both).'),

    nonCapitalApplied: z.number().optional(),
    nonCapitalExpired: z.number().optional(),
    nonCapitalWindUpTransfer: z.number().optional(),
    nonCapitalSection80Adjustment: z.number().optional(),
    nonCapitalOtherAdjustments: z.number().optional(),
    capitalApplied: z.number().optional(),
    capitalExpired: z.number().optional(),
    capitalWindUpTransfer: z.number().optional(),
    capitalSection80Adjustment: z.number().optional(),
    capitalOtherAdjustments: z.number().optional(),
    farmApplied: z.number().optional(),
    farmExpired: z.number().optional(),
    farmWindUpTransfer: z.number().optional(),
    farmSection80Adjustment: z.number().optional(),
    farmOtherAdjustments: z.number().optional(),
    restrictedFarmApplied: z.number().optional(),
    restrictedFarmExpired: z.number().optional(),
    restrictedFarmWindUpTransfer: z.number().optional(),
    restrictedFarmSection80Adjustment: z.number().optional(),
    restrictedFarmOtherAdjustments: z.number().optional(),
  })
  .meta({ id: 'AlbertaContinuityValues' });

/** One member of the group claiming the Innovation Employment Grant together. */
export const IegGroupMember = z
  .object({
    name: z.string().optional(),
    taxableCapital: z
      .number()
      .optional()
      .describe('Taxable capital employed in Canada, this member’s last taxation year ending in the prior calendar year.'),
    priorYear1: z.number().optional().describe('Eligible Alberta SR&ED expenditures, first preceding taxation year.'),
    priorYear2: z.number().optional().describe('Eligible Alberta SR&ED expenditures, second preceding taxation year.'),
  })
  .meta({ id: 'IegGroupMember' });

/**
 * One row of the formal Agreement Among Associated Corporations (Schedule
 * 29 page 3). Separate from `IegGroupMember` above: the group figures set
 * the BASE level of spending and the taxable-capital grind (informal, every
 * associated claim needs them); the Agreement is a filed document that
 * gates the ASSOCIATED enhanced-rate formula (line 125) instead of the
 * non-associated one (line 112) — a genuinely different credit calculation,
 * not a variant of the group figures.
 */
export const IegAgreementMember = z
  .object({
    name: z.string().optional(),
    albertaCan: z.string().optional().describe('Alberta Corporate Account Number.'),
    currentTaxationYearEnd: z.string().optional().describe('This member’s own current taxation year end, ISO YYYY-MM-DD.'),
    allocatedExpenditureLimit: z.number().optional().describe('This member’s own agreed share of the expenditure limit (line 240).'),
    currentYearExpenditures: z.number().optional().describe('This member’s own current-year eligible Alberta expenditures (line 245).'),
    priorYear1: z.number().optional().describe('This member’s own first-preceding-year Alberta expenditures (line 250).'),
    priorYear2: z.number().optional().describe('This member’s own second-preceding-year Alberta expenditures (line 260).'),
    taxableCapitalPriorYear: z.number().optional().describe('This member’s own taxable capital for the first preceding year (line 265).'),
    daysInTaxYear: z.number().optional().describe('Days in THIS member’s own current taxation year. Leave blank for a full (365-day) year.'),
    hasAlbertaPermanentEstablishment: YesNo.optional().describe(
      'Whether this member has a permanent establishment in Alberta. A member without one is ' +
        'not eligible for the IEG at all — line 268 is nil even when this member’s own figures ' +
        'would otherwise allow an amount — though its figures still count toward the group’s ' +
        'totals. Leave blank for a member other than yourself only when genuinely unknown; the ' +
        'return treats a blank answer as "no PE" (the direction that understates the grant, not ' +
        'overstates it) and flags it rather than assuming.',
    ),
  })
  .meta({ id: 'IegAgreementMember' });

/**
 * One project's Alberta SR&ED spending, for the AT4970 attachment (Listing
 * of Innovation Employment Grant Projects Carried Out in Alberta) — a
 * separate NetFile schedule from Schedule 29 itself, required whenever the
 * IEG is claimed. The TOTAL row across every project transcribes onto
 * Schedule 29 page 1's own eligible-expenditure lines automatically.
 */
export const IegProjectRow = z
  .object({
    title: z.string().optional().describe('Line 101 — same information as line 200 from Part 2 of federal T661.'),
    projectCode: z.string().optional().describe('Line 103 — project code (federal T661 line 206).'),
    albertaPortion: z.number().optional().describe('Line 105 — portion of the federal figure incurred in Alberta, this project, before IEG.'),
    otherPortion: z.number().optional().describe('Line 107 — portion NOT carried out in Alberta, this project.'),
    salariesAndWages: z.number().optional().describe('Line 109 — salaries and wages re SR&ED carried out in Alberta, this project.'),
    federalProxyAmount: z.number().optional().describe('Line 111 — federal prescribed proxy amount included in the Alberta portion, if claimed federally.'),
    albertaProxyAmount: z.number().optional().describe('Line 113 — Alberta proxy amount for this project, if line 111 applies.'),
  })
  .meta({ id: 'IegProjectRow' });

/** One row of AT4970's jurisdiction-breakdown table (135-161) — informational, entered directly. */
export const IegJurisdictionAmount = z
  .object({
    jurisdiction: z
      .enum([
        'alberta',
        'britishColumbia',
        'manitoba',
        'newBrunswick',
        'newfoundlandAndLabrador',
        'northwestTerritories',
        'novaScotia',
        'nunavut',
        'ontario',
        'princeEdwardIsland',
        'quebec',
        'saskatchewan',
        'yukon',
        'other',
      ])
      .optional(),
    amountIncurred: z.number().optional(),
  })
  .meta({ id: 'IegJurisdictionAmount' });

/**
 * AT1 Schedule 29 — the Innovation Employment Grant. Entirely Alberta-only:
 * federal tracks SR&ED spending Canada-wide, with no Alberta-specific
 * split, and the associated-group figures (taxable capital, prior-year
 * Alberta spending) have no federal source at all.
 *
 * "Eligible expenditures" (line 031) is DERIVED, not a number a preparer
 * types in directly — Schedule 29 page 1 builds it from the federal T661
 * figure below, adjusted by the AT4970 attachment's own totals (or by the
 * override fields here, when there is no project to list). This mirrors
 * the live form exactly; an earlier version of this return collected only
 * a bare `eligibleExpenditures` number with nothing to derive it from.
 */
export const AlbertaIegValues = z
  .object({
    federalAmount: z.number().optional().describe(
      'Line 003 — federal amount of qualified/current SR&ED expenditures. Federal T661 line ' +
        '559 for a taxation year ending on or before 2024-12-15; T661 line 557 (a DIFFERENT ' +
        'federal figure) for a taxation year ending on or after 2024-12-16.',
    ),
    albertaPortion: z.number().optional().describe(
      'Line 005 — portion of the federal amount carried out in Alberta. Leave blank when ' +
        '`projects` below has at least one row — it defaults to the AT4970 attachment’s own ' +
        'total. Set it here only to override that default, or when there are no projects to ' +
        'list individually.',
    ),
    federalProxyAmount: z.number().optional().describe('Line 007 — deduct: federal prescribed proxy amount. Defaults from `projects`’ total when omitted.'),
    albertaProxyAmount: z.number().optional().describe('Line 009 — add: Alberta proxy amount. Defaults from `projects`’ total when omitted.'),
    iegReducingFederalExpenditure: z.number().optional().describe(
      'Line 011 — add: IEG that reduced the federal expenditure IN THE TAXATION YEAR. Leave ' +
        'blank for a first-time current-year claim reported on the pre-deduction federal ' +
        'figures — the ordinary case.',
    ),
    repaymentOrContractPayment: z.number().optional().describe(
      'Line 025 — add: the Alberta portion of a repayment of government assistance (other ' +
        'than an IEG) or a contract payment, relating to amounts in `albertaPortion` from the ' +
        'current year or any preceding taxation year.',
    ),
    primaryFieldCode: z.enum(['1', '2', '3', '4']).optional().describe('Line 040 — primary field of science or technology.'),
    projects: z
      .array(IegProjectRow)
      .optional()
      .describe(
        'AT4970 — one row per Alberta SR&ED project. The TOTAL row across every project feeds ' +
          '`albertaPortion` / `federalProxyAmount` / `albertaProxyAmount` above automatically.',
      ),
    jurisdictions: z.array(IegJurisdictionAmount).optional().describe('AT4970’s jurisdiction-breakdown table — informational, entered directly.'),
    group: z.array(IegGroupMember).optional().describe(
      'Every member of the associated group, INCLUDING this corporation. Pass a single-member ' +
        'list even when there is no association — an empty list fails closed (no grant ' +
        'claimed) rather than assuming no grind and no base, which would overstate the grant ' +
        'on absent data.',
    ),
    allocatedLimit: z.number().optional().describe('This corporation’s agreed share of the group’s expenditure limit. Omit to take the whole limit.'),
    recapture: z.number().optional().describe('Recapture where IEG-funded property was sold or converted to commercial use in the year.'),
    agreementLongestYearCan: z.string().optional().describe(
      'Formal Agreement Among Associated Corporations (Schedule 29 page 3) — CAN of the ' +
        'member with the longest taxation year (line 200). Leave `agreementMembers` empty ' +
        'when the group has not filed one: the grant then uses the non-associated formula ' +
        '(line 112).',
    ),
    agreementLongestYearBegin: z.string().optional().describe('That member’s own tax year begin, ISO YYYY-MM-DD (line 202).'),
    agreementLongestYearEnd: z.string().optional().describe('That member’s own tax year end, ISO YYYY-MM-DD (line 204).'),
    agreementDaysInLongestYear: z.number().optional().describe('Days in that longest year — up to 366 (line 206). Leave blank for a full (365-day) year.'),
    agreementMembers: z.array(IegAgreementMember).optional().describe(
      'The Agreement’s member table. Put the claiming corporation FIRST — its own allocated ' +
        'allowed amount (line 268) becomes line 325, which is what actually switches the ' +
        'grant to the associated formula.',
    ),
  })
  .meta({ id: 'AlbertaIegValues' });

// ── AT1 Schedule 3 — Alberta Other Tax Deductions and Credits (TRA §3.2.3.4) ──

export const AlbertaOtherCredits3Values = z
  .object({
    taxPayableBeforeDeduction: z.number().optional().describe('AT1 page 2, line 068 — Alberta tax payable before this deduction.'),
    line070: z.number().optional().describe('AT1 page 2, line 070.'),
    line071: z.number().optional().describe('AT1 page 2, line 071.'),
    line072: z.number().optional().describe('AT1 page 2, line 072.'),
    line074: z.number().optional().describe('AT1 page 2, line 074.'),
    itcCertificatesIssued: z.number().optional().describe('003100 — total shown on all Investor Tax Credit certificates issued during the year.'),
    itcCarryforwardFromPriorYear: z.number().optional().describe('003102 — total Investor Tax Credit carried forward from prior year(s).'),
    itcExpired: z.number().optional().describe('003106 — total Investor Tax Credit expired during the year.'),
    itcAmountApplied: z.number().optional().describe('003104 — amount applied to the current taxation year. Blank = claim the maximum both the pool and the shared room allow.'),
    citcCertificatesIssued: z.number().optional().describe('003200 — total shown on all Capital Investment Tax Credit certificates issued during the year.'),
    citcCarryforwardFromPriorYear: z.number().optional().describe('003202 — total Capital Investment Tax Credit carried forward from prior year(s).'),
    citcExpired: z.number().optional().describe('003206 — total Capital Investment Tax Credit expired during the year.'),
    citcAmountApplied: z.number().optional().describe(
      '003204 — amount applied to the current taxation year. Forced to nil while the Investor ' +
        'Tax Credit above still carries an unused carryforward balance — CITC cannot be ' +
        'claimed until ITC is fully drawn down.',
    ),
    apitcCurrentReceived: z.number().optional().describe('003334 occurrence 0 / 003300 — total on Agri-Processing Investment Tax Credit certificates issued this year.'),
    apitcCurrentApplied: z.number().optional().describe('003336 occurrence 0 / 003304 — applied from the current year’s receipt. Capped at 20%.'),
    apitcFirstAvailable: z.number().optional().describe('003335 occurrence 1 — 1st preceding year’s balance available at the start of this year.'),
    apitcFirstApplied: z.number().optional().describe('003336 occurrence 1 / 003306 — applied from the 1st preceding year. Capped at 30%.'),
    apitcSecondAvailable: z.number().optional().describe('003335 occurrence 2 — 2nd preceding year’s balance available at the start of this year.'),
    apitcSecondApplied: z.number().optional().describe('003336 occurrence 2 / 003308 — applied from the 2nd preceding year. Capped at 50%.'),
    apitcThirdToTenthAvailable: z.number().optional().describe('Sum of 003335 across occurrences 3-10 — the 3rd-10th preceding years, combined.'),
    apitcThirdToTenthApplied: z.number().optional().describe('003310 — applied from the 3rd-10th preceding years, combined. No percentage cap.'),
    apitcExpired: z.number().optional().describe('003314 — total Agri-Processing Investment Tax Credit expired during the year (= 003338 occurrence 10).'),
  })
  .meta({ id: 'AlbertaOtherCredits3Values' });

// ── AT1 Schedule 4 — Alberta Foreign Investment Income Tax Credit (TRA §3.2.3.5) ──

export const ForeignInvestmentCountry4Row = z
  .object({
    country: z.string().optional().describe('004002 — two-character country code. Must equal the matching occurrence of federal Schedule 21.'),
    netForeignInvestmentIncome: z.number().optional().describe('004004 — net foreign investment income. Must equal federal Schedule 21’s matching occurrence.'),
    fedForeignTaxPaid: z.number().optional().describe(
      'Federal Schedule 21, line 120 — foreign investment income tax paid, gross (before any ' +
        '20(12)/8(2.2) deduction). NOT itself an AT1 line: the engine nets this against the ' +
        'deduction below to compute AT1 line 006.',
    ),
    fedIta2012Deduction: z.number().optional().describe(
      'Federal Schedule 21, line 130 — the ITA subsection 20(12) deduction claimed federally ' +
        'for this occurrence. NOT itself an AT1 line — see `fedForeignTaxPaid`.',
    ),
    albertaActa82Deduction: z.number().optional().describe(
      'The Alberta ACTA 8(2.2) deduction, ONLY where it was computed differently than the ' +
        'federal ITA 20(12) figure above. Leave blank when the two agree. NOT itself an AT1 line.',
    ),
    fedNonBusinessForeignTaxCredit: z.number().optional().describe('004008 — federal non-business foreign tax credit. Must equal federal Schedule 21’s matching occurrence.'),
  })
  .meta({ id: 'ForeignInvestmentCountry4Row' });

export const AlbertaForeignInvestment4Values = z
  .object({
    countries: z.array(ForeignInvestmentCountry4Row).optional().describe('One FIC occurrence per country, in the same order as the federal form.'),
  })
  .meta({ id: 'AlbertaForeignInvestment4Values' });

// ── AT1 Schedule 5 — Alberta Royalty Tax Deduction (TRA §3.2.3.6) ──

export const PredecessorTransferRow = z
  .object({
    predecessorName: z.string().optional(),
    albertaCorporateAccountNumber: z.string().optional(),
    dateOfEvent: z.string().optional(),
    amountTransferred: z.number().optional(),
  })
  .meta({ id: 'PredecessorTransferRow' });

export const SuccessoredPoolRow = z
  .object({
    vendorName: z.string().optional(),
    dateOfEvent: z.string().optional(),
    poolBroughtForward: z.number().optional().describe('Mutually exclusive with `acquisitionAmount` for the same occurrence.'),
    acquisitionAmount: z.number().optional().describe('Mutually exclusive with `poolBroughtForward` for the same occurrence.'),
    propertyIncome: z.number().optional(),
  })
  .meta({ id: 'SuccessoredPoolRow' });

export const AlbertaRoyaltyDeduction5Values = z
  .object({
    crownChargesFromSchedule7: z.number().optional().describe(
      '005001 — Crown charges under s.20(6)(a)-(e). AT1 Schedule 7, line 061 — a separate ' +
        'schedule wired under its own key; enter its finished figure here. Floored at zero by ' +
        'the engine if entered negative.',
    ),
    resourceAllowanceFromSchedule12OrFederal: z.number().optional().describe(
      '005005 — resource allowance claimed under s.20(6)(g). AT1 Schedule 12, line 024, or ' +
        'federal Schedule 1, line 346 when Schedule 12 does not apply.',
    ),
    reimbursementsForCrownCharges: z.number().optional().describe(
      '005007 — reimbursements received under a contract in respect of Crown charges, under ' +
        's.20(6)(f). Excludes ARTC and other government rebates or credits.',
    ),
    openingUnsuccessoredPoolBalance: z.number().optional().describe('005043 — corporation’s own unsuccessored pool carried forward from the preceding year (normally last year’s line 017).'),
    predecessorTransfers: z.array(PredecessorTransferRow).optional().describe(
      '005031-005037 — predecessor transfers into the unsuccessored pool (amalgamation under ' +
        's.20(10), or wind-up of a wholly-owned subsidiary under s.20(11)).',
    ),
    crtdAmountClaimed: z.number().optional().describe('005016 — the CRTD claim actually made against the unsuccessored pool. Blank = claim the maximum the pool and Alberta taxable income both allow.'),
    transferredOnDisposal: z.number().optional().describe('005023 — Attributed Royalty Income transferred to another corporation during the year on disposal of substantially all Canadian resource properties.'),
    hasSuccessoredPools: z.enum(['yes', 'no']).optional().describe('005200 — does the corporation have any successored pools to report?'),
    secondSuccessoredPools: z.array(SuccessoredPoolRow).optional().describe('SSPI, 005101-005115 — second successored pool occurrences, oldest date of event first. Only used when `hasSuccessoredPools` is "yes".'),
    firstSuccessoredPools: z.array(SuccessoredPoolRow).optional().describe('FSPI, 005121-005135 — first successored pool occurrences, oldest date of event first. Only used when `hasSuccessoredPools` is "yes".'),
    poolTransfer: z
      .object({
        type: z.enum(['1', '2', '3']).optional().describe('005026 — 1: disposition of all/substantially all CRP (s.20(8)); 2: change in control / ceasing s.20(14) exemption; 3: no transfer.'),
        acquirerName: z.string().optional().describe('005027 — legal name of the acquiring corporation. Required when type is 1 or 2; leave blank when 3.'),
      })
      .optional()
      .describe('005026/005027 — whether the resource pools were transferred during the year.'),
    changeInControlEndedPrecedingYear: z.enum(['yes', 'no']).optional().describe('005100 — was there a change in control that created the immediately preceding taxation year end?'),
    albertaTaxableIncomeBeforeDeduction: z.number().optional().describe('AT1 core line 062 — Alberta Taxable Income (Loss) before this deduction. Caps both line 016 and the combined line 064 total.'),
  })
  .meta({ id: 'AlbertaRoyaltyDeduction5Values' });

// ── AT1 Schedule 6 — Alberta Royalty Tax Credit (TRA §3.2.3.7) ──

export const RoyaltyCredit6ShelterAllocationRow = z
  .object({
    name: z.string().optional(),
    albertaCan: z.string().optional(),
    allocatedAmount: z.number().optional(),
  })
  .meta({ id: 'RoyaltyCredit6ShelterAllocationRow' });

/** 006008 — one row per calendar quarter the taxation year spans. */
export const RoyaltyCredit6QuarterRow = z
  .object({
    days: z.number().optional(),
    rate: z.number().optional(),
  })
  .meta({ id: 'RoyaltyCredit6QuarterRow' });

export const AlbertaRoyaltyCredit6Values = z
  .object({
    associatedWithCrownRoyaltyCorporations: z.enum(['yes', 'no']).optional().describe(
      '006002 — "yes" | "no", matching the AT1 jacket’s own YES_NO radio convention (default reads as No).',
    ),
    albertaCrownRoyaltyIncurred: z.number().optional().describe(
      '006004 — per the spec, `007003 + Σ007077 − Σ007087 + Σ007089` (every term lives on ' +
        'Schedule 7). True cross-schedule wiring is a follow-up; enter the figure here ' +
        'directly for now, matching what Schedule 7 computes.',
    ),
    taxationYearDays: z.number().optional().describe('Days in THIS corporation’s own taxation year — used only when NOT associated. Blank = a full 365-day year.'),
    longestAssociatedYearCan: z.string().optional().describe('ACRS (006022-006028) — required only when associated.'),
    longestAssociatedYearBeginning: z.string().optional(),
    longestAssociatedYearEnding: z.string().optional(),
    longestAssociatedYearDays: z.number().optional().describe('Blank = a full 365-day year.'),
    allocations: z.array(RoyaltyCredit6ShelterAllocationRow).optional().describe('AACRS (006030-006034) — required only when associated. Sort so the FIRST row is this filing corporation.'),
    quarters: z.array(RoyaltyCredit6QuarterRow).optional().describe('006008 — one row per calendar quarter the taxation year spans.'),
  })
  .meta({ id: 'AlbertaRoyaltyCredit6Values' });

// ── AT1 Schedule 7 — Royalty Tax Credit/Deduction Supplemental Information (TRA §3.2.3.8) ──

export const RoyaltySupplemental7PartnershipRow = z
  .object({
    name: z.string().optional(),
    interestPercent: z.number().optional().describe('007073 — decimal, e.g. .7500 for 75%, to 4 places.'),
    fiscalPeriodEnd: z.string().optional(),
    shareEligibleForCredit: z.number().optional(),
    shareOtherRoyaltiesNotEligible: z.number().optional(),
    shareOtherCrownChargesEligibleForDeduction: z.number().optional().describe('007081 — feeds Schedule 5’s own 005001 formula; collected here as disclosure, not consumed by this schedule.'),
  })
  .meta({ id: 'RoyaltySupplemental7PartnershipRow' });

/** ACRA (007083-007091) — one row per prior-year Alberta Crown Royalty adjustment reported this year. */
export const RoyaltySupplemental7PriorYearAdjustmentRow = z
  .object({
    priorProductionPeriodEnd: z.string().optional(),
    sourceOfAdjustment: z.enum(['1', '2']).optional().describe('007085 — "1" | "2", matching SOURCE_OF_ADJUSTMENT_OPTIONS.'),
    increase: z.number().optional().describe('007087 — positive magnitude of the increase.'),
    decrease: z.number().optional().describe('007089 — positive magnitude of the decrease.'),
    adjustmentNotEligibleForCredit: z.number().optional().describe('007091 — signed.'),
  })
  .meta({ id: 'RoyaltySupplemental7PriorYearAdjustmentRow' });

export const AlbertaRoyaltySupplemental7Values = z
  .object({
    eligibleCrownRoyalty: z.number().optional().describe('007003 — from the income statement (fed form 125).'),
    otherRoyaltiesNotEligible: z.number().optional().describe('007005.'),
    royaltyPaidToOtherJurisdictions: z.number().optional().describe('007007.'),
    nonDeductibleCrownLeaseRentals: z.number().optional().describe('007009.'),
    mineralTaxes: z.number().optional().describe('007011.'),
    saskatchewanResourcesSurcharge: z.number().optional().describe('007013.'),
    otherNonDeductibleCrownChargeType1: z.string().optional().describe('007014 / 007015 / 007016 — up to three named "other" crown-charge types.'),
    otherNonDeductibleCrownChargeType2: z.string().optional(),
    otherNonDeductibleCrownChargeType3: z.string().optional(),
    otherNonDeductibleCrownCharges: z.number().optional().describe('007017 — total for the named type(s) above. Blank/zero when none are named.'),
    crownLeaseRentalsCapitalized: z.number().optional().describe('007025 — from the balance sheet (fed form 100).'),
    otherBalanceSheetDeductionName: z.string().optional().describe('007027.'),
    otherBalanceSheetDeduction: z.number().optional().describe('007029 — amount for the deduction named above. Blank/zero when no name is given.'),
    partnerships: z.array(RoyaltySupplemental7PartnershipRow).optional(),
    priorYearAdjustments: z.array(RoyaltySupplemental7PriorYearAdjustmentRow).optional(),
  })
  .meta({ id: 'AlbertaRoyaltySupplemental7Values' });

// ── AT1 Schedule 8 — Alberta Political Contributions Tax Credit (TRA §3.2.3.9) ──

export const PoliticalContribution8Row = z
  .object({
    name: z.string().optional().describe('008002 — name of the party, constituency association or candidate.'),
    receiptNumber: z.string().optional().describe('008004 — official receipt number.'),
    dateOfDonation: z.string().optional().describe('008006 — date of the official receipt. The spec requires one for every receipted contribution.'),
    amount: z.number().optional().describe('008008 — donation amount.'),
  })
  .meta({ id: 'PoliticalContribution8Row' });

export const AlbertaPoliticalContributions8Values = z
  .object({
    contributions: z.array(PoliticalContribution8Row).optional().describe('One PCD occurrence per receipted contribution.'),
    partnershipContributionsTo2003: z.number().optional().describe('008012 — Alberta political contributions from a partnership made in 2003 or earlier (federal T5013 box 37).'),
    partnershipContributionsFrom2004: z.number().optional().describe('008013 — Alberta political contributions from a partnership made in 2004 or later (federal T5013).'),
    taxYearBegin: z.string().optional().describe(
      'This corporation’s OWN tax year begin/end dates. NOT an AT1 line — needed only to ' +
        'confirm the rare 2003/2004 straddling-tax-year credit formula applies. Leave both ' +
        'blank unless contributions were made in BOTH 2003-or-earlier and 2004-or-later AND ' +
        'this corporation’s own tax year began in 2003 and ended in 2004.',
    ),
    taxYearEnd: z.string().optional(),
  })
  .meta({ id: 'AlbertaPoliticalContributions8Values' });

// ── AT1 Schedule 9 — Alberta SR&ED Tax Credit (TRA §3.2.3.10) ──

export const AlbertaSredCredit9GroupMember = z
  .object({
    name: z.string().optional().describe('Line 009220 — name of the associated corporation.'),
    albertaCan: z.string().optional().describe('Line 009230 — Alberta Corporate Account Number.'),
    allocated: z.number().optional().describe('Line 009240 — this member’s agreed share of the expenditure limit.'),
  })
  .meta({ id: 'AlbertaSredCredit9GroupMember' });

export const AlbertaSredCredit9Values = z
  .object({
    federalQualifiedExpenditures: z.number().optional().describe('Line 009003 — federal total qualified SR&ED expenditures. Must equal fed T661 line 559.'),
    albertaPortionOfExpenditures: z.number().optional().describe('Line 009005 — the portion of 003 incurred in Alberta, BEFORE 2020-01-01. Must not exceed 003.'),
    federalProxyAmountInAlbertaPortion: z.number().optional().describe('Line 009007 — deduct: federal prescribed proxy amount included in the Alberta portion.'),
    albertaProxyAmount: z.number().optional().describe('Line 009009 — add: Alberta proxy amount.'),
    albertaCreditReducingFederalExpense: z.number().optional().describe(
      'Line 009011 — add: Alberta SR&ED credit that reduced the federal expense on fed T661 ' +
        'line 559 in the taxation year. The spec defers this calculation to the Guide to ' +
        'Claiming the Alberta SR&ED Tax Credit.',
    ),
    priorYearFederalItcReceived: z.number().optional().describe('Line 009015 — federal ITC received in the immediately preceding year (fed T661 line 435).'),
    totalAlbertaExpendituresAllYears: z.number().optional().describe('Line 009017 — total Alberta-eligible expenditures for years in which incurred, all relevant years.'),
    totalFederalExpendituresAllYears: z.number().optional().describe('Line 009019 — total federal expenditures for those same years (fed T661 line 570, all years).'),
    albertaPortionOfRepayments: z.number().optional().describe('Line 009025 — add: Alberta portion of any repayment of assistance relating to line 005.'),
    eligibleExpenditures: z.number().optional().describe(
      'Lines 009031 / 009106 — "Eligible expenditures for Alberta purposes." Leave blank to ' +
        'use the engine’s derived figure; set directly to override it with the authoritative amount.',
    ),
    fieldOfScience: z.enum(['1', '2', '3', '4']).optional().describe('Line 009040 — primary field of science or technology. Mandatory on the live form.'),
    isAssociated: z.enum(['yes', 'no']).optional().describe('Line 009100 — associated with one or more corporations for SR&ED purposes?'),
    allocatedExpenditureLimit: z.number().optional().describe(
      'Line 009102 — this corporation’s allocated share of the maximum expenditure limit, ' +
        'used ONLY when `group` below is empty. When `group` has at least one row, the filing ' +
        'corporation’s (row 1) capped share is used instead and this field is ignored.',
    ),
    daysInTaxYear: z.number().optional().describe(
      'Days in the corporation’s own taxation year, for the NON-associated line 009104 ' +
        'proration. Leave blank for a full, 365-day year. Days before 2009-01-01 (when the ' +
        'Alberta SR&ED program began) must already be excluded.',
    ),
    disposalRecapture: z.number().optional().describe('Line 009112 — recapture on disposal (or deemed disposal) of Alberta SR&ED property.'),
    priorYearFederalItcAdjustment: z.number().optional().describe(
      'Line 009116 — legacy adjustment from the Schedule 9 Supplemental line 428, applicable ' +
        'ONLY when the taxation year end is on or before 2012-03-31. Expected nil for a ' +
        'current return.',
    ),
    taxationYearEnd: z.string().optional().describe(
      'The return’s taxation year end, ISO YYYY-MM-DD — used only to flag a reminder when it ' +
        'falls after the 2019-12-31 wind-down date. NOT itself an AT1 Schedule 9 line item.',
    ),
    longestYearCan: z.string().optional().describe('200 — the Alberta CAN of the associated corporation with the longest taxation year. Used only when `group` has at least one row.'),
    longestYearBegin: z.string().optional().describe('202 — that corporation’s own tax year begin.'),
    longestYearEnd: z.string().optional().describe('204 — that corporation’s own tax year end.'),
    daysInLongestYear: z.number().optional().describe(
      'Days in the LONGEST associated taxation year (line 206), for the page-3 allocation’s ' +
        'shared $4,000,000 ceiling. Leave blank for a full, 365-day year. Used only when ' +
        '`group` has at least one row.',
    ),
    group: z.array(AlbertaSredCredit9GroupMember).optional().describe(
      'The associated-group allocation table (page 3, lines 220/230/240). Include this ' +
        'corporation as the FIRST row — its own allocated amount becomes line 009102. Leave ' +
        'empty for a non-associated claim.',
    ),
  })
  .meta({ id: 'AlbertaSredCredit9Values' });

// ── AT1 Schedule 15 — Alberta Resource Related Deductions (TRA §3.2.3.16) ──
//
// Every regular/successor pool side is its own top-level key on
// `albertaResourceDeductions15` (not nested `eda: { regular, successor }`).
// A reconciled figure is TWO parallel fields, `federal<Name>` / `alberta<Name>`
// (blank Alberta = same as federal) — the same convention `cca.ts` uses
// (`openingUCC` / `albertaOpeningUCC`). A field the spec marks "must equal
// federal" (no Alberta override permitted) only gets the `federal<Name>` half.
// `claimed` is the one discretionary claim figure per block.

export const EdaRegularRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalSaleTransfer: z.number().optional(),
    albertaSaleTransfer: z.number().optional(),
    federalRegulation1201Claim: z.number().optional().describe('015007 — the claim itself, reconciled the same way as every other EDA figure.'),
    albertaRegulation1201Claim: z.number().optional(),
  })
  .meta({ id: 'EdaRegularRow' });

export const EdaSuccessorRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalSaleTransfer: z.number().optional(),
    albertaSaleTransfer: z.number().optional(),
    federalRegulation1202Claim: z.number().optional().describe('015019'),
    albertaRegulation1202Claim: z.number().optional(),
  })
  .meta({ id: 'EdaSuccessorRow' });

export const CmedbRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalDisposalTransfer: z.number().optional(),
    albertaDisposalTransfer: z.number().optional(),
    claimed: z.number().optional().describe('015031 — no federal default line exists for this one; blank = claim the maximum pool balance.'),
  })
  .meta({ id: 'CmedbRow' });

export const CeeRegularRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalCurrentYearExpenses: z.number().optional(),
    federalLookBackExpenses: z.number().optional(),
    federalReclassifiedFromCde: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalRenewableConservationExpenses: z.number().optional(),
    federalOtherAdditions: z.number().optional(),
    albertaOtherAdditions: z.number().optional(),
    federalGovernmentAssistance: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalRenouncedFlowThrough: z.number().optional(),
    federalTransferredToSuccessor: z.number().optional(),
    albertaTransferredToSuccessor: z.number().optional(),
    federalRenouncedLookBack: z.number().optional(),
    claimed: z.number().optional().describe('015061 — 100% claimable to the pool, no percentage rate.'),
  })
  .meta({ id: 'CeeRegularRow' });

export const CeeSuccessorRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalReclassifiedFromCde: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalTransferredToSuccessor: z.number().optional(),
    albertaTransferredToSuccessor: z.number().optional(),
    claimed: z.number().optional().describe('015081'),
  })
  .meta({ id: 'CeeSuccessorRow' });

export const CdeRegularRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalCurrentYearExpenses: z.number().optional(),
    federalLookBackExpenses: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherAdditions: z.number().optional(),
    albertaOtherAdditions: z.number().optional(),
    federalReclassifiedFromCee: z.number().optional(),
    federalGovernmentAssistance: z.number().optional(),
    federalReceivableOnDisposition: z.number().optional(),
    albertaReceivableOnDisposition: z.number().optional(),
    federalCreditBalanceInCogpePool: z.number().optional().describe('015105 — auto-derives from a negative CCOGPE-regular pool; see field description.'),
    albertaCreditBalanceInCogpePool: z.number().optional(),
    federalOtherDeductions: z.number().optional().describe('015107 — the spec’s own text references an undefined "015139"; see field description.'),
    albertaOtherDeductions: z.number().optional(),
    federalRenouncedFlowThrough: z.number().optional(),
    federalTransferredToSuccessor: z.number().optional(),
    albertaTransferredToSuccessor: z.number().optional(),
    federalRenouncedLookBack: z.number().optional(),
    claimed: z.number().optional().describe('015115 — capped at 30% of the pool (prorated for a short tax year).'),
  })
  .meta({ id: 'CdeRegularRow' });

export const CdeSuccessorRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalReclassifiedFromCee: z.number().optional(),
    federalCreditBalanceInCogpePool: z.number().optional().describe('015133 — no federal default line; ambiguous "may not exceed" wording, see field description.'),
    albertaCreditBalanceInCogpePool: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalTransferredToSuccessor: z.number().optional(),
    albertaTransferredToSuccessor: z.number().optional(),
    claimed: z.number().optional().describe('015141'),
  })
  .meta({ id: 'CdeSuccessorRow' });

export const CcogpeRegularRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalCurrentYearExpenses: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherAdditions: z.number().optional(),
    albertaOtherAdditions: z.number().optional(),
    federalReceivableOnDisposition: z.number().optional(),
    albertaReceivableOnDisposition: z.number().optional(),
    federalGovernmentAssistance: z.number().optional(),
    federalTransferredToSuccessor: z.number().optional(),
    albertaTransferredToSuccessor: z.number().optional(),
    federalOtherDeductions: z.number().optional().describe('015167 — a negative pool total here may need to be routed to CDE per the 66.7(4)(a)(iii) designation; see field description.'),
    albertaOtherDeductions: z.number().optional(),
    claimed: z.number().optional().describe('015169 — capped at 10% of the pool (prorated for a short tax year).'),
  })
  .meta({ id: 'CcogpeRegularRow' });

export const CcogpeSuccessorRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalReceivableOnDisposition: z.number().optional(),
    albertaReceivableOnDisposition: z.number().optional(),
    federalTransferredToSuccessor: z.number().optional(),
    albertaTransferredToSuccessor: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    claimed: z.number().optional().describe('015189'),
  })
  .meta({ id: 'CcogpeSuccessorRow' });

export const FedeRegularRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalForeignResourceIncome: z.number().optional(),
    claimed: z.number().optional().describe('015209 — lesser of the pool and the greater of a 10% floor or foreign resource income.'),
  })
  .meta({ id: 'FedeRegularRow' });

export const FedeSuccessorRow = z
  .object({
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalForeignResourceIncome: z.number().optional(),
    claimed: z.number().optional().describe('015221 — no percentage rate; capped only by the pool and foreign resource income.'),
  })
  .meta({ id: 'FedeSuccessorRow' });

export const SfedeCountryRegularRow = z
  .object({
    countryCode: z.string().optional().describe('015241 — 2-letter country code (Chapter 1, Appendix 1-5).'),
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherAdditions: z.number().optional(),
    albertaOtherAdditions: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalForeignResourceIncome: z.number().optional(),
    claimed: z.number().optional().describe('015253'),
  })
  .meta({ id: 'SfedeCountryRegularRow' });

export const SfedeCountrySuccessorRow = z
  .object({
    countryCode: z.string().optional(),
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalForeignResourceIncome: z.number().optional(),
    claimed: z.number().optional().describe('015273 — no percentage rate.'),
  })
  .meta({ id: 'SfedeCountrySuccessorRow' });

export const CfreCountryRegularRow = z
  .object({
    countryCode: z.string().optional(),
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalCurrentYearExpenses: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherAdditions: z.number().optional(),
    albertaOtherAdditions: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalForeignResourceIncome: z.number().optional(),
    claimed: z.number().optional().describe('015293 = A + B; B needs `globalForeignResourceLimit` below or it is treated as nil.'),
    globalForeignResourceLimit: z.number().optional().describe('No line number — undefined anywhere in the spec text this engine was built from; see field description.'),
  })
  .meta({ id: 'CfreCountryRegularRow' });

export const CfreCountrySuccessorRow = z
  .object({
    countryCode: z.string().optional(),
    federalOpeningBalance: z.number().optional(),
    albertaOpeningBalance: z.number().optional(),
    federalAmalgamationTransfer: z.number().optional(),
    albertaAmalgamationTransfer: z.number().optional(),
    federalOtherTransfer: z.number().optional(),
    albertaOtherTransfer: z.number().optional(),
    federalOtherDeductions: z.number().optional(),
    albertaOtherDeductions: z.number().optional(),
    federalForeignResourceIncome: z.number().optional(),
    claimed: z.number().optional().describe('015313 — capped at 30%-prorated pool OR the sum of every country’s foreign resource income.'),
  })
  .meta({ id: 'CfreCountrySuccessorRow' });

export const AlbertaResourceDeductions15Values = z
  .object({
    daysInTaxYear: z.number().optional().describe(
      'Days in the tax year — feeds every claim cap the spec prorates for a short year ' +
        '(CDE/CCOGPE/FEDE regular/SFEDE regular/CFRE). Blank = 365. The 000060/000061 ' +
        'divergence-gate flags are NOT collected here — they are jacket-level fields shared ' +
        'by every reconciliation-gated schedule (13/17/18/15), collected once on the AT1 ' +
        'jacket form and read from `ri.alberta` by the composer.',
    ),
    edaRegular: EdaRegularRow.optional().describe('EDA — Continuity of Earned Depletion Base (line 001-021, grandfathered).'),
    edaSuccessor: EdaSuccessorRow.optional(),
    cmedb: CmedbRow.optional().describe('CMEDB — Continuity of Mining Exploration Depletion Base (line 023-033). No successor side.'),
    ceeRegular: CeeRegularRow.optional().describe('CEE — Cumulative Canadian Exploration Expenses (line 041-083).'),
    ceeSuccessor: CeeSuccessorRow.optional(),
    cdeRegular: CdeRegularRow.optional().describe('CDE — Cumulative Canadian Development Expenses (line 091-143).'),
    cdeSuccessor: CdeSuccessorRow.optional(),
    ccogpeRegular: CcogpeRegularRow.optional().describe('CCOGPE — Cumulative Canadian Oil and Gas Property Expenses (line 151-191).'),
    ccogpeSuccessor: CcogpeSuccessorRow.optional(),
    fedeRegular: FedeRegularRow.optional().describe('FEDE — Foreign Exploration and Development Expenses (line 201-233).'),
    fedeSuccessor: FedeSuccessorRow.optional(),
    sfedeRegular: z.array(SfedeCountryRegularRow).optional().describe('SFEDE — Specified Foreign Exploration and Development Expenses, PER COUNTRY (line 241-277).'),
    sfedeSuccessor: z.array(SfedeCountrySuccessorRow).optional(),
    cfreRegular: z.array(CfreCountryRegularRow).optional().describe('CFRE — Cumulative Foreign Resource Expenses, PER COUNTRY (line 281-317).'),
    cfreSuccessor: z.array(CfreCountrySuccessorRow).optional(),
  })
  .meta({ id: 'AlbertaResourceDeductions15Values' });

// A same-named TS type per exported schema — see common.ts's own comment on this pattern.
export type AlbertaValues = z.infer<typeof AlbertaValues>;
export type AlbertaAssociatedCorpMember = z.infer<typeof AlbertaAssociatedCorpMember>;
export type AlbertaSbdValues = z.infer<typeof AlbertaSbdValues>;
export type AlbertaDonationsValues = z.infer<typeof AlbertaDonationsValues>;
export type NonCapitalLossVintageRow = z.infer<typeof NonCapitalLossVintageRow>;
export type OtherLossVintageRow = z.infer<typeof OtherLossVintageRow>;
export type LimitedPartnershipLossRow = z.infer<typeof LimitedPartnershipLossRow>;
export type AlbertaContinuityValues = z.infer<typeof AlbertaContinuityValues>;
export type IegGroupMember = z.infer<typeof IegGroupMember>;
export type IegAgreementMember = z.infer<typeof IegAgreementMember>;
export type IegProjectRow = z.infer<typeof IegProjectRow>;
export type IegJurisdictionAmount = z.infer<typeof IegJurisdictionAmount>;
export type AlbertaIegValues = z.infer<typeof AlbertaIegValues>;
export type AlbertaOtherCredits3Values = z.infer<typeof AlbertaOtherCredits3Values>;
export type ForeignInvestmentCountry4Row = z.infer<typeof ForeignInvestmentCountry4Row>;
export type AlbertaForeignInvestment4Values = z.infer<typeof AlbertaForeignInvestment4Values>;
export type PredecessorTransferRow = z.infer<typeof PredecessorTransferRow>;
export type SuccessoredPoolRow = z.infer<typeof SuccessoredPoolRow>;
export type AlbertaRoyaltyDeduction5Values = z.infer<typeof AlbertaRoyaltyDeduction5Values>;
export type RoyaltyCredit6ShelterAllocationRow = z.infer<typeof RoyaltyCredit6ShelterAllocationRow>;
export type RoyaltyCredit6QuarterRow = z.infer<typeof RoyaltyCredit6QuarterRow>;
export type AlbertaRoyaltyCredit6Values = z.infer<typeof AlbertaRoyaltyCredit6Values>;
export type RoyaltySupplemental7PartnershipRow = z.infer<typeof RoyaltySupplemental7PartnershipRow>;
export type RoyaltySupplemental7PriorYearAdjustmentRow = z.infer<
  typeof RoyaltySupplemental7PriorYearAdjustmentRow
>;
export type AlbertaRoyaltySupplemental7Values = z.infer<typeof AlbertaRoyaltySupplemental7Values>;
export type PoliticalContribution8Row = z.infer<typeof PoliticalContribution8Row>;
export type AlbertaPoliticalContributions8Values = z.infer<typeof AlbertaPoliticalContributions8Values>;
export type AlbertaSredCredit9GroupMember = z.infer<typeof AlbertaSredCredit9GroupMember>;
export type AlbertaSredCredit9Values = z.infer<typeof AlbertaSredCredit9Values>;
export type EdaRegularRow = z.infer<typeof EdaRegularRow>;
export type EdaSuccessorRow = z.infer<typeof EdaSuccessorRow>;
export type CmedbRow = z.infer<typeof CmedbRow>;
export type CeeRegularRow = z.infer<typeof CeeRegularRow>;
export type CeeSuccessorRow = z.infer<typeof CeeSuccessorRow>;
export type CdeRegularRow = z.infer<typeof CdeRegularRow>;
export type CdeSuccessorRow = z.infer<typeof CdeSuccessorRow>;
export type CcogpeRegularRow = z.infer<typeof CcogpeRegularRow>;
export type CcogpeSuccessorRow = z.infer<typeof CcogpeSuccessorRow>;
export type FedeRegularRow = z.infer<typeof FedeRegularRow>;
export type FedeSuccessorRow = z.infer<typeof FedeSuccessorRow>;
export type SfedeCountryRegularRow = z.infer<typeof SfedeCountryRegularRow>;
export type SfedeCountrySuccessorRow = z.infer<typeof SfedeCountrySuccessorRow>;
export type CfreCountryRegularRow = z.infer<typeof CfreCountryRegularRow>;
export type CfreCountrySuccessorRow = z.infer<typeof CfreCountrySuccessorRow>;
export type AlbertaResourceDeductions15Values = z.infer<typeof AlbertaResourceDeductions15Values>;
