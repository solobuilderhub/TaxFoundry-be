/**
 * AT1 Schedule 1 — filed from the jacket's own answers, and computed in full.
 *
 * Two defects a tester hit on the AuraTax baseline (062 = 100,000, 003 =
 * 100,000, 029 = 1): Schedule 1's Form View showed 007/009/013/015 as "—" and
 * an empty calculation table, while the jacket claimed a $6,000 deduction.
 *
 *   1. Eligibility was a separate Schedule 1 question, collected in the guided
 *      view only. Unanswered, Schedule 1 was not filed at all — but the jacket
 *      still granted the deduction on the client's corporation type.
 *      TRA §3.2.3.2 decides it from the jacket: Schedule 1 exists if 029 = 1 or
 *      2, or 030 = 3 or 4; never if 030 = 5.
 *   2. The table (A-G) and its total at 031 were never computed.
 *
 * The invariant held here for every scenario: whenever jacket 070 is claimed,
 * Schedule 1 is filed and its 031 equals 070.
 */
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { assembleT2Input } from '../src/engine/assemble-t2-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const no = 'no';
const questions = {
  associatedWithCcpcs: no,
  windUpOfSubsidiary: no,
  firstYearAfterAmalgamation: no,
  taxYearEndChanged: no,
  finalReturn: no,
  transferOfProperty: no,
  reportsDifferentAlbertaIncome: no,
  electsDifferentDiscretionaryAmounts: no,
  preparedByTaxPreparerForFee: no,
};

function compute(
  alberta: Record<string, unknown>,
  opts: {
    abi?: number;
    isCcpc?: boolean;
    year?: [string, string];
    extra?: Record<string, unknown>;
  } = {},
) {
  const [start, end] = opts.year ?? ['2025-01-01', '2025-12-31'];
  const engagement = { program: 'AT1', taxYearStart: new Date(start), taxYearEnd: new Date(end) };
  const ri = {
    alberta: { ...questions, ...alberta },
    payments: { instalmentsPaid: 5_000 },
    sbd: { activeBusinessIncome: opts.abi ?? 100_000 },
    ...opts.extra,
  };
  const t2 = assembleT2Input(ri as never, engagement as never) as Record<string, unknown> & {
    period: { start: string; end: string; label: string };
  };
  const isCcpc = opts.isCcpc ?? true;
  const fed = {
    ...t2,
    period: {
      start: new Date(t2.period.start),
      end: new Date(t2.period.end),
      label: t2.period.label,
    },
    isCcpc,
  };
  const out = runAT1Compute(assembleProvincialInput('AT1', fed as never, ri as never, { isCcpc }));
  const f = Object.fromEntries(out.fields.map((x) => [x.line, x.value])) as Record<string, number>;
  const s1 = (out.schedulePayloads ?? []).find((p) => p.scheduleId === '001') as
    | {
        values: { lineItemId: string; value: unknown }[];
        display?: { lineItemId: string; value: unknown }[];
        tables?: {
          sbdCalculation?: { rows: { days: number; deduction?: number }[]; line031: number };
        };
      }
    | undefined;
  const line = (field: string) =>
    [...(s1?.values ?? []), ...(s1?.display ?? [])].find((v) => v.lineItemId.slice(3, 6) === field)
      ?.value;
  return { f, s1, line };
}

describe('AT1 Schedule 1 — the AuraTax baseline', () => {
  it('files Schedule 1 from 029 alone and matches AuraTax line for line', () => {
    const { f, s1, line } = compute({ albertaTaxableIncome: 100_000, typeOfCorporation: '1' });
    expect(s1).toBeDefined();
    expect(line('003')).toBe(100_000);
    expect(line('007')).toBe(100_000);
    expect(line('009')).toBe(100_000);
    expect(line('013')).toBe(100_000);
    expect(line('015')).toBe(200_000);
    expect(line('031')).toBe(6_000);
    const lastRow = s1?.tables?.sbdCalculation?.rows.at(-1);
    expect(lastRow).toMatchObject({ days: 365, deduction: 6_000 });
    expect(f.basicAlbertaTax).toBe(8_000); // 068
    expect(f.albertaSmallBusinessDeduction).toBe(6_000); // 070
    expect(f.albertaTaxPayable).toBe(2_000); // 080
  });

  it('031 is print-only: it never enters the transmitted values', () => {
    const { s1 } = compute({ albertaTaxableIncome: 100_000, typeOfCorporation: '1' });
    expect(s1?.values.some((v) => v.lineItemId.slice(3, 6) === '031')).toBe(false);
  });
});

