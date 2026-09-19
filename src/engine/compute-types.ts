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
  /**
   * Reproducibility record. T2 and AT1 both emit one; CO-17 does not yet, so it
   * stays optional.
   */
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
    /**
     * PRINT-ONLY lines — computed, shown, never transmitted. See ca-tax's
     * `At1ScheduleData.display`.
     *
     * Carried here so the paper Form Views can render the subtotals the page
     * prints (Schedule 12's 052/080/081, Schedule 18's column totals and
     * capital-gain working, Schedule 21's 013/015 and its whole RIFE
     * continuity). Those were computed inside the engine, consumed, and
     * discarded — so every one of them rendered as a "Computed" badge over an
     * empty cell.
     *
     * The filing path must never read this: `renderAt1NetFile` and the RSI
     * adapter both iterate `values`, which is exactly why this is a sibling
     * array rather than a flag inside it.
     */
    display?: { lineItemId: string; value: string | number }[];
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
