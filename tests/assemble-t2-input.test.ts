/**
 * `assembleT2Input` — pure, no DB access, so directly testable. Had ZERO test
 * coverage before this file even though it's the function that turns the
 * guided editor's raw `ReturnInput` into the engine's `FederalT2Input` for
 * every T2 compute. Starting with the s.112 dividend deduction (`divisionC`)
 * and Schedule 3's portfolio-dividend split (`scheduleThree`), since those
 * were found to be genuinely wired but genuinely untested while investigating
 * `dividendsDeductibleS112`.
 */
import { describe, expect, it } from 'vitest';
import { assembleT2Input } from '../src/engine/assemble-t2-input.js';

const engagement = {
  taxYearStart: new Date('2024-01-01'),
  taxYearEnd: new Date('2024-12-31'),
  program: 'T2',
};

describe('assembleT2Input — Division C s.112 dividend deduction', () => {
  it('carries taxableReceivedConnected into divisionCDeductions, labeled and cited', () => {
    const out = assembleT2Input({ dividends: { taxableReceivedConnected: 45_000 } }, engagement);
    expect(out.divisionCDeductions).toEqual([
      { label: 'Taxable dividends deductible under s.112/113', amount: 45_000, ref: 's.112' },
    ]);
  });

  it('omits the deduction entirely when nothing was entered — not a zero-amount line', () => {
    const out = assembleT2Input({}, engagement);
    expect(out.divisionCDeductions).toEqual([]);
  });

  it('does not conflate the s.112 (connected) figure with the Part IV (portfolio) figure', () => {
    const out = assembleT2Input(
      {
        dividends: {
          taxableReceivedConnected: 45_000, // → divisionCDeductions (s.112)
          taxableReceivedPortfolio: 12_000, // → portfolioDividendsReceived (Part IV)
        },
      },
      engagement,
    );
    expect(out.divisionCDeductions).toEqual([
      { label: 'Taxable dividends deductible under s.112/113', amount: 45_000, ref: 's.112' },
    ]);
    expect(out.portfolioDividendsReceived).toBe(12_000);
  });
});

describe('assembleT2Input — Schedule 7 Part 1/2 detail (deriving AII/AAII)', () => {
  it('leaves aaii unset (not 0) when nothing was entered, so aaiiDetail can still win downstream', () => {
    const out = assembleT2Input({ sbd: { activeBusinessIncome: 100_000 } }, engagement);
    expect(out.aaii).toBeUndefined();
  });

  it('carries an explicit aaii through unchanged', () => {
    const out = assembleT2Input({ sbd: { aaii: 60_000 } }, engagement);
    expect(out.aaii).toBe(60_000);
  });

  it('carries aaiiDetail through with only the entered fields present', () => {
    const out = assembleT2Input(
      { sbd: { aaiiDetail: { taxableCapitalGains: 90_000, allowableCapitalLosses: 15_000 } } },
      engagement,
    );
    expect(out.adjustedAggregateInvestmentIncomeDetail).toEqual({
      taxableCapitalGains: 90_000,
      allowableCapitalLosses: 15_000,
    });
  });

  it('carries aiiDetail through separately from aaiiDetail — genuinely different bases', () => {
    const out = assembleT2Input(
      {
        sbd: {
          aiiDetail: { taxableCapitalGains: 100_000 },
          aaiiDetail: { taxableCapitalGains: 60_000 },
        },
      },
      engagement,
    );
    expect(out.aggregateInvestmentIncomeDetail).toEqual({ taxableCapitalGains: 100_000 });
    expect(out.adjustedAggregateInvestmentIncomeDetail).toEqual({ taxableCapitalGains: 60_000 });
  });
});

describe('assembleT2Input — Schedule 8, a NEW class 13/14 addition', () => {
  it('derives the class 13 Schedule III period count from the lease-end date, not a typed-in number', () => {
    const out = assembleT2Input(
      {
        cca: {
          class13Layers: [{ capitalCost: 100_000, leaseEnd: '2033-12-31' }],
          class13OpeningUCC: 100_000,
        },
      },
      engagement, // taxYearStart 2024-01-01
    );
    // 2024-01-01 → 2033-12-31 is exactly ten 12-month periods.
    expect(out.class13?.layers[0]).toMatchObject({ capitalCost: 100_000, periods: 10 });
    expect(out.class13?.openingUCC).toBe(100_000);
  });

  it('a lease with renewal rights uses the first-renewal end date instead', () => {
    const out = assembleT2Input(
      {
        cca: {
          class13Layers: [
            { capitalCost: 50_000, leaseEnd: '2027-12-31', firstRenewalEnd: '2030-12-31' },
          ],
          class13OpeningUCC: 50_000,
        },
      },
      engagement,
    );
    // 2024-01-01 → 2030-12-31 is seven 12-month periods, not the three to leaseEnd.
    expect(out.class13?.layers[0]?.periods).toBe(7);
  });

  it('carries a class 14 property through with its own remaining-life days', () => {
    const out = assembleT2Input(
      {
        cca: {
          class14Properties: [{ capitalCost: 80_000, lifeDaysAtAcquisition: 3650 }],
          class14OpeningUCC: 80_000,
          class14Claim: 5_000,
        },
      },
      engagement,
    );
    expect(out.class14).toEqual({
      properties: [{ capitalCost: 80_000, lifeDaysAtAcquisition: 3650 }],
      openingUCC: 80_000,
      claim: 5_000,
    });
  });

  it('omits class13/class14 entirely when nothing was entered', () => {
    const out = assembleT2Input({ cca: { classes: [{ ccaClass: '8', openingUCC: 1000 }] } }, engagement);
    expect(out.class13).toBeUndefined();
    expect(out.class14).toBeUndefined();
  });
});
