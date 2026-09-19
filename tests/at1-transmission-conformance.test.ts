import { FORMS } from '@classytic/ca-tax/forms';
import { assertAt1MandatoryComplete, renderAt1NetFile } from '@classytic/ca-tax/t2';
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { assembleT2Input } from '../src/engine/assemble-t2-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';
import { composeAt1FilingData } from '../src/engine/at1-netfile.service.js';

/**
 * What a MAXIMAL Alberta return actually transmits.
 *
 * The AT1 form model describes ~680 lines across the jacket and thirteen
 * schedules, all transcribed off the printed TRA forms. Describing a line and
 * filing it are different things, and the gap between them is invisible in a
 * unit test of either side: the form model has no idea what the composer
 * populates, and the composer has no idea what the form says exists.
 *
 * So this drives ONE return that triggers every schedule through the real
 * filing chain — assembleT2Input → assembleProvincialInput → runAT1Compute →
 * composeAt1FilingData → renderAt1NetFile — and asserts against the RENDERED
 * XML. A line counts as filed only if it is genuinely on the wire.
 *
 * It found two things nothing else was looking for:
 *
 *   Schedule 2   never transmitted at all. ca-tax has pushed
 *                `schedule2Values(sched.allocation)` since the schedule was
 *                built, but the server only ever put the allocation bases at
 *                the TOP level (where the engine divides them into a factor),
 *                never in `schedules`. A corporation with a permanent
 *                establishment outside Alberta filed a factor on the jacket
 *                and nothing showing where it came from — four mandatory
 *                lines missing from every multi-jurisdiction return.
 *   Schedule 29  an Innovation Employment Grant claim with no associated-group
 *                row was discarded before the engine saw it, so the preparer
 *                got no schedule, no grant and no reason.
 */

const taxYearStart = new Date('2024-01-01');
const taxYearEnd = new Date('2024-12-31');
const engagement = { taxYearStart, taxYearEnd, program: 'AT1' };

/** One return that triggers every AT1 schedule this product composes. */
const maximalReturn: Record<string, unknown> = {
  identification: { corpType: 'ccpc', province: 'AB' },
  incomeStatement: {
    revenue: 2_000_000,
    costOfSales: 900_000,
    salariesAndWages: 400_000,
    otherExpenses: 200_000,
  },
  // Schedule 2 — a permanent establishment outside Alberta, so the income is allocated.
  provincialAllocation: {
    establishments: [
      { province: 'AB', grossRevenue: 1_400_000, salariesWages: 300_000 },
      { province: 'ON', grossRevenue: 600_000, salariesWages: 100_000 },
    ],
  },
  cca: {
    classes: [
      { ccaClass: '8', openingUCC: 100_000, additions: 20_000 },
      { ccaClass: '10', openingUCC: 50_000 },
    ],
  },
  albertaCca13: { classes: [{ ccaClass: '8', openingUCC: 100_000, claim: 18_000 }] },
  capitalGains: {
    dispositions: [
      {
        description: 'Shares of X Co.',
        proceeds: 150_000,
        acb: 80_000,
        outlays: 2_000,
        category: 'shares',
      },
      {
        description: 'Land',
        proceeds: 300_000,
        acb: 250_000,
        outlays: 5_000,
        category: 'realEstate',
      },
    ],
  },
  albertaSchedule18: {
    abilEntries: [
      {
        name: 'Failed Startup Ltd.',
        kind: 'shares',
        dateOfAcquisition: '2019-03-01',
        proceeds: 1_000,
        acb: 90_000,
        outlays: 500,
      },
    ],
  },
  reserves: { rows: [{ type: 'doubtfulDebts', opening: 5_000, transfer: 0, closing: 8_000 }] },
  albertaReserves17: {
    rows: [{ type: 'doubtfulDebts', opening: 5_000, transfer: 0, closing: 9_000 }],
  },
  donations: {
    charitable: 40_000,
    cultural: 4_000,
    ecological: 6_000,
    openingDonationPool: 10_000,
  },
  albertaDonations: {
    giftsCurrentYear: 10_000,
    giftsOpening: 2_000,
    carryforwardRows: [{ yearOfOrigin: '2023-12-31', toCanadaOrProvince: 2_000 }],
  },
  sbd: { activeBusinessIncome: 400_000, taxableCapital: 2_000_000 },
  albertaSbd: {
    corporationStatus: 'ccpc',
    royaltyTaxDeduction: 1_000,
    associatedCorpAgreement: [
      { name: 'Sister Co.', albertaCan: '9876543210', allocatedAmount: 100_000 },
    ],
  },
  losses: { nonCapitalOpening: 50_000 },
  albertaContinuity: {
    nonCapitalOpening: 50_000,
    capitalOpening: 20_000,
    farmOpening: 5_000,
    restrictedFarmOpening: 3_000,
    lppOpening: 1_000,
    farmCurrentYearLoss: 4_000,
    farmCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 1_000 }],
    restrictedFarmCurrentYearLoss: 2_000,
    otherLossIncludesRestrictedFarm: 'yes',
    otherLossCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 500 }],
    limitedPartnerships: [{ identifier: 'LP-1', precedingYearBalance: 7_000, applied: 1_000 }],
    nonCapitalVintages: [
      { yearsAgo: 1, taxYearEnd: '2023-12-31', balanceAtBeginning: 50_000, applied: 0 },
    ],
    rife: { openingBalance: 12_000, currentYearRife: 3_000 },
  },
  albertaSchedule12: {
    taxableDividendsDeductible: 30_000,
    partVI1TaxDeductible: 2_000,
    prospectorsShares: 1_500,
    nonQualifiedSecuritiesDeduction: 800,
    section110_5Additions: 900,
    centralCreditUnionAllocation: 1_100,
  },
  albertaOtherCredits3: {
    itcCertificatesIssued: 5_000,
    itcCarryforwardFromPriorYear: 2_000,
    itcAmountApplied: 1_000,
    citcCertificatesIssued: 3_000,
    citcAmountApplied: 500,
    apitcCurrentReceived: 4_000,
    apitcCurrentApplied: 1_200,
  },
  albertaForeignInvestment4: {
    countries: [
      {
        country: 'United States',
        netForeignInvestmentIncome: 50_000,
        fedForeignTaxPaid: 7_500,
        fedNonBusinessForeignTaxCredit: 5_000,
      },
    ],
  },
  albertaResourceDeductions15: {
    daysInTaxYear: 366,
    ceeRegular: [
      {
        federalOpeningBalance: 100_000,
        albertaOpeningBalance: 100_000,
        federalCurrentYearExpenses: 50_000,
        claimed: 30_000,
      },
    ],
    edaRegular: [
      {
        federalOpeningBalance: 80_000,
        albertaOpeningBalance: 80_000,
        federalRegulation1201Claim: 10_000,
        albertaRegulation1201Claim: 10_000,
      },
    ],
    cmedb: [{ federalOpeningBalance: 20_000, albertaOpeningBalance: 20_000, claimed: 5_000 }],
  },
  albertaSred16: {
    currentYearExpenditures: 120_000,
    openingPoolBalance: 30_000,
    amountClaimed: 40_000,
  },
  albertaIeg: {
    federalAmount: 200_000,
    albertaPortion: 150_000,
    primaryFieldCode: 1,
    projects: [
      { title: 'Project A', projectCode: '01', albertaPortion: 150_000, salariesAndWages: 90_000 },
    ],
    // The engine requires the claimant ITSELF as a group member — see the
    // no-group test below for what happens when it is absent.
    group: [
      { name: 'Maximal Ltd.', taxableCapital: 2_000_000, priorYear1: 100_000, priorYear2: 120_000 },
    ],
  },
  alberta: {
    grossRevenue: 2_000_000,
    totalAssets: 3_000_000,
    manufacturingDeduction: 1_000,
    politicalContributionsTaxCredit: 250,
    associatedWithCcpcs: 'no',
    windUpOfSubsidiary: 'no',
    firstYearAfterAmalgamation: 'no',
    taxYearEndChanged: 'no',
    finalReturn: 'no',
    transferOfProperty: 'no',
    reportsDifferentAlbertaIncome: 'yes',
    electsDifferentDiscretionaryAmounts: 'yes',
    preparedByTaxPreparerForFee: 'yes',
  },
};

