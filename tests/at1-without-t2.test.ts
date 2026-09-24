/**
 * An AT1 whose T2 was prepared elsewhere — no federal schedules in this app.
 *
 * Two figures had nowhere to be typed on the Alberta side and read nil from
 * the empty federal return: Schedule 2's allocation (so a corporation with a
 * permanent establishment outside Alberta was taxed as 100% Alberta) and the
 * gross current-year capital loss (so a capital carry-back had nothing to
 * draw on). Both are typed on the AT1 forms now and win over the federal
 * derivation; blank still means "take it from the T2".
 */
import { computeAllocationFactor } from '@classytic/ca-tax/t2';
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };
const emptyFederal = { period };

type Out = {
  allocation?: {
    albertaSalaries: number;
    totalSalaries: number;
    albertaGrossRevenue: number;
    totalGrossRevenue: number;
  };
  schedules?: {
    allocation?: Record<string, number>;
    lossCarryback?: { capital?: { totalCarriedBack: number } };
    losses?: { capital?: { currentYearLoss: number; carriedBack: number } };
  };
};

const at1 = (fed: unknown, ri: unknown) =>
  assembleProvincialInput('AT1', fed, ri as never, { isCcpc: true }) as Out;

describe('Schedule 2 typed on the AT1', () => {
  const typed = {
    alberta: {
      allocationAlbertaSalaries: 60_000,
      allocationTotalSalaries: 100_000,
      allocationAlbertaRevenue: 300_000,
      allocationTotalRevenue: 500_000,
    },
  };

  it('allocates from the typed figures when there is no federal Schedule 5', () => {
    const out = at1(emptyFederal, typed);
    expect(out.allocation).toEqual({
      albertaSalaries: 60_000,
      totalSalaries: 100_000,
      albertaGrossRevenue: 300_000,
      totalGrossRevenue: 500_000,
    });
    expect(computeAllocationFactor(out.allocation!)).toBe(0.6);
    // …and files Schedule 2 showing where the factor came from.
    expect(out.schedules?.allocation).toEqual({
      albertaSalaries: 60_000,
      totalSalaries: 100_000,
      albertaRevenue: 300_000,
      totalRevenue: 500_000,
    });
  });

  it('wins over the federal establishments as a set, never mixed', () => {
    const fed = {
      period,
      permanentEstablishments: [
        { province: 'AB', grossRevenue: 1, salariesWages: 1 },
        { province: 'BC', grossRevenue: 1, salariesWages: 1 },
      ],
    };
    const out = at1(fed, {
      alberta: { allocationAlbertaRevenue: 40, allocationTotalRevenue: 100 },
    });
    // Salaries are NOT topped up from Schedule 5 — the typed set says nil.
    expect(out.allocation).toEqual({
      albertaSalaries: 0,
      totalSalaries: 0,
      albertaGrossRevenue: 40,
      totalGrossRevenue: 100,
    });
  });

  it('leaves the federal roll-up in charge when every box is blank', () => {
    const fed = {
      period,
      permanentEstablishments: [
        { province: 'AB', grossRevenue: 50, salariesWages: 0 },
        { province: 'BC', grossRevenue: 50, salariesWages: 0 },
      ],
    };
    expect(at1(fed, { alberta: {} }).allocation?.totalGrossRevenue).toBe(100);
  });

  it('treats typed zeros as no allocation basis — 100% Alberta, no Schedule 2', () => {
    const out = at1(emptyFederal, {
      alberta: { allocationTotalSalaries: 0, allocationTotalRevenue: 0 },
    });
    expect(out.allocation).toBeUndefined();
    expect(out.schedules?.allocation).toBeUndefined();
  });
});

describe('capital loss typed on the AT1', () => {
  it('carries back against the typed gross capital loss with no federal figure', () => {
    const out = at1(emptyFederal, {
      albertaContinuity: {
        capitalCurrentYearLoss: 20_000,
        capitalCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 5_000 }],
      },
    });
    expect(out.schedules?.lossCarryback?.capital?.totalCarriedBack).toBe(5_000);
  });

  it('is the same figure on Schedule 21', () => {
    const out = at1(emptyFederal, {
      albertaContinuity: {
        capitalOpening: 0,
        capitalCurrentYearLoss: 20_000,
        capitalCarrybacks: [{ taxYearEnd: '2023-12-31', amount: 5_000 }],
      },
    });
    expect(out.schedules?.losses?.capital?.currentYearLoss).toBe(20_000);
    expect(out.schedules?.losses?.capital?.carriedBack).toBe(5_000);
  });
});
