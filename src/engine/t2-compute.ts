/**
 * Host composition: run the ca-tax T2 engine and shape its output for the ledger.
 *
 * This is the seam between the pure engine (@classytic/ca-tax/t2) and the return
 * ledger. It is itself pure (no DB) so it can be tested exhaustively; the resource
 * route (engagement-year `compute`) is a thin wrapper that persists what this
 * returns:
 *   - a `computed-return` snapshot (fields carrying provenance 'engine'),
 *   - an `AdjustmentComputed` fact appended to the fact-log.
 *
 * Every value this produces is engine-computed, so it must pass the provenance
 * guard — the last line of defence before anything is filable. A future
 * regression (say a field wired from a model) fails HERE, not at the wire.
 */
import {
  type CorpTaxRates,
  computeFederalT2,
  type FederalT2Result,
  resolveCorpTaxRates,
  t2Engine,
} from '@classytic/ca-tax/t2';
import type { TaxObligation } from '@classytic/tax-core/obligation';
import { assertFiledProvenance, type ProvenancedField } from '#shared/provenance-guard.js';
import { buildSnapshot, type ComputationSnapshot, hashOf, T2_FORM_VERSION } from './snapshot.js';
import { getFederalRateBook, getProvincialRateChanges } from './tax-rates.js';

/**
 * Engine build stamp → persisted on computed-return.engineVersion and pinned so a
 * prior-year recompute reproduces its historical result. Bump when the T2 compute
 * changes. (Tax-year selection lives inside the engine's year-versioned tables.)
 */
export const T2_ENGINE_VERSION = 'ca-tax/t2@2024.1';

export interface T2ComputeOutput {
  obligation: TaxObligation<FederalT2Result>;
  /** computed-return field rows — every one provenance 'engine'. */
  fields: ProvenancedField[];
  /** the AdjustmentComputed fact to append to the ledger. */
  fact: {
    type: 'AdjustmentComputed';
    actor: string;
    provenance: 'engine';
    reason: string;
    payload: Record<string, unknown>;
  };
  engineVersion: string;
  /** Reproducibility record — full input + result + content hashes + versions. */
  snapshot: ComputationSnapshot;
}

/**
 * Validate → compute → shape for the ledger. `input` is untrusted (from the
 * request); `t2Engine.validate` throws on bad input so compute never sees garbage.
 */
