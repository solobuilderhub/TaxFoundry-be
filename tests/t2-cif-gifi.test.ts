/**
 * `buildGifiFromReturn` (T2 CIF filing) maps this app's balance-sheet/income-
 * statement fields onto GIFI codes. Regression test for
 * research/findings/federal/gifi-capital-assets-cost-of-sales-code-fix.md:
 * capitalAssetsNet/costOfSales used to file under the wrong leaf codes
 * (1740/8320 instead of 2008/8518), and 2008 was filed as a net figure
 * against a code that's technically the gross-cost total.
 */
import { describe, expect, it } from 'vitest';
import { buildGifiFromReturn } from '../src/filing/t2-cif.service.js';

describe('buildGifiFromReturn — capital assets (2008/2009)', () => {
  it('files the net figure at 2008 alone when no accumulated amortization is entered', () => {
    const result = buildGifiFromReturn({
      balanceSheet: { capitalAssetsNet: 150_000 },
    });
    const code2008 = result?.gifi.schedule100.find((l) => l.code === '2008');
    const code2009 = result?.gifi.schedule100.find((l) => l.code === '2009');
    expect(code2008?.amount).toBe(150_000);
    expect(code2009?.amount).toBe(0);
    // Not the old, wrong leaf code.
    expect(result?.gifi.schedule100.some((l) => l.code === '1740')).toBe(false);
  });

  it('adds accumulated amortization back to file the GROSS total at 2008, and the amortization itself at 2009', () => {
    const result = buildGifiFromReturn({
      balanceSheet: { capitalAssetsNet: 150_000, accumulatedAmortization: 40_000 },
    });
    const code2008 = result?.gifi.schedule100.find((l) => l.code === '2008');
    const code2009 = result?.gifi.schedule100.find((l) => l.code === '2009');
    expect(code2008?.amount).toBe(190_000); // 150,000 net + 40,000 accumulated amortization
    expect(code2009?.amount).toBe(40_000);
  });

  it("does not change this app's own total-assets figure (2599) — it stays on the NET capital-assets input", () => {
    const withoutAmort = buildGifiFromReturn({ balanceSheet: { capitalAssetsNet: 150_000 } });
    const withAmort = buildGifiFromReturn({
      balanceSheet: { capitalAssetsNet: 150_000, accumulatedAmortization: 40_000 },
    });
    const total = (r: typeof withoutAmort) => r?.gifi.schedule100.find((l) => l.code === '2599')?.amount;
    expect(total(withoutAmort)).toBe(total(withAmort));
  });
});

describe('buildGifiFromReturn — cost of sales (8518)', () => {
  it('files costOfSales at 8518, not the old 8320 leaf code', () => {
    const result = buildGifiFromReturn({
      incomeStatement: { revenue: 500_000, costOfSales: 200_000 },
    });
    expect(result?.gifi.schedule125.find((l) => l.code === '8518')?.amount).toBe(200_000);
    expect(result?.gifi.schedule125.some((l) => l.code === '8320')).toBe(false);
  });
});