type Computed = {
  fields: { line: string; value: unknown }[];
  schedulePayloads?: { scheduleId: string; values: { lineItemId: string; value: unknown }[] }[];
  issues?: string[];
};

/** The real chain. `coerceEngineInput`'s date revival is mirrored, not skipped. */
function compute(input: Record<string, unknown>): Computed {
  const assembled = assembleT2Input(input as never, engagement as never) as Record<string, unknown>;
  const p = assembled.period as { start: string; end: string; label: string };
  const fed = {
    ...assembled,
    period: { start: new Date(p.start), end: new Date(p.end), label: p.label },
  };
  return runAT1Compute(
    assembleProvincialInput('AT1', fed, input as never, { isCcpc: true }),
  ) as Computed;
}

function transmit(input: Record<string, unknown>): string {
  const computed = compute(input);
  const data = composeAt1FilingData({
    computed: { fields: computed.fields, identity: {}, filingInput: input },
    client: {
      name: 'Maximal Ltd.',
      address: { street: '1 Test Way', city: 'Calgary', province: 'AB', postalCode: 'T2P1A1' },
      corporateAccountNumber: '1234567890',
      businessNumber: '123456782',
      contactPerson: 'Dana QA',
      contactTelephone: '4035550100',
      natureOfBusiness: 'Manufacturing',
      typeOfCorporation: '1',
      authorizedEmail: 'qa@taxfoundry.test',
    },
    engagement: { taxYearStart, taxYearEnd },
    certification: { firstName: 'A', lastName: 'B', position: 'CFO' },
    forFiling: false,
  });
  return renderAt1NetFile(data, computed.schedulePayloads ?? []);
}

/** `Schedule Number` → the 3-digit fields transmitted under it. */
function transmitted(xml: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of xml.matchAll(/<Schedule Number="([^"]+)">([\s\S]*?)<\/Schedule>/g)) {
    const set = out.get(m[1] as string) ?? new Set<string>();
    // `\w{3}[0-9]{6}` per the XSD — the EDI block's ids start with letters
    // ("EDI001001"), so a digits-only match silently sees it as empty.
    for (const v of (m[2] as string).matchAll(/LineItemID="(\w{3}\d{6})"/g)) {
      set.add((v[1] as string).slice(3, 6));
    }
    out.set(m[1] as string, set);
  }
  return out;
}

const XML = transmit(maximalReturn);
const SENT = transmitted(XML);

describe('the transmitted AT1 conforms to AlbertaCorporateIncomeTaxReturn.xsd', () => {
  /*
   * The constraints below are the XSD's own, transcribed from
   * research/sources/tra-spec/AlbertaCorporateIncomeTaxReturn.xsd:
   *
   *   ScheduleNumber  pattern \w{3}
   *   LineItemID      pattern \w{3}[0-9]{6}
   *   ProgramCode     pattern [0-9]{2}
   *   ValueString     maxLength 175
   *   Return          sequence: ProgramCode, then Schedule (unbounded)
   *
   * A full schema validation of these documents passes (lxml, against that
   * file); this encodes the same rules so the suite keeps checking them
   * without a schema-validator dependency.
   */
  it('declares the schema and a two-digit programme code, in order', () => {
    expect(XML).toContain('xsi:noNamespaceSchemaLocation="AlbertaCorporateIncomeTaxReturn.xsd"');
    const code = XML.match(/<ProgramCode>([^<]*)<\/ProgramCode>/)?.[1];
    expect(code).toMatch(/^[0-9]{2}$/);
    expect(XML.indexOf('<ProgramCode>')).toBeLessThan(XML.indexOf('<Schedule '));
  });

  it('gives every Schedule a 3-character Number', () => {
    const numbers = [...XML.matchAll(/<Schedule Number="([^"]*)"/g)].map((m) => m[1] as string);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(n).toMatch(/^\w{3}$/);
  });

  it('gives every Value a well-formed LineItemID and a value within 175 characters', () => {
    const values = [...XML.matchAll(/<Value LineItemID="([^"]*)">([^<]*)<\/Value>/g)];
    expect(values.length).toBeGreaterThan(100);
    for (const [, id, text] of values) {
      expect(id as string).toMatch(/^\w{3}[0-9]{6}$/);
      expect((text as string).length).toBeLessThanOrEqual(175);
    }
  });

  it('carries no empty Schedule — the XSD requires at least one Value in each', () => {
    for (const [number, fields] of SENT) {
      expect(fields.size, `Schedule ${number} was transmitted with no Value`).toBeGreaterThan(0);
    }
  });
});

