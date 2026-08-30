/**
 * The AT1 jacket answers reach the payload from the EDITOR, not from nowhere.
 *
 * THE BUG THIS EXISTS FOR. The composition read the jacket answers off
 * `computed.identity` — which carries only the client-derived fields (legal
 * name, address, tax year) — instead of `computed.filingInput`, which is where
 * the editor's slices are frozen at compute time. Every answer resolved to
 * `undefined`. Nothing failed: typecheck was clean, 1,072 tests were green, and
 * the payload simply omitted nine mandatory lines.
 *
 * It survived because the composition was welded into a database-backed service
 * and no test exercised it with real editor data. It is now a pure function, and
 * these are the assertions that would have caught it on the day.
 *
 * ── Why "unanswered" is tested as hard as "answered" ────────────────────────
 *
 * TRA encodes the answers **1 = Yes, 2 = No**, so "No" is a positive assertion
 * the corporation makes. An unanswered question must therefore stay absent all
 * the way through — editor, composition, payload — and be REFUSED at filing,
 * rather than quietly becoming a "No" somewhere in the chain.
 */
import { describe, expect, it } from 'vitest';
import { assertAt1MandatoryComplete, At1MandatoryFieldMissingError } from '@classytic/ca-tax/t2';
import {
  assertValidAmendmentTarget,
  composeAt1FilingData,
  type ComposeSources,
} from '../src/engine/at1-netfile.service.js';

const sources = (
  alberta: Record<string, unknown> = {},
  clientExtra: Record<string, unknown> = {},
): ComposeSources => ({
  computed: {
    fields: [
      { line: 'allocationFactor', value: 1 },
      { line: 'albertaTaxableIncome', value: 195_000 },
      { line: 'albertaTaxPayable', value: 3_900 },
      { line: 'basicAlbertaTax', value: 15_600 },
      { line: 'albertaSmallBusinessDeduction', value: 11_700 },
      { line: 'innovationEmploymentGrant', value: 0 },
      { line: 'federalTaxableIncome', value: 195_000 },
      { line: 'albertaActiveBusinessIncome', value: 195_000 },
    ],
    // What `engagement-compute.service.ts` freezes: the client-derived identity,
    // INCLUDING the AT1 jacket fields, so a later edit to the client record
    // cannot change a return that was already computed and reviewed.
    identity: {
      legalName: 'Editor Path Ltd.',
      address: { street: '1 Way', city: 'Calgary', province: 'AB', postalCode: 'T2P1A1' },
      taxYearStart: '2024-01-01',
      taxYearEnd: '2024-12-31',
      contactPerson: 'A. Preparer',
      contactTelephone: '4035550100',
      natureOfBusiness: '4411',
      typeOfCorporation: '1',
      authorizedEmail: 'filing@example.com',
    },
    filingInput: { alberta },
  },
  client: {
    name: 'Editor Path Ltd.',
    businessNumber: '123456782',
    corporateAccountNumber: '1234567890',
    contactPerson: 'A. Preparer',
    contactTelephone: '4035550100',
    natureOfBusiness: '4411',
    typeOfCorporation: '1',
    authorizedEmail: 'filing@example.com',
    ...clientExtra,
  },
  engagement: { taxYearStart: new Date('2024-01-01'), taxYearEnd: new Date('2024-12-31') },
  certification: { firstName: 'A', lastName: 'B', position: 'C' },
});

/** Every jacket answer, as the editor's radios store them. */
const answered = {
  grossRevenue: 800_000,
  totalAssets: 1_200_000,
  associatedWithCcpcs: 'no',
  windUpOfSubsidiary: 'no',
  firstYearAfterAmalgamation: 'no',
  taxYearEndChanged: 'no',
  finalReturn: 'no',
  transferOfProperty: 'no',
  reportsDifferentAlbertaIncome: 'yes',
  electsDifferentDiscretionaryAmounts: 'yes',
  preparedByTaxPreparerForFee: 'yes',
};

