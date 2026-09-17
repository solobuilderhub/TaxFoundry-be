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
