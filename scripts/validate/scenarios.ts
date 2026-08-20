/**
 * Differential-test scenarios — validate our federal T2 engine against a certified
 * product (AuraTax). Each scenario is a fully-specified FederalT2Input plus a
 * plain-tax description the AuraTax operator enters identically. Tax year 2024.
 *
 * The "hard edges" (short year, associated grind, capital grind, multi-province,
 * Part IV) are included deliberately — those are where a divergence is most likely
 * and most worth finding.
 */
import type { FederalT2Input } from '@classytic/ca-tax/t2';

export interface Scenario {
  id: string;
  title: string;
  /** Plain-tax description for the AuraTax operator to reproduce identically. */
  auraTaxEntry: string;
  input: FederalT2Input;
}

const TAX_YEAR = 2024;
const base = { taxYear: TAX_YEAR, isCcpc: true, province: 'ON' as const };

export const SCENARIOS: Scenario[] = [
  {
    id: 'S1-ccpc-sbd-basic',
    title: 'Simple CCPC, all income SBD-eligible (Ontario)',
    auraTaxEntry:
      'CCPC, Ontario PE. GIFI net income (9999) = 200,000 with no book/tax differences. Active business income 200,000. No CCA, no other schedules.',
    input: { ...base, bookNetIncome: 200_000, activeBusinessIncome: 200_000 },
  },
  {
    id: 'S2-ccpc-over-limit',
    title: 'CCPC over the $500k business limit (Ontario)',
    auraTaxEntry:
      'CCPC, Ontario. GIFI net income 600,000, ABI 600,000. 500,000 at the small-business rate, 100,000 at the general rate (with the general rate reduction).',
    input: { ...base, bookNetIncome: 600_000, activeBusinessIncome: 600_000 },
  },
  {
    id: 'S3-general-rate-nonccpc',
    title: 'Non-CCPC general-rate corporation (Ontario)',
    auraTaxEntry:
      'Type of corporation = "Other" (NOT a CCPC). Ontario. GIFI net income 300,000, ABI 300,000. No SBD; general rate + general rate reduction.',
    input: { ...base, isCcpc: false, bookNetIncome: 300_000, activeBusinessIncome: 300_000 },
  },
  {
    id: 'S4-cca-class10',
    title: 'CCPC with Schedule 8 CCA (Class 10 @ 30%)',
    auraTaxEntry:
      'CCPC, Ontario. GIFI net income 250,000 (no book amortization). Schedule 8: Class 10, opening UCC 100,000, no additions/dispositions → CCA 30,000. ABI 220,000 (after CCA).',
    input: {
      ...base,
      bookNetIncome: 250_000,
      activeBusinessIncome: 220_000,
      ccaClasses: [{ ccaClass: '10', openingUCC: 100_000, additions: 0, dispositions: 0 }],
    },
  },
  {
    id: 'S5-short-year',
    title: 'Short tax year (182 days) — business-limit proration',
    auraTaxEntry:
      'CCPC, Ontario. Tax year 2024-01-01 to 2024-06-30 (182 days). GIFI net income 500,000, ABI 500,000. CRA PRORATES the $500k business limit by days/365 (s.125(5)(b)) ≈ 249,315.',
    input: {
      ...base,
      bookNetIncome: 500_000,
      activeBusinessIncome: 500_000,
      periodStart: '2024-01-01',
      periodEnd: '2024-06-30',
    },
  },
  {
    id: 'S6-associated-group',
    title: 'Associated CCPC — allocated business limit 300k',
    auraTaxEntry:
      'CCPC, Ontario, associated group. This corporation is allocated 300,000 of the $500,000 limit (Schedule 23). GIFI net income 400,000, ABI 400,000. SBD on 300,000.',
    input: { ...base, bookNetIncome: 400_000, activeBusinessIncome: 400_000, businessLimit: 300_000 },
  },
  {
    id: 'S7-capital-grind-s33',
    title: 'Large-corporation capital grind (Schedule 33, $30M taxable capital)',
    auraTaxEntry:
      'CCPC, Ontario. GIFI net income 600,000, ABI 600,000. Schedule 33 taxable capital employed in Canada = 30,000,000 (e.g. capital stock 30M). Business limit ground on the $10M–$50M straight line → 250,000.',
    input: {
      ...base,
      bookNetIncome: 600_000,
      activeBusinessIncome: 600_000,
      taxableCapitalDetail: { capitalStock: 30_000_000 },
    },
  },
  {
    id: 'S8-multi-province',
    title: 'Multi-province allocation (ON + BC permanent establishments)',
    auraTaxEntry:
      'CCPC. PEs in Ontario and BC. Schedule 5: ON gross revenue 600,000 / salaries 200,000; BC gross revenue 400,000 / salaries 300,000. GIFI net income 300,000, ABI 300,000. Allocate by Reg 402, tax each province at its own rate.',
    input: {
      ...base,
      province: undefined as unknown as 'ON',
      bookNetIncome: 300_000,
      activeBusinessIncome: 300_000,
      permanentEstablishments: [
        { province: 'ON', grossRevenue: 600_000, salariesWages: 200_000 },
        { province: 'BC', grossRevenue: 400_000, salariesWages: 300_000 },
      ],
    },
  },
  {
    id: 'S9-part4-rdtoh',
    title: 'Part IV tax on portfolio dividends',
    auraTaxEntry:
      'CCPC, Ontario. GIFI net income 50,000, ABI 50,000. Received 100,000 of taxable portfolio (non-connected) dividends → Part IV tax at 38 1/3% = 38,333, added to RDTOH.',
    input: {
      ...base,
      bookNetIncome: 50_000,
      activeBusinessIncome: 50_000,
      portfolioDividendsReceived: 100_000,
    },
  },
];
