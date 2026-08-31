/**
 * AT1 Schedule 11 — Alberta Manufacturing and Processing Profits Deduction.
 *
 * Composes `Schedule11Input` from the flat, AT1-only UI slice at
 * `ri.albertaManufacturing11`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule11-manufacturing-processing.ts`
 * for the full spec derivation (TRA spec §3.2.3.12, lines 9082-9397) — this
 * file only reshapes UI input into that module's `Schedule11Input`; it does
 * not re-derive any of the business rules (the eligibility gates, the
 * four-case proration, the 033 ≤ 031 / 039 ≤ 037 clamps) itself.
 *
 * ── This is a HISTORICAL schedule ────────────────────────────────────────
 *
 * The deduction only applies to a tax year beginning before 2001-04-01
 * (`computeSchedule11` enforces this itself and forces line 042 to nil
 * otherwise, with an issue). Essentially no engagement being filed today
 * touches it, so this composer is deliberately conservative about firing at
 * all: it returns `undefined` unless the preparer entered SOMETHING on
 * `ri.albertaManufacturing11` — an empty slice is not a Schedule 11 to file,
 * matching the `undefined`-return pattern the rest of
 * `assemble-at1-schedules.ts` uses (e.g. `scheduleTwenty`, `scheduleTen`,
 * `assembleSchedule3`).
 *
 * ── Why the ADJUBI / Cost of Capital / Cost of Labour figures are NOT
 *    derived from `fed` ───────────────────────────────────────────────────
 *
 * ADJUBI (fed 027130), Cost of Capital (fed 027140) and Cost of Labour (fed
 * 027160) are federal Schedule 27 PART 2 figures. This codebase has no
 * module that computes Part 2 — `schedule27-mp.ts` starts from Part 2's
 * OUTPUT (`manufacturingAndProcessingProfits`, fed line 200), never from
 * ADJUBI or the capital/labour cost bases that produce it — so there is
 * nothing on `fed` for this composer to read them from. They are collected
 * as plain money fields on `ri.albertaManufacturing11` instead, the same way
 * `assembleSchedule3` collects the AT1 page-2 jacket lines its Maximum
 * Allowable Deduction ceiling needs with no jacket composer to source them
 * from yet.
 *
 * The ONE figure this composer does read off `fed`: the tax year START date
 * (`fed.period.start`, matching the shape `assemble-provincial-input.ts`
 * already relies on — `period.end` is a real `Date` by the time it reaches
 * here), for the pre-2001-04-01 eligibility gate. A tax year the caller
 * cannot determine fails CLOSED to a date far past the cutoff, so an
 * unresolvable date reads as "not eligible" rather than silently defaulting
 * to eligible on an empty string (which would sort before every real date).
 *
 * `ri.albertaManufacturing11` is expected to carry (all optional, matching
 * `AlbertaManufacturing11Values` in
 * `apps/web/.../_config/schedules/alberta-schedule11.ts` field for field):
 *   manufacturingGrossRevenue, totalGrossRevenue                (10% test)
 *   isSmallManufacturingCorp, smallManufacturerAmpp             (small-mfr path)
 *   federalAdjubi, albertaAdjubiLine112, albertaAdjubiLine114   (line 001)
 *   isCcpc, schedule12Exists,
 *     albertaAggregateInvestmentIncome, federalAggregateInvestmentIncome  (line 013)
 *   costOfCapital, albertaCostOfCapital,
 *     costOfLabour, albertaCostOfLabour                          (lines 031/033/037/039)
 */
import { computeSchedule11, type Schedule11Result } from '@classytic/ca-tax/t2';
import type { ComposedFederalInput } from '../assemble-t2-input.js';
import type { AlbertaManufacturing11Values, ReturnInput } from '../return-input-contract.js';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';
const yes = (v: unknown): boolean => v === 'yes';

/**
 * `fed.period.start` may arrive as a `Date` (the usual shape by the time an
 * engine input reaches this composer) or as an ISO string (a legacy /
 * directly-supplied engine input). Neither present ⇒ `undefined`, and the
 * caller fails that closed rather than defaulting to an eligible year.
 */
function isoDay(d: unknown): string | undefined {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'string' && d) return d.slice(0, 10);
  return undefined;
}

/**
 * The composition entry point. Returns `undefined` when nothing meaningful
 * was entered — most engagements never touch this historical schedule.
 */
export function assembleSchedule11(
  fed: ComposedFederalInput,
  ri: ReturnInput,
): Schedule11Result | undefined {
  const m: AlbertaManufacturing11Values = ri.albertaManufacturing11 ?? {};

  const enteredSomething =
    present(m.manufacturingGrossRevenue) ||
    present(m.totalGrossRevenue) ||
    yes(m.isSmallManufacturingCorp) ||
    present(m.smallManufacturerAmpp) ||
    present(m.federalAdjubi) ||
    present(m.albertaAdjubiLine112) ||
    present(m.albertaAdjubiLine114) ||
    yes(m.isCcpc) ||
    yes(m.schedule12Exists) ||
    present(m.albertaAggregateInvestmentIncome) ||
    present(m.federalAggregateInvestmentIncome) ||
    present(m.costOfCapital) ||
    present(m.albertaCostOfCapital) ||
    present(m.costOfLabour) ||
    present(m.albertaCostOfLabour);

  if (!enteredSomething) return undefined; // nothing to file

  // Fails CLOSED: an unresolvable tax-year start reads as far past the
  // 2001-04-01 cutoff (ineligible), never as an empty string that would sort
  // before every real date and so read as eligible by accident.
  const taxYearStart = isoDay(fed.period?.start) ?? '9999-12-31';

  return computeSchedule11({
    taxYearStart,
    ...(present(m.manufacturingGrossRevenue)
      ? { manufacturingGrossRevenue: num(m.manufacturingGrossRevenue) }
      : {}),
    ...(present(m.totalGrossRevenue) ? { totalGrossRevenue: num(m.totalGrossRevenue) } : {}),
    ...(yes(m.isSmallManufacturingCorp) ? { isSmallManufacturingCorp: true } : {}),
    ...(present(m.smallManufacturerAmpp)
      ? { smallManufacturerAmpp: num(m.smallManufacturerAmpp) }
      : {}),
    ...(present(m.federalAdjubi) ? { federalAdjubi: num(m.federalAdjubi) } : {}),
    ...(present(m.albertaAdjubiLine112) || present(m.albertaAdjubiLine114)
      ? {
          albertaAdjubiFromSchedule12: {
            line112: num(m.albertaAdjubiLine112),
            line114: num(m.albertaAdjubiLine114),
          },
        }
      : {}),
    ...(yes(m.isCcpc) ? { isCcpc: true } : {}),
    ...(yes(m.schedule12Exists) ? { schedule12Exists: true } : {}),
    ...(present(m.albertaAggregateInvestmentIncome)
      ? { albertaAggregateInvestmentIncome: num(m.albertaAggregateInvestmentIncome) }
      : {}),
    ...(present(m.federalAggregateInvestmentIncome)
      ? { federalAggregateInvestmentIncome: num(m.federalAggregateInvestmentIncome) }
      : {}),
    ...(present(m.costOfCapital) ? { costOfCapital: num(m.costOfCapital) } : {}),
    ...(present(m.albertaCostOfCapital)
      ? { albertaCostOfCapital: num(m.albertaCostOfCapital) }
      : {}),
    ...(present(m.costOfLabour) ? { costOfLabour: num(m.costOfLabour) } : {}),
    ...(present(m.albertaCostOfLabour)
      ? { albertaCostOfLabour: num(m.albertaCostOfLabour) }
      : {}),
  });
}
