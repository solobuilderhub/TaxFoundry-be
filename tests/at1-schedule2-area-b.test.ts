/**
 * Schedule 2 Area B through the composer — the special formula's factor is
 * the one the engine taxes with, and the formula's lines are what files.
 */
import { At1SpecialAllocationError } from '@classytic/ca-tax/t2';
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };

type Out = {
  allocation?: unknown;
  allocationFactor?: number;
  schedules?: {
    allocation?: {
      specialAllocationCategory?: boolean;
      special?: { formula: string; lines: Record<string, number> };
    };
  };
};
const at1 = (ri: unknown, fed: unknown = { period }) =>
  assembleProvincialInput('AT1', fed, ri as never, { isCcpc: true }) as Out;

describe('Schedule 2 Area B in the composer', () => {
  it('taxes at the special formula’s factor and files its lines, not Area A', () => {
    const out = at1({
      alberta: {
        specialAllocationFormula: 'insurance',
        allocationAreaB: { l046: 25_000, l048: 100_000, l012: 9 }, // l012 belongs to another formula
        allocationTotalRevenue: 1, // Area A left behind — ignored once Area B applies
      },
    });
    expect(out.allocationFactor).toBe(0.25);
    expect(out.allocation).toBeUndefined();
    expect(out.schedules?.allocation).toEqual({
      specialAllocationCategory: true,
      special: { formula: 'insurance', lines: { '046': 25_000, '048': 100_000 } },
    });
  });

  it('divided businesses divides by Alberta taxable income', () => {
    const out = at1({
      alberta: {
        albertaTaxableIncome: 120_000,
        specialAllocationFormula: 'divided-businesses',
        allocationAreaB: { l106: 30_000 },
      },
    });
    expect(out.allocationFactor).toBe(0.25);
    expect(out.schedules?.allocation?.special?.lines).toEqual({ '106': 30_000, '108': 120_000 });
  });

  it('refuses an incomplete formula, naming the lines', () => {
    expect(() =>
      at1({ alberta: { specialAllocationFormula: 'railway', allocationAreaB: { l082: 1 } } }),
    ).toThrow(At1SpecialAllocationError);
  });
});

describe('Schedule 2 Area B — through the AT1 engine', () => {
  it('files 002001 = 1 with the formula lines, and 065 at its factor', async () => {
    const { runAT1Compute } = await import('../src/engine/at1-compute.js');
    const input = at1(
      {
        alberta: {
          albertaTaxableIncome: 200_000,
          specialAllocationFormula: 'trust-loan',
          allocationAreaB: { l066: 50_000, l068: 200_000 },
        },
      },
      { period, bookNetIncome: 200_000, activeBusinessIncome: 0 },
    );
    const result = runAT1Compute(input as never, 'test') as unknown as {
      fields: { line: string; value: unknown }[];
      schedulePayloads?: { scheduleId: string; values: { lineItemId: string; value: number }[] }[];
    };
    expect(result.fields.find((f) => f.line === 'allocationFactor')?.value).toBe(0.25);
    const s2 = result.schedulePayloads?.find((p) => p.scheduleId === '002');
    expect(s2?.values.map((v) => [v.lineItemId, v.value])).toEqual([
      ['002001001', 1],
      ['002066001', 50_000],
      ['002068001', 200_000],
    ]);
  });
});
