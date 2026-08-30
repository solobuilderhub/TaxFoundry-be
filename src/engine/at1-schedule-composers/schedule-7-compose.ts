/**
 * AT1 Schedule 7 — Alberta Royalty Tax Credit/Deduction Supplemental
 * Information.
 *
 * Composes `AlbertaSchedule7Input` from the flat, AT1-only UI slice at
 * `ri.albertaRoyaltySupplemental7`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule7-royalty-supplemental.ts`
 * for the full spec derivation (TRA spec §3.2.3.8) — this file only reshapes
 * UI input into that module's `AlbertaSchedule7Input`; it does not re-derive
 * any of the business rules (007051's Σ(087−089+091), 007061's nine-term sum,
 * or the 006004 cross-feed) itself.
 *
 * ── Entirely Alberta-only, and independent of Schedule 5/6 for this pass ────
 *
 * Every CPI/PITI/ACRA figure here is sourced from the income statement (fed
 * form 125) or balance sheet (fed form 100), transcribed onto this schedule
 * directly — none of it is derivable from the federal engine's own T2
 * computation, so this composer reads only from `ri.albertaRoyaltySupplemental7`,
 * the same as `assembleIeg` reads its associated-group figures directly.
 * `shareOtherCrownChargesEligibleForDeduction` (007081) is collected here
 * purely as data disclosed on THIS schedule — genuine cross-schedule wiring
 * to feed Schedule 5's own 005001 formula, or Schedule 6's 006004, is a
 * follow-up, not this pass; Schedule 5 is composed independently under
 * `ri.albertaRoyaltyDeduction5` by a sibling composer, and Schedule 6 reads
 * its own royalty-incurred figure directly (see `schedule-6-compose.ts`).
 *
 * `ri.albertaRoyaltySupplemental7` is expected to carry (all optional,
 * matching `AlbertaRoyaltySupplemental7Values` in
 * `apps/web/.../_config/schedules/alberta-schedule7.ts` field for field):
 *   eligibleCrownRoyalty, otherRoyaltiesNotEligible,
 *     royaltyPaidToOtherJurisdictions, nonDeductibleCrownLeaseRentals,
 *     mineralTaxes, saskatchewanResourcesSurcharge                     (CPI)
 *   otherNonDeductibleCrownChargeType1/2/3, otherNonDeductibleCrownCharges
 *   crownLeaseRentalsCapitalized
 *   otherBalanceSheetDeductionName, otherBalanceSheetDeduction
 *   partnerships: { name, interestPercent, fiscalPeriodEnd,
 *     shareEligibleForCredit, shareOtherRoyaltiesNotEligible,
 *     shareOtherCrownChargesEligibleForDeduction }[]                   (PITI)
 *   priorYearAdjustments: { priorProductionPeriodEnd, sourceOfAdjustment
 *     ("1" | "2"), increase, decrease, adjustmentNotEligibleForCredit }[] (ACRA)
 */
import { computeAlbertaSchedule7, type AlbertaSchedule7Result } from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

const CPI_MONEY_FIELDS = [
  'eligibleCrownRoyalty',
  'otherRoyaltiesNotEligible',
  'royaltyPaidToOtherJurisdictions',
  'nonDeductibleCrownLeaseRentals',
  'mineralTaxes',
  'saskatchewanResourcesSurcharge',
  'otherNonDeductibleCrownCharges',
  'crownLeaseRentalsCapitalized',
  'otherBalanceSheetDeduction',
] as const;

/**
 * The composition entry point. Returns `undefined` when nothing meaningful
 * was entered anywhere on the schedule — matching the `undefined`-return
 * pattern the rest of `assemble-at1-schedules.ts` uses (e.g. `scheduleTwenty`,
 * `scheduleTen`).
 */
