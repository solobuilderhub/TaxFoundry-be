/**
 * .cor import — a filed T2's GIFI statements and identification, loaded from
 * a CRA Corporation Internet Filing file.
 *
 * No real .cor corpus is checked in (`tests/fixtures/cor/` holds a .gitkeep),
 * so these round-trip through `@classytic/ledger-ca/cor`'s own `CORGenerator`:
 * the same package that parses the file writes it, which pins the two to each
 * other and to the field codes both implement (001/002 header, 040 business
 * number, 060/061 dates, 750 province, GIFI account lines).
 */
import { CORGenerator } from '@classytic/ledger-ca/cor';
import { describe, expect, it } from 'vitest';
import { importCorFile } from '../src/engine/cor-import.js';

function sampleCor(overrides: { businessNumber?: string; accounts?: Record<string, number> } = {}) {
  const generator = new CORGenerator();
  return generator.generate({
    header: {
      corporationNumber: '1234567',
      corporationName: 'Riverside Logistics Corp.',
      taxYear: 2024,
      taxPeriod: 1,
      startDate: new Date('2024-01-01T00:00:00Z'),
      endDate: new Date('2024-12-31T00:00:00Z'),
    },
    company: {
      businessNumber: overrides.businessNumber ?? '123456789RC0001',
      address: { line1: '100 Main St', city: 'Calgary', province: 'AB', country: 'CA', postalCode: 'T2P0A1' },
      provinceCode: 'AB',
      businessActivityCodes: ['484110'],
      businessDescription: 'Freight trucking',
    },
    directors: [],
    accounts: Object.entries(
      overrides.accounts ?? {
        '1000': 50_000, // cash
        '1060': 30_000, // accounts receivable
        '1740': 40_000, // capital assets
        '2620': 25_000, // accounts payable
        '3500': 10_000, // share capital
        '3600': 85_000, // retained earnings
        '8299': 400_000, // total revenue
        '8320': 180_000, // cost of sales
        '9060': 90_000, // salaries
      },
    ).map(([gifiCode, value]) => ({ gifiCode, value })),
  });
}

describe('importCorFile', () => {
  it('reads the corporation the file is for, so the editor can check it against the client', () => {
    const r = importCorFile(sampleCor());
    expect(r.identification.corporationName).toBe('Riverside Logistics Corp.');
    expect(r.identification.businessNumber).toBe('123456789RC0001');
    expect(r.identification.taxYearStart).toBe('2024-01-01');
    expect(r.identification.taxYearEnd).toBe('2024-12-31');
    expect(r.identification.taxYear).toBe(2024);
    expect(r.identification.provinceCode).toBe('AB');
    expect(r.identification.address.city).toBe('Calgary');
    expect(r.identification.businessActivityCodes).toContain('484110');
  });

  it('classifies the GIFI accounts through the same path as a pasted trial balance', () => {
    const r = importCorFile(sampleCor());
    expect(r.gifiAccountsInFile).toBe(9);
    expect(r.balanceSheet.cash).toBe(50_000);
    expect(r.balanceSheet.accountsReceivable).toBe(30_000);
    expect(r.balanceSheet.capitalAssetsNet).toBe(40_000);
    expect(r.balanceSheet.accountsPayable).toBe(25_000);
    expect(r.incomeStatement.revenue).toBe(400_000);
    expect(r.incomeStatement.costOfSales).toBe(180_000);
    expect(r.incomeStatement.salariesAndWages).toBe(90_000);
    expect(r.bookNetIncome).toBe(400_000 - 180_000 - 90_000);
    expect(r.totals.balanced).toBe(true);
  });

  it('carries the parser’s own warnings rather than swallowing them', () => {
    const r = importCorFile(`${sampleCor()}\nTHIS IS NOT A COR LINE\n`);
    expect(Array.isArray(r.parsingWarnings)).toBe(true);
    expect(Array.isArray(r.parsingErrors)).toBe(true);
  });

  it('reports a file with no GIFI accounts as having none, for the route to refuse', () => {
    const r = importCorFile(sampleCor({ accounts: {} }));
    expect(r.gifiAccountsInFile).toBe(0);
    expect(r.mappedLines).toBe(0);
  });

  it('refuses empty content outright', () => {
    expect(() => importCorFile('')).toThrow();
  });
});
