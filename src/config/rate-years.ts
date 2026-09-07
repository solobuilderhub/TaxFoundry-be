/**
 * The tax years this deploy certifies rates for.
 *
 * `@classytic/ca-tax` ships 2024 as its reference year and nothing later; the
 * review layer red-flags any return whose tax year has no exact entry in ITS
 * OWN program's book ("RATE_YEAR_UNCERTIFIED"), and the T2 CIF path refuses it
 * outright. Until this module existed nothing registered a year, so every 2025
 * return was unfileable on rates alone. Onboarding a year is a data change
 * here, sourced from the published documents named beside each entry.
 *
 * ── What refuses, and what only warns ───────────────────────────────────────
 *
 * The review flag covers all three programs. The hard filing refusal
 * (`hasExactRateYear` inside `composeT2FilingData`) covers only the federal
 * CIF path — the Alberta and Québec renderers do not check. This comment used
 * to claim the AT1 path refused too, and it never has.
 *
 * That gap mattered most for Québec, whose book still ships 2024 only and which
 * no deployment registers a later year for: `resolveRates` carries the newest
 * earlier table forward rather than throwing, so a 2025 CO-17 computed on 2024
 * Québec rates and reviewed green. Alberta escaped by coincidence — its 2025
 * table is a copy of 2024 — and the same hole opens for Alberta in 2026, which
 * this module deliberately declines to register without a published table.
 *
 * Registering a year you do not have published rates for would be worse than
 * the gap. The flag is the honest control: it says the return cannot be filed
 * on carried-forward rates, without inventing what the rates are.
 *
 * ── 2025 ──────────────────────────────────────────────────────────────────
 *
 * Federal: identical to 2024 except the SR&ED expenditure limit.
 *   - Basic 38%, abatement 10%, general rate reduction 13% (net 15%), small
 *     business rate net 9%, business limit $500,000 — CRA, "Corporation tax
 *     rates", page dated 2025-05-30, no change listed for 2025 or 2026.
 *   - SR&ED expenditure limit $3,000,000 → $6,000,000 — Budget 2025 (Tax
 *     Measures: Supplementary Information), "for taxation years that begin on
 *     or after December 16, 2024", superseding the 2024 Fall Economic
 *     Statement's $4,500,000 for the same start date. CRA's T2 guide "What's
 *     new" carries the same $6,000,000.
 *   - Capital gains inclusion rate stays ½ — the proposed ⅔ was cancelled;
 *     Budget 2025 carries no inclusion-rate measure.
 *
 *   The SR&ED change keys off the tax year's START (on or after 2024-12-16),
 *   while this book keys off the tax YEAR. A calendar 2025 year begins after
 *   that date and is right; a non-calendar year ending in 2025 that BEGAN
 *   before 2024-12-16 still has the $3,000,000 limit, and a preparer with one
 *   should set `expenditureLimit` on the SR&ED input directly, which overrides
 *   the book.
 *
 *   The same Budget 2025 measure also moves the SR&ED limit's own
 *   taxable-capital phase-out to $15M–$75M. The engine does not model that
 *   phase-out (it applies the limit as a flat figure), so nothing here changes
 *   for it; the SBD grind band ($10M–$50M, `TC_GRIND_*`) is a different rule
 *   and is unchanged.
 *
 * Alberta: identical to 2024. General 8%, small business 2%, small business
 *   threshold $500,000, all in effect since 2020-07-01 with no announced
 *   change — alberta.ca, "Tax, levy and prescribed interest rates".
 *
 * ── 2026 ──────────────────────────────────────────────────────────────────
 *
 * NOT registered. Budget 2025 (2025-11-04) is the latest federal budget, and
 * Finance Canada now tables the budget in the fall with a fiscal update in the
 * spring — so Budget 2026 had not been tabled when this was written, and no
 * published 2026 rate table exists to certify against. Neither CRA's rates page
 * nor Budget 2025 announces a 2026 change to any figure the engine carries, but
 * "nothing announced yet" is not a published rate, and a year certified here on
 * that basis would file on an assumption. Add 2026 as a further entry below
 * once Budget 2026's tax measures are published.
 */
import {
  AB_TAX_2024,
  type AlbertaTaxRates,
  CORP_TAX_2024,
  type CorpTaxRates,
} from '@classytic/ca-tax/t2';
import { registerAlbertaRates, registerFederalRates } from '../engine/tax-rates.js';

export const CORP_TAX_2025: CorpTaxRates = Object.freeze({
  ...CORP_TAX_2024,
  SRED_EXPENDITURE_LIMIT: 6_000_000,
});

export const AB_TAX_2025: AlbertaTaxRates = AB_TAX_2024;

/** Register every certified year onto the host books. Call once at boot. */
export function registerRateYears(): void {
  registerFederalRates([{ taxYear: 2025, rates: CORP_TAX_2025 }]);
  registerAlbertaRates([{ taxYear: 2025, rates: AB_TAX_2025 }]);
}