describe('a maximal return transmits every schedule it triggers', () => {
  it('files all thirteen schedules plus the jacket and the EDI block', () => {
    expect([...SENT.keys()].sort()).toEqual([
      '000',
      '001',
      '002',
      '003',
      '004',
      '010',
      '012',
      '013',
      '015',
      '016',
      '017',
      '018',
      '020',
      '021',
      '029',
      'EDI',
    ]);
  });

  /**
   * THE REGRESSION. Schedule 2 was absent from every multi-jurisdiction return.
   * The four bases are the ones the factor is computed FROM, so they must agree
   * with the factor the jacket files: ½(1,400,000/2,000,000) + ½(300,000/400,000)
   * = 0.725.
   */
  it('files Schedule 2 with the four bases behind the allocation factor', () => {
    const s2 = new Map(
      [
        ...(XML.match(/<Schedule Number="002">[\s\S]*?<\/Schedule>/)?.[0] ?? '').matchAll(
          /<Value LineItemID="(\d{9})">([^<]*)<\/Value>/g,
        ),
      ].map((m) => [(m[1] as string).slice(3, 6), m[2] as string]),
    );
    expect(s2.get('002')).toBe('300000'); // Alberta salaries
    expect(s2.get('004')).toBe('400000'); // total salaries
    expect(s2.get('006')).toBe('1400000'); // Alberta revenue
    expect(s2.get('008')).toBe('2000000'); // total revenue
    expect(XML).toContain('.725000');
  });
});

describe('every mandatory line the form model describes is transmitted', () => {
  const FORM_TO_SCHEDULE: Record<string, string> = {
    AT1: '000',
    AT1SCH1: '001',
    AT1SCH2: '002',
    AT1SCH03: '003',
    AT1SCH04: '004',
    AT1SCH10: '010',
    AT1SCH12: '012',
    AT1SCH13: '013',
    AT1SCH15: '015',
    AT1SCH16: '016',
    AT1SCH17: '017',
    AT1SCH18: '018',
    AT1SCH20: '020',
    AT1SCH21: '021',
    AT1SCH29: '029',
  };

  /**
   * Mandatory lines that are described but not transmitted — EMPTY, and meant
   * to stay that way.
   *
   * It held two entries when this test was written, both yes/no questions that
   * the transcribed forms described and no builder emitted, so every Schedule 2
   * and every Schedule 12 went to TRA missing a mandatory line:
   *
   *   AT1SCH2 001   "Is the corporation in any of these special allocation
   *                 categories?" §3.2.3.3 derives it — "if special allocation
   *                 rules apply (fed 005100 other than 402), value = 1;
   *                 otherwise, if general allocation (fed 005100 = 402),
   *                 default value = 2" — and this engine computes only the
   *                 general Regulation 402 formula, so 2 is the true answer.
   *   AT1SCH12 100  "Does the corporation's calculation of ABI for Alberta
   *                 purposes differ from its federal ABI?" §3.2.3.13: "set
   *                 value = 1 (Yes) … otherwise, default to 2 (No)", and the
   *                 engine takes the federal figure, which IS the No case.
   *
   * Neither needed asking; both needed filing. Adding an entry here means a
   * mandatory line is knowingly absent from a filed Alberta return, so it must
   * be a deliberate edit with the reason written down.
   */
  const KNOWN_UNFILED_MANDATORY: Record<string, string[]> = {};

  it.each(Object.keys(FORM_TO_SCHEDULE))('%s', (formId) => {
    const form = FORMS.find((f) => f.id === formId);
    expect(form, `${formId} is not in the registry`).toBeDefined();
    if (!form) return;
    const sent = SENT.get(FORM_TO_SCHEDULE[formId] as string) ?? new Set<string>();
    const allowed = new Set(KNOWN_UNFILED_MANDATORY[formId] ?? []);

    const missing = form.fields
      .filter((f) => f.requirement === 'mandatory')
      .map((f) => (f.line.length === 9 ? f.line.slice(3, 6) : f.line))
      .filter((line) => !sent.has(line) && !allowed.has(line));

    expect(
      [...new Set(missing)].sort(),
      `${formId}: mandatory line(s) described by the form model but not transmitted`,
    ).toEqual([]);
  });

  it('has no mandatory line left unfiled anywhere', () => {
    expect(KNOWN_UNFILED_MANDATORY).toEqual({});
  });

  it('files the two gates that were missing, with the defaults the spec supplies', () => {
    expect(SENT.get('002')?.has('001'), 'AT1SCH2 line 001').toBe(true);
    expect(SENT.get('012')?.has('100'), 'AT1SCH12 line 100').toBe(true);
    // "No" on both: the general Reg 402 allocation, and the federal ABI.
    expect(XML).toContain('<Value LineItemID="002001001">2</Value>');
    expect(XML).toContain('<Value LineItemID="012100001">2</Value>');
  });
});

/**
 * The jacket's CONDITIONAL follow-ups — the rules a mandatory-line audit cannot
 * see.
 *
 * Every test above this one asks "is each mandatory (`M`) line transmitted?",
 * and they all passed for months while four conditional (`X`) lines were
 * uncollectable — because `X` lines carry no requirement to be present until
 * their condition is met, so nothing in a mandatory scan ever looks at them.
 *
 * Two of the four are gated on questions THIS APP ASKS, which made it worse
 * than a coverage gap: answering "Yes" to line 038 or line 050 produced a
 * return that broke TRA's own rule, with no box anywhere in the app to satisfy
 * it. The defect was created by the software, not merely unhandled by it.
 *
 * So these tests are written the way the spec states the rules — in both
 * directions, because each rule has two halves and only checking the "must
 * exist" half would miss a stale answer left behind by a gate since changed:
 *
 *   039  "If 000038=1, must be a valid code … If 000038=2, then value must be blank."
 *   051  "If 000050=1, must be a valid code … If 000050=2, field must not exist."
 *   052  "If 000051=1, date of amalgamation must exist."
 *   053  "If 000051=5, date operations ceased must exist. If 000050=2, field must not exist."
 *   050  "If 000039 = 3, then value must = 1."
 */
