/**
 * The host certifies rate years the package does not ship. Without this, every
 * 2025 return is red-flagged RATE_YEAR_UNCERTIFIED and cannot be filed —
 * `review-generator.service.ts` and `t2-cif.service.ts` both gate on
 * `hasExactRateYear(getFederalRateBook(), taxYear)`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasExactRateYear, resolveRates } from '@classytic/ca-tax/t2';
import { AB_TAX_2025, CORP_TAX_2025, registerRateYears } from '../src/config/rate-years.js';
import { getAlbertaRateBook, getFederalRateBook, resetRateBooks } from '../src/engine/tax-rates.js';

describe('registerRateYears', () => {
  afterEach(() => resetRateBooks());

  it('leaves 2025 uncertified until registration runs — the gap this closes', () => {
    expect(hasExactRateYear(getFederalRateBook(), 2025)).toBe(false);
    expect(hasExactRateYear(getAlbertaRateBook(), 2025)).toBe(false);
  });

  it('certifies 2025 federally and for Alberta', () => {
    registerRateYears();
    expect(hasExactRateYear(getFederalRateBook(), 2025)).toBe(true);
    expect(hasExactRateYear(getAlbertaRateBook(), 2025)).toBe(true);
  });

  it('carries the one 2025 federal change — the SR&ED expenditure limit at $6M', () => {
    // Budget 2025: "$3 million to … $6 million", taxation years beginning on or
    // after 2024-12-16, superseding the FES's $4.5 million.
    registerRateYears();
    const r2025 = resolveRates(getFederalRateBook(), 2025);
    const r2024 = resolveRates(getFederalRateBook(), 2024);
    expect(r2025.SRED_EXPENDITURE_LIMIT).toBe(6_000_000);
    expect(r2024.SRED_EXPENDITURE_LIMIT).toBe(3_000_000); // 2024 untouched
  });

  it('leaves every other federal figure exactly as 2024 — CRA lists no change', () => {
    registerRateYears();
    const { SRED_EXPENDITURE_LIMIT: _a, ...rest2025 } = CORP_TAX_2025;
    const { SRED_EXPENDITURE_LIMIT: _b, ...rest2024 } = resolveRates(getFederalRateBook(), 2024);
    expect(rest2025).toEqual(rest2024);
    expect(CORP_TAX_2025.CAPITAL_GAINS_INCLUSION_RATE).toBe(0.5); // the ⅔ proposal was cancelled
    expect(CORP_TAX_2025.BUSINESS_LIMIT).toBe(500_000);
  });

  it('keeps Alberta at 8% / 2% / $500,000 — unchanged since 2020-07-01', () => {
    registerRateYears();
    expect(AB_TAX_2025).toEqual({ GENERAL_RATE: 0.08, SMALL_BUSINESS_RATE: 0.02, BUSINESS_LIMIT: 500_000 });
  });

  it('does not certify 2026 — no primary source was available to verify it', () => {
    registerRateYears();
    expect(hasExactRateYear(getFederalRateBook(), 2026)).toBe(false);
  });
});
