import { describe, expect, it } from 'vitest';
import { at1ClientIdentityFlags } from '../src/review/review-generator.service.js';

/**
 * The AT1 client-identity review checks — both "not filled in" and "filled in
 * wrong".
 *
 * The second kind was missing, and it is the one that costs a preparer a
 * rejected transmission: a field holding prose passes every blank-check in the
 * app and in the filing path, because those ask whether something is there, not
 * whether it is the right shape. TRA then rejects the return, which is the
 * slowest place to find out.
 *
 * Both fields checked here are CODED — the value is transmitted verbatim and
 * the code IS the answer — so "Holding company" in the nature-of-business box
 * is not untidy formatting, it is an unparseable statement. The constraints are
 * §3.2.3.1's own type column:
 *
 *   028  Nature of Business   N  4   "Must be a valid code from the SIC codes"
 *   029  Type of Corporation  N  1   codes 1-5
 */

const complete = {
  address: { street: '1 Test Way', city: 'Calgary' },
  corporateAccountNumber: '1234567890',
  contactPerson: 'Dana QA',
  contactTelephone: '4035550100',
  natureOfBusiness: '0198',
  typeOfCorporation: '1',
  authorizedEmail: 'qa@taxfoundry.test',
};

const codesOf = (client: Record<string, unknown>) =>
  at1ClientIdentityFlags('AT1', client).map((f) => f.code);
const messageOf = (client: Record<string, unknown>, code: string) =>
  at1ClientIdentityFlags('AT1', client).find((f) => f.code === code)?.message ?? '';

describe('AT1 client identity review flags', () => {
  it('raises nothing for a complete, well-formed client', () => {
    expect(at1ClientIdentityFlags('AT1', complete)).toEqual([]);
  });

  it('ignores non-AT1 programs entirely', () => {
    expect(at1ClientIdentityFlags('T2', {})).toEqual([]);
  });

  it('flags a nature of business that is not a 4-digit SIC code', () => {
    // The exact mistake that prompted this: a plain-English description typed
    // into a numeric field, which reads as filled in everywhere else.
    const codes = codesOf({ ...complete, natureOfBusiness: 'Holding company' });
    expect(codes).toContain('AT1_CLIENT_IDENTITY_MALFORMED');
    expect(codes).not.toContain('AT1_CLIENT_IDENTITY_INCOMPLETE');
  });

  it('names the offending value and the expected shape', () => {
    const msg = messageOf(
      { ...complete, natureOfBusiness: 'Holding company' },
      'AT1_CLIENT_IDENTITY_MALFORMED',
    );
    expect(msg).toMatch(/000028/);
    expect(msg).toMatch(/4-digit/);
    expect(msg).toContain('Holding company');
  });

  it('rejects a SIC code of the wrong LENGTH, not merely a non-numeric one', () => {
    for (const bad of ['198', '01988', '19.8', '']) {
      const codes = codesOf({ ...complete, natureOfBusiness: bad });
      // An empty string is absent, not malformed — it belongs to the other flag.
      const expected =
        bad === '' ? 'AT1_CLIENT_IDENTITY_INCOMPLETE' : 'AT1_CLIENT_IDENTITY_MALFORMED';
      expect(codes, `natureOfBusiness ${JSON.stringify(bad)}`).toContain(expected);
    }
  });

  it('accepts a SIC code with a leading zero as the string it is', () => {
    // 0198 is a real code and must not be normalized to 198 anywhere.
    expect(codesOf({ ...complete, natureOfBusiness: '0198' })).toEqual([]);
  });

  it('flags a type of corporation outside the printed list', () => {
    expect(codesOf({ ...complete, typeOfCorporation: '9' })).toContain(
      'AT1_CLIENT_IDENTITY_MALFORMED',
    );
    expect(codesOf({ ...complete, typeOfCorporation: 'ccpc' })).toContain(
      'AT1_CLIENT_IDENTITY_MALFORMED',
    );
  });

  it('accepts every code the printed form offers for 029', () => {
    for (const code of ['1', '2', '3', '4', '5']) {
      expect(codesOf({ ...complete, typeOfCorporation: code }), `code ${code}`).toEqual([]);
    }
  });

  it('reports missing and malformed separately, so each says what to do', () => {
    const codes = codesOf({
      ...complete,
      natureOfBusiness: 'Holding company',
      authorizedEmail: '',
    });
    expect(codes).toContain('AT1_CLIENT_IDENTITY_MALFORMED');
    expect(codes).toContain('AT1_CLIENT_IDENTITY_INCOMPLETE');
  });

  it('does not judge whether a well-formed code is a REAL SIC code', () => {
    // The SIC list is the specification's Section 3.5 and is not modelled here.
    // Calling 9999 invalid would assert more than this app knows; the shape is
    // the part that can be checked honestly.
    expect(codesOf({ ...complete, natureOfBusiness: '9999' })).toEqual([]);
  });
});

