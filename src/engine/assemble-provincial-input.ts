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
import { computeFederalT2, type FederalT2Input } from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;

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
 * and prior-year openings have been applied, so its taxable income is the filed one.
 */
export function assembleProvincialInput(
  program: string,
  federalEngineInput: unknown,
  ri: Ri,
  facts: { isCcpc: boolean },
): unknown {
  const fed = (federalEngineInput ?? {}) as Ri;
  const federal = computeFederalT2(fed as unknown as FederalT2Input);
  const federalTaxableIncome = federal.taxableIncome;
  const activeBusinessIncome = num(fed.activeBusinessIncome);
  const period = fed.period;
  const pes = ((fed.permanentEstablishments ?? []) as Pe[]).filter((pe) => pe?.province);

  if (program === 'AT1') {
    const allocation = albertaAllocationFrom(pes);
    return {
      period,
      federalTaxableIncome,
      activeBusinessIncome,
      ...(allocation ? { allocation } : {}),
    };
  }

  // CO17 — Québec. SBD is fail-closed: only an eligible CCPC that also attests the
  // Québec paid-hours test gets the reduced rate; otherwise all income is general.
  const qc = (ri.quebec ?? {}) as { sbdEligibleQC?: boolean; businessLimit?: unknown };
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
