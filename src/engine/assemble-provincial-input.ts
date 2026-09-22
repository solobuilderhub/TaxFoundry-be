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
import { albertaSbdFacts, assembleAt1Schedules } from './assemble-at1-schedules.js';
import type { ComposedFederalInput } from './assemble-t2-input.js';
import type { ReturnInput } from './return-input-contract.js';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);

interface Pe {
  province: string;
  grossRevenue: number;
  salariesWages: number;
}

/**
 * Roll the permanent establishments into Alberta's Schedule 2 allocation bases.
 *
 * `null` means "fall back to `SINGLE_JURISDICTION_ALBERTA_FACTOR`" (100%) at the
 * call site — the safe default for a corporation whose PE list carries no usable
 * allocation basis at all. Returning `null` only for `pes.length === 0` used to
 * be the whole rule, which missed the identical case one entered-but-blank row
 * produces: a preparer clicks "Add Item" on the provincial allocation grid,
 * picks a province, and leaves both money cells empty (has not entered figures
 * yet, or the row exists only to record a PE with genuinely nil activity this
 * year). `pes.length` is then 1, not 0, so the old guard let it through — and
 * `computeAllocationFactor` has no comparable "nothing entered" branch: with
 * both totals at zero it falls through to `else factor = 0`, a real answer
 * ("0% of taxable income is Alberta's") this input never asserted. Every
 * downstream figure — Basic Alberta Tax, the SBD, the amount payable — is
 * legitimately $0 once fed a $0 base, so nothing past this function was wrong;
 * the base itself was.
 *
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-114.
 *
 * The fix distinguishes two states that both zero the raw totals but are not
 * the same fact:
 *
 *   - every PE is Alberta (one incomplete row, or several, all "AB") — there is
 *     only one jurisdiction in play, exactly the shape the empty-array case
 *     already defaults for, so this returns `null` too and gets the same 100%.
 *   - PEs span MORE than one province and none carries any revenue or payroll —
 *     a genuinely dormant multi-province year. Defaulting to 100% Alberta here
 *     would be a real, different answer with no more basis than 0% has; Reg
 *     402(4)/(5)'s own treatment for that case is an equal split across the
 *     provinces actually present, which the federal `computeProvincialAllocation`
 *     already implements (see its own "dormant multi-PE year" branch) — that
 *     splits a real return correctly; this function still returns `null` for the
 *     narrower Alberta-only shape rather than duplicating that logic for a case
 *     this fallback does not need to solve.
 */
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
  const noAllocationBasisEntered = totalGrossRevenue === 0 && totalSalaries === 0;
  const everyPeIsAlberta = pes.every((pe) => pe.province === 'AB');
  if (noAllocationBasisEntered && everyPeIsAlberta) return null;
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
    /*
     * Line 062 — Alberta taxable income, derived from the federal return
     * UNLESS the preparer states it.
     *
     * The AT1 is normally computed from the federal figures: taxable income
     * times the allocation factor. That is right whenever the T2 is prepared
     * here, and it is the default below.
     *
     * It is not the only way an AT1 gets prepared. Where the T2 was done in
     * another package, there is nothing to derive from — the federal engine
     * sees an empty return, taxable income is nil, and the whole Alberta tax
     * side collapses to zero with the preparer unable to say otherwise. The
     * printed form does not work that way: TRA's own jacket types 062 as an
     * INPUT ("Alberta taxable income or (loss)"), because the figure can come
     * off a federal return the preparer holds on paper.
     *
     * So an entered figure wins, and nothing else changes: the override is
     * opt-in, absent on every return that does not use it, and the derivation
     * is untouched underneath. The allocation factor is deliberately NOT
     * applied to it — a preparer entering Alberta taxable income is entering
     * the Alberta figure, already allocated, exactly as the box is captioned.
     *
     * `AT1_TAXABLE_INCOME_ENTERED` reports it in review, because a figure that
     * bypasses the engine has to be visible as such rather than reading like a
     * computed one.
     */
    const enteredTaxableIncome = (ri.alberta as { albertaTaxableIncome?: number } | undefined)
      ?.albertaTaxableIncome;
    const statedTaxableIncome =
      enteredTaxableIncome != null && Number.isFinite(Number(enteredTaxableIncome))
        ? Math.round(Number(enteredTaxableIncome))
        : undefined;

    // `period.end` is already a real `Date` by this point — `at1Engine.validate`
    // (downstream) throws otherwise, so every engine input reaching here already
    // satisfies it.
    const taxYear: number = period?.end?.getFullYear() ?? new Date().getFullYear();
    const rates = resolveAlbertaTaxRates(taxYear, AB_TAX_RATE_BOOK);

    /*
     * Line 062 — taxable income BEFORE allocation.
     *
     * Not computed here any more. It is Schedule 12 line 090 ("Taxable income
     * for Alberta purposes or (loss)", "Carried to AT1 page 2, line 062"), so
     * the composer resolves it from the schedule it actually files and hands
     * it back. It used to be `federalTaxableIncome` (or the preparer's entry)
     * and was ALSO pushed onto 090 as an override, which meant Area B's own
     * deductions — the Alberta donations claim, the Alberta loss application
     * — changed neither the filed 090 nor the tax. A return could deduct
     * $24,000 against $12,000 of income and still be taxed on $8,000.
     *
     * Kept distinct from 066 because they are different lines: the engine
     * applies the allocation factor itself, and it floors the result at nil
     * there — so a negative 062 (a real Alberta loss) transmits as the loss
     * it is, and simply produces no tax.
     */
    const { schedules, ieg, albertaTaxableIncome } = assembleAt1Schedules(
      federal,
      fed,
      ri,
      statedTaxableIncome,
      rates.BUSINESS_LIMIT,
      allocationFactor,
    );

    // The SAME eligibility facts Schedule 1 is filed from. Without them the
    // engine's own `computeAlbertaSbd` sees no status and defaults to eligible,
    // so a non-CCPC got the small-business rate on the jacket while its
    // Schedule 1 correctly reported no claim — $18,000 of understated Alberta
    // tax on $300,000 of income. Passed from one place so the two cannot drift.
    const sbdFacts = albertaSbdFacts(fed, ri);

    /*
     * AT1 jacket lines 000071 and 000074 — the two terms of Schedule 3's
     * shared ceiling that ARE the preparer's to give.
     *
     * `input` on the jacket; nothing computes them. Forwarded at the TOP level
     * rather than inside `schedules`, because two things need them — the jacket
     * payload and Schedule 3's room — and one figure must have one home.
     *
     * Schedule 3 used to collect its own copies of these, along with copies of
     * 068, 070 and 072 which are not the preparer's at all. That is what let a
     * return state one ceiling on Schedule 3 and transmit a different jacket.
     * See `SCHEDULE_3_ROOM` in ca-tax's `alberta-return.ts`.
     */
    const ab = ri.alberta ?? {};

    /*
     * Schedule 2 — the allocation factor's own working.
     *
     * `allocation` at the top level gives the ENGINE the four bases it divides
     * to get the factor. `schedules.allocation` is what gets FILED: ca-tax has
     * pushed `schedule2Values(sched.allocation)` since the schedule was built,
     * but nothing ever populated it, so a corporation with a permanent
     * establishment outside Alberta transmitted a factor on the jacket and no
     * Schedule 2 showing where it came from — all four of its mandatory lines
     * (002/004/006/008) absent from the return.
     *
     * The two shapes are NOT the same object: the engine's `AllocationFactorInput`
     * says `albertaGrossRevenue`/`totalGrossRevenue`, the filing input says
     * `albertaRevenue`/`totalRevenue`. Spreading one into the other would file
     * two undefined lines and look like it worked.
     */
    const scheduleTwo = allocation
      ? {
          albertaSalaries: allocation.albertaSalaries,
          totalSalaries: allocation.totalSalaries,
          albertaRevenue: allocation.albertaGrossRevenue,
          totalRevenue: allocation.totalGrossRevenue,
        }
      : undefined;
    const filedSchedules = scheduleTwo
      ? { ...(schedules ?? {}), allocation: scheduleTwo }
      : schedules;

    return {
      period,
      federalTaxableIncome,
      activeBusinessIncome,
      // Line 062 stated rather than derived. Forwarded to the ENGINE, not just
      // used locally: `computeAlbertaTax` recomputes 062 from
      // `federalTaxableIncome × allocationFactor` itself, so a figure resolved
      // only here would be silently discarded — which is exactly what happened
      // on the first attempt at this.
      // The engine's own 062 input is the PRE-allocation figure; it applies the
      // factor itself at 066. Passing the allocated one would double-allocate.
      // Always forwarded now, not only when the preparer stated one: the
      // schedule's 090 is the return's taxable income whether it came from the
      // box or from Area B's arithmetic, and the engine deriving its own from
      // `federalTaxableIncome` is exactly how the two came to disagree.
      albertaTaxableIncome,
      ...(sbdFacts ?? {}),
      ...(allocation ? { allocation } : {}),
      ...(num(ab.manufacturingDeduction) > 0
        ? { manufacturingDeduction: num(ab.manufacturingDeduction) }
        : {}),
      ...(num(ab.politicalContributionsTaxCredit) > 0
        ? { politicalContributionsTaxCredit: num(ab.politicalContributionsTaxCredit) }
        : {}),
      ...(filedSchedules && Object.keys(filedSchedules).length > 0
        ? { schedules: filedSchedules }
        : {}),
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
