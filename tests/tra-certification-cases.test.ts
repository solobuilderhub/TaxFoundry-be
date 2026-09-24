/**
 * TRA's Fall 2025 AT1 certification test cases, end to end.
 *
 * Each case is a working return shaped exactly as the editor's forms save it
 * (`fixtures/tra-cases.ts`), run through the real filing chain and rendered as
 * the Net File payload. The figures asserted here are worked by hand from the
 * case text and §3.2.3 of TRA's specification — never read back off the
 * engine — so a change that moves one of them is a change to what TRA would
 * receive, and has to be argued for.
 *
 * Running these against the new forms found four defects no unit test had:
 * Schedule 10 line 002 filed the federal loss where §3.2.3.11 requires
 * Schedule 21's 037; Schedule 21 line 047 ignored the Alberta carry-back rows;
 * the capital column mixed gross and net amounts, refusing a carry-back of the
 * whole loss; and every schedule date went out as YYYY-MM-DD instead of the
 * eight-character YYYYMMDD.
 */
import { assertAt1MandatoryComplete, validateAt1Transmitter } from '@classytic/ca-tax/t2';
import { describe, expect, it } from 'vitest';
import { runCase } from '../scripts/validate/tra-cases.js';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { assembleT2Input } from '../src/engine/assemble-t2-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';
import { composeAt1FilingData } from '../src/engine/at1-netfile.service.js';
import { TRA_CASES } from './fixtures/tra-cases.js';

/** `SSSFFFOOO` → value, for every Value in the payload. */
function lines(xml: string): Map<string, string> {
  return new Map(
    [...xml.matchAll(/<Value LineItemID="(\w{3}\d{6})">([^<]*)<\/Value>/g)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );
}

const CASES = ['tc1', 'tc1a', 'tc2', 'tc3'] as const;

describe.each(CASES)('TRA %s — a payload TRA can accept', (id) => {
  const { xml } = runCase(id);

  it('conforms to the XSD’s own constraints', () => {
    expect(xml).toContain('xsi:noNamespaceSchemaLocation="AlbertaCorporateIncomeTaxReturn.xsd"');
    for (const [, lineId, text] of xml.matchAll(/<Value LineItemID="([^"]*)">([^<]*)<\/Value>/g)) {
      expect(lineId as string).toMatch(/^\w{3}[0-9]{6}$/);
      expect((text as string).length).toBeLessThanOrEqual(175);
    }
  });

  it('files every date in the eight-character YYYYMMDD form (§3.2.3: D 8)', () => {
    expect(xml).not.toMatch(/>\d{4}-\d{2}-\d{2}/);
  });

  it('is complete by TRA’s mandatory-field rules, transmitter included', () => {
    expect(() => assertAt1MandatoryComplete(composedData(id))).not.toThrow();
    expect(validateAt1Transmitter(composedData(id).transmitter)).toEqual([]);
  });
});

/** The filing data `runCase` renders, for the completeness checks that run on it. */
function composedData(id: keyof typeof TRA_CASES) {
  const c = TRA_CASES[id];
  const engagement = { taxYearStart: c.taxYearStart, taxYearEnd: c.taxYearEnd, program: 'AT1' };
  const assembled = assembleT2Input(c.returnInput as never, engagement as never) as Record<
    string,
    unknown
  >;
  const p = assembled.period as { start: string; end: string; label: string };
  const fed = {
    ...assembled,
    period: { start: new Date(p.start), end: new Date(p.end), label: p.label },
  };
  const computed = runAT1Compute(
    assembleProvincialInput('AT1', fed, c.returnInput as never, { isCcpc: true }),
  ) as { fields: { line: string; value: unknown }[] };
  return composeAt1FilingData({
    computed: { fields: computed.fields, identity: {}, filingInput: c.returnInput },
    client: c.client,
    engagement: { taxYearStart: c.taxYearStart, taxYearEnd: c.taxYearEnd },
    certification: { firstName: 'Dana', lastName: 'Whitecourt', position: 'President' },
    forFiling: false,
  } as never);
}