import { at1SilentNilFlags } from '../src/review/review-generator.service.js';

/**
 * A claim that computes to nothing, said out loud.
 *
 * The defect here is SILENCE. A schedule can be present, answered, and worth
 * real money, and still produce zero because one input nobody asked for is
 * missing — and the return then files a nil claim with nothing saying a claim
 * was attempted at all. The preparer sees a schedule they filled in and a
 * figure of $0, with no way to tell whether that is the right answer.
 */
const codes = (program: string, ri: Record<string, unknown>, fold: Record<string, number> = {}) =>
  at1SilentNilFlags(program, ri, fold).map((f) => f.code);

const withIncome = { incomeStatement: { revenue: 1_000_000 } };

describe('AT1 silent-nil review flags', () => {
  it('ignores non-AT1 programs', () => {
    expect(at1SilentNilFlags('T2', {}, {})).toEqual([]);
  });

  describe('Schedule 29 — an IEG claim with no members roster', () => {
    it('flags a claim whose roster is empty, because it computes to $0', () => {
      // The real case: the agreement table filled, the roster empty, and the
      // grant silently nil. Adding the roster on one test return moved it from
      // $0 to $31,250 with no warning at any point in between.
      expect(
        codes('AT1', { ...withIncome, albertaIeg: { federalAmount: 200_000, group: [] } }),
      ).toContain('AT1_IEG_NO_GROUP_ROSTER');
    });

    it('flags it when the claim is expressed only as projects', () => {
      expect(
        codes('AT1', { ...withIncome, albertaIeg: { projects: [{ title: 'Project A' }] } }),
      ).toContain('AT1_IEG_NO_GROUP_ROSTER');
    });

    it('stays quiet once the roster is supplied', () => {
      expect(
        codes('AT1', {
          ...withIncome,
          albertaIeg: { federalAmount: 200_000, group: [{ name: 'Claimant Ltd.' }] },
        }),
      ).not.toContain('AT1_IEG_NO_GROUP_ROSTER');
    });

    it('stays quiet when no grant was claimed at all', () => {
      // Nothing attempted is not a silent nil — it is simply a return with no
      // IEG, which is most of them.
      expect(codes('AT1', withIncome)).not.toContain('AT1_IEG_NO_GROUP_ROSTER');
      expect(codes('AT1', { ...withIncome, albertaIeg: {} })).not.toContain(
        'AT1_IEG_NO_GROUP_ROSTER',
      );
    });
  });

  describe('no income basis — the whole tax side reads zero', () => {
    it('explains why 062 and everything under it is nil', () => {
      // Not a bug: the AT1 is computed FROM the federal figures. But a preparer
      // working behind the "AT1 only" nav filter sees every number at zero with
      // nothing saying which schedules are missing.
      expect(codes('AT1', {}, { albertaTaxableIncome: 0 })).toContain('AT1_NO_INCOME_BASIS');
    });

    it('points at the federal schedules and at the filter hiding them', () => {
      const msg = at1SilentNilFlags('AT1', {}, { albertaTaxableIncome: 0 })[0]?.message ?? '';
      expect(msg).toMatch(/GIFI 125/);
      expect(msg).toMatch(/AT1 only/);
    });

    it('stays quiet once any income figure is entered', () => {
      expect(codes('AT1', withIncome, { albertaTaxableIncome: 0 })).not.toContain(
        'AT1_NO_INCOME_BASIS',
      );
    });

    it('stays quiet for a return that has computed real Alberta income', () => {
      expect(codes('AT1', withIncome, { albertaTaxableIncome: 1_200_000 })).not.toContain(
        'AT1_NO_INCOME_BASIS',
      );
    });

    it('does not fire on an expense-only return — that is a real loss, not an empty one', () => {
      expect(
        codes('AT1', { incomeStatement: { otherExpenses: 40_000 } }, { albertaTaxableIncome: 0 }),
      ).not.toContain('AT1_NO_INCOME_BASIS');
    });
  });
});