export function assembleSchedule7(ri: Ri): AlbertaSchedule7Result | undefined {
  const s7: Ri = ri.albertaRoyaltySupplemental7 ?? {};

  const otherNonDeductibleCrownChargeTypes = [
    s7.otherNonDeductibleCrownChargeType1,
    s7.otherNonDeductibleCrownChargeType2,
    s7.otherNonDeductibleCrownChargeType3,
  ].filter((t) => present(t)) as string[];

  const rawPartnerships: Ri[] = Array.isArray(s7.partnerships) ? s7.partnerships : [];
  const partnerships = rawPartnerships.filter(
    (p) => present(p?.name) || present(p?.interestPercent) || present(p?.shareEligibleForCredit),
  );

  const rawAdjustments: Ri[] = Array.isArray(s7.priorYearAdjustments) ? s7.priorYearAdjustments : [];
  const priorYearAdjustments = rawAdjustments.filter(
    (a) => present(a?.priorProductionPeriodEnd) || present(a?.increase) || present(a?.decrease),
  );

  const hasCpi = CPI_MONEY_FIELDS.some((k) => present(s7[k]));
  const hasChargeTypes = otherNonDeductibleCrownChargeTypes.length > 0;
  const hasBalanceSheetDeduction = present(s7.otherBalanceSheetDeductionName);

  if (
    !hasCpi &&
    !hasChargeTypes &&
    !hasBalanceSheetDeduction &&
    partnerships.length === 0 &&
    priorYearAdjustments.length === 0
  ) {
    return undefined; // nothing to file
  }

  return computeAlbertaSchedule7({
    eligibleCrownRoyalty: num(s7.eligibleCrownRoyalty),
    otherRoyaltiesNotEligible: num(s7.otherRoyaltiesNotEligible),
    royaltyPaidToOtherJurisdictions: num(s7.royaltyPaidToOtherJurisdictions),
    nonDeductibleCrownLeaseRentals: num(s7.nonDeductibleCrownLeaseRentals),
    mineralTaxes: num(s7.mineralTaxes),
    saskatchewanResourcesSurcharge: num(s7.saskatchewanResourcesSurcharge),
    ...(hasChargeTypes ? { otherNonDeductibleCrownChargeTypes } : {}),
    otherNonDeductibleCrownCharges: num(s7.otherNonDeductibleCrownCharges),
    crownLeaseRentalsCapitalized: num(s7.crownLeaseRentalsCapitalized),
    ...(hasBalanceSheetDeduction
      ? { otherBalanceSheetDeductionName: String(s7.otherBalanceSheetDeductionName) }
      : {}),
    otherBalanceSheetDeduction: num(s7.otherBalanceSheetDeduction),
    ...(partnerships.length > 0
      ? {
          partnerships: partnerships.map((p) => ({
            name: p.name || 'Unnamed partnership',
            interestPercent: num(p.interestPercent),
            ...(present(p.fiscalPeriodEnd) ? { fiscalPeriodEnd: String(p.fiscalPeriodEnd) } : {}),
            shareEligibleForCredit: num(p.shareEligibleForCredit),
            shareOtherRoyaltiesNotEligible: num(p.shareOtherRoyaltiesNotEligible),
            shareOtherCrownChargesEligibleForDeduction: num(
              p.shareOtherCrownChargesEligibleForDeduction,
            ),
          })),
        }
      : {}),
    ...(priorYearAdjustments.length > 0
      ? {
          priorYearAdjustments: priorYearAdjustments.map((a) => ({
            ...(present(a.priorProductionPeriodEnd)
              ? { priorProductionPeriodEnd: String(a.priorProductionPeriodEnd) }
              : {}),
            ...(a.sourceOfAdjustment === '1' || a.sourceOfAdjustment === 1
              ? { sourceOfAdjustment: 1 as const }
              : {}),
            ...(a.sourceOfAdjustment === '2' || a.sourceOfAdjustment === 2
              ? { sourceOfAdjustment: 2 as const }
              : {}),
            increase: num(a.increase),
            decrease: num(a.decrease),
            adjustmentNotEligibleForCredit: num(a.adjustmentNotEligibleForCredit),
          })),
        }
      : {}),
  });
}
