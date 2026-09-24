import { describe, expect, it } from 'vitest';
import { effectiveAt1Identity } from '../src/engine/at1-identity.js';
import { withAt1JacketIdentity } from '../src/engine/engagement-compute.service.js';
import { at1ClientIdentityFlags } from '../src/review/review-generator.service.js';

const fullClient = {
  name: 'Client Name Ltd.',
  businessNumber: '100092287',
  corporateAccountNumber: '1234567890',
  address: { street: '1 Client St', city: 'Calgary', province: 'AB', postalCode: 'T2P 0A0' },
  contactPerson: 'Client Contact',
  contactTelephone: '4035550100',
  natureOfBusiness: '0198',
  typeOfCorporation: '1',
  authorizedEmail: 'client@example.test',
};

const jacket = {
  legalName: 'H2H R2 A03 JKT Baseline',
  businessNumber: '300000023',
  corporateAccountNumber: '424104018',
  addressStreet: '100 Jacket Ave',
  addressCity: 'Edmonton',
  addressProvince: 'AB',
  addressPostalCode: 'T5J 0N3',
  contactPerson: 'Jacket Contact',
  contactTelephone: '7805550199',
  natureOfBusiness: '9999',
  typeOfCorporation: '1',
  authorizedEmail: 'jacket@example.test',
};

describe('AT1 jacket identity — typed on Schedule 000, client profile as fallback', () => {
  it('a lean client (name + BN only) plus a filled jacket yields a complete identity', () => {
    const eff = effectiveAt1Identity(
      { name: 'Lean Co', businessNumber: '111111118' },
      { alberta: jacket },
    );
    expect(eff).toEqual({
      name: 'H2H R2 A03 JKT Baseline',
      businessNumber: '300000023',
      corporateAccountNumber: '424104018',
      address: {
        street: '100 Jacket Ave',
        city: 'Edmonton',
        province: 'AB',
        postalCode: 'T5J 0N3',
      },
      contactPerson: 'Jacket Contact',
      contactTelephone: '7805550199',
      natureOfBusiness: '9999',
      typeOfCorporation: '1',
      authorizedEmail: 'jacket@example.test',
    });
    expect(at1ClientIdentityFlags('AT1', eff as Record<string, unknown>)).toEqual([]);
  });

  it('a blank jacket keeps every client value — returns prepared before this change file unchanged', () => {
    expect(effectiveAt1Identity(fullClient, { alberta: {} })).toEqual(fullClient);
    expect(effectiveAt1Identity(fullClient, undefined)).toEqual(fullClient);
  });

  it('a whitespace-only jacket entry is not an answer — the client value stands', () => {
    const eff = effectiveAt1Identity(fullClient, {
      alberta: { contactPerson: '   ', addressCity: '' },
    });
    expect(eff.contactPerson).toBe('Client Contact');
    expect(eff.address?.city).toBe('Calgary');
  });

  it('address parts override one by one, not as a block', () => {
    const eff = effectiveAt1Identity(fullClient, { alberta: { addressCity: 'Red Deer' } });
    expect(eff.address).toEqual({
      street: '1 Client St',
      city: 'Red Deer',
      province: 'AB',
      postalCode: 'T2P 0A0',
    });
  });

  it('a lean client with a blank jacket still raises the missing-identity flag, pointing at the jacket', () => {
    const eff = effectiveAt1Identity({ name: 'Lean Co', businessNumber: '111111118' }, {});
    const flags = at1ClientIdentityFlags('AT1', eff as Record<string, unknown>);
    expect(flags.map((f) => f.code)).toContain('AT1_CLIENT_IDENTITY_INCOMPLETE');
    expect(flags[0]?.message).toMatch(/AT1 Jacket \(Schedule 000\)/);
  });

  it('the frozen identity the filing path reads carries the jacket entries', () => {
    const frozen = {
      legalName: 'Client Name Ltd.',
      businessNumber: '100092287',
      corporationType: 'CCPC',
      taxYearStart: '2025-01-01T00:00:00.000Z',
      taxYearEnd: '2025-12-31T00:00:00.000Z',
    };
    const out = withAt1JacketIdentity(frozen, fullClient, { alberta: jacket });
    expect(out.legalName).toBe('H2H R2 A03 JKT Baseline');
    expect(out.businessNumber).toBe('300000023');
    expect(out.corporateAccountNumber).toBe('424104018');
    expect(out.contactPerson).toBe('Jacket Contact');
    expect(out.address).toEqual({
      street: '100 Jacket Ave',
      city: 'Edmonton',
      province: 'AB',
      postalCode: 'T5J 0N3',
    });
    // Untouched: fields the jacket does not carry.
    expect(out.corporationType).toBe('CCPC');
    expect(out.taxYearEnd).toBe('2025-12-31T00:00:00.000Z');
  });
});

describe('AT1 jacket 011 / 013 / 016 — jacket-only identification lines', () => {
  it('are frozen with the identity when typed, and absent when not', () => {
    const typed = withAt1JacketIdentity({}, fullClient, {
      alberta: { operatingName: 'Trading As', addressLine2: 'Suite 400', addressCountry: 'US' },
    });
    expect(typed.operatingName).toBe('Trading As');
    expect(typed.address).toMatchObject({
      street: '1 Client St',
      line2: 'Suite 400',
      country: 'US',
    });

    const blank = withAt1JacketIdentity({}, fullClient, { alberta: {} });
    expect(blank.operatingName).toBeUndefined();
    expect(blank.address).not.toHaveProperty('line2');
    expect(blank.address).not.toHaveProperty('country');
  });
});
