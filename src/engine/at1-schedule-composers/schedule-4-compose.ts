/**
 * AT1 Schedule 4 — Alberta Foreign Investment Income Tax Credit.
 *
 * Composes `AlbertaSchedule4Input` (one FIC occurrence per foreign country)
 * from the AT1-only UI slice at `ri.albertaForeignInvestment4`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule4-foreign-investment-tax-credit.ts`
 * for the full spec derivation (TRA spec §3.2.3.5) — this file only reshapes UI
 * input into that module's input shape; it does not re-derive the D/G
 * lesser-of formula itself.
 *
 * The country rows (country, net foreign investment income, federal tax paid,
 * the ITA 20(12)/ACTA 8(2.2) deduction, the federal non-business credit) have
 * no federal source at all — federal Schedule 21's foreign tax credit is a
 * DIFFERENT calculation, not a figure this schedule's occurrences can be
 * derived from — so every FIC row is genuinely AT1-only input.
 *
 * The formula's other four inputs — 000062 (Alberta taxable income), 000064
 * (royalty tax deduction), 000065 (allocation factor) and 000068 (basic
 * Alberta tax payable) — are AT1 JACKET lines, not Schedule 4's own. Per the
 * task brief, these are read from `ri.alberta` rather than re-collected under
 * this schedule's own key:
 *   - `ri.alberta.royaltyTaxDeduction` already exists as real preparer input
 *     (see `apps/web/.../_config/schedules/alberta.ts`'s "Royalty Tax
 *     Deduction" field, which also feeds AT1 Schedule 1) — sourced from there
 *     directly, no duplication.
 *   - `ri.alberta.albertaTaxableIncome` / `ri.alberta.allocationFactor` /
 *     `ri.alberta.basicAlbertaTax` are NOT currently populated anywhere in
 *     the running app as of this composer's authoring: `albertaTaxableIncome`
 *     and `allocationFactor` are computed in
 *     `assemble-provincial-input.ts` (lines ~78-81) but passed to
 *     `assembleAt1Schedules` as bare function PARAMETERS, not attached to
 *     `ri`; `basicAlbertaTax` (000068) is not computed until `at1-compute.ts`
 *     runs `at1Engine.compute()`, strictly AFTER schedule composition. Wiring
 *     this composer into `assembleAt1Schedules` therefore needs the caller to
 *     merge these three onto `ri.alberta` (or pass them some other way) before
 *     calling `assembleSchedule4` — this file reads them under those three
 *     names so whichever composer/wiring change does that merge has an
 *     unambiguous target. Note 000068 does NOT depend on Schedule 4's own
 *     credit (it is basic tax BEFORE any of lines 070/071/072/074/076), so it
 *     can be computed independently of this schedule despite the apparent
 *     circularity in the spec's own D formula (see the schedule module's doc
 *     comment for why D is degenerate for exactly this reason).
 *
 * `@classytic/ca-tax/t2` ALSO has an unrelated federal `Schedule4Result`
 * (loss continuity, from `schedule4-losses.js`), so — same as Schedule 8's
 * federal-CCA collision — the AT1 pair is imported under its
 * `Alberta`-prefixed barrel export (`computeAlbertaSchedule4`/
 * `AlbertaSchedule4Result`). See `packages/ca-tax/src/t2/at1/index.ts`'s
 * Schedule 4 export block for the collision this avoids.
 */
import { computeAlbertaSchedule4, type AlbertaSchedule4Result } from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/**
 * The composition entry point. Returns `undefined` when no country row was
 * entered — an all-blank slice is not a Schedule 4 to file, matching the
 * `undefined`-return pattern the rest of `assemble-at1-schedules.ts` uses
 * (e.g. `scheduleTwenty`, `scheduleTen`).
 */
export function assembleSchedule4(ri: Ri): AlbertaSchedule4Result | undefined {
  const rows: Ri[] = ri.albertaForeignInvestment4?.countries ?? [];
  const countries = rows.filter(
    (c) => present(c?.country) || present(c?.netForeignInvestmentIncome),
  );
  if (countries.length === 0) return undefined; // nothing to file

  const ab: Ri = ri.alberta ?? {};

  return computeAlbertaSchedule4({
    countries: countries.map((c) => ({
      country: String(c.country ?? ''),
      netForeignInvestmentIncome: num(c.netForeignInvestmentIncome),
      fedForeignTaxPaid: num(c.fedForeignTaxPaid),
      fedIta2012Deduction: num(c.fedIta2012Deduction),
      ...(present(c.albertaActa82Deduction)
        ? { albertaActa82Deduction: num(c.albertaActa82Deduction) }
        : {}),
      fedNonBusinessForeignTaxCredit: num(c.fedNonBusinessForeignTaxCredit),
    })),
    ...(present(ab.albertaTaxableIncome)
      ? { albertaTaxableIncome: num(ab.albertaTaxableIncome) }
      : {}),
    ...(present(ab.royaltyTaxDeduction) ? { royaltyTaxDeduction: num(ab.royaltyTaxDeduction) } : {}),
    ...(present(ab.allocationFactor) ? { allocationFactor: num(ab.allocationFactor) } : {}),
    ...(present(ab.basicAlbertaTax) ? { basicAlbertaTax: num(ab.basicAlbertaTax) } : {}),
  });
}