describe('the jacket files each conditional follow-up exactly when its gate is open', () => {
  const withJacket = (extra: Record<string, unknown>): Record<string, unknown> => ({
    ...maximalReturn,
    alberta: { ...(maximalReturn.alberta as Record<string, unknown>), ...extra },
  });
  const jacketLines = (input: Record<string, unknown>) =>
    transmitted(transmit(input)).get('000') ?? new Set<string>();
  const lineValue = (xml: string, id: string) =>
    xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1];

  it('files 039 when the tax year end changed, with the code chosen', () => {
    const xml = transmit(withJacket({ taxYearEndChanged: 'yes', taxYearEndChangeReason: '2' }));
    expect(transmitted(xml).get('000')?.has('039')).toBe(true);
    expect(lineValue(xml, '000039001')).toBe('2');
  });

  it('drops 039 when the gate is "No", even with an answer still in the draft', () => {
    // The stale-answer case, and the reason the engine gates at emission rather
    // than trusting the caller: a preparer who answers "Yes", picks a reason,
    // then corrects 038 to "No" leaves the reason behind in the saved return.
    // Filing it would break "if 000038=2, then value must be blank" just as
    // surely as omitting it broke the other half.
    const sent = jacketLines(withJacket({ taxYearEndChanged: 'no', taxYearEndChangeReason: '2' }));
    expect(sent.has('038')).toBe(true);
    expect(sent.has('039')).toBe(false);
  });

  it('files 051 and 052 for a final return by amalgamation, and not 053', () => {
    const xml = transmit(
      withJacket({
        finalReturn: 'yes',
        finalReturnReason: '1',
        dateOfAmalgamation: '2025-01-01', // the day after the 2024-12-31 year end
      }),
    );
    const sent = transmitted(xml).get('000') ?? new Set<string>();
    expect(sent.has('051')).toBe(true);
    expect(sent.has('052')).toBe(true);
    expect(sent.has('053'), '053 belongs to reason 5, not reason 1').toBe(false);
    expect(lineValue(xml, '000052001')).toBe('20250101');
  });

  it('files 053 for a dissolution, and not 052', () => {
    const sent = jacketLines(
      withJacket({
        finalReturn: 'yes',
        finalReturnReason: '5',
        dateOperationsCeased: '2024-11-30',
        // Deliberately also present: the wrong date for this reason must not be
        // filed just because it was typed before the reason was changed.
        dateOfAmalgamation: '2025-01-01',
      }),
    );
    expect(sent.has('053')).toBe(true);
    expect(sent.has('052')).toBe(false);
  });

  it('drops 051, 052 and 053 when this is not the final return', () => {
    const sent = jacketLines(
      withJacket({
        finalReturn: 'no',
        finalReturnReason: '1',
        dateOfAmalgamation: '2025-01-01',
        dateOperationsCeased: '2024-11-30',
      }),
    );
    expect(sent.has('050')).toBe(true);
    for (const line of ['051', '052', '053']) {
      expect(sent.has(line), `${line} must not exist when 000050 = 2`).toBe(false);
    }
  });

  it('files 030 and 041 when supplied, and drops them when not', () => {
    // Neither has a gate this return can derive, so the only rule to hold is
    // that supplying one files it and leaving it blank files nothing — never a
    // zero or a "1", which would assert a status the corporation does not have.
    const supplied = jacketLines(
      withJacket({ specialCorporationStatus: '2', functionalCurrency: '1' }),
    );
    expect(supplied.has('030')).toBe(true);
    expect(supplied.has('041')).toBe(true);
    const blank = jacketLines({});
    expect(blank.has('030')).toBe(false);
    expect(blank.has('041')).toBe(false);
  });

  describe('and refuses to transmit when an open gate has no answer', () => {
    const filingData = (extra: Record<string, unknown>) =>
      composeAt1FilingData({
        computed: {
          fields: compute(withJacket(extra)).fields,
          identity: {},
          filingInput: withJacket(extra),
        },
        client: {
          name: 'Maximal Ltd.',
          address: { street: '1 Test Way', city: 'Calgary', province: 'AB', postalCode: 'T2P1A1' },
          corporateAccountNumber: '1234567890',
          businessNumber: '123456782',
          contactPerson: 'Dana QA',
          contactTelephone: '4035550100',
          natureOfBusiness: 'Manufacturing',
          typeOfCorporation: '1',
          authorizedEmail: 'qa@taxfoundry.test',
        },
        engagement: { taxYearStart, taxYearEnd },
        certification: { firstName: 'A', lastName: 'B', position: 'CFO' },
        // `false`, like `transmit()` above: `forFiling: true` deliberately
        // ignores the LIVE client record so a filing can only use the input
        // frozen at compute time, and this fixture's frozen input carries the
        // jacket answers but not the identity block. Leaving it true made every
        // case here fail on missing contact details — an unrelated rule, and it
        // would have masked whether the conditional gates work at all.
        forFiling: false,
      } as never);

    it('names 039 when the tax year end changed but no reason was given', () => {
      expect(() => assertAt1MandatoryComplete(filingData({ taxYearEndChanged: 'yes' }))).toThrow(
        /000039/,
      );
    });

    it('names 051 when it is the final return but no reason was given', () => {
      expect(() => assertAt1MandatoryComplete(filingData({ finalReturn: 'yes' }))).toThrow(
        /000051/,
      );
    });

    it('names 052 when the reason is amalgamation but no date was given', () => {
      expect(() =>
        assertAt1MandatoryComplete(filingData({ finalReturn: 'yes', finalReturnReason: '1' })),
      ).toThrow(/000052/);
    });

    it('names 053 when the reason is dissolution but no date was given', () => {
      expect(() =>
        assertAt1MandatoryComplete(filingData({ finalReturn: 'yes', finalReturnReason: '5' })),
      ).toThrow(/000053/);
    });

    it('reports the contradiction when 039 says "final return" but 050 says No', () => {
      // Line 050's own rule: "If 000039 = 3, then value must = 1." Two given
      // answers that cannot both be true — the preparer has to settle it,
      // because either one could be the mistake.
      expect(() =>
        assertAt1MandatoryComplete(
          filingData({
            taxYearEndChanged: 'yes',
            taxYearEndChangeReason: '3',
            finalReturn: 'no',
          }),
        ),
      ).toThrow(/000050/);
    });

    it('accepts a complete final return by amalgamation', () => {
      expect(() =>
        assertAt1MandatoryComplete(
          filingData({
            finalReturn: 'yes',
            finalReturnReason: '1',
            dateOfAmalgamation: '2025-01-01',
          }),
        ),
      ).not.toThrow();
    });

    it('accepts a return whose gates are all "No" — no follow-up is required then', () => {
      expect(() => assertAt1MandatoryComplete(filingData({}))).not.toThrow();
    });
  });
});

