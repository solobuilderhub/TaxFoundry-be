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
 * Registered, and identical to 2025 on every figure the engine carries. Each
 * one was checked against a document published IN 2026, not inferred from
 * silence — the distinction this module's earlier revision (correctly) refused
 * to blur when no such document existed yet.
 *
 * Federal — verified 2026-09-08:
 *   - No federal change for 2026 at all. CRA, "What's new for corporations",
 *     page dated 2026-06-12, enumerates 2026 changes for British Columbia,
 *     Newfoundland and Labrador, Nova Scotia, Ontario and Saskatchewan, and
 *     lists none federally. Alberta appears nowhere in it either.
 *   - Confirmed against the Spring Economic Update 2026, which announces no
 *     change to the general rate, the small business deduction rate or the
 *     business limit. Its corporate measures are an accelerated CCA for
 *     low-carbon LNG facilities, a CCUS credit expansion, the employee
 *     ownership trust exemption made permanent, and an SR&ED pre-claim
 *     approval process from 2026-04-01 — none of which touches a rate in this
 *     book. It announces no capital-gains inclusion-rate change, so ½ stands.
 *   - Business limit $500,000, ground to nil straight-line over taxable
 *     capital of $10,000,000 → $50,000,000 — T2 Corporation Income Tax Guide,
 *     chapter 4, page dated 2026-05-28, quoted verbatim: "The business limit
 *     is reduced on a straight-line basis for CCPCs that have taxable capital
 *     employed in Canada of between $10 million and $50 million in the
 *     previous year."
 *   - SR&ED expenditure limit stays $6,000,000. The Budget 2025 increase runs
 *     from tax years BEGINNING after 2024-12-15, and every tax year ending in
 *     2026 began after that date, so 2026 has none of the straddle problem the
 *     2025 note below describes. (CRA's own SR&ED ITC page also puts the
 *     limit's taxable-capital phase-out at $15M → $75M from the same start
 *     date. The engine still applies the limit as a flat figure and does not
 *     model that phase-out — unchanged from 2025, and stated here so the gap
 *     is not rediscovered as a surprise.)
 *   - Zero-emission technology manufacturing stays 7.5% / 4.5%. The reduced
 *     rates run in full for tax years beginning 2022 through 2031 and phase
 *     out over tax years beginning 2032 to 2034 (ITA s.125.2), so 2026 is well
 *     inside the full-rate window.
 *
 * Alberta — verified 2026-09-08: general 8%, small business 2%, small business
 *   threshold $500,000, all effective since 2020-07-01 and still shown as
 *   current, with no scheduled corporate change — alberta.ca, "Tax, levy, and
 *   prescribed interest rates". The 2026 dates on that page belong to the
 *   tourism levy (6%, from 2026-04-01) and the data centre levy (from
 *   2026-01-01), neither of which is corporate income tax.
 *
 * Both years are therefore registered as the SAME frozen objects rather than
 * as copies. `CORP_TAX_2026 === CORP_TAX_2025` is deliberate: if a 2026 figure
 * is ever found to differ, the fix is a new object here, and an accidental
 * divergence between two hand-copied tables cannot happen in the meantime.
 *
 * ── 2027 ──────────────────────────────────────────────────────────────────
 *
 * NOT registered, on exactly the reasoning that kept 2026 out until today: no
 * 2027 rate table has been published. Register it from the documents, not from
 * the absence of an announcement.
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

/**
 * 2026 carries every 2025 figure unchanged — see the "2026" section above for
 * the document behind each one. Deliberately the same object, not a copy.
 */
export const CORP_TAX_2026: CorpTaxRates = CORP_TAX_2025;

export const AB_TAX_2026: AlbertaTaxRates = AB_TAX_2025;

/** Register every certified year onto the host books. Call once at boot. */
export function registerRateYears(): void {
  registerFederalRates([
    { taxYear: 2025, rates: CORP_TAX_2025 },
    { taxYear: 2026, rates: CORP_TAX_2026 },
  ]);
  registerAlbertaRates([
    { taxYear: 2025, rates: AB_TAX_2025 },
    { taxYear: 2026, rates: AB_TAX_2026 },
  ]);
}
