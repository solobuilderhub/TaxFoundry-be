/**
 * Alberta AT1 counterpart to t2-compute: run the AT1 engine and shape its output
 * for the ledger (fields provenance 'engine', through the provenance guard).
 */
import { type AlbertaReturnResult, at1Engine } from '@classytic/ca-tax/t2';
import type { TaxObligation } from '@classytic/tax-core/obligation';
import { assertFiledProvenance, type ProvenancedField } from '#shared/provenance-guard.js';
import type { EngineComputeOutput } from './compute-types.js';
import { getAlbertaRateBook } from './tax-rates.js';

export const AT1_ENGINE_VERSION = 'ca-tax/at1@2024.1';

export function runAT1Compute(input: unknown, actor = 'engine'): EngineComputeOutput {
  const validated = at1Engine.validate(input);
  // Inject the host's authoritative Alberta rate book (see tax-rates.ts).
  const obligation = at1Engine.compute({
    ...validated,
    rateBook: getAlbertaRateBook(),
  }) as TaxObligation<AlbertaReturnResult>;
  const b = obligation.breakdown;

  const fields: ProvenancedField[] = [
    { line: 'allocationFactor', value: b.allocationFactor, provenance: 'engine' },
    {
      line: 'albertaTaxableIncome',
      value: b.albertaTax.albertaTaxableIncome,
      provenance: 'engine',
    },
    { line: 'albertaSbdIncome', value: b.albertaTax.albertaSbdIncome, provenance: 'engine' },
    // AT1 lines 068 and 070. The jacket states 080 = 068 − (070 + 071 + 072 +
    // 074 + 076), and all of those are mandatory output, so the two the engine
    // computes must reach the payload rather than being re-derived there.
    { line: 'basicAlbertaTax', value: b.albertaTax.basicTax, provenance: 'engine' },
    {
      line: 'albertaSmallBusinessDeduction',
      value: b.albertaTax.smallBusinessDeduction,
      provenance: 'engine',
    },
    { line: 'albertaTaxPayable', value: b.albertaTaxPayable, provenance: 'engine' },
    // AT1 line 129 — mandatory on the jacket, so it is reported even at nil.
    { line: 'innovationEmploymentGrant', value: b.innovationEmploymentGrant, provenance: 'engine' },
    { line: 'totalOwing', value: obligation.totalOwing, provenance: 'engine' },
  ];
  assertFiledProvenance(fields);

  return {
    obligation,
    fields,
    fact: {
      type: 'AdjustmentComputed',
      actor,
      provenance: 'engine',
      reason: `Alberta AT1 computed (${AT1_ENGINE_VERSION})`,
      payload: {
        engineVersion: AT1_ENGINE_VERSION,
        totalOwing: obligation.totalOwing,
        albertaTaxPayable: b.albertaTaxPayable,
      },
    },
    engineVersion: AT1_ENGINE_VERSION,
    // Carry the engine's own payload through to persistence. The filing path must
    // render what was computed, not reconstruct it from the summary fields.
    schedulePayloads: b.schedulePayloads,
    // Every schedule's own validation notes, already merged by the engine
    // (`AlbertaReturnResult.issues`) — not re-derived here.
    issues: b.issues,
  };
}
