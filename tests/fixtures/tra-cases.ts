/**
 * TRA's Fall 2025 AT1 certification test cases as working returns — the shape
 * the editor's forms save — so the certification check exercises the same
 * inputs a preparer produces. Source: research/sources/tra-test-cases/*.txt.
 *
 * TRA says of Test Case 1: "Please generate financial statements and federal
 * information at your discretion". The federal figures below are that
 * discretion, chosen so every Alberta figure TRA states comes out exactly:
 *
 *   federal net income  −19,800 = revenue 1,000,000 − expenses 18,800
 *                                 − federal CCA 1,001,000
 *   federal CCA        1,001,000 = class 8: 1,000,000 immediate expensing
 *                                 + 20% × 5,000 opening; classes 1 and 13 nil
 *   Alberta CCA        1,006,200 = federal + class 1 (4% × 5,000 = 200)
 *                                 + class 13 (the full 5,000)
 *   Alberta loss          25,000 = −19,800 − (1,006,200 − 1,001,000)   ← TRA's figure
 *   net capital loss      75,000 = ½ × (100,000 − 250,000)            ← TRA's figure
 */

const TC1_CLIENT = {
  name: 'Foothills Manufacturing Ltd.',
  address: {
    street: '1200 Stephen Avenue SW',
    city: 'Calgary',
    province: 'AB',
    postalCode: 'T2P 5C5',
  },
  corporateAccountNumber: '424102952',
  businessNumber: '742518963RC0001',
  contactPerson: 'Dana Whitecourt',
  contactTelephone: '4035550142',
  natureOfBusiness: '3399',
  typeOfCorporation: '1',
  authorizedEmail: 'dana.whitecourt@foothillsmfg.test',
};

/**
 * The EDI schedule as a preparer fills it for these runs — TaxFoundry filing
 * its own clients, not as a third party. The certification code is the one TRA
 * issued for the Fall test cycle (HL2026), as in the earlier certification run.
 */
const EDI = {
  softwareCertCode: 'HL2026',
  webServiceVersion: '0.0.1',
  softwareVersion: '0.1.0',
  serialNumber: 'SR_DEV',
  thirdPartyIndicator: '2',
  legalName: 'TaxFoundry Inc.',
  contactFirstName: 'TaxFoundry',
  contactLastName: 'Support',
  contactPosition: 'Transmitter',
  contactPhone: '4035550100',
  contactEmail: 'filing@taxfoundry.ca',
} as const;

const JACKET_NO = {
  associatedWithCcpcs: 'no',
  windUpOfSubsidiary: 'no',
  firstYearAfterAmalgamation: 'no',
  taxYearEndChanged: 'no',
  finalReturn: 'no',
  transferOfProperty: 'no',
  preparedByTaxPreparerForFee: 'yes',
} as const;

/** Test Case 1 — TYB 2023-09-01, TYE 2024-08-31. */
const tc1ReturnInput = (nonCapitalCarrybacks: readonly number[]) => ({
  identification: { corpType: 'ccpc', province: 'AB' },
  edi: EDI,
  // ── Federal figures (TRA: "at your discretion") ──
  incomeStatement: { revenue: 1_000_000, otherExpenses: 18_800 },
  cca: {
    classes: [
      { ccaClass: '8', openingUCC: 5_000, additions: 1_000_000, immediateExpensing: 1_000_000 },
      // "No claim is made on this class for federal purposes."
      { ccaClass: '1', openingUCC: 5_000, claim: 0 },
    ],
    // Class 13 — a leasehold with 5 periods left: 25,000 cost, 20,000 claimed
    // to date, so the 5,000 opening UCC is exactly one year's straight line.
    class13Layers: [
      {
        description: 'Leasehold improvements',
        capitalCost: 25_000,
        leaseEnd: '2028-08-31',
        claimedToDate: 20_000,
      },
    ],
    class13OpeningUCC: 5_000,
    class13Claim: 0,
  },
  capitalGains: {
    dispositions: [
      { description: 'Shares', proceeds: 100_000, acb: 250_000, outlays: 0, category: 'shares' },
    ],
  },
  // ── The AT1 forms ──
  alberta: {
    ...JACKET_NO,
    grossRevenue: 1_000_000,
    totalAssets: 1_665_000,
    // CCA differs from federal, so Schedules 13 and 12 are filed.
    reportsDifferentAlbertaIncome: 'yes',
    electsDifferentDiscretionaryAmounts: 'yes',
  },
  albertaCca13: {
    // Class 1: the maximum, 4% of 5,000, for Alberta only.
    classes: [{ ccaClass: '1', openingUCC: 5_000, claim: 200 }],
    // Class 13: "the full amount is being claimed ... for Alberta purposes only".
    class13Claim: 5_000,
  },
  albertaContinuity: {
    nonCapitalOpening: 100_000,
    capitalOpening: 100_000,
    nonCapitalCarrybacks: [
      { taxYearEnd: '2023-08-31', amount: nonCapitalCarrybacks[0] },
      { taxYearEnd: '2022-08-31', amount: nonCapitalCarrybacks[1] },
      { taxYearEnd: '2021-08-31', amount: nonCapitalCarrybacks[2] },
    ],
    // Gross amounts — Schedule 10's capital column is "Gross Amount". TRA's
    // 25,000 per year is the net loss applied: ½ × 50,000.
    capitalCarrybacks: [
      { taxYearEnd: '2023-08-31', amount: 50_000 },
      { taxYearEnd: '2022-08-31', amount: 50_000 },
      { taxYearEnd: '2021-08-31', amount: 50_000 },
    ],
  },
});