/**
 * Instalments reach the filed return — lines 082 and 090.
 *
 * `At1FilingData.instalmentsPaid` existed, `at1-line-items.ts` filed it as
 * `d.instalmentsPaid ?? 0`, and NOTHING ever set it: `composeAt1FilingData`
 * read the `alberta` slice and never the `payments` one, where the editor
 * actually collects the figure. So every AT1 for a corporation that pays
 * instalments — which is most of them — went to TRA with
 *
 *   082  instalments and other payments = 0
 *   090  balance unpaid                 = overstated by the whole amount paid
 *
 * because 090 subtracts 082. Two wrong figures on the two lines TRA uses to
 * decide what the corporation still owes, and both wrong in the direction that
 * says the corporation owes more than it does.
 *
 * Nothing caught it because the mandatory-line audits ask whether 082 is
 * PRESENT, and a hardcoded zero is present. Being filed is not the same as
 * being right, which is why these assert the value.
 */
describe('instalments reach the filed AT1', () => {
  const withPayments = (instalmentsPaid: number): Record<string, unknown> => ({
    ...maximalReturn,
    payments: { instalmentsPaid },
  });
  const valueOfLine = (xml: string, id: string) =>
    Number(xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1]);

  it('files the instalments at 082 rather than a hardcoded zero', () => {
    const xml = transmit(withPayments(7_500));
    expect(valueOfLine(xml, '000082001')).toBe(7_500);
  });

  it('still files 082 as zero when none were paid — it is mandatory', () => {
    expect(valueOfLine(transmit(maximalReturn), '000082001')).toBe(0);
  });

  it('reduces the balance at 090 by exactly the instalments paid', () => {
    // 090 = 080 − (129 + 082 + 085 + 086 + 115 + 087). Holding everything else
    // equal, paying instalments must move the balance one-for-one — this is the
    // relationship that was broken, not merely a missing field.
    const before = valueOfLine(transmit(maximalReturn), '000090001');
    const after = valueOfLine(transmit(withPayments(7_500)), '000090001');
    expect(before - after).toBe(7_500);
  });

  it('turns a balance owing into an overpayment when instalments exceed the tax', () => {
    // The case a preparer would notice immediately if it were wrong: line 090
    // is signed, and an overpayment is a negative balance rather than a floor
    // at zero. Filing zero here would hide a refund the corporation is owed.
    const taxPayable = valueOfLine(transmit(maximalReturn), '000080001');
    const xml = transmit(withPayments(taxPayable + 3_000));
    expect(valueOfLine(xml, '000090001')).toBeLessThan(0);
  });
});

describe('an Innovation Employment Grant claim without a group says why', () => {
  /**
   * THE REGRESSION. `assembleIeg` used to discard the claim when no group row
   * was entered, so the preparer saw no schedule, no grant and no explanation.
   * The engine already fails closed WITH an instruction; it just never got the
   * chance to say it.
   */
  const noGroup = {
    incomeStatement: { revenue: 1_000_000, otherExpenses: 600_000 },
    alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
    albertaSbd: { corporationStatus: 'ccpc' },
    albertaIeg: { federalAmount: 200_000, albertaPortion: 150_000 },
  };

  it('claims nothing, and tells the preparer to pass the claimant itself', () => {
    const out = compute(noGroup);
    expect(out.schedulePayloads?.some((p) => p.scheduleId === '029')).toBe(false);
    expect(out.issues?.join(' ')).toMatch(/Pass the claimant itself/);
  });
});

describe('the Alberta ABI reconciliation reaches the deduction, not just the page', () => {
  /**
   * §3.2.3.2 for AT1 Schedule 1 line 003: "if 012100 = 1, then value = 012102 +
   * 012104 … otherwise, if form 012 does not exist, default to fed 200400." So
   * answering "Yes" on Schedule 12 line 100 does not merely add three lines —
   * it changes the income the Alberta small business deduction is computed on,
   * and Schedule 1 has to state the same figure it was computed from.
   */
  const withAbi = (s12: Record<string, unknown>) => {
    const input = {
      incomeStatement: { revenue: 1_000_000, otherExpenses: 600_000 },
      sbd: { activeBusinessIncome: 400_000 },
      alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
      albertaSbd: { corporationStatus: 'ccpc' },
      albertaSchedule12: s12,
    };
    const out = compute(input);
    const byField = (scheduleId: string) => {
      const p = out.schedulePayloads?.find((x) => x.scheduleId === scheduleId);
      return new Map((p?.values ?? []).map((v) => [v.lineItemId.slice(3, 6), v.value]));
    };
    const fields = new Map(out.fields.map((f) => [f.line, f.value]));
    return {
      s12: byField('012'),
      s1: byField('001'),
      sbdIncome: fields.get('albertaSbdIncome'),
      taxPayable: fields.get('albertaTaxPayable'),
    };
  };

  it('takes the federal figure when the answer is "No"', () => {
    const r = withAbi({});
    expect(r.s1.get('003')).toBe(400_000);
    expect(r.sbdIncome).toBe(400_000);
    // 400,000 × 2% — all of it within the $500,000 business limit.
    expect(r.taxPayable).toBe(8_000);
  });

  it('computes the deduction on 012106 when the answer is "Yes"', () => {
    const r = withAbi({
      abiDiffersFromFederal: 'yes',
      abiFederalAmount: 400_000,
      abiDiscretionaryAdjustment: -150_000,
    });
    expect(r.s12.get('100')).toBe(1);
    expect(r.s12.get('106')).toBe(250_000); // 400,000 − 150,000
    // Schedule 1 states the amount the deduction was worked out on, not federal's.
    expect(r.s1.get('003')).toBe(250_000);
    expect(r.sbdIncome).toBe(250_000);
    // 250,000 × 2% + 150,000 × 8% = 5,000 + 12,000.
    expect(r.taxPayable).toBe(17_000);
  });
});

