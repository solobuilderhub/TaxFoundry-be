/**
 * Line-level diagnostics engine — data-driven completeness / consistency rules.
 */
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_RULES,
  type DiagnosticContext,
  runDiagnostics,
} from '../src/review/diagnostics.js';

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
    const d = runDiagnostics(ctx({ client: { corpType: 'CCPC' } })).find(
      (x) => x.code === 'D_PROVINCE_MISSING',
    );
    expect(d?.severity).toBe('amber');
    expect(d?.line).toBe('750');
  });

  /**
   * The province is typed on the CLIENT record — the return editor has no
   * province control at all. Reading only `ri.identification.province` made the
   * review say "province not set" to a preparer looking at a client whose
   * registered address plainly said Alberta.
   */
  it('does NOT flag a missing province when it is set on the client record', () => {
    expect(codes(ctx({ client: { corpType: 'CCPC', province: 'AB' } }))).not.toContain(
      'D_PROVINCE_MISSING',
    );
  });

  it('says where the province is entered, since it is not on the return', () => {
    const d = runDiagnostics(ctx({ client: { corpType: 'CCPC' } })).find(
      (x) => x.code === 'D_PROVINCE_MISSING',
    );
    expect(d?.message).toMatch(/client record/i);
  });

  it('flags missing financials unless the return is inactive', () => {
    expect(codes(ctx({ client: { corpType: 'CCPC' } }))).toContain('D_INCOME_STATEMENT_REQUIRED');
    expect(
      codes(ctx({ client: { corpType: 'CCPC' }, ri: { identification: { inactive: true } } })),
    ).not.toContain('D_INCOME_STATEMENT_REQUIRED');
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
    const d = runDiagnostics(
      ctx({ client: { corpType: 'CCPC' }, fold: { taxableIncome: 0, partITaxPayable: 5000 } }),
    ).find((x) => x.code === 'D_TAX_ON_NIL_INCOME');
    expect(d?.severity).toBe('red');
  });

  it('every rule has a code and a message', () => {
    for (const r of DIAGNOSTIC_RULES) {
      expect(r.code).toBeTruthy();
      expect(r.message).toBeTruthy();
    }
  });
});

/**
 * A multi-jurisdiction return names its provinces on the allocation schedule,
 * one permanent establishment per province. That is the OTHER way a return says
 * where the corporation operates, and reading only the single-province path
 * flagged a corporation that had named two provinces explicitly.
 */
describe('the province is named in two different places', () => {
  it('accepts a permanent establishment list as naming the province', () => {
    expect(
      codes(
        ctx({
          client: { corpType: 'CCPC' },
          ri: {
            provincialAllocation: { establishments: [{ province: 'ON' }, { province: 'BC' }] },
          },
        }),
      ),
    ).not.toContain('D_PROVINCE_MISSING');
  });

  it('still flags an establishment list with no province on it', () => {
    expect(
      codes(
        ctx({
          client: { corpType: 'CCPC' },
          ri: { provincialAllocation: { establishments: [{ grossRevenue: 100 }] } },
        }),
      ),
    ).toContain('D_PROVINCE_MISSING');
  });

  it('names both routes in the message, since the preparer may need either', () => {
    const d = runDiagnostics(ctx({ client: { corpType: 'CCPC' } })).find(
      (x) => x.code === 'D_PROVINCE_MISSING',
    );
    expect(d?.message).toMatch(/client record/i);
    expect(d?.message).toMatch(/Provincial Allocation/i);
  });
});
