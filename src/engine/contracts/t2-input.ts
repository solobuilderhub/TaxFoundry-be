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
    /*
     * The Alberta columns MOVED to `albertaCca13` (see at1-input.ts).
     *
     * They were `albertaOpeningUCC` and `albertaClaim` here, which made AT1
     * Schedule 13 inseparable from federal Schedule 8: one slice, so one nav
     * entry, so the Alberta form could only ever be a second grid inside the
     * federal one. It now has its own schedule, and pairs back to these
     * classes by `ccaClass`.
     */
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
    // The Guided-view combobox sends `""` for "nothing selected" rather than
    // omitting the key, so an empty string must be tolerated here the same
    // as `undefined` — Zod's own `.enum()` would otherwise 400 on it. Not
    // normalized to `undefined` in the schema itself (a `.transform()` here
    // cannot be represented in the generated JSON Schema apps/web's
    // `return-input.ts` is emitted from) — callers treat `''` as unset.
    category: z
      .union([At1DispositionCategory, z.literal('')])
      .optional()
      .describe('Feeds AT1 Schedule 18 only; the federal Schedule 6 computation ignores it.'),
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
    accumulatedAmortization: z
      .number()
      .optional()
      .describe(
        'GIFI 2009 — accumulated amortization on tangible capital assets. Optional: leave blank if unknown, and capitalAssetsNet still files (as a net figure) under GIFI 2008.',
      ),
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

/**
 * Schedule 1's lines, as they arrive from the editor.
 *
 * ── Why this needs normalizing at all ───────────────────────────────────────
 *
 * The editor names each box for the line it is filed under — `lines.101`,
 * `lines.403` — so what a preparer types is already in filing shape with no
 * mapping step to get wrong. That is the right design, and it collides with
 * react-hook-form's path semantics: a NUMERIC path segment means an ARRAY
 * INDEX, so `lines.101` builds `lines[101]` rather than `lines["101"]`, and the
 * slice leaves the browser as a sparse array 419 long (one past line 418, the
 * highest on the form). `JSON.stringify` writes a hole as `null`, so an
 * untouched Schedule 1 serializes as a wall of nulls — which is what made this
 * visible, and is also why it was invisible for so long: the payload looks like
 * garbage rather than like data in the wrong container.
 *
 * It failed closed, at least: `expected record, received array` rejected the
 * WHOLE save, so no return was ever stored with misplaced figures. But it
 * rejected every save of any return that had rendered Schedule 1, whatever else
 * was on it, and the message named a shape mismatch rather than anything a
 * preparer could act on.
 *
 * ── Why the fix belongs here ────────────────────────────────────────────────
 *
 * The array index IS the line number, so no information is lost and the
 * conversion is exact. Doing it at the contract rather than in the browser
 * means: a client already deployed is fixed without shipping one, a document
 * saved in either shape reads back, and there is ONE definition of the stored
 * shape instead of a client-side transform that could drift from it. The engine
 * and every downstream reader keep seeing the record they were written against.
 *
 * Nulls are stripped rather than rejected for the same reason: a cleared money
 * box gives back `null`, and "the preparer emptied this field" is not a
 * different fact from "the preparer never filled it" — both mean no amount on
 * that line. Rejecting the save over it would fail a return for being edited.
 */
const ScheduleOneLines = z.preprocess(
  (raw) => {
    if (raw == null || typeof raw !== 'object') return raw;
    const entries = Array.isArray(raw)
      ? // Index → line number. A hole reads as undefined, a cleared box as null;
        // both drop out below.
        raw.map((v, i) => [String(i), v] as const)
      : Object.entries(raw as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      // Absent, or emptied by the preparer. Both mean no amount on the line.
      if (value == null || value === '') continue;
      if (typeof value === 'number') {
        out[key] = value;
        continue;
      }
      // A numeric string is the same figure in a different wrapper, so it is
      // converted. Anything else is passed through UNCHANGED so the schema
      // below rejects it and the save reports the bad line.
      //
      // The first version of this dropped whatever it could not convert, which
      // is how a preparer loses a figure without being told: a value the client
      // mangled would have vanished and the save would have succeeded. Silently
      // discarding an amount on a tax return is worse than refusing it.
      const n = typeof value === 'string' ? Number(value) : Number.NaN;
      out[key] = Number.isFinite(n) ? n : value;
    }
    return out;
  },
  z.record(z.string(), z.number()),
);

