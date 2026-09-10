/**
 * The corpus scenarios — the fact patterns whose every filed line is recorded.
 *
 * A golden corpus is only as good as its inputs, and this is where a naive port
 * of `tax-ca`'s approach would have gone wrong. Their functions take four
 * scalars (`getEffectiveRate(province, income, rate, years)`), so they can
 * cross-product 8,572 calls and call it coverage. Ours take a whole return: you
 * cannot grid a T2, because almost every combination of a return's hundreds of
 * optional fields is not a valid return at all.
 *
 * So the corpus is CURATED, not generated — a small set of returns each chosen
 * because it exercises a path that would otherwise go unwatched. Small enough
 * that a human reads the diff, which is the only property that makes a golden
 * corpus worth having.
 *
 * The federal cases are the differential-test scenarios already written for the
 * AuraTax comparison (`scripts/validate/scenarios.ts`) — reused rather than
 * duplicated, so a scenario improved for one purpose improves both. The Alberta
 * cases are authored here because nothing else drove the AT1 assembler.
 */
import type { FederalT2Input } from '@classytic/ca-tax/t2';
import { SCENARIOS as FEDERAL_SCENARIOS } from '../../scripts/validate/scenarios.js';

export type CorpusScenario =
  | {
      program: 'T2';
      id: string;
      title: string;
      taxYear: number;
      input: FederalT2Input;
    }
  | {
      program: 'AT1';
      id: string;
      title: string;
      taxYear: number;
      /** Federal engine input — the AT1 side is assembled from its result. */
      fed: Record<string, unknown>;
      /** The structured working return: the AT1-only slices nothing else supplies. */
      returnInput: Record<string, unknown>;
      isCcpc: boolean;
    };

const TAX_YEAR = 2024;

/**
 * A federal fact pattern with CCA, a categorized disposition, a donation, a
 * reserve and a loss — broad enough that the Alberta assembler has something to
 * reconcile on most schedules.
 */
const FED_BROAD: Record<string, unknown> = {
  bookNetIncome: 400_000,
  activeBusinessIncome: 400_000,
  ccaClasses: [{ ccaClass: '8', openingUCC: 100_000, additions: 20_000 }],
  capitalDispositions: [
    {
      description: 'Shares of X Co.',
      proceeds: 150_000,
      acb: 80_000,
      outlays: 2_000,
      category: 'shares',
    },
  ],
  charitableDonations: 10_000,
  openingDonationPool: 0,
  reserveContinuity: [{ type: 'doubtfulDebts', opening: 5_000, transfer: 0, closing: 8_000 }],
  openingNonCapitalLoss: 0,
  nonCapitalLossToApply: 0,
};

/** A plain federal pattern with nothing for Alberta to diverge on. */
const FED_PLAIN: Record<string, unknown> = {
  bookNetIncome: 300_000,
  activeBusinessIncome: 300_000,
};

/** TRA permits schedules 13/17/18 only when the jacket declares a difference. */
const DIVERGENCE = {
  alberta: {
    reportsDifferentAlbertaIncome: 'no',
    electsDifferentDiscretionaryAmounts: 'yes',
  },
  albertaSbd: { corporationStatus: 'ccpc' },
  albertaContinuity: {
    nonCapitalOpening: 50_000,
    capitalOpening: 0,
    farmOpening: 0,
    restrictedFarmOpening: 0,
  },
};

const NO_DIVERGENCE = {
  alberta: {
    reportsDifferentAlbertaIncome: 'no',
    electsDifferentDiscretionaryAmounts: 'no',
  },
  albertaSbd: { corporationStatus: 'ccpc' },
};

const ALBERTA_SCENARIOS: CorpusScenario[] = [
  {
    program: 'AT1',
    id: 'AB1-no-divergence',
    title: 'AT1 jacket only — no difference declared, so TRA permits no schedules',
    taxYear: TAX_YEAR,
    fed: FED_BROAD,
    returnInput: NO_DIVERGENCE,
    isCcpc: true,
  },
  {
    program: 'AT1',
    id: 'AB2-full-divergence',
    title: 'AT1 with CCA, dispositions, reserves, donations and loss continuity',
    taxYear: TAX_YEAR,
    fed: FED_BROAD,
    returnInput: DIVERGENCE,
    isCcpc: true,
  },
  {
    // The gate fixed this session: Area B was conditioned on a COMPUTED
    // reconciliation existing, so a return whose only Alberta divergence was
    // typed straight into Schedule 12 produced no Area B at all — the figures
    // reached taxable income with no line declaring them.
    program: 'AT1',
    id: 'AB3-schedule12-input-only',
    title: 'AT1 Schedule 12 Area B driven by preparer input, with nothing computed',
    taxYear: TAX_YEAR,
    fed: FED_PLAIN,
    returnInput: {
      ...DIVERGENCE,
      albertaSchedule12: { albertaTaxableDividendsDeductible: 25_000 },
    },
    isCcpc: true,
  },
  {
    // The sibling gate: `scheduleEighteen` returned undefined when no federal
    // disposition was categorized, which dropped hand-entered ABIL rows.
    program: 'AT1',
    id: 'AB4-schedule18-abil-only',
    title: 'AT1 Schedule 18 with ABIL entries and no categorized federal disposition',
    taxYear: TAX_YEAR,
    fed: FED_PLAIN,
    returnInput: {
      ...DIVERGENCE,
      albertaSchedule18: {
        abilEntries: [
          {
            name: 'Failed Startup Ltd.',
            kind: 'shares',
            dateOfAcquisition: '2019-03-01',
            proceeds: 1_000,
            acb: 90_000,
            outlays: 500,
          },
        ],
      },
    },
    isCcpc: true,
  },
  {
    // The first scenario with a current-year LOSS — before it, line 021 was 0
    // in every recording, so the corpus could not see either Schedule 21 Part 1
    // defect: 021 filed POSITIVE (it must be ≤ 0; 037 = 021 × −1), and the
    // loss computed as `max(0, −net income)`, ignoring the Division C
    // deductions. This is the case both bit hardest — a holding company whose
    // loss is widened by s.112 dividends it may deduct:
    //
    //   001  −25,000   net income (loss)
    //   005   30,000   taxable dividends deductible (T2 line 320)
    //   015  −55,000   001 − 013
    //   021  −55,000   filed negative
    //   037   55,000   = 021 × (−1) — was 25,000 before the fix
    program: 'AT1',
    id: 'AB6-loss-with-dividends',
    title: 'AT1 loss year widened by s.112 dividends deductible — Schedule 21 Part 1',
    taxYear: TAX_YEAR,
    fed: { bookNetIncome: -25_000, activeBusinessIncome: 0 },
    returnInput: {
      ...DIVERGENCE,
      albertaSchedule12: { taxableDividendsDeductible: 30_000 },
    },
    isCcpc: true,
  },
  {
    program: 'AT1',
    id: 'AB5-non-ccpc',
    title: 'AT1 for a non-CCPC — no Alberta small-business deduction',
    taxYear: TAX_YEAR,
    fed: { ...FED_PLAIN, isCcpc: false },
    returnInput: {
      alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
      albertaSbd: { corporationStatus: 'other' },
    },
    isCcpc: false,
  },
];

export const SCENARIOS: CorpusScenario[] = [
  ...FEDERAL_SCENARIOS.map(
    (s): CorpusScenario => ({
      program: 'T2',
      id: s.id,
      title: s.title,
      taxYear: TAX_YEAR,
      input: s.input,
    }),
  ),
  ...ALBERTA_SCENARIOS,
];
