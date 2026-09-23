/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-106 — "BIG_BOOK_TAX_DIFF false positive
 * with a wrong figure": book net income = taxable income = $300,000, no
 * Schedule 1 additions or deductions, and the review flagged "a large
 * book-to-tax difference ($300,000)" on a return where book == tax exactly.
 *
 * Reproduced exactly against the actual review-flag pipeline. Root cause:
 * `evaluateReviewFlags` runs ONE shared check for every program and reads
 * `fold.netIncomeForTax` to compare against book income — the federal T2
 * compute has always emitted a field by that name, but AT1's own compute
 * never did (it has no comparable concept internally; it only ever receives
 * `federalTaxableIncome`, a downstream figure). So on EVERY AT1 return the
 * comparison ran against an absent figure defaulting to $0, producing a
 * "difference" the size of the whole return regardless of whether book and
 * tax actually agreed — the reported $300,000 IS the return's own book
 * income, read verbatim off the diff. Québec CO-17 shares the same review
 * check and had the identical gap.
 *
 * Fixed by carrying `federal.netIncomeForTax` through `assembleProvincialInput`
 * as an extra property on the assembled engine input — NOT consumed by
 * `computeAlbertaReturn`/`computeQuebecReturn`, which is why both engine
 * `validate()` functions (hand-written type guards, not closed schemas) let
 * it pass through untouched — and re-emitting it as a field in at1-compute.ts
 * / co17-compute.ts, matching the name the shared review check already reads.
 */
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';
import { evaluateReviewFlags } from '../src/review/review-generator.service.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };
const base = {
  alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
  albertaSbd: { corporationStatus: 'ccpc' },
};

function flagsFor(bookNetIncome: number) {
  const fed = {
    period,
    bookNetIncome,
    activeBusinessIncome: bookNetIncome,
    ccaClasses: [],
    capitalDispositions: [],
    charitableDonations: 0,
    openingDonationPool: 0,
    reserveContinuity: [],
    openingNonCapitalLoss: 0,
    nonCapitalLossToApply: 0,
  };
  const ri = { ...base, incomeStatement: { revenue: bookNetIncome } };
  const out = runAT1Compute(
    assembleProvincialInput('AT1', fed as never, ri as never, { isCcpc: true }),
  );
  const fold: Record<string, number> = {};
  for (const f of out.fields ?? []) if (typeof f.value === 'number') fold[f.line] = f.value;
  return {
    fold,
    flags: evaluateReviewFlags({
      corpType: 'CCPC',
      businessNumber: '123456782',
      fold,
      ri: ri as never,
      taxYear: 2024,
      rateYearCertified: true,
    }),
  };
}

describe('AT1 compute — netIncomeForTax reaches the fold (BUG-106)', () => {
  it('an AT1 return with no Schedule 1 adjustments emits netIncomeForTax matching book income', () => {
    const { fold } = flagsFor(300_000);
    expect(fold.netIncomeForTax).toBe(300_000);
  });

  it("matches the report's own exact repro: book == tax, no S1 entries → the flag stays silent", () => {
    const { flags } = flagsFor(300_000);
    expect(flags.map((f) => f.code)).not.toContain('BIG_BOOK_TAX_DIFF');
  });

  it('a genuine book-to-tax gap still fires the flag — the fix does not neuter the real check', () => {
    const flags = evaluateReviewFlags({
      corpType: 'CCPC',
      businessNumber: '123456782',
      fold: { netIncomeForTax: 400_000 },
      ri: { incomeStatement: { revenue: 100_000 } } as never,
      taxYear: 2024,
      rateYearCertified: true,
    });
    expect(flags.map((f) => f.code)).toContain('BIG_BOOK_TAX_DIFF');
  });
});
