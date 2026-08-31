/**
 * Shared shape for a computed engagement — what every engine runner returns and
 * what the compute service persists. `obligation.breakdown` is opaque here
 * (T2 vs AT1 differ); the persisted computed-return keeps the summary fields.
 */
import type { TaxObligation } from '@classytic/tax-core/obligation';
import type { ProvenancedField } from '#shared/provenance-guard.js';
import type { ComputationSnapshot } from './snapshot.js';

export interface EngineComputeOutput {
  obligation: TaxObligation<unknown>;
  /** computed-return field rows — every one provenance 'engine'. */
  fields: ProvenancedField[];
  fact: {
    type: 'AdjustmentComputed';
    actor: string;
    provenance: 'engine';
    reason: string;
    payload: Record<string, unknown>;
  };
  engineVersion: string;
  /** Reproducibility record (T2). Optional — AT1 does not emit one yet. */
  snapshot?: ComputationSnapshot;
  /**
   * Supporting-schedule line items for the filing payload, as the engine
   * assembled them.
   *
   * Persisted with the computed return so the filing path renders **what was
   * computed** rather than rebuilding it from the flat summary fields. Rebuilding
   * is how schedules go missing: the summary carries a handful of jacket totals
   * and knows nothing about the schedules behind them.
   */
  schedulePayloads?: {
    scheduleId: string;
    values: { lineItemId: string; value: string | number }[];
  }[];
  /**
   * Anything the schedules want the preparer to see — a fail-closed default
   * that suppressed a claim, an amount capped by a shared ceiling, a missing
   * input the engine could not derive. Persisted alongside the computed
   * return so the review layer and the paper Form Views can both surface
   * them, rather than each rebuilding its own copy from the raw schedule
   * results (T2 does not emit these yet — AT1-only for now).
   */
  issues?: string[];
}