/**
 * BUG-002 — does the Innovation Employment Grant reach line 090?
 *
 * Reported as "the IEG computes but never nets into credits/balance (088/090)".
 * The printed jacket strikes 090 as
 *
 *   090 = 080 − (129 + 082 + 085 + 086 + 115 + 087)
 *
 * so a grant must reduce the balance exactly as instalments do. Asserted on the
 * RENDERED XML rather than on the engine, because the reported symptom was a
 * displayed balance, and the question that matters is what goes on the wire.
 */
describe('the Innovation Employment Grant nets into the filed balance', () => {
  const valueOfLine = (xml: string, id: string) =>
    Number(xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1]);

  it('files the grant at 129', () => {
    expect(valueOfLine(transmit(maximalReturn), '000129001')).toBeGreaterThan(0);
  });

  it('reduces 090 by the grant, exactly as the printed formula strikes it', () => {
    const xml = transmit(maximalReturn);
    const tax = valueOfLine(xml, '000080001');
    const grant = valueOfLine(xml, '000129001');
    const instalments = valueOfLine(xml, '000082001');
    const balance = valueOfLine(xml, '000090001');
    expect(balance).toBe(tax - (grant + instalments));
  });

  it('makes 090 an overpayment when the grant exceeds the tax', () => {
    const xml = transmit(maximalReturn);
    const tax = valueOfLine(xml, '000080001');
    const grant = valueOfLine(xml, '000129001');
    // The reported case: a refundable credit larger than the tax must file as a
    // NEGATIVE balance, not floor at zero — a refund transmitted as nil is the
    // corporation silently forgoing money it is owed.
    if (grant > tax) expect(valueOfLine(xml, '000090001')).toBeLessThan(0);
    else expect(valueOfLine(xml, '000090001')).toBe(tax - grant - valueOfLine(xml, '000082001'));
  });
});

/**
 * An AT1 prepared WITHOUT the federal T2 in this app.
 *
 * The normal path computes Alberta taxable income as federal taxable income ×
 * the allocation factor, which is right whenever the T2 is prepared here. It is
 * not the only way an AT1 gets prepared: where the federal return was done in
 * another package there is nothing to derive from, so the federal engine sees
 * an empty return, taxable income is nil, and the entire Alberta tax side
 * collapses to zero — 062, 068, 070 and 080 all $0 — with no way for the
 * preparer to say otherwise.
 *
 * TRA's own jacket does not work that way: it types 062 as an INPUT, because
 * the figure can come off a federal return the preparer is holding on paper.
 *
 * The reference case (P03, an $18M-grind return checked against AuraTax):
 *
 *   062  1,200,000   entered
 *   068     96,000   basic tax
 *   070     30,000   small business deduction
 *   080     66,000   tax payable
 */
describe('an AT1 whose federal return was prepared elsewhere', () => {
  const at1Only: Record<string, unknown> = {
    identification: { corpType: 'ccpc', province: 'AB' },
    alberta: {
      albertaTaxableIncome: 1_200_000,
      grossRevenue: 5_000_000,
      totalAssets: 3_000_000,
      associatedWithCcpcs: 'no',
      windUpOfSubsidiary: 'no',
      firstYearAfterAmalgamation: 'no',
      taxYearEndChanged: 'no',
      finalReturn: 'no',
      transferOfProperty: 'no',
      reportsDifferentAlbertaIncome: 'no',
      electsDifferentDiscretionaryAmounts: 'no',
      preparedByTaxPreparerForFee: 'yes',
    },
    albertaSbd: { corporationStatus: 'ccpc' },
  };
  const lineValue = (xml: string, id: string) =>
    Number(xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1]);

  it('no longer collapses to nil with no federal figures at all', () => {
    const xml = transmit(at1Only);
    expect(lineValue(xml, '000062001')).toBe(1_200_000);
    expect(lineValue(xml, '000068001')).toBeGreaterThan(0);
    expect(lineValue(xml, '000080001')).toBeGreaterThan(0);
  });

  it('files the entered figure as the Alberta figure, not re-allocated', () => {
    // The box is captioned "Alberta taxable income" — already allocated. Running
    // the allocation factor over it again would shrink a figure the preparer
    // read straight off their federal return.
    expect(lineValue(transmit(at1Only), '000062001')).toBe(1_200_000);
  });

  it('still derives 062 when nothing is entered — the default path is untouched', () => {
    const derived = transmit(maximalReturn);
    const entered = lineValue(derived, '000062001');
    expect(entered).toBeGreaterThan(0);
    // And it is the DERIVED figure, not any entered one: `maximalReturn` states
    // no 062, so this proves the override is genuinely opt-in.
    expect((maximalReturn.alberta as Record<string, unknown>).albertaTaxableIncome).toBeUndefined();
  });

  it('computes nil when neither a federal return nor an entered figure exists', () => {
    const { albertaTaxableIncome: _omitted, ...albertaWithout } = at1Only.alberta as Record<
      string,
      unknown
    >;
    const xml = transmit({ ...at1Only, alberta: albertaWithout });
    // Unchanged behaviour, and correct — there is genuinely nothing to report.
    // The review layer raises AT1_NO_INCOME_BASIS so it is not silent.
    expect(lineValue(xml, '000062001')).toBe(0);
  });
});

