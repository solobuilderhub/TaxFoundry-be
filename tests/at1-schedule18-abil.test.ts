import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };
const fed = {
  period,
  bookNetIncome: 900_000,
  activeBusinessIncome: 700_000,
  ccaClasses: [{ ccaClass: '8', openingUCC: 100_000, additions: 20_000 }],
} as never;

const base = {
  alberta: { reportsDifferentAlbertaIncome: 'yes', electsDifferentDiscretionaryAmounts: 'yes' },
  albertaSbd: { corporationStatus: 'ccpc' },
};

const filed = (ri: Record<string, unknown>) => {
  const out = runAT1Compute(assembleProvincialInput('AT1', fed, ri, { isCcpc: true }) as never);
  const s18 = out.schedulePayloads?.find((s) => s.scheduleId === '018');
  return new Map((s18?.values ?? []).map((v) => [v.lineItemId, v.value]));
};

/**
 * AT1 Schedule 18's ABIL section (018082-018094) had no field anywhere the
 * preparer could reach: `AlbertaSchedule18Input.abilEntries` was real, tested
 * ca-tax code, but nothing in the return editor or the server composer ever
 * populated it, and `scheduleEighteen` additionally returned `undefined`
 * outright whenever there were no ORDINARY category dispositions — so even a
 * corporation with only an ABIL to report got no Schedule 18 at all.
 */
describe('Schedule 18 — allowable business investment loss entries', () => {
  it('files the ABIL section from ri.albertaSchedule18.abilEntries alone, with no ordinary dispositions', () => {
    const byId = filed({
      ...base,
      albertaSchedule18: {
        abilEntries: [
          {
            name: 'Failed Co. Ltd.',
            kind: 'shares',
            dateOfAcquisition: '2020-06-01',
            proceeds: 0,
            acb: 50_000,
            outlays: 1_000,
          },
        ],
      },
    });
    expect(byId.get('018082001')).toBe('Failed Co. Ltd.');
    expect(byId.get('018084001')).toBe(1); // shares
    expect(byId.get('018088001')).toBe(0);
    expect(byId.get('018090001')).toBe(50_000);
    expect(byId.get('018092001')).toBe(1_000);
    // 018094 — the allowable business investment loss, at the inclusion
    // rate. Computed from the row, never entered directly.
    expect(byId.has('018094001')).toBe(true);
    expect(Number(byId.get('018094001'))).toBeLessThan(0);
  });

  it('omits an ABIL row the preparer left entirely blank', () => {
    const byId = filed({
      ...base,
      albertaSchedule18: { abilEntries: [{ name: '', proceeds: undefined }] },
    });
    expect(byId.has('018082001')).toBe(false);
  });

  it('requires the AT1 jacket divergence flags, same as the rest of Schedule 18', () => {
    // formPermitted is a genuine legal gate (AT1 lines 000060/000061), not
    // specific to ABIL — an ABIL entry does not bypass it.
    const noFlags = {
      alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
      albertaSchedule18: { abilEntries: [{ name: 'X Co.', proceeds: 0, acb: 10_000 }] },
    };
    const out = runAT1Compute(
      assembleProvincialInput('AT1', fed, noFlags, { isCcpc: true }) as never,
    );
    expect((out.schedulePayloads ?? []).some((s) => s.scheduleId === '018')).toBe(false);
  });
});