/*
 * Test Cases 2 and 3 — a $NIL Alberta return filed only to claim the
 * Innovation Employment Grant (Schedule 29 and jacket line 129). TYB
 * 2024-01-01, TYE 2024-12-31. No income, so no federal figures at all: the
 * AT1 stands alone, which is the case these two exist to test.
 *
 * Grant by hand (§ Schedule 29): 8% of this year's Alberta eligible
 * expenditures, plus 12% of the amount above the base (the average of the two
 * preceding years), times the group's taxable-capital factor
 * (50M − combined prior-year taxable capital) ÷ 40M.
 *
 *   TC2   base (300k + 200k)/2 = 250k; 8% × 400k + 12% × 150k = 50,000;
 *         factor (50M − 25M)/40M = 0.625  →  31,250
 *   TC3   base (750k + 600k)/2 = 675k; 8% × 1M + 12% × 325k = 119,000;
 *         factor (50M − 20M)/40M = 0.75   →  89,250
 */
const IEG_JACKET = {
  ...JACKET_NO,
  reportsDifferentAlbertaIncome: 'no',
  electsDifferentDiscretionaryAmounts: 'no',
} as const;

const tc2 = {
  taxYearStart: new Date('2024-01-01'),
  taxYearEnd: new Date('2024-12-31'),
  client: {
    name: 'Aurora Innovations Ltd.',
    address: {
      street: '450 Jasper Avenue NW',
      city: 'Edmonton',
      province: 'AB',
      postalCode: 'T5J 3N4',
    },
    corporateAccountNumber: '424102960',
    businessNumber: '813574269RC0001',
    contactPerson: 'Priya Kaur',
    contactTelephone: '7805550188',
    natureOfBusiness: '5417',
    typeOfCorporation: '1',
    authorizedEmail: 'priya.kaur@aurorainnov.test',
  },
  returnInput: {
    identification: { corpType: 'ccpc', province: 'AB' },
    edi: EDI,
    // "associated with another corporation for the purposes of the IEG"
    alberta: {
      ...IEG_JACKET,
      associatedWithCcpcs: 'yes',
      grossRevenue: 1_000_000,
      totalAssets: 1_000_000,
    },
    albertaIeg: {
      federalAmount: 1_000_000, // T661 line 559, before the IEG
      primaryFieldCode: '2',
      projects: [
        {
          title: 'Advanced process automation platform',
          projectCode: '2.11.03',
          albertaPortion: 400_000,
          otherPortion: 600_000, // Ontario
          salariesAndWages: 100_000,
        },
      ],
      group: [
        {
          name: 'Aurora Innovations Ltd.',
          taxableCapital: 12_000_000,
          priorYear1: 300_000,
          priorYear2: 200_000,
        },
        {
          name: 'Associated Co.',
          taxableCapital: 13_000_000,
          priorYear1: 150_000,
          priorYear2: 100_000,
        },
      ],
      // The associate's year (July 2023 – June 2024) is the longest; 2024 is a leap year.
      agreementLongestYearCan: '700100200',
      agreementLongestYearBegin: '2023-07-01',
      agreementLongestYearEnd: '2024-06-30',
      agreementDaysInLongestYear: 366,
      agreementMembers: [
        {
          name: 'Aurora Innovations Ltd.',
          albertaCan: '424102960',
          currentTaxationYearEnd: '2024-12-31',
          allocatedExpenditureLimit: 3_000_000,
          currentYearExpenditures: 400_000,
          priorYear1: 300_000,
          priorYear2: 200_000,
          taxableCapitalPriorYear: 12_000_000,
          daysInTaxYear: 366,
          hasAlbertaPermanentEstablishment: 'yes',
        },
        {
          name: 'Associated Co.',
          albertaCan: '700100200',
          currentTaxationYearEnd: '2024-06-30',
          allocatedExpenditureLimit: 1_000_000,
          currentYearExpenditures: 400_000,
          priorYear1: 150_000,
          priorYear2: 100_000,
          taxableCapitalPriorYear: 13_000_000,
          daysInTaxYear: 366,
          hasAlbertaPermanentEstablishment: 'yes',
        },
      ],
    },
  },
};