/**
 * Line 062 discloses taxable income; line 065 allocates it.
 *
 * These were one number. The engine computed `federalTaxableIncome ×
 * allocationFactor` and filed THAT at 062, so every return with a permanent
 * establishment outside Alberta understated its taxable income by the
 * allocation — on a mandatory line.
 *
 * The tax was right, which is why nothing noticed: tax is computed on the
 * allocated base either way. But the return did not RECONCILE. TRA can
 * recompute from what was filed: 066 = 062 × 065, then the rate on 066. From a
 * filed 062 of 870,000 and a factor of 0.725 that yields 630,750 and about
 * 50,460 of tax — against the 69,600 actually filed at 068.
 *
 * Two independent sources fix the meaning of 062, neither ambiguous:
 *
 *   §3.2.3.1   "If both 000060 and 000061 = 2, value = … default = fed 200360
 *              − fed 200370" — federal taxable income, no factor.
 *   AT1SCH12   line 090 "Taxable income for Alberta purposes", noted "Carried
 *              to AT1 page 2, line 062" — and Schedule 12 performs no
 *              allocation; that is Schedule 2, at line 065.
 *
 * Single-jurisdiction returns are identical either way (factor 1.0), which is
 * exactly why this survived: almost every fixture has one jurisdiction.
 */
describe('AT1 line 062 is taxable income BEFORE allocation', () => {
  const lineOf = (xml: string, id: string) =>
    Number(xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1]);

  it('files the whole figure at 062, not the allocated share', () => {
    const xml = transmit(maximalReturn);
    const factor = Number(xml.match(/<Value LineItemID="000065001">([^<]*)</)?.[1]);
    expect(factor, 'this fixture must be multi-jurisdiction or it proves nothing').toBeLessThan(1);
    const taxableIncome = lineOf(xml, '000062001');
    const basicTax = lineOf(xml, '000068001');
    // 068 is struck on the ALLOCATED base, so it must be smaller than the rate
    // applied to the whole of 062 — the relationship that fails when the
    // allocated figure is filed at 062.
    expect(taxableIncome).toBeGreaterThan(basicTax / 0.08);
  });

  it("reconciles against the form's own arithmetic: 068 = rate × (062 × 065)", () => {
    const xml = transmit(maximalReturn);
    const taxableIncome = lineOf(xml, '000062001');
    const factor = Number(xml.match(/<Value LineItemID="000065001">([^<]*)</)?.[1]);
    const amountTaxableInAlberta = Math.round(taxableIncome * factor); // line 066
    expect(lineOf(xml, '000068001')).toBe(Math.round(0.08 * amountTaxableInAlberta));
  });
});

/**
 * Schedule 10's non-capital column can be stated on the Alberta side.
 *
 * It was the only one of the four that could not. `scheduleTen` read
 * `federal.lossCarryback` and nothing else, while the capital, farm and
 * other-loss columns beside it all accepted Alberta-side rows — so a preparer
 * whose federal return was prepared in another package could request a capital
 * carry-back but not a non-capital one, the commonest kind. An asymmetry with
 * no reason behind it: federal HAS a non-capital carry-back input, so the
 * default worked, and nobody noticed the case where there is no federal return
 * to default from.
 *
 * The federal derivation is untouched and still the default.
 */
describe('AT1 Schedule 10 — the non-capital carry-back', () => {
  const at1Only = (extra: Record<string, unknown>): Record<string, unknown> => ({
    identification: { corpType: 'ccpc', province: 'AB' },
    alberta: {
      albertaTaxableIncome: 400_000,
      grossRevenue: 900_000,
      totalAssets: 500_000,
      associatedWithCcpcs: 'no',
      windUpOfSubsidiary: 'no',
      firstYearAfterAmalgamation: 'no',
      taxYearEndChanged: 'no',
      finalReturn: 'no',
      transferOfProperty: 'no',
      reportsDifferentAlbertaIncome: 'no',
      electsDifferentDiscretionaryAmounts: 'yes',
      preparedByTaxPreparerForFee: 'yes',
    },
    albertaSbd: { corporationStatus: 'ccpc' },
    ...extra,
  });
  const sentUnder = (input: Record<string, unknown>) =>
    transmitted(transmit(input)).get('010') ?? new Set<string>();

  it('files the non-capital column from Alberta-side rows with no federal return', () => {
    const sent = sentUnder(
      at1Only({
        albertaContinuity: {
          nonCapitalOpening: 50_000,
          // The loss the request is drawn from. Without it the engine refuses
          // the carry-back — correctly, since with no federal return the
          // current-year loss reads nil and a request larger than the loss is
          // not one TRA can accept.
          nonCapitalCurrentYearLoss: 12_000,
          nonCapitalCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 9_500 }],
        },
      }),
    );
    // 002 is the column's current-year loss and 004 the first preceding year —
    // neither appeared at all when the column could only come from federal.
    expect(sent.has('004'), 'non-capital 1st preceding year').toBe(true);
  });

  it('files nothing for the column when no rows are stated and there is no federal loss', () => {
    expect(
      sentUnder(at1Only({ albertaContinuity: { nonCapitalOpening: 50_000 } })).has('004'),
    ).toBe(false);
  });

  it('leaves the federal derivation as the default', () => {
    // `maximalReturn` states no Alberta non-capital rows, so anything filed in
    // that column still comes from the federal return — the behaviour this
    // change must not disturb.
    expect(
      (maximalReturn.albertaContinuity as Record<string, unknown>).nonCapitalCarrybacks,
    ).toBeUndefined();
    expect(() => transmit(maximalReturn)).not.toThrow();
  });
});

/**
 * A short taxation year prorates the Alberta base amount, end to end.
 *
 * The rule is AT1 Schedule 1's own Area B: "If the taxation year is shorter
 * than 51 weeks, the corporation's base amount is the amount allocated to it
 * multiplied by the ratio that the number of days in the year is to 365."
 *
 * Nothing applied it, so a stub year claimed the whole annual limit — too much
 * deduction, therefore too little Alberta tax. Stub years are ordinary:
 * incorporation, amalgamation, wind-up and an approved year-end change each
 * produce one, and this app asks about the last two on the jacket (032, 038).
 *
 * The federal side already prorated correctly — `computeFederalT2` derives the
 * factor from the period itself — which is part of why the Alberta gap was easy
 * to miss: the same return was right federally and wrong provincially.
 *
 * Asserted through the real chain rather than on the engine, because the engine
 * only prorates when it is given the period, and the question here is whether
 * the server hands it over.
 */
