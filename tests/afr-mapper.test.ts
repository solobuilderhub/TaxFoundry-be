/**
 * CRA Auto-fill mapper — fill-blanks-only merge of CRA data into the working return.
 */
import { describe, it, expect } from 'vitest';
import { mergeAutoFill } from '../src/afr/afr-mapper.js';
import type { AfrResponse } from '../src/afr/afr-types.js';

const afr: AfrResponse = {
  identification: { corpType: 'CCPC', province: 'ON', businessNumber: '100000000' },
  carryforwards: {
    nonCapitalLossOpening: 40_000,
    netCapitalLossOpening: 5_000,
    donationPoolOpening: 2_000,
    gripOpening: 150_000,
    itcPoolOpening: 8_000,
    businessFtcPoolOpening: 1_200,
  },
  instalmentsPaid: 25_000,
};

describe('mergeAutoFill', () => {
  it('populates a blank return from CRA carryforwards + identification', () => {
    const { returnInput, filled } = mergeAutoFill({}, afr);
    expect(returnInput.identification).toMatchObject({ corpType: 'CCPC', province: 'ON' });
    expect(returnInput.losses).toMatchObject({ nonCapitalOpening: 40_000, netCapitalOpening: 5_000 });
    expect(returnInput.donations).toMatchObject({ openingDonationPool: 2_000 });
    expect(returnInput.dividends).toMatchObject({ openingGrip: 150_000 });
    expect(returnInput.credits).toMatchObject({ openingItcPool: 8_000 });
    expect(returnInput.foreign).toMatchObject({ openingBusinessFtcPool: 1_200 });
    expect(returnInput.payments).toMatchObject({ instalmentsPaid: 25_000 });
    expect(filled).toContain('losses.nonCapitalOpening');
    expect(filled).toContain('payments.instalmentsPaid');
  });

  it('NEVER overwrites a value the preparer already entered', () => {
    const existing = {
      identification: { corpType: 'Public', province: 'BC' },
      losses: { nonCapitalOpening: 99_999 },
    };
    const { returnInput, filled } = mergeAutoFill(existing, afr);
    // Preparer's values stand; the blank net-capital opening still fills.
    expect(returnInput.identification).toMatchObject({ corpType: 'Public', province: 'BC' });
    expect(returnInput.losses).toMatchObject({ nonCapitalOpening: 99_999, netCapitalOpening: 5_000 });
    expect(filled).not.toContain('identification.corpType');
    expect(filled).not.toContain('losses.nonCapitalOpening');
    expect(filled).toContain('losses.netCapitalOpening');
  });

  it('does not mutate the input object', () => {
    const existing = { losses: { nonCapitalOpening: 1 } };
    const snapshot = JSON.stringify(existing);
    mergeAutoFill(existing, afr);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it('skips fields CRA did not return (no phantom zeros)', () => {
    const { returnInput, filled } = mergeAutoFill({}, { identification: { corpType: 'CCPC' } });
    expect(returnInput.payments).toBeUndefined();
    expect(returnInput.losses).toBeUndefined();
    expect(filled).toEqual(['identification.corpType']);
  });
});
