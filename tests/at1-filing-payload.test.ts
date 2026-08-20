/**
 * The AT1 filing path carries the schedules, end to end.
 *
 * THE ASSERTION THAT WAS MISSING. `at1-netfile.service.ts` called the renderer
 * with no schedules, so the transmitted payload was a jacket and nothing else —
 * and every existing test passed, because none of them looked at what the payload
 * contained beyond the jacket's own lines.
 *
 * The host rebuilds its filing data from the computed return's flat `fields`
 * array, which carries a handful of jacket totals and knows nothing about the
 * schedules behind them. So anything reconstructed from it is a jacket by
 * construction; the payload has to be STORED where it is assembled and read back.
 * These tests guard that chain: compute → persist → render.
 *
 * Pure — no DB. The persistence step is exercised by asserting the compute output
 * carries what the service writes.
 */
import { describe, expect, it } from 'vitest';
import {
  computeAlbertaSchedule13,
  computeAlbertaSchedule18,
  renderAt1NetFile,
  type At1FilingData,
} from '@classytic/ca-tax/t2';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: '2024' };

const filingData = (extra: Partial<At1FilingData> = {}): At1FilingData => ({
  softwareCertCode: 'TEST01',
  legalName: 'Filing Path Test Ltd.',
  address: { street: '1 Test Way', city: 'Calgary', province: 'AB', postalCode: 'T2P1A1' },
  corporateAccountNumber: '1234567890',
  businessNumber: '123456782',
  taxYearBegin: period.start,
  taxYearEnd: period.end,
  allocationFactor: 1,
  albertaTaxPayable: 0,
  certification: { firstName: 'A', lastName: 'B', position: 'C' },
  transmitter: {
    softwareCertCode: 'T',
    webServiceVersion: '1',
    softwareVersion: '1',
    serialNumber: '1',
    thirdPartyIndicator: '1',
    legalName: 'T',
    contact: { firstName: 'a', lastName: 'b', position: 'c', phone: '1', email: 'e' },
  },
  ...extra,
});

const filedSchedules = (xml: string) =>
  [...xml.matchAll(/Schedule Number="([^"]+)"/g)].map((m) => m[1]!);

describe('runAT1Compute surfaces what the filing path needs', () => {
  it('carries the schedule payloads the engine assembled', () => {
    const out = runAT1Compute({
      period,
      federalTaxableIncome: 500_000,
      activeBusinessIncome: 500_000,
      schedules: {
        cca: computeAlbertaSchedule13({ federalClasses: [{ ccaClass: '8', openingUCC: 100_000 }] }),
        dispositions: computeAlbertaSchedule18({
          federalCategories: { shares: { proceeds: 100_000, acb: 40_000 } },
        }),
      },
    });
    expect(out.schedulePayloads?.map((s) => s.scheduleId).sort()).toEqual(['013', '018']);
  });

  it('emits line 129 as a field even at nil — it is mandatory on the jacket', () => {
    const out = runAT1Compute({
      period,
      federalTaxableIncome: 100_000,
      activeBusinessIncome: 100_000,
    });
    const grant = out.fields.find((f) => f.line === 'innovationEmploymentGrant');
    expect(grant).toBeDefined();
    expect(grant?.value).toBe(0);
    expect(grant?.provenance).toBe('engine');
  });

  it('reports no payloads when nothing was computed', () => {
    const out = runAT1Compute({
      period,
      federalTaxableIncome: 100_000,
      activeBusinessIncome: 100_000,
    });
    expect(out.schedulePayloads).toEqual([]);
  });
});

describe('the rendered payload carries them through', () => {
  it('files the schedules the compute produced', () => {
    const out = runAT1Compute({
      period,
      federalTaxableIncome: 500_000,
      activeBusinessIncome: 500_000,
      schedules: {
        cca: computeAlbertaSchedule13({ federalClasses: [{ ccaClass: '8', openingUCC: 100_000 }] }),
      },
    });
    const xml = renderAt1NetFile(filingData(), out.schedulePayloads ?? []);
    expect(filedSchedules(xml)).toEqual(['000', '013', 'EDI']);
  });

  it('files a JACKET ONLY when the payloads are dropped — the bug this guards', () => {
    // Passing nothing is what the service used to do. The difference has to be
    // visible in a test, or it is invisible everywhere.
    const out = runAT1Compute({
      period,
      federalTaxableIncome: 500_000,
      activeBusinessIncome: 500_000,
      schedules: {
        cca: computeAlbertaSchedule13({ federalClasses: [{ ccaClass: '8', openingUCC: 100_000 }] }),
      },
    });
    expect(filedSchedules(renderAt1NetFile(filingData()))).toEqual(['000', 'EDI']);
    expect(filedSchedules(renderAt1NetFile(filingData(), out.schedulePayloads ?? []))).toContain(
      '013',
    );
  });

  it('carries the innovation grant onto the jacket and its own schedule together', () => {
    const out = runAT1Compute({
      period,
      federalTaxableIncome: 0,
      activeBusinessIncome: 0,
      ieg: {
        eligibleExpenditures: 400_000,
        group: [
          {
            name: 'A',
            taxableCapital: 12_000_000,
            priorYearAlbertaExpenditures: [300_000, 200_000],
          },
        ],
      },
    });
    const grant = out.fields.find((f) => f.line === 'innovationEmploymentGrant')?.value;
    expect(grant).toBe(50_000);

    const xml = renderAt1NetFile(
      filingData({ innovationEmploymentGrant: grant as number }),
      out.schedulePayloads ?? [],
    );
    expect(xml).toContain('<Value LineItemID="000129001">50000</Value>');
    expect(filedSchedules(xml)).toContain('029');
  });
});