describe('a short Alberta taxation year prorates the base amount', () => {
  const stub = (taxYearEnd: Date) => {
    const assembled = assembleT2Input(
      { ...maximalReturn } as never,
      { taxYearStart, taxYearEnd, program: 'AT1' } as never,
    ) as Record<string, unknown>;
    const p = assembled.period as { start: string; end: string; label: string };
    const fed = {
      ...assembled,
      period: { start: new Date(p.start), end: new Date(p.end), label: p.label },
    };
    const computed = runAT1Compute(
      assembleProvincialInput('AT1', fed, maximalReturn as never, { isCcpc: true }),
    ) as Computed;
    return Number(
      computed.fields.find((f) => f.line === 'albertaSmallBusinessDeduction')?.value ?? 0,
    );
  };

  it('claims less on a half year than on a full one', () => {
    const full = stub(new Date('2024-12-31'));
    const half = stub(new Date('2024-06-30')); // 182 days
    expect(full).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it('prorates by the DAYS, not by a flat fraction', () => {
    // Two different stub lengths must give two different deductions. The exact
    // days ÷ 365 ratio is asserted in ca-tax's own unit tests, in isolation:
    // here the deduction is the LESSER of active business income, the limit and
    // taxable income, and the general rate is day-weighted over the same
    // period, so measuring the ratio off this fixture would be measuring three
    // effects at once. This asserts the one thing this layer owns — that the
    // period reaches the engine at all.
    expect(stub(new Date('2024-06-30'))).not.toBe(stub(new Date('2024-03-31')));
  });
});

/**
 * AT1 Schedule 12 line 034 — the SR&ED figure carried from Schedule 16.
 *
 * The pair was described by the form model and accepted by nothing: the
 * payload builder had no input for it, and the server computed Schedule 16,
 * filed it as its own form, and never passed it to Schedule 12. So 034 could
 * not be filed however the return was prepared.
 *
 * A bench run found it on a negative-pool case: Schedule 16 computed 016 =
 * −30,000 and Schedule 12 line 034 rendered "—", while its sibling 035 showed
 * 0 — which is what made it look like a display bug rather than a missing
 * wire.
 *
 * §3.2.3.13 states the rule, and the negative case is the whole point of it:
 *
 *   "If form 016 exists and if 016016 is negative, then value = 016016.
 *    Otherwise, value = 016020."
 *
 * Line 016 is a SUBTOTAL that can go negative — a pool exhausted past zero is
 * an income INCLUSION, not a deduction — and then the inclusion is what
 * Schedule 12 reconciles, not the nil claim at 020.
 */
describe('AT1 Schedule 12 carries the SR&ED figure from Schedule 16', () => {
  const withSred = (sred: Record<string, unknown>): Record<string, unknown> => ({
    ...maximalReturn,
    albertaSred16: sred,
  });
  const sch12 = (input: Record<string, unknown>) =>
    transmitted(transmit(input)).get('012') ?? new Set<string>();
  const valueAt = (xml: string, id: string) =>
    Number(xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1]);

  it('files 034 when a Schedule 16 was prepared', () => {
    expect(
      sch12(
        withSred({
          currentYearExpenditures: 120_000,
          openingPoolBalance: 30_000,
          amountClaimed: 40_000,
        }),
      ).has('034'),
    ).toBe(true);
  });

  it('carries a negative pool as a negative — the case that was empty', () => {
    // Deductions exceeding the pool drive line 016 below zero.
    const xml = transmit(
      withSred({ currentYearExpenditures: 0, assistance: 30_000, openingPoolBalance: 0 }),
    );
    expect(valueAt(xml, '012034001')).toBeLessThan(0);
  });

  it('files nothing at 034 when no Schedule 16 exists', () => {
    // `maximalReturn` carries one, so strip it for this case.
    const { albertaSred16: _omitted, ...withoutSred } = maximalReturn;
    expect(sch12(withoutSred).has('034')).toBe(false);
  });
});

/**
 * A return whose ONLY Alberta divergence is SR&ED still files Schedule 12.
 *
 * Schedule 12 is filed when anything it reconciles exists, and
 * `scientificResearch` was missing from that list. The omission was invisible
 * on every ordinary return — CCA, reserves, dispositions, losses or donations
 * each pull the schedule in — and total on the one case that has none of them:
 * Schedule 16 filed on its own, and the entire reconciliation went missing,
 * including line 090, the Alberta taxable income that feeds jacket line 062.
 *
 * That is what the bench was really seeing. It reported line 034 rendering "—"
 * and noted in passing that 090 did too "although the engine holds $100,000".
 * Both are the same cause: there was no Schedule 12 on the return at all.
 *
 * The fourth appearance of one shape in this composer — a schedule omitted
 * although Alberta-side data for it exists. The IEG did it on an empty group,
 * Schedule 18 on an uncategorized disposition, Schedule 13 on an empty federal
 * CCA.
 */
describe('Schedule 12 is filed when SR&ED is the only divergence', () => {
  const sredOnly: Record<string, unknown> = {
    identification: { corpType: 'ccpc', province: 'AB' },
    incomeStatement: { revenue: 100_000 },
    alberta: {
      grossRevenue: 100_000,
      totalAssets: 50_000,
      associatedWithCcpcs: 'no',
      windUpOfSubsidiary: 'no',
      firstYearAfterAmalgamation: 'no',
      taxYearEndChanged: 'no',
      finalReturn: 'no',
      transferOfProperty: 'no',
      reportsDifferentAlbertaIncome: 'no',
      electsDifferentDiscretionaryAmounts: 'yes',
      preparedByTaxPreparerForFee: 'no',
    },
    albertaSbd: { corporationStatus: 'ccpc' },
    // Deductions with no pool drive Schedule 16 line 016 negative.
    albertaSred16: { currentYearExpenditures: 0, assistance: 30_000 },
  };
  const lineOf = (xml: string, id: string) =>
    Number(xml.match(new RegExp(`<Value LineItemID="${id}">([^<]*)</Value>`))?.[1]);

  it('files the schedule at all', () => {
    expect((transmitted(transmit(sredOnly)).get('012') ?? new Set()).size).toBeGreaterThan(0);
  });

  it('carries the negative pool to 034', () => {
    expect(lineOf(transmit(sredOnly), '012034001')).toBe(-30_000);
  });

  it('files 090, the taxable income that feeds jacket 062', () => {
    const xml = transmit(sredOnly);
    expect(lineOf(xml, '012090001')).toBe(100_000);
    // And the jacket agrees — 090 is carried to 062.
    expect(lineOf(xml, '000062001')).toBe(100_000);
  });
});
