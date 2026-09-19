/**
 * Alberta AT1 counterpart to t2-compute: run the AT1 engine and shape its output
 * for the ledger (fields provenance 'engine', through the provenance guard).
 */
import { type AlbertaReturnResult, type AlbertaSbdAreaB, at1Engine } from '@classytic/ca-tax/t2';
import type { TaxObligation } from '@classytic/tax-core/obligation';
import { assertFiledProvenance, type ProvenancedField } from '#shared/provenance-guard.js';
import type { EngineComputeOutput } from './compute-types.js';
import { buildSnapshot } from './snapshot.js';
import { getAlbertaRateBook } from './tax-rates.js';

export const AT1_ENGINE_VERSION = 'ca-tax/at1@2024.1';

/** AT1 return-form / schema version — bump when the input or line shape changes. */
export const AT1_FORM_VERSION = 'at1-form@2024.1';

/**
 * Area B's amounts, flattened onto the `line`-keyed fields array.
 *
 * Absent — not zeroed — when the corporation cannot claim the deduction at
 * all, because there is no base amount to determine and a row of zeros reads
 * as a computed nil rather than an inapplicable schedule. Same reason
 * `AlbertaSbdResult.areaB` is optional rather than always present.
 */
function areaBFields(areaB: AlbertaSbdAreaB | undefined): ProvenancedField[] {
  if (!areaB) return [];
  return Object.entries(areaB).map(([key, value]) => ({
    line: `sbdAreaB.${key}`,
    value,
    provenance: 'engine',
  }));
}

export function runAT1Compute(input: unknown, actor = 'engine'): EngineComputeOutput {
  const validated = at1Engine.validate(input);

  // Strip every caller-controlled rate/year field BEFORE compute — the request is
  // untrusted, and a provincial engagement sent in the engine's own shape is
  // passed straight through by the compute service. `computeAlbertaReturn` treats
  // `rates` (a fully-resolved table) as an override of the resolved book, and the
  // AT1 engine treats `taxYear` as an override of the year derived from
  // `period.end` — so leaving either in would let a client file a return computed
  // at rates it chose. The federal path has always dropped these; the Alberta one
  // only overrode `rateBook`, which the other two fields sit in front of.
  const {
    rates: _rates,
    rateBook: _rateBook,
    taxYear: _taxYear,
    ...safe
  } = validated as unknown as Record<string, unknown>;
  void _rates;
  void _rateBook;
  void _taxYear;

  // Resolved once and both USED and STORED, so the snapshot's rate table is
  // provably the one this return was computed at.
  const rateBook = getAlbertaRateBook();
  const obligation = at1Engine.compute({
    ...(safe as unknown as typeof validated),
    rateBook,
  }) as TaxObligation<AlbertaReturnResult>;
  const b = obligation.breakdown;

  // The same reproducibility record the federal return has carried from the
  // start. Without it an AT1 computed-return stored a null `rateTableVersion`,
  // a null `formVersion` and — worse — a null `resultHash`, which is what the
  // T183 authorization binds to. A signature bound to null is bound to nothing:
  // the officer's authorization could not be shown to belong to the computation
  // that was filed.
  const snapshot = buildSnapshot({
    engineBuild: AT1_ENGINE_VERSION,
    formVersion: AT1_FORM_VERSION,
    rateTable: rateBook,
    validatedInput: safe,
    result: b,
  });

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
    /*
     * AT1 Schedule 1 Area B — the working behind line 015.
     *
     * Not filed, and not filable: Area B's amounts (a)-(k) are unnumbered on
     * the page and §3.2.3.2 defines no row for any of them, line 015 included.
     * They are reported here for the same reason `allocationFactor` is — the
     * preparer has to be able to see where a figure the whole deduction is
     * scaled by came from, and line 015 used to render as a "Computed" badge
     * over an empty cell with no Area B anywhere in the product to explain it.
     *
     * Keyed under `sbdAreaB.` so nothing mistakes them for AT1 line ids: this
     * array is `line`-keyed and every real AT1 entry in it is either a
     * 9-digit line-item id or a named jacket total.
     */
    ...areaBFields(b.albertaTax.schedule1.areaB),
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
    snapshot,
    // Carry the engine's own payload through to persistence. The filing path must
    // render what was computed, not reconstruct it from the summary fields.
    schedulePayloads: b.schedulePayloads,
    // Every schedule's own validation notes, already merged by the engine
    // (`AlbertaReturnResult.issues`) — not re-derived here.
    issues: b.issues,
  };
}
