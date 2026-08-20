/**
 * Québec CO-17 counterpart to t2-compute / at1-compute: run the CO-17 engine and
 * shape its output for the ledger (fields provenance 'engine', guarded).
 */
import { co17Engine, type QuebecReturnResult } from '@classytic/ca-tax/t2';
import type { TaxObligation } from '@classytic/tax-core/obligation';
import { assertFiledProvenance, type ProvenancedField } from '#shared/provenance-guard.js';
import type { EngineComputeOutput } from './compute-types.js';
import { getQuebecRateBook } from './tax-rates.js';

export const CO17_ENGINE_VERSION = 'ca-tax/co17@2024.1';

export function runCo17Compute(input: unknown, actor = 'engine'): EngineComputeOutput {
  const validated = co17Engine.validate(input);
  // Inject the host's authoritative Québec rate book (see tax-rates.ts).
  const obligation = co17Engine.compute({
    ...validated,
    rateBook: getQuebecRateBook(),
  }) as TaxObligation<QuebecReturnResult>;
  const b = obligation.breakdown;

  const fields: ProvenancedField[] = [
    { line: 'allocationFactor', value: b.allocationFactor, provenance: 'engine' },
    { line: 'quebecTaxableIncome', value: b.quebecTax.quebecTaxableIncome, provenance: 'engine' },
    { line: 'quebecSbdIncome', value: b.quebecTax.quebecSbdIncome, provenance: 'engine' },
    {
      line: 'quebecTaxAtSmallBusinessRate',
      value: b.quebecTax.taxAtSmallBusinessRate,
      provenance: 'engine',
    },
    { line: 'quebecTaxAtGeneralRate', value: b.quebecTax.taxAtGeneralRate, provenance: 'engine' },
    { line: 'quebecTaxPayable', value: b.quebecTaxPayable, provenance: 'engine' },
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
      reason: `Québec CO-17 computed (${CO17_ENGINE_VERSION})`,
      payload: {
        engineVersion: CO17_ENGINE_VERSION,
        totalOwing: obligation.totalOwing,
        quebecTaxPayable: b.quebecTaxPayable,
      },
    },
    engineVersion: CO17_ENGINE_VERSION,
  };
}
