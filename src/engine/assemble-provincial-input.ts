/**
 * Federal T2 engine input → a PROVINCIAL engine input (Alberta AT1 / Québec CO-17).
 *
 * Both provincial returns tax the FEDERAL taxable income allocated to the
 * province, so the province's income figure is not re-entered — it is composed
 * from the same federal return: this runs `computeFederalT2` on the (isCcpc- and
 * prior-openings-applied) federal input, then shapes the province-specific input
 * the AT1 / CO-17 engine validates. One source, so the provincial calculation and
 * the federal one can never disagree about taxable income.
 *
 * Province-only inputs that the federal schedules don't carry (Québec's paid-hours
 * SBD eligibility, a shared provincial business limit) come from the structured
 * working return's `quebec` slice. Fail-closed: absent eligibility ⇒ general rate.
 */
import {
  AB_TAX_RATE_BOOK,
  computeAllocationFactor,
  computeFederalT2,
  type FederalT2Input,
  resolveAlbertaTaxRates,
  SINGLE_JURISDICTION_ALBERTA_FACTOR,
} from '@classytic/ca-tax/t2';
import type { ComposedFederalInput } from './assemble-t2-input.js';
import { assembleAt1Schedules } from './assemble-at1-schedules.js';
import type { ReturnInput } from './return-input-contract.js';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);

interface Pe {
  province: string;
  grossRevenue: number;
  salariesWages: number;
}

/** Roll the permanent establishments into Alberta's Schedule 2 allocation bases. */
function albertaAllocationFrom(pes: Pe[]): {
  albertaGrossRevenue: number;
  totalGrossRevenue: number;
  albertaSalaries: number;
  totalSalaries: number;
} | null {
  if (pes.length === 0) return null;
  let albertaGrossRevenue = 0;
  let totalGrossRevenue = 0;
  let albertaSalaries = 0;
  let totalSalaries = 0;
  for (const pe of pes) {
    totalGrossRevenue += num(pe.grossRevenue);
    totalSalaries += num(pe.salariesWages);
    if (pe.province === 'AB') {
      albertaGrossRevenue += num(pe.grossRevenue);
      albertaSalaries += num(pe.salariesWages);
    }
  }
  return { albertaGrossRevenue, totalGrossRevenue, albertaSalaries, totalSalaries };
}

/**
 * Build the provincial engine input from the federal engine input + working return.
 * `federalEngineInput` is the T2-shaped input AFTER authoritative identity (isCcpc)
 * and prior-year openings have been applied, so its taxable income is the filed one
 * (see `ComposedFederalInput`'s own doc comment for why this stays `unknown` at the
 * parameter and gets one documented cast here, rather than a plain typed parameter).
 */
export function assembleProvincialInput(
  program: string,
  federalEngineInput: unknown,
  ri: ReturnInput,
  facts: { isCcpc: boolean },
): unknown {
  const fed = (federalEngineInput ?? {}) as ComposedFederalInput;
  const federal = computeFederalT2(fed as unknown as FederalT2Input);
  const federalTaxableIncome = federal.taxableIncome;
  const activeBusinessIncome = num(fed.activeBusinessIncome);
  const period = fed.period;
  const pes = (fed.permanentEstablishments ?? []).filter((pe): pe is Pe => !!pe?.province);

  if (program === 'AT1') {
    const allocation = albertaAllocationFrom(pes);
    const allocationFactor = allocation
      ? computeAllocationFactor(allocation)
      : SINGLE_JURISDICTION_ALBERTA_FACTOR;
    const albertaTaxableIncome = Math.round(allocationFactor * federalTaxableIncome);

    // `period.end` is already a real `Date` by this point — `at1Engine.validate`
    // (downstream) throws otherwise, so every engine input reaching here already
    // satisfies it.
    const taxYear: number = period?.end?.getFullYear() ?? new Date().getFullYear();
    const rates = resolveAlbertaTaxRates(taxYear, AB_TAX_RATE_BOOK);

    const { schedules, ieg } = assembleAt1Schedules(
      federal,
      fed,
      ri,
      albertaTaxableIncome,
      rates.BUSINESS_LIMIT,
    );

    return {
      period,
      federalTaxableIncome,
      activeBusinessIncome,
      ...(allocation ? { allocation } : {}),
      ...(schedules && Object.keys(schedules).length > 0 ? { schedules } : {}),
      ...(ieg ? { ieg } : {}),
    };
  }

  // CO17 — Québec. SBD is fail-closed: only an eligible CCPC that also attests the
  // Québec paid-hours test gets the reduced rate; otherwise all income is general.
  const qc = ri.quebec ?? {};
  const sbdEligible = facts.isCcpc && qc.sbdEligibleQC === true;
  const businessLimit = num(qc.businessLimit);
  return {
    period,
    federalTaxableIncome,
    activeBusinessIncome,
    ...(pes.length > 0 ? { permanentEstablishments: pes } : {}),
    sbdEligible,
    ...(businessLimit > 0 ? { businessLimit } : {}),
  };
}