describe('composeAt1FilingData — the editor slice reaches the payload', () => {
  it('reads the jacket answers from filingInput, not identity', () => {
    const d = composeAt1FilingData(sources(answered));

    expect(d.grossRevenue).toBe(800_000);
    expect(d.totalAssets).toBe(1_200_000);
    // "yes"/"no" from the radios become the booleans the payload contract takes.
    expect(d.reportsDifferentAlbertaIncome).toBe(true);
    expect(d.preparedByTaxPreparerForFee).toBe(true);
    expect(d.finalReturn).toBe(false);
    expect(d.associatedWithCcpcs).toBe(false);
  });

  it('is NOT satisfied by identity carrying the same keys', () => {
    // The exact shape of the original bug: the answers on `identity` must not be
    // picked up, or the fix would pass for the wrong reason.
    const src = sources();
    src.computed.identity = { ...src.computed.identity, ...answered };

    const d = composeAt1FilingData(src);
    expect(d.grossRevenue).toBeUndefined();
    expect(d.reportsDifferentAlbertaIncome).toBeUndefined();
  });

  it('carries the client identity the AT1 needs and the return cannot derive', () => {
    const d = composeAt1FilingData(sources(answered));
    expect(d.contactPerson).toBe('A. Preparer');
    expect(d.natureOfBusiness).toBe('4411');
    expect(d.authorizedEmail).toBe('filing@example.com');
    expect(d.certificationDate).toBeInstanceOf(Date);
  });

  it('passes the filing check once every answer is given', () => {
    expect(() => assertAt1MandatoryComplete(composeAt1FilingData(sources(answered)))).not.toThrow();
  });
});