const tc3Member = (
  name: string,
  can: string,
  yearEnd: string,
  limit: number,
  current: number,
  prior1: number,
  prior2: number,
  capital: number,
  albertaPe: 'yes' | 'no',
) => ({
  name,
  albertaCan: can,
  currentTaxationYearEnd: yearEnd,
  allocatedExpenditureLimit: limit,
  currentYearExpenditures: current,
  priorYear1: prior1,
  priorYear2: prior2,
  taxableCapitalPriorYear: capital,
  hasAlbertaPermanentEstablishment: albertaPe,
});

const tc3 = {
  taxYearStart: new Date('2024-01-01'),
  taxYearEnd: new Date('2024-12-31'),
  client: {
    name: 'Cascade Research Corp.',
    address: { street: '888 3 Street SW', city: 'Calgary', province: 'AB', postalCode: 'T2P 5C5' },
    corporateAccountNumber: '424102978',
    businessNumber: '926318475RC0001',
    contactPerson: 'Marcus Reyes',
    contactTelephone: '4035550164',
    natureOfBusiness: '5417',
    typeOfCorporation: '1',
    authorizedEmail: 'marcus.reyes@cascaderesearch.test',
  },
  returnInput: {
    identification: { corpType: 'ccpc', province: 'AB' },
    edi: EDI,
    alberta: {
      ...IEG_JACKET,
      associatedWithCcpcs: 'yes',
      grossRevenue: 1_500_000,
      totalAssets: 1_400_000,
    },
    albertaIeg: {
      federalAmount: 1_500_000,
      primaryFieldCode: '2',
      projects: [
        {
          title: 'Applied research program',
          projectCode: '2.11.03',
          albertaPortion: 1_000_000,
          otherPortion: 500_000, // British Columbia
          salariesAndWages: 400_000,
        },
      ],
      // Alberta amounts only — a British Columbia expenditure is not an Alberta
      // eligible expenditure, whatever the federal T661 says.
      group: [
        {
          name: 'Corporation A',
          taxableCapital: 10_000_000,
          priorYear1: 750_000,
          priorYear2: 600_000,
        },
        { name: 'Corporation B', taxableCapital: 3_000_000, priorYear1: 0, priorYear2: 500_000 },
        { name: 'Corporation C', taxableCapital: 5_000_000, priorYear1: 80_000, priorYear2: 0 },
        { name: 'Corporation D', taxableCapital: 2_000_000, priorYear1: 0, priorYear2: 0 },
      ],
      // C's year (Oct 2023 – Sep 2024) is the longest, and spans 29 February.
      agreementLongestYearCan: '700300400',
      agreementLongestYearBegin: '2023-10-01',
      agreementLongestYearEnd: '2024-09-30',
      agreementDaysInLongestYear: 366,
      agreementMembers: [
        tc3Member(
          'Corporation A',
          '424102978',
          '2024-12-31',
          3_000_000,
          1_000_000,
          750_000,
          600_000,
          10_000_000,
          'yes',
        ),
        tc3Member(
          'Corporation B',
          '700200300',
          '2024-06-30',
          1_000_000,
          200_000,
          0,
          500_000,
          3_000_000,
          'yes',
        ),
        tc3Member(
          'Corporation C',
          '700300400',
          '2024-09-30',
          0,
          100_000,
          80_000,
          0,
          5_000_000,
          'no',
        ),
        tc3Member('Corporation D', '700400500', '2024-03-31', 0, 0, 0, 0, 2_000_000, 'no'),
      ],
    },
  },
};

export const TRA_CASES = {
  tc2,
  tc3,
  tc1: {
    taxYearStart: new Date('2023-09-01'),
    taxYearEnd: new Date('2024-08-31'),
    client: TC1_CLIENT,
    returnInput: tc1ReturnInput([10_000, 3_000, 2_500]),
  },
  /*
   * Test Case 1 AMENDED — the Alberta current-year loss becomes 50,000 and the
   * first carry-back 35,000. Federal expenses rise by 25,000 so the Alberta
   * loss is exactly TRA's figure; nothing else changes.
   */
  tc1a: {
    taxYearStart: new Date('2023-09-01'),
    taxYearEnd: new Date('2024-08-31'),
    client: TC1_CLIENT,
    returnInput: {
      ...tc1ReturnInput([35_000, 3_000, 2_500]),
      incomeStatement: { revenue: 1_000_000, otherExpenses: 43_800 },
    },
  },
} as const;