export function runT2Compute(input: unknown, actor = 'engine'): T2ComputeOutput {
  const validated = t2Engine.validate(input);
  // Strip every caller-controlled rate/year field BEFORE compute — the request is
  // untrusted. `computeFederalT2` treats `rates` (a fully-resolved table) and
  // `taxYear` as precedence overrides, so leaving them in would let a client
  // smuggle arbitrary rates or resolve the wrong year. We drop all three and
  // re-inject only the host's authoritative book; the tax year is then derived
  // from the return period inside the engine wrapper (fail-closed on the year).
  const {
    rates: _rates,
    rateBook: _rateBook,
    taxYear: _taxYear,
    provincialRateChanges: _prc,
    ...safe
  } = validated as unknown as Record<string, unknown>;
  void _rates;
  void _rateBook;
  void _taxYear;
  void _prc;
  const rateBook = getFederalRateBook();
  const obligation = t2Engine.compute({
    ...(safe as unknown as typeof validated),
    rateBook,
    // Authoritative mid-year provincial rate changes (day-weighting) — host data,
    // never the request's, same trust boundary as the rate book.
    provincialRateChanges: getProvincialRateChanges(),
  }) as TaxObligation<FederalT2Result>;
  const b = obligation.breakdown;

  // Resolve the EXACT rate table this return used (the engine wrapper derives the
  // year from period.end) and store it in the snapshot — so a later recompute
  // restores the historical rates even after the host book advances.
  const taxYear = validated.period.end.getFullYear();
  const rateTable = resolveCorpTaxRates(taxYear, rateBook);

  // Reproducibility record: the exact sanitized input + full result + content
  // hashes + the resolved rate table + form/engine versions. Enough to recompute
  // this return byte-for-byte later (see verifyT2Reproducible) — not a summary.
  const snapshot = buildSnapshot({
    engineBuild: T2_ENGINE_VERSION,
    formVersion: T2_FORM_VERSION,
    rateTable,
    validatedInput: safe,
    result: b,
  });

  // Summary lines now; expands to the full CRA line set as the schedules render.
  // The *Closing lines are the carryforward balances — a later tax year reads
  // them as its opening pools (multi-year continuity).
  const fields: ProvenancedField[] = [
    { line: 'netIncomeForTax', value: b.netIncomeForTax, provenance: 'engine' },
    ...(b.capitalGains
      ? [
          {
            line: 'taxableCapitalGain',
            value: b.capitalGains.taxableCapitalGain,
            provenance: 'engine' as const,
          },
          ...(b.capitalGains.currentYearNetCapitalLoss > 0
            ? [
                {
                  line: 'netCapitalLossCreated',
                  value: b.capitalGains.currentYearNetCapitalLoss,
                  provenance: 'engine' as const,
                },
              ]
            : []),
        ]
      : []),
    ...(b.cca
      ? [
          { line: 'ccaClaimed', value: b.cca.totalCca, provenance: 'engine' as const },
          ...(b.cca.totalRecapture > 0
            ? [{ line: 'ccaRecapture', value: b.cca.totalRecapture, provenance: 'engine' as const }]
            : []),
          ...(b.cca.totalTerminalLoss > 0
            ? [
                {
                  line: 'ccaTerminalLoss',
                  value: b.cca.totalTerminalLoss,
                  provenance: 'engine' as const,
                },
              ]
            : []),
          // Per-class closing UCC — a later year reads these as opening UCC.
          ...b.cca.classes.map((c) => ({
            line: `ccaClosingUCC:${c.ccaClass}`,
            value: c.closingUCC,
            provenance: 'engine' as const,
          })),
        ]
      : []),
    ...(b.donations
      ? [
          {
            line: 'donationsClaimed',
            value: b.donations.donationsClaimed,
            provenance: 'engine' as const,
          },
          // Closing donation pool → next year reads it as opening (5-yr carryforward).
          {
            line: 'donationPoolClosing',
            value: b.donations.closingDonationPool,
            provenance: 'engine' as const,
          },
        ]
      : []),
    // Schedule 13 — reserve continuity net effect on income (opening reversed, closing deducted).
    ...(b.reserves
      ? [
          {
            line: 'reservesClosing',
            value: b.reserves.schedule1Deduction,
            provenance: 'engine' as const,
          },
        ]
      : []),
    { line: 'nonCapitalLossApplied', value: b.losses.nonCapitalApplied, provenance: 'engine' },
    { line: 'netCapitalLossApplied', value: b.losses.netCapitalApplied, provenance: 'engine' },
    ...(b.lossCarryback
      ? [
          {
            line: 'lossCarriedBack',
            value: b.lossCarryback.totalCarriedBack,
            provenance: 'engine' as const,
          },
        ]
      : []),
    { line: 'taxableIncome', value: b.taxableIncome, provenance: 'engine' },
    // Schedule 33 — taxable capital employed in Canada (drives the SBD grind).
    ...(b.taxableCapitalSchedule
      ? [
          {
            line: 'taxableCapitalEmployedInCanada',
            value: b.taxableCapitalSchedule.taxableCapitalEmployedInCanada,
            provenance: 'engine' as const,
          },
        ]
      : []),
    { line: 'sbdIncome', value: b.sbd.sbdIncome, provenance: 'engine' },
    // The SBD amount is the ENGINE's figure (19% of eligible income) — the filing
    // layer serializes this, it must never recompute the rate.
    { line: 'sbdDeduction', value: b.sbd.sbdAmount, provenance: 'engine' },
    // Part I build-up (jacket lines 550/608/638) so the 700 total is auditable.
    { line: 'partIBasicTax', value: b.partI.basicTax, provenance: 'engine' },
    { line: 'federalAbatement', value: b.partI.abatement, provenance: 'engine' },
    { line: 'generalRateReduction', value: b.partI.generalRateReduction, provenance: 'engine' },
    { line: 'partITaxPayable', value: b.partI.partITaxPayable, provenance: 'engine' },
    { line: 'partIVTaxPayable', value: b.part4Rdtoh.partIvTax, provenance: 'engine' },
    { line: 'dividendRefund', value: b.part4Rdtoh.dividendRefund, provenance: 'engine' },
    // Part III.1 (jacket 710) and Part VI.1 (jacket 724). These are ALREADY inside
    // `totalFederalTax`, so omitting them here does not understate the tax — it
    // makes the filed return fail to add up, which is worse: the summary page is
    // an addition (700 + 705 + 710 + 712 + 716 + 720 + 724 … = 770) and CRA
    // assesses the disclosed components.
    ...(b.partIII1
      ? [
          {
            line: 'partIII1TaxPayable',
            value: b.partIII1.partIII1Tax,
            provenance: 'engine' as const,
          },
        ]
      : []),
    ...(b.partVI1
      ? [{ line: 'partVI1TaxPayable', value: b.partVI1.partVI1Tax, provenance: 'engine' as const }]
      : []),
    ...(b.provincial
      ? [
          { line: 'federalTax', value: b.totalFederalTax, provenance: 'engine' as const },
          {
            line: 'provincialTax',
            value: b.provincial.provincialTax,
            provenance: 'engine' as const,
          },
        ]
      : []),
    ...(b.provincialAllocation
      ? [
          { line: 'federalTax', value: b.totalFederalTax, provenance: 'engine' as const },
          {
            line: 'provincialTax',
            value: b.provincialAllocation.totalProvincialTax,
            provenance: 'engine' as const,
          },
          // Per-province allocated tax — a later filing renders Schedule 5 Part 1.
          ...b.provincialAllocation.provinces.map((p) => ({
            line: `provincialTax:${p.province}`,
            value: p.provincialTax,
            provenance: 'engine' as const,
          })),
        ]
      : []),
    // Total TAX PAYABLE (Part I + Part IV − dividend refund − credits, + provincial),
    // in dollars. This is tax payable, NOT the balance owing — it does not yet net
    // instalments (line 840) or payments made. `totalOwing` (cents) is the same
    // figure at the tax-core obligation boundary and carries the same caveat.
    { line: 'totalFederalTax', value: b.totalFederalTax, provenance: 'engine' },
    { line: 'totalTaxPayable', value: b.totalTax, provenance: 'engine' },
    { line: 'totalOwing', value: obligation.totalOwing, provenance: 'engine' },
    // Carryforward closing balances (→ next year's opening pools).
    {
      line: 'nonCapitalLossClosing',
      value: b.losses.nonCapital.closingBalance,
      provenance: 'engine',
    },
    {
      line: 'netCapitalLossClosing',
      value: b.losses.netCapital.closingBalance,
      provenance: 'engine',
    },
    { line: 'erdtohClosing', value: b.part4Rdtoh.erdtohClosing, provenance: 'engine' },
    { line: 'nerdtohClosing', value: b.part4Rdtoh.nerdtohClosing, provenance: 'engine' },
    ...(b.grip
      ? [
          { line: 'gripClosing', value: b.grip.closingGrip, provenance: 'engine' as const },
          ...(b.grip.excessiveDesignation > 0
            ? [
                {
                  line: 'excessiveEligibleDividend',
                  value: b.grip.excessiveDesignation,
                  provenance: 'engine' as const,
                },
              ]
            : []),
        ]
      : []),
    ...(b.zetm
      ? [{ line: 'zetmRateReduction', value: b.zetm.rateReduction, provenance: 'engine' as const }]
      : []),
    ...(b.foreignTaxCredit
      ? [
          {
            line: 'foreignTaxCredit',
            value: b.foreignTaxCredit.totalFtc,
            provenance: 'engine' as const,
          },
          // Unused business FTC → next year reads it as opening (10-yr carryforward).
          {
            line: 'businessFtcPoolClosing',
            value: b.foreignTaxCredit.closingBusinessFtcPool,
            provenance: 'engine' as const,
          },
        ]
      : []),
    ...(b.sredItc
      ? [
          { line: 'sredItcEarned', value: b.sredItc.itcEarned, provenance: 'engine' as const },
          {
            line: 'sredItcRefundable',
            value: b.sredItc.refundableItc,
            provenance: 'engine' as const,
          },
          // Closing non-refundable ITC pool → next year reads it as opening.
          {
            line: 'itcPoolClosing',
            value: b.sredItc.closingItcPool,
            provenance: 'engine' as const,
          },
        ]
      : []),
  ];

  // The safety control, applied to real engine output.
  assertFiledProvenance(fields);

  return {
    obligation,
    fields,
    fact: {
      type: 'AdjustmentComputed',
      actor,
      provenance: 'engine',
      reason: `Federal T2 computed (${T2_ENGINE_VERSION})`,
      payload: {
        engineVersion: T2_ENGINE_VERSION,
        totalOwing: obligation.totalOwing,
        taxableIncome: b.taxableIncome,
        partITaxPayable: b.partI.partITaxPayable,
        resultHash: snapshot.resultHash,
      },
    },
    engineVersion: T2_ENGINE_VERSION,
    snapshot,
  };
}

/**
 * Reproducibility check: recompute from a stored snapshot's `validatedInput` and
 * confirm the fresh result hashes to the recorded `resultHash`. A mismatch means
 * the return can no longer be reproduced — the engine, rate book, or form shape
 * has changed since it was filed (or the snapshot was tampered with). This is the
 * proof the reviewer wanted that engine-version + stored input actually reproduce
 * a return, not just a manually-maintained version string.
 */
export function verifyT2Reproducible(snapshot: ComputationSnapshot): {
  reproducible: boolean;
  expected: string;
  actual: string;
} {
  // Recompute with the EXACT stored rate table (via the engine's fully-resolved
  // `rates` escape hatch), NOT the current host book — so a rate-book change
  // since filing does not masquerade as an irreproducible return. This is a
  // trusted internal reproduction, so bypassing the request-strip is correct.
  const fresh = computeFederalT2({
    ...(snapshot.validatedInput as Record<string, unknown>),
    rates: snapshot.rateTable as CorpTaxRates,
  } as Parameters<typeof computeFederalT2>[0]);
  const actual = hashOf(fresh);
  return {
    reproducible: actual === snapshot.resultHash,
    expected: snapshot.resultHash,
    actual,
  };
}