describe('AT1 Schedule 1 — eligibility is the jacket’s, per §3.2.3.2', () => {
  it('029 = 3 (other private): no Schedule 1 and no deduction', () => {
    const { f, s1 } = compute({ albertaTaxableIncome: 100_000, typeOfCorporation: '3' });
    expect(f.albertaSmallBusinessDeduction).toBe(0);
    expect(f.albertaTaxPayable).toBe(8_000);
    expect(s1?.tables?.sbdCalculation?.line031 ?? 0).toBe(0);
  });

  it('029 = 5 (CCPC at year end, not throughout): no deduction', () => {
    const { f } = compute({ albertaTaxableIncome: 100_000, typeOfCorporation: '5' });
    expect(f.albertaSmallBusinessDeduction).toBe(0);
  });

  it('030 = 5 (s.149 exempt): no deduction, even with 029 = 1', () => {
    const { f } = compute({
      albertaTaxableIncome: 100_000,
      typeOfCorporation: '1',
      specialCorporationStatus: '5',
    });
    expect(f.albertaSmallBusinessDeduction).toBe(0);
  });

  it('029 blank: the client’s corporation type decides, and Schedule 1 agrees with the jacket', () => {
    const { f, s1, line } = compute({ albertaTaxableIncome: 100_000 });
    expect(f.albertaSmallBusinessDeduction).toBe(6_000);
    expect(s1).toBeDefined();
    expect(line('031')).toBe(6_000);
  });
});

describe('AT1 Schedule 1 — a short year files the prorated base amount at 015', () => {
  it('Jan 1 - Jun 30: 015 = 200,000 × 181/365, and 031 = 070 = $14,877', () => {
    const { f, line } = compute(
      { albertaTaxableIncome: 400_000, typeOfCorporation: '1' },
      { abi: 400_000, year: ['2025-01-01', '2025-06-30'] },
    );
    expect(line('015')).toBe(99_178);
    expect(f.albertaSmallBusinessDeduction).toBe(14_877);
    expect(line('031')).toBe(14_877);
  });
});

// A year straddling a rate change is covered in ca-tax's own table test: the
// host rate book starts at 2024, so no straddling year can be computed here.
describe('AT1 Schedule 1 — 031 always equals jacket 070', () => {
  const cases: [string, Record<string, unknown>, Parameters<typeof compute>[1]][] = [
    [
      'ABI below taxable income',
      { albertaTaxableIncome: 300_000, typeOfCorporation: '1' },
      { abi: 120_000 },
    ],
    [
      'income above the $500,000 threshold',
      { albertaTaxableIncome: 900_000, typeOfCorporation: '1' },
      { abi: 900_000 },
    ],
    [
      'a short year',
      { albertaTaxableIncome: 400_000, typeOfCorporation: '1' },
      { abi: 400_000, year: ['2025-01-01', '2025-06-30'] },
    ],
    [
      'the taxable-capital grind',
      { albertaTaxableIncome: 400_000, typeOfCorporation: '1' },
      {
        abi: 400_000,
        extra: { sbd: { activeBusinessIncome: 400_000, taxableCapital: 25_000_000 } },
      },
    ],
  ];
  for (const [name, alberta, opts] of cases) {
    it(name, () => {
      const { f, s1, line } = compute(alberta, opts);
      expect(f.albertaSmallBusinessDeduction).toBeGreaterThan(0);
      expect(s1).toBeDefined();
      expect(line('031')).toBe(f.albertaSmallBusinessDeduction);
    });
  }
});
