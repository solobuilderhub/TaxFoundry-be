/**
 * T2 line 400 when the preparer leaves it blank: capped at net income for tax.
 *
 * The federal assembly defaults it to book net income. TRA Test Case 1 books
 * 981,200 before 1,001,000 of CCA — a loss for tax — and that book figure went
 * out as Alberta active business income on Schedule 1.
 */
import { describe, expect, it } from 'vitest';
import { capDefaultedActiveBusinessIncome } from '../src/engine/assemble-provincial-input.js';
import { assembleT2Input } from '../src/engine/assemble-t2-input.js';
import { TRA_CASES } from './fixtures/tra-cases.js';

const federalInput = (returnInput: Record<string, unknown>) => {
  const c = TRA_CASES.tc1;
  const engagement = { taxYearStart: c.taxYearStart, taxYearEnd: c.taxYearEnd, program: 'T2' };
  const assembled = assembleT2Input(returnInput as never, engagement as never) as Record<
    string,
    unknown
  >;
  const p = assembled.period as { start: string; end: string; label: string };
  return {
    ...assembled,
    period: { start: new Date(p.start), end: new Date(p.end), label: p.label },
    isCcpc: true,
  } as { activeBusinessIncome: number };
};

describe('a defaulted active business income', () => {
  const ri = TRA_CASES.tc1.returnInput as unknown as Record<string, unknown>;

  it('starts from book net income, which ignores the CCA', () => {
    expect(federalInput(ri).activeBusinessIncome).toBe(981_200);
  });

  it('is capped at net income for tax — nil in a loss year', () => {
    expect(
      capDefaultedActiveBusinessIncome(federalInput(ri), ri as never).activeBusinessIncome,
    ).toBe(0);
  });

  it('leaves a figure the preparer stated alone', () => {
    const stated = { ...ri, sbd: { ...(ri.sbd as object), activeBusinessIncome: 12_345 } };
    expect(
      capDefaultedActiveBusinessIncome(federalInput(stated), stated as never).activeBusinessIncome,
    ).toBe(12_345);
  });
});
