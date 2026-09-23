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

  /*
   * Carried onto the validated input by `assembleProvincialInput` for the
   * review layer's benefit only — `computeAlbertaReturn` never reads it, so
   * it is read here rather than stripped like the rate/year fields above.
   * `evaluateReviewFlags`' book-vs-tax comparison (`BIG_BOOK_TAX_DIFF`) reads
   * `fold.netIncomeForTax` for every program alike; the federal compute has
   * always emitted this field, this one never did, so every AT1 review
   * compared book income against an absent figure that defaulted to $0 — a
   * false "difference" the size of the whole return, however clean the
   * actual Schedule 1 reconciliation was.
   */
  const netIncomeForTax =
    typeof safe.netIncomeForTax === 'number' ? safe.netIncomeForTax : undefined;

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
    ...(netIncomeForTax !== undefined
      ? [{ line: 'netIncomeForTax', value: netIncomeForTax, provenance: 'engine' as const }]
      : []),
    /*
     * AT1 line 062 — taxable income on an Alberta basis, BEFORE allocation.
     * `line-labels.ts` used to caption this "Alberta taxable income" with no
     * qualifier, so on any return with an allocation factor under 100% the
     * summary's single most load-bearing figure read as the wrong number —
     * a preparer at a 60% factor saw $200,000 labelled "Alberta taxable
     * income" when only $120,000 of it was actually taxed in Alberta
     * (TF_DEV_BUG_LIST_2026-09-18.md, BUG-108). Kept under the same `line`
     * key for backward compatibility with anything already reading it;
     * `amountTaxableInAlberta` below is the new field, not a replacement.
     */
    {
      line: 'albertaTaxableIncome',
      value: b.albertaTax.albertaTaxableIncome,
      provenance: 'engine',
    },
    /*
     * AT1 line 066 — `062 × 065`, the income actually taxable in Alberta and
     * the base every rate applies to. This was computed and used internally
     * (`computeAlbertaTax`'s own doc comment: "Printed on the form, never
     * transmitted") but never surfaced as its own summary field, so the
     * allocated figure had nowhere honest to be labelled — BUG-108 again,
     * the other half of it.
     */
    {
      line: 'amountTaxableInAlberta',
      value: b.albertaTax.amountTaxableInAlberta,
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
