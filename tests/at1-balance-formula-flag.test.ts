import { describe, expect, it } from 'vitest';
import { at1BalanceFormulaFlags } from '../src/review/review-generator.service.js';

/**
 * AT1 line 090 is struck as TRA's PRINTED form strikes it, not as the Net File
 * specification's own line-090 rule states it. The two disagree by exactly the
 * Innovation Employment Grant and the Film and Television Tax Credit — see
 * `AT1_BALANCE_CREDIT_LINES` in ca-tax's `at1/forms/jacket.ts`.
 *
 * This flag is the disclosure. It must fire when, and only when, the choice
 * actually changes the filed balance.
 */
describe('AT1_BALANCE_FORMULA_CONFLICT', () => {
  it('stays silent when the two formulas agree', () => {
    expect(at1BalanceFormulaFlags('AT1', { albertaTaxPayable: 100_000 })).toEqual([]);
    expect(
      at1BalanceFormulaFlags('AT1', {
        innovationEmploymentGrant: 0,
        filmAndTelevisionTaxCredit: 0,
      }),
    ).toEqual([]);
  });

  it('fires amber, naming the amount, once an IEG is claimed', () => {
    const [flag] = at1BalanceFormulaFlags('AT1', { innovationEmploymentGrant: 25_000 });
    expect(flag?.code).toBe('AT1_BALANCE_FORMULA_CONFLICT');
    // Amber, never red: the figure filed is the defensible one, so a preparer
    // must not be blocked from signing off over a documentation lag at TRA.
    expect(flag?.severity).toBe('amber');
    expect(flag?.message).toContain('25000');
    expect(flag?.message).toContain('Innovation Employment Grant');
  });

  it('names the film credit too, but only when there is one', () => {
    const [withFilm] = at1BalanceFormulaFlags('AT1', {
      innovationEmploymentGrant: 10_000,
      filmAndTelevisionTaxCredit: 5_000,
    });
    expect(withFilm?.message).toContain('Film and Television Tax Credit');
    expect(withFilm?.message).toContain('15000');

    const [withoutFilm] = at1BalanceFormulaFlags('AT1', { innovationEmploymentGrant: 10_000 });
    expect(withoutFilm?.message).not.toContain('Film and Television Tax Credit');
  });

  it('is Alberta-only — the federal and Québec balances are unaffected', () => {
    expect(at1BalanceFormulaFlags('T2', { innovationEmploymentGrant: 25_000 })).toEqual([]);
    expect(at1BalanceFormulaFlags('CO17', { innovationEmploymentGrant: 25_000 })).toEqual([]);
  });
});
