/**
 * Line-level diagnostics engine — data-driven completeness / consistency rules.
 */
import { describe, it, expect } from 'vitest';
import { runDiagnostics, DIAGNOSTIC_RULES, type DiagnosticContext } from '../src/review/diagnostics.js';

const ctx = (over: Partial<DiagnosticContext>): DiagnosticContext => ({
  program: 'T2',
  fold: {},
  ri: {},
  client: null,
  hasComputed: true,
  ...over,
});

const codes = (c: DiagnosticContext) => runDiagnostics(c).map((d) => d.code);

describe('runDiagnostics', () => {
  it('flags a missing corp type (line 040) as red', () => {
    const found = runDiagnostics(ctx({})).find((d) => d.code === 'D_CORP_TYPE_REQUIRED');
    expect(found?.severity).toBe('red');
    expect(found?.line).toBe('040');
  });

  it('clears the corp-type diagnostic when set on the client', () => {
    expect(codes(ctx({ client: { corpType: 'CCPC' } }))).not.toContain('D_CORP_TYPE_REQUIRED');
  });

  it('flags a missing province (Schedule 5) as amber', () => {
    const d = runDiagnostics(ctx({ client: { corpType: 'CCPC' } })).find((x) => x.code === 'D_PROVINCE_MISSING');
    expect(d?.severity).toBe('amber');
    expect(d?.line).toBe('750');
  });

  it('flags missing financials unless the return is inactive', () => {
    expect(codes(ctx({ client: { corpType: 'CCPC' } }))).toContain('D_INCOME_STATEMENT_REQUIRED');
    expect(codes(ctx({ client: { corpType: 'CCPC' }, ri: { identification: { inactive: true } } })))
      .not.toContain('D_INCOME_STATEMENT_REQUIRED');
  });

  it('a complete return raises no red diagnostics', () => {
    const complete = ctx({
      client: { corpType: 'CCPC', businessNumber: '100000000' },
      ri: {
        identification: { corpType: 'CCPC', province: 'ON' },
        incomeStatement: { revenue: 500000 },
        balanceSheet: { cash: 100000 },
      },
      fold: { taxableIncome: 200000, partITaxPayable: 18000, totalOwing: 1800000 },
    });
    expect(runDiagnostics(complete).filter((d) => d.severity === 'red')).toHaveLength(0);
  });

  it('catches Part I tax on nil income (red)', () => {
    const d = runDiagnostics(ctx({ client: { corpType: 'CCPC' }, fold: { taxableIncome: 0, partITaxPayable: 5000 } }))
      .find((x) => x.code === 'D_TAX_ON_NIL_INCOME');
    expect(d?.severity).toBe('red');
  });

  it('every rule has a code and a message', () => {
    for (const r of DIAGNOSTIC_RULES) {
      expect(r.code).toBeTruthy();
      expect(r.message).toBeTruthy();
    }
  });
});