describe('an unanswered question never becomes "No"', () => {
  it('leaves an untouched jacket entirely absent', () => {
    const d = composeAt1FilingData(sources());

    expect(d.finalReturn).toBeUndefined();
    expect(d.associatedWithCcpcs).toBeUndefined();
    expect(d.grossRevenue).toBeUndefined();
  });

  it('REFUSES to file an untouched jacket, naming every missing line', () => {
    const d = composeAt1FilingData(sources());
    try {
      assertAt1MandatoryComplete(d);
      throw new Error('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(At1MandatoryFieldMissingError);
      const { missing } = err as At1MandatoryFieldMissingError;
      expect(missing).toContain('000047 gross revenue');
      expect(missing).toContain('000050 final return');
      expect(missing).toContain('000001 associated with CCPCs');
    }
  });

  it('refuses when ONE question is left blank, not just when all are', () => {
    const { finalReturn: _blank, ...rest } = answered;
    expect(() => assertAt1MandatoryComplete(composeAt1FilingData(sources(rest)))).toThrow(
      /000050 final return/,
    );
  });

  it('distinguishes an explicit "no" from an absent answer', () => {
    const explicit = composeAt1FilingData(sources({ ...answered, finalReturn: 'no' }));
    const absent = composeAt1FilingData(sources({ ...answered, finalReturn: undefined }));

    expect(explicit.finalReturn).toBe(false);
    expect(absent.finalReturn).toBeUndefined();
    // …and only the absent one blocks filing.
    expect(() => assertAt1MandatoryComplete(explicit)).not.toThrow();
    expect(() => assertAt1MandatoryComplete(absent)).toThrow(At1MandatoryFieldMissingError);
  });

  it('treats an unrecognised value as unanswered rather than guessing', () => {
    const d = composeAt1FilingData(sources({ ...answered, finalReturn: 'maybe' }));
    expect(d.finalReturn).toBeUndefined();
  });
});

describe('the freeze invariant — a filing never reads live data', () => {
  /**
   * Freezing is what lets a filed return be shown to be the one that was
   * reviewed. Every fallback to a live document is therefore a hole in the audit
   * trail, not a convenience: compute, obtain sign-off, edit the client, and the
   * transmitted payload would carry the edit.
   *
   * The fallbacks stay for DRAFTS, which must render whatever is available so a
   * preparer can see the return.
   */
  const withoutFrozenIdentity = (): ComposeSources => {
    const s = sources(answered);
    delete s.computed.identity;
    return s;
  };

  it('falls back to the live client record for a DRAFT', () => {
    const d = composeAt1FilingData(withoutFrozenIdentity());
    expect(d.legalName).toBe('Editor Path Ltd.');
    expect(d.contactPerson).toBe('A. Preparer');
  });

  it('does NOT read the live client record for a FILING', () => {
    const d = composeAt1FilingData({ ...withoutFrozenIdentity(), forFiling: true });
    // Nothing frozen, nothing live: the values are simply absent, and the
    // downstream guards refuse rather than filing a stale identity.
    expect(d.legalName).toBe('');
    expect(d.contactPerson).toBeUndefined();
    expect(d.natureOfBusiness).toBeUndefined();
  });

  it('prefers the FROZEN identity over a client record that has since changed', () => {
    const s = sources(answered, { name: 'Renamed After Sign-off Ltd.', contactPerson: 'Someone Else' });
    const d = composeAt1FilingData({ ...s, forFiling: true });

    expect(d.legalName).toBe('Editor Path Ltd.');
    expect(d.contactPerson).toBe('A. Preparer');
  });

  it('refuses to file when the frozen identity is missing what the return needs', () => {
    const d = composeAt1FilingData({ ...withoutFrozenIdentity(), forFiling: true });
    expect(() => assertAt1MandatoryComplete(d)).toThrow(At1MandatoryFieldMissingError);
  });
});

describe('a snapshot frozen before the AT1 identity fields existed', () => {
  /**
   * `frozenIdentity` gained the five AT1 jacket fields when the Alberta jacket
   * was wired. A return computed before that carries an identity WITHOUT them.
   *
   * The tempting fix is to fall back to the client record. That is precisely the
   * hole: the whole point of the frozen copy is that the filed return is the one
   * that was reviewed. So an old snapshot REFUSES and asks for a recompute,
   * which re-freezes against the current shape.
   */
  const oldSnapshot = (): ComposeSources => {
    const s = sources(answered);
    s.computed.identity = {
      legalName: 'Editor Path Ltd.',
      address: { street: '1 Way', city: 'Calgary', province: 'AB', postalCode: 'T2P1A1' },
      taxYearStart: '2024-01-01',
      taxYearEnd: '2024-12-31',
    };
    return s;
  };

  it('still renders as a DRAFT, reading the client record', () => {
    const d = composeAt1FilingData(oldSnapshot());
    expect(d.contactPerson).toBe('A. Preparer');
    expect(() => assertAt1MandatoryComplete(d)).not.toThrow();
  });

  it('REFUSES to file rather than reaching for the live client record', () => {
    const d = composeAt1FilingData({ ...oldSnapshot(), forFiling: true });
    expect(d.contactPerson).toBeUndefined();
    expect(() => assertAt1MandatoryComplete(d)).toThrow(/000025 contact person/);
  });
});

describe('composeAt1FilingData — the amendment indicator (EDI071/EDI073)', () => {
  it('omits the amendment indicator when the engagement amends nothing', () => {
    const d = composeAt1FilingData(sources(answered));
    expect(d.transmitter.isAmended).toBeUndefined();
  });

  it('carries isAmended + the description through onto the transmitter block', () => {
    const s = sources(answered);
    s.amendment = { description: 'Increased the Alberta current-year loss to $50,000.' };
    const d = composeAt1FilingData(s);
    expect(d.transmitter.isAmended).toBe(true);
    expect(d.transmitter.amendmentDescription).toBe(
      'Increased the Alberta current-year loss to $50,000.',
    );
  });

  it('REFUSES assertAt1MandatoryComplete when isAmended is set with a blank description', () => {
    // `assertAt1MandatoryComplete` enforces the same rule regardless of a
    // "draft" concept — the leniency for drafts lives in `prepareAt1NetFile`
    // (which simply does not call this assert unless `forFiling`), not here.
    const s = sources(answered);
    s.amendment = { description: '' };
    const d = composeAt1FilingData(s);
    expect(() => assertAt1MandatoryComplete(d)).toThrow(/EDI073 description of changes/);
  });
});

describe('assertValidAmendmentTarget — the relationship an amendment must have', () => {
  const engagement = { clientId: 'client-1', program: 'AT1', taxYearEnd: new Date('2024-12-31') };

  it('accepts a target with the same client, program and tax year end', () => {
    expect(() =>
      assertValidAmendmentTarget(engagement, {
        clientId: 'client-1',
        program: 'AT1',
        taxYearEnd: new Date('2024-12-31'),
      }),
    ).not.toThrow();
  });

  it('refuses a dangling reference', () => {
    expect(() => assertValidAmendmentTarget(engagement, null)).toThrow(
      /amends an engagement that no longer exists/,
    );
  });

  it('refuses a target belonging to a different client', () => {
    expect(() =>
      assertValidAmendmentTarget(engagement, {
        clientId: 'client-2',
        program: 'AT1',
        taxYearEnd: new Date('2024-12-31'),
      }),
    ).toThrow(/same client, program and tax year end/);
  });

  it('refuses a target on a different program', () => {
    expect(() =>
      assertValidAmendmentTarget(engagement, {
        clientId: 'client-1',
        program: 'T2',
        taxYearEnd: new Date('2024-12-31'),
      }),
    ).toThrow(/same client, program and tax year end/);
  });

  it('refuses a target with a different tax year end', () => {
    expect(() =>
      assertValidAmendmentTarget(engagement, {
        clientId: 'client-1',
        program: 'AT1',
        taxYearEnd: new Date('2023-12-31'),
      }),
    ).toThrow(/same client, program and tax year end/);
  });
});
