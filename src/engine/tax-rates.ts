/**
 * Host rate registry — where TaxFoundry wires the AUTHORITATIVE tax rate data.
 *
 * The ca-tax package ships pure formulas + a *reference* rate book (the years it
 * happens to know). The HOST is the source of truth: it composes the real book —
 * adding each new CRA/TRA year, or overriding a reference value with the
 * published number — and injects it into every compute. The package is the
 * fallback; this module is the authority.
 *
 * Onboarding a new tax year is a DATA change here (add a `RateBookEntry`), not a
 * package edit or engine redeploy. Seed from config/DB at boot via the setters;
 * `runT2Compute` / `runAt1Compute` read the current book at compute time.
 *
 * Mirrors the `setT2CifGateway` injection pattern — host wiring lives in the host.
 */
import {
  AB_TAX_RATE_BOOK,
  type AlbertaTaxRates,
  CORP_TAX_RATE_BOOK,
  type CorpTaxRates,
  extendRateBook,
  type ProvincialRateChanges,
  QC_TAX_RATE_BOOK,
  type QuebecTaxRates,
  type RateBook,
} from '@classytic/ca-tax/t2';

let federalBook: RateBook<CorpTaxRates> = CORP_TAX_RATE_BOOK;
let albertaBook: RateBook<AlbertaTaxRates> = AB_TAX_RATE_BOOK;
let quebecBook: RateBook<QuebecTaxRates> = QC_TAX_RATE_BOOK;
// Authoritative mid-year provincial rate changes (day-weighting data). Empty by
// default — a host wires a province's change here when one is announced.
let provincialRateChanges: ProvincialRateChanges = {};

/** The federal rate book the engine should use for this deploy. */
export function getFederalRateBook(): RateBook<CorpTaxRates> {
  return federalBook;
}

/** The Alberta rate book the engine should use for this deploy. */
export function getAlbertaRateBook(): RateBook<AlbertaTaxRates> {
  return albertaBook;
}

/** The Québec (CO-17) rate book the engine should use for this deploy. */
export function getQuebecRateBook(): RateBook<QuebecTaxRates> {
  return quebecBook;
}

/** Wire host-authoritative Québec years onto the package reference book. */
export function registerQuebecRates(overrides: RateBook<QuebecTaxRates>): void {
  quebecBook = extendRateBook(quebecBook, overrides);
}

/** Authoritative mid-year provincial rate changes for day-weighting. */
export function getProvincialRateChanges(): ProvincialRateChanges {
  return provincialRateChanges;
}

/** Wire a province's mid-year rate change (host authority) — e.g. at boot from config/DB. */
export function registerProvincialRateChanges(changes: ProvincialRateChanges): void {
  provincialRateChanges = { ...provincialRateChanges, ...changes };
}

/**
 * Wire host-authoritative federal years onto the package reference book (host
 * entries win). Call at boot with CRA-published values; e.g.
 *   registerFederalRates([{ taxYear: 2025, rates: { ...CORP_TAX_2024, SBD_RATE: 0.09 } }])
 */
export function registerFederalRates(overrides: RateBook<CorpTaxRates>): void {
  federalBook = extendRateBook(federalBook, overrides);
}

/** Wire host-authoritative Alberta years onto the package reference book. */
export function registerAlbertaRates(overrides: RateBook<AlbertaTaxRates>): void {
  albertaBook = extendRateBook(albertaBook, overrides);
}

/** Reset to the package reference books — for tests. */
export function resetRateBooks(): void {
  federalBook = CORP_TAX_RATE_BOOK;
  albertaBook = AB_TAX_RATE_BOOK;
}