describe('TRA Test Case 1 — Alberta loss, CCA divergence, carry-backs', () => {
  const v = lines(runCase('tc1').xml);

  it('reconciles to TRA’s $25,000 Alberta loss on Schedule 12 and the jacket', () => {
    expect(v.get('012002001')).toBe('-19800'); // federal net income
    expect(v.get('012004001')).toBe('1006200'); // Alberta CCA
    expect(v.get('012005001')).toBe('1001000'); // federal CCA
    expect(v.get('012054001')).toBe('-25000');
    expect(v.get('000062001')).toBe('-25000');
    expect(v.get('000080001')).toBe('0');
  });

  it('files Schedule 13 with the Alberta-only claims on classes 1 and 13', () => {
    expect(v.get('013019002')).toBe('200'); // class 1: 4% × 5,000
    expect(v.get('013019003')).toBe('5000'); // class 13: the full 5,000
    expect(v.get('013013003')).toBe('NA'); // "If a rate is not applicable, enter NA."
    expect(v.get('013045001')).toBe('1000000'); // class 8 immediate expensing
    expect(v.get('013027001')).toBe('1006200');
  });

  it('carries back Schedule 21’s own loss on Schedule 10 (§3.2.3.11: 010002 = 021037)', () => {
    expect(v.get('021037001')).toBe('25000');
    expect(v.get('010002001')).toBe('25000');
    expect([v.get('010004001'), v.get('010006001'), v.get('010008001')]).toEqual([
      '10000',
      '3000',
      '2500',
    ]);
    expect(v.get('010010001')).toBe('9500');
    expect([v.get('010003001'), v.get('010005001'), v.get('010007001')]).toEqual([
      '20230831',
      '20220831',
      '20210831',
    ]);
  });

  it('files Schedule 10’s total at Schedule 21 line 047 (§3.2.3.21: 021047 = 010004 + 006 + 008)', () => {
    expect(v.get('021047001')).toBe('15500');
    expect(v.get('021049001')).toBe('109500'); // 100,000 + 25,000 − 15,500
  });

  it('carries capital losses GROSS: 150,000, all of it carried back, ½ applied per year', () => {
    expect(v.get('021057001')).toBe('150000'); // −(Schedule 18 total)
    expect(v.get('010042001')).toBe('150000'); // = 021057
    expect(v.get('010043001')).toBe('0.500000');
    expect([v.get('010044001'), v.get('010046001'), v.get('010048001')]).toEqual([
      '50000',
      '50000',
      '50000',
    ]);
    expect(v.get('010050001')).toBe('0');
    expect(v.get('021069001')).toBe('100000'); // 100,000 + 150,000 − 150,000
  });

  it('files the certification names in the spec’s order — 097 surname, 098 first name', () => {
    expect(v.get('000097001')).toBe('Whitecourt');
    expect(v.get('000098001')).toBe('Dana');
  });
});

describe('TRA Test Case 1 AMENDED — loss 50,000, first carry-back 35,000', () => {
  const v = lines(runCase('tc1a').xml);

  it('moves 002, the carry-back and the continuity together', () => {
    expect(v.get('012054001')).toBe('-50000');
    expect(v.get('010002001')).toBe('50000');
    expect(v.get('010004001')).toBe('35000');
    expect(v.get('010010001')).toBe('9500'); // 50,000 − 40,500
    expect(v.get('021047001')).toBe('40500');
    expect(v.get('021049001')).toBe('109500');
  });
});

describe.each([
  [
    'tc2',
    {
      base110: '32000',
      over125: '18000',
      capital: '25000000',
      factor: '0.625000',
      grant: '31250',
      limit: '4010959',
    },
  ],
  [
    'tc3',
    {
      base110: '80000',
      over125: '39000',
      capital: '20000000',
      factor: '0.750000',
      grant: '89250',
      limit: '4010959',
    },
  ],
] as const)('TRA %s — a $NIL return claiming the Innovation Employment Grant', (id, want) => {
  const v = lines(runCase(id).xml);

  it('computes the grant by hand', () => {
    expect(v.get('029110001')).toBe(want.base110); // 8% of this year's Alberta expenditures
    expect(v.get('029125001')).toBe(want.over125); // 12% of the amount above the base
    expect(v.get('029126001')).toBe(want.capital); // the group's prior-year taxable capital
    expect(v.get('029128001')).toBe(want.factor); // (50M − capital) ÷ 40M
    expect(v.get('029130001')).toBe(want.grant);
    expect(v.get('000129001')).toBe(want.grant);
  });

  it('files nil Alberta tax and nets the grant into the balance, as the printed AT1 does', () => {
    expect(v.get('000080001')).toBe('0');
    expect(v.get('000090001')).toBe(`-${want.grant}`);
  });

  it('prorates the group limit by the longest year’s days (§3.2.3.29: $4,000,000 × line 206 ÷ 365)', () => {
    expect(v.get('029206001')).toBe('366'); // 2024 spans 29 February
    expect(v.get('029208001')).toBe(want.limit);
  });
});