export const NetIncomeValues = z
  .object({
    lines: ScheduleOneLines.optional().describe(
      'Schedule 1, keyed by CRA line number: { "104": 50000, "403": 55000 }.\n\n' +
        'The line number is the transmission key, so storing it as the key means what the ' +
        'preparer typed is already in the shape the return is filed in. The former ' +
        '{ description, amount }[] shape reconciled on screen and could not be filed — a ' +
        "transmitted return has no field for a preparer's own wording.\n\n" +
        'Accepts the sparse ARRAY react-hook-form produces for a numeric field path ' +
        '(`lines.101` → `lines[101]`) and normalizes it to this record — the index is the ' +
        'line number, so the conversion is exact. Blank and cleared boxes are dropped rather ' +
        'than stored as null or zero: an untyped line has no amount, which is not the same ' +
        'statement as a line reported at nil.',
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
    farmOpening: z.number().optional().describe('Farm loss, s.111(1)(d) — offsets any income.'),
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
/** Schedule 130 Parts 1C/1D column 1 — who the other party to the financing is. */
export const EifelCounterpartyRelationship = z.enum([
  'canadian-arm-length',
  'canadian-non-arm-length',
  'non-resident-arm-length',
  'non-resident-non-arm-length',
]);

/** Schedule 130 Part 2C — the ten resource pools the form lists, in its own row order. */
export const ResourceIfePool = z.enum([
  'ccee-regular',
  'ccee-successor',
  'ccde-regular',
  'ccde-successor',
  'ccogpe-regular',
  'ccogpe-successor',
  'fede-regular',
  'fede-successor',
  'cfre-regular',
  'cfre-successor',
]);

export const EifelValues = z
  .object({
    netInterestAndFinancingExpenses: z.number().optional(),
    groupTaxableCapital: z.number().optional(),
    domesticExceptionApplies: z.boolean().optional(),
    // ── Schedule 130 — the computation itself, once the regime applies ──────
    interestAndFinancingExpenses: z
      .number()
      .optional()
      .describe(
        'Schedule 130 Part 2A line 045 — the corporation’s GROSS interest and financing expenses. Distinct from the group NET figure above, which only settles the de-minimis excluded-entity test.',
      ),
    interestAndFinancingRevenues: z
      .number()
      .optional()
      .describe('Schedule 130 Part 2D line 072 — interest and financing revenues.'),
    adjustedTaxableIncome: z
      .number()
      .optional()
      .describe(
        'Schedule 130 Part 2F line 106 — supply only to override the engine’s own derivation, which builds it from taxable income plus IFE, CCA, resource deductions, terminal loss and the 110(1)(k) deduction.',
      ),
    hasGroupRatioElection: z
      .boolean()
      .optional()
      .describe('Whether a group ratio election under subsection 18.21(2) was made.'),
    groupRatioAmount: z
      .number()
      .optional()
      .describe('Schedule 130 line 118/132 — the allocated group ratio amount.'),
    rifeFromPreviousYears: z
      .number()
      .optional()
      .describe('Schedule 130 Part 2J line 128 — RIFE carried forward from previous tax years.'),
    receivedCapacity: z
      .array(
        z.object({
          entityName: z.string().optional(),
          accountNumber: z.string().optional(),
          taxYearEnd: z.string().optional(),
          amount: z.number().optional(),
        }),
      )
      .optional()
      .describe(
        'Schedule 130 Part 1A — capacity received from eligible group entities (line 130).',
      ),
    priorYearExcessCapacity: z
      .array(
        z.object({
          yearsAgo: z
            .number()
            .optional()
            .describe('1, 2 or 3 — the form carries three years only.'),
          excessCapacity: z.number().optional().describe('122'),
          previouslyTransferred: z.number().optional().describe('123 — under subsection 18.2(4)'),
          previouslyAbsorbed: z.number().optional().describe('124 — under subsection 18.2(2)'),
        }),
      )
      .optional()
      .describe('Schedule 130 Part 2I — the three preceding years’ excess-capacity vintages.'),
    partnershipIfeAddBack: z
      .number()
      .optional()
      .describe(
        'Schedule 130 Part 2N line 158 — partnership IFE add-back (Schedule 1 line 252). Derived from `partnershipIfe` below × the denied proportion; supply only to override.',
      ),

    // ── Parts 1B-1E, 2B, 2C, 2E, 2M — the tables IFE and IFR are built from ──
    exemptIfe: z
      .array(
        z.object({
          authorityName: z.string().optional().describe('007'),
          principalAmount: z.number().optional().describe('008'),
          ifeIncurred: z.number().optional().describe('009'),
          incomeFromFundedActivities: z
            .number()
            .optional()
            .describe('010 — reduces ATI (line 104)'),
          lossFromFundedActivities: z.number().optional().describe('011 — adds to ATI (line 092)'),
        }),
      )
      .optional()
      .describe('Part 1B — public-sector agreements whose borrowings produce exempt IFE.'),
    borrowings: z
      .array(
        z.object({
          relationship: EifelCounterpartyRelationship.optional(),
          principalAmount: z.number().optional().describe('012'),
          derivativeNotional: z.number().optional().describe('013'),
          interestPaidOrPayable: z.number().optional().describe('014 → line 027'),
          fundingCostAmounts: z.number().optional().describe('015 → line 033'),
          costReducingAmounts: z.number().optional().describe('016 → line 042'),
        }),
      )
      .optional()
      .describe('Part 1C — borrowings and other financings.'),
    loans: z
      .array(
        z.object({
          relationship: EifelCounterpartyRelationship.optional(),
          principalAmount: z.number().optional().describe('017'),
          derivativeNotional: z.number().optional().describe('018'),
          returnAmounts: z.number().optional().describe('019 → line 061'),
          returnReducingAmounts: z.number().optional().describe('020 → line 066'),
        }),
      )
      .optional()
      .describe('Part 1D — loans and other financings.'),
    partnershipIfe: z
      .array(
        z.object({
          partnershipName: z.string().optional().describe('021'),
          accountNumber: z.string().optional().describe('022'),
          shareOfPartnershipIfe: z.number().optional().describe('023'),
          portionUnderParagraph12_1_l1: z.number().optional().describe('024'),
          portionDeniedBySubsection96_2_1: z.number().optional().describe('025'),
        }),
      )
      .optional()
      .describe('Part 1E — IFE allocated from a partnership. Feeds lines 039, 142 and 156.'),
    capitalizedIfe: z
      .array(
        z.object({
          ccaClass: z.string().optional().describe('046'),
          ifeInOpeningUcc: z.number().optional().describe('047'),
          ifeInAcquisitionsAndDispositions: z.number().optional().describe('048 — signed'),
          ifeInTerminalLoss: z.number().optional().describe('050 → line 032'),
          ifeInCca: z.number().optional().describe('051 → line 030'),
        }),
      )
      .optional()
      .describe('Part 2B — IFE capitalized into the cost of depreciable property.'),
    resourceIfe: z
      .array(
        z.object({
          pool: ResourceIfePool,
          ifeInOpeningBalance: z.number().optional().describe('053'),
          ifeAddedOrDeducted: z.number().optional().describe('054 — signed'),
          ifeInCurrentYearClaim: z.number().optional().describe('056 → line 031'),
        }),
      )
      .optional()
      .describe('Part 2C — IFE sitting inside resource expense pools.'),
    lossPortionFromIfe: z
      .array(
        z.object({
          taxYearOfOrigin: z.string().optional().describe('073'),
          nonCapitalLoss: z.number().optional().describe('074 — variable J(i)'),
          variableJSecondAmount: z.number().optional().describe('075 — variable J(ii)'),
          amountDeducted: z.number().optional().describe('077'),
        }),
      )
      .optional()
      .describe('Part 2E — the IFE-derived portion of a 111(1)(a) loss claim (line 089).'),
    clause95Denied: z
      .array(
        z.object({
          affiliateName: z.string().optional().describe('144'),
          variableAForAffiliate: z.number().optional().describe('145'),
          specifiedParticipatingPercentage: z
            .number()
            .optional()
            .describe('148 — as a FRACTION (0.4, not 40)'),
        }),
      )
      .optional()
      .describe('Part 2M, first table — subclause 95(2)(f.11)(ii)(D)(I).'),
    clause95Included: z
      .array(
        z.object({
          affiliateName: z.string().optional().describe('151'),
          amountInAffiliateFapi: z.number().optional().describe('152'),
          specifiedParticipatingPercentage: z.number().optional().describe('153 — as a FRACTION'),
        }),
      )
      .optional()
      .describe('Part 2M, second table — subclause 95(2)(f.11)(ii)(D)(II).'),
    ifeDetail: z
      .object({
        otherInterest: z.number().optional().describe('028'),
        subsection20_1_eAmounts: z.number().optional().describe('029'),
        fundingCostLoss: z.number().optional().describe('034'),
        fundingCostCapitalLoss: z.number().optional().describe('035'),
        feeGivingRiseToIfe: z.number().optional().describe('036'),
        feeReducingIfe: z.number().optional().describe('037'),
        leaseFinancingAmount: z.number().optional().describe('038'),
        reinstatedPartnershipLoss: z.number().optional().describe('040'),
        affiliateRaife: z.number().optional().describe('041 — also line 143'),
        costReducingGain: z.number().optional().describe('043'),
        costReducingPartnershipShare: z.number().optional().describe('044'),
      })
      .optional()
      .describe(
        'Part 2A — the IFE lines NOT fed by the tables above. Lines 027/030/031/032/033/039/042 come from Parts 1C, 1E, 2B and 2C and must not be repeated here.',
      ),
    ifrDetail: z
      .object({
        interestReceived: z.number().optional().describe('058'),
        subsection12_9Amounts: z.number().optional().describe('059'),
        guaranteeFees: z.number().optional().describe('060'),
        returnGain: z.number().optional().describe('062'),
        leaseFinancingAmount: z.number().optional().describe('063'),
        partnershipShare: z.number().optional().describe('064'),
        affiliateRaifr: z.number().optional().describe('065'),
        returnReducingLoss: z.number().optional().describe('067'),
        returnReducingCapitalLoss: z.number().optional().describe('068'),
        returnReducingPartnershipShare: z.number().optional().describe('069'),
        shelteredByForeignTaxRelief: z.number().optional().describe('070'),
        exemptFromPartITax: z.number().optional().describe('071'),
      })
      .optional()
      .describe('Part 2D — the IFR lines not fed by Part 1D (lines 061 and 066).'),
  })
  .meta({ id: 'EifelValues' });

export const SbdValues = z
  .object({
    activeBusinessIncome: z.number().optional(),
    businessLimit: z.number().optional(),
    taxableCapital: z.number().optional(),
    aaii: z
      .number()
      .optional()
      .describe(
        'Adjusted aggregate investment income, PRIOR year (Schedule 7 Part 2, line 745) — the SBD passive-income grind only.',
      ),
    aggregateInvestmentIncome: z
      .number()
      .optional()
      .describe(
        'Aggregate investment income, CURRENT year (Schedule 7 Part 1, line 092 / jacket line 440) — feeds Part IV/RDTOH, not the grind. Defaults to `aaii` when omitted.',
      ),
    aiiDetail: z
      .object({
        taxableCapitalGains: z.number().optional().describe('002'),
        allowableCapitalLosses: z.number().optional().describe('012'),
        netCapitalLossesClaimed: z.number().optional().describe('022 — T2 jacket line 332'),
        incomeFromProperty: z.number().optional().describe('032'),
        exemptIncome: z.number().optional().describe('042'),
        agriInvestFundReceived: z.number().optional().describe('052'),
        taxableDividendsDeductible: z.number().optional().describe('062'),
        trustPropertyIncome: z.number().optional().describe('072'),
        lossesFromProperty: z.number().optional().describe('082'),
      })
      .optional()
      .describe(
        'Schedule 7 Part 1 detail — when entered and `aggregateInvestmentIncome` is left blank, AII is derived from these instead of typed in directly.',
      ),
    aaiiDetail: z
      .object({
        taxableCapitalGains: z
          .number()
          .optional()
          .describe('705 — excludes active-asset dispositions'),
        allowableCapitalLosses: z
          .number()
          .optional()
          .describe('710 — excludes active-asset dispositions'),
        incomeFromProperty: z.number().optional().describe('715'),
        exemptIncome: z.number().optional().describe('720'),
        agriInvestFundReceived: z.number().optional().describe('725'),
        dividendsFromConnectedCorporations: z.number().optional().describe('730'),
        trustPropertyIncome: z.number().optional().describe('735'),
        lossesFromProperty: z.number().optional().describe('740'),
        subsection91_4Deduction: z.number().optional().describe('741 — FAPI, s.91(4)'),
      })
      .optional()
      .describe(
        'Schedule 7 Part 2 detail — when entered and `aaii` is left blank, AAII is derived from these instead of typed in directly.',
      ),
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

export const Class13LeaseholdLayer = z
  .object({
    description: z.string().optional(),
    capitalCost: z.number().optional(),
    leaseEnd: z
      .string()
      .optional()
      .describe(
        'The date the lease is deemed to terminate. The engine derives the Schedule III ' +
          'period count from this and the tax year start — the number of 12-month periods ' +
          'is computed, not typed in.',
      ),
    firstRenewalEnd: z
      .string()
      .optional()
      .describe(
        'Where the lease grants renewal rights, the end of the term NEXT SUCCEEDING the ' +
          'one this cost was incurred in (Schedule III s.3(b)) — the first renewal only. ' +
          'When entered, this replaces leaseEnd for the period calculation.',
      ),
    isFirstYear: z
      .boolean()
      .optional()
      .describe(
        'This is the layer’s first tax year — triggers the Reg 1100(2) UCC-ceiling reduction.',
      ),
    aiip: z
      .boolean()
      .optional()
      .describe('Accelerated investment incentive property — exempt from the 1100(2) reduction.'),
    claimedToDate: z
      .number()
      .optional()
      .describe('CCA already claimed on this layer in prior years.'),
    proceeds: z.number().optional().describe('Disposition proceeds attributed to this layer.'),
  })
  .meta({ id: 'Class13LeaseholdLayer' });

export const Class14LimitedLifeProperty = z
  .object({
    description: z.string().optional(),
    capitalCost: z.number().optional(),
    lifeDaysAtAcquisition: z
      .number()
      .optional()
      .describe(
        'Days of life the property had REMAINING when the capital cost was incurred — ' +
          'not its total life, and not the days left today (Reg 1100(1)(c) fixes the ' +
          'denominator at acquisition).',
      ),
  })
  .meta({ id: 'Class14LimitedLifeProperty' });

export const CcaValues = z
  .object({
    classes: z.array(CcaClass).optional(),
    class13Layers: z
      .array(Class13LeaseholdLayer)
      .optional()
      .describe(
        'NEW class 13 leasehold-interest layers added this tax year (the full Schedule III mechanic).',
      ),
    class13OpeningUCC: z
      .number()
      .optional()
      .describe('Class 13 undepreciated capital cost before this year’s deduction.'),
    class13Claim: z.number().optional().describe('Class 13 amount to claim; blank = the maximum.'),
    class14Properties: z
      .array(Class14LimitedLifeProperty)
      .optional()
      .describe('NEW class 14 limited-life intangible properties added this tax year.'),
    class14OpeningUCC: z
      .number()
      .optional()
      .describe('Class 14 undepreciated capital cost before this year’s deduction.'),
    class14Claim: z.number().optional().describe('Class 14 amount to claim; blank = the maximum.'),
  })
  .meta({ id: 'CcaValues' });

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
    opening: z
      .number()
      .optional()
      .describe('Balance at the beginning of the year (reversed into income).'),
    transfer: z
      .number()
      .optional()
      .describe('Transfer on an amalgamation / wind-up of a subsidiary.'),
    closing: z.number().optional().describe('Balance at the end of the year (deducted this year).'),
    /*
     * The Alberta columns MOVED to `albertaReserves17` (see at1-input.ts) —
     * same reason as the CCA class above. They pair back to these rows by
     * `type`.
     */
  })
  .meta({ id: 'ReserveRow' });

/** Schedule 13 — continuity of reserves (Part 2, other reserves). */
export const ReservesValues = z
  .object({ rows: z.array(ReserveRow).optional() })
  .meta({ id: 'ReservesValues' });

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
export type Class13LeaseholdLayer = z.infer<typeof Class13LeaseholdLayer>;
export type Class14LimitedLifeProperty = z.infer<typeof Class14LimitedLifeProperty>;
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
