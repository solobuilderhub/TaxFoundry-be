/**
 * AT1 Schedule 3 — Alberta Other Tax Deductions and Credits.
 *
 * Composes `Schedule3Input` (three independent AB investment-tax-credit
 * continuities — Investor Tax Credit, Capital Investment Tax Credit and
 * Agri-Processing Investment Tax Credit — sharing one ceiling, the Maximum
 * Allowable Deduction) from the flat, AT1-only UI slice at
 * `ri.albertaOtherCredits3`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule3-other-deductions-credits.ts`
 * for the full spec derivation (TRA spec §3.2.3.4) — this file only reshapes
 * UI input into that module's `Schedule3Input`; it does not re-derive any of
 * the business rules (the ITC-before-CITC gate, the per-vintage APITC
 * percentage caps, the shared-room allocation) itself.
 *
 * Entirely Alberta-only, entirely undiscoverable from federal: none of ITC,
 * CITC or APITC exist on the federal T2 side (Alberta's own investment-tax-
 * credit regimes, not the federal SR&ED ITC on Schedule 31), and the MAD
 * ceiling's own inputs (AT1 page 2 jacket lines 068/070/071/072/074) are not
 * modelled by any jacket composer this package has yet — so, the same way
 * `assembleIeg`'s associated-group taxable-capital figures are collected
 * directly rather than derived, these five jacket lines are collected
 * directly here too.
 *
 * `ri.albertaOtherCredits3` is expected to carry (all optional, all numbers
 * unless noted, matching `AlbertaOtherCredits3Values` in
 * `apps/web/.../_config/schedules/alberta-schedule3.ts` field for field):
 *   taxPayableBeforeDeduction, line070, line071, line072, line074   (MAD)
 *   itcCertificatesIssued, itcCarryforwardFromPriorYear, itcExpired,
 *     itcAmountApplied                                              (ITC)
 *   citcCertificatesIssued, citcCarryforwardFromPriorYear, citcExpired,
 *     citcAmountApplied                                             (CITC)
 *   apitcCurrentReceived, apitcCurrentApplied,
 *   apitcFirstAvailable, apitcFirstApplied,
 *   apitcSecondAvailable, apitcSecondApplied,
 *   apitcThirdToTenthAvailable, apitcThirdToTenthApplied,
 *   apitcExpired                                                    (APITC)
 */
import { computeSchedule3, type Schedule3Result } from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/**
 * The composition entry point. Returns `undefined` when nothing meaningful
 * was entered for any of the three credits — an all-blank slice is not a
 * Schedule 3 to file, matching the `undefined`-return pattern the rest of
 * `assemble-at1-schedules.ts` uses (e.g. `scheduleTwenty`, `scheduleTen`).
 */
export function assembleSchedule3(ri: Ri): Schedule3Result | undefined {
  const s3: Ri = ri.albertaOtherCredits3 ?? {};

  const hasItc =
    present(s3.itcCertificatesIssued) ||
    present(s3.itcCarryforwardFromPriorYear) ||
    present(s3.itcAmountApplied);
  const hasCitc =
    present(s3.citcCertificatesIssued) ||
    present(s3.citcCarryforwardFromPriorYear) ||
    present(s3.citcAmountApplied);
  const hasApitc =
    present(s3.apitcCurrentReceived) ||
    present(s3.apitcFirstAvailable) ||
    present(s3.apitcSecondAvailable) ||
    present(s3.apitcThirdToTenthAvailable);

  if (!hasItc && !hasCitc && !hasApitc) return undefined; // nothing to file

  return computeSchedule3({
    mad: {
      taxPayableBeforeDeduction: num(s3.taxPayableBeforeDeduction),
      line070: num(s3.line070),
      line071: num(s3.line071),
      line072: num(s3.line072),
      line074: num(s3.line074),
    },
    ...(hasItc
      ? {
          itc: {
            certificatesIssued: num(s3.itcCertificatesIssued),
            carryforwardFromPriorYear: num(s3.itcCarryforwardFromPriorYear),
            expired: num(s3.itcExpired),
            ...(present(s3.itcAmountApplied) ? { amountApplied: num(s3.itcAmountApplied) } : {}),
          },
        }
      : {}),
    ...(hasCitc
      ? {
          citc: {
            certificatesIssued: num(s3.citcCertificatesIssued),
            carryforwardFromPriorYear: num(s3.citcCarryforwardFromPriorYear),
            expired: num(s3.citcExpired),
            ...(present(s3.citcAmountApplied) ? { amountApplied: num(s3.citcAmountApplied) } : {}),
          },
        }
      : {}),
    ...(hasApitc
      ? {
          apitc: {
            current: {
              received: num(s3.apitcCurrentReceived),
              ...(present(s3.apitcCurrentApplied)
                ? { amountApplied: num(s3.apitcCurrentApplied) }
                : {}),
            },
            firstPreceding: {
              availableAtBeginning: num(s3.apitcFirstAvailable),
              ...(present(s3.apitcFirstApplied)
                ? { amountApplied: num(s3.apitcFirstApplied) }
                : {}),
            },
            secondPreceding: {
              availableAtBeginning: num(s3.apitcSecondAvailable),
              ...(present(s3.apitcSecondApplied)
                ? { amountApplied: num(s3.apitcSecondApplied) }
                : {}),
            },
            thirdToTenthPreceding: {
              availableAtBeginning: num(s3.apitcThirdToTenthAvailable),
              ...(present(s3.apitcThirdToTenthApplied)
                ? { amountApplied: num(s3.apitcThirdToTenthApplied) }
                : {}),
            },
            expiredThisYear: num(s3.apitcExpired),
          },
        }
      : {}),
  });
}
