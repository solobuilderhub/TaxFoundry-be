/**
 * Live CCA preview — the authoritative `computeCcaClass` run against the
 * engagement's own resolved rate table, for the return editor's summary
 * strip.
 *
 * This EXISTS to close the duplication the review flagged: `apps/web`'s
 * `_lib/calc.ts` used to carry its own hand-written re-implementation of
 * `computeCcaClass` (half-year rule, AIIP, immediate expensing, class 13/14
 * straight-line) so the editor could show a live total before a compute
 * round-trip. Two independent implementations of the same tax rule drift —
 * this endpoint lets the editor call the REAL engine function instead, so
 * there is exactly one CCA implementation in the whole system, not two that
 * have to be kept in lockstep by hand.
 *
 * Batched (one request for every class on the schedule, not one per row):
 * the editor calls this on a debounce as the preparer types, and a live
 * per-keystroke preview genuinely needs the round-trip cost paid once, not
 * once per row.
 */
import {
  CCA_RATE_BOOK,
  type CcaClassInput,
  type CcaClassResult,
  computeCcaClass,
  resolveCcaRates,
  UnsupportedCcaClassError,
} from '@classytic/ca-tax/t2';
import { z } from 'zod';

const CcaClassPreviewInputSchema = z.object({
  ccaClass: z.string(),
  openingUCC: z.number(),
  additions: z.number().optional(),
  dispositions: z.number().optional(),
  netAdjustments: z.number().optional(),
  immediateExpensing: z.number().optional(),
  aiip: z.boolean().optional(),
  classEmptied: z.boolean().optional(),
  claim: z.number().optional(),
});

export const CcaPreviewRequestSchema = z.object({
  taxYearEnd: z.coerce.date().optional(),
  classes: z.array(CcaClassPreviewInputSchema),
});

export type CcaPreviewRequest = z.infer<typeof CcaPreviewRequestSchema>;

/**
 * One result per requested class, in the same order — `null` where the class
 * can't be previewed at all (an unsupported class code, or a class 13/14 row
 * with a current-year addition, which needs the detailed leasehold/limited-
 * life schedule this quick preview doesn't model). A `null` entry means "no
 * preview for this row," not "zero" — the caller should show nothing rather
 * than a misleading $0.
 */
export function previewCcaClasses(request: CcaPreviewRequest): (CcaClassResult | null)[] {
  const rates = resolveCcaRates(
    request.taxYearEnd?.getFullYear() ?? new Date().getFullYear(),
    CCA_RATE_BOOK,
  );
  return request.classes.map((c) => {
    if (!c.ccaClass) return null;
    try {
      return computeCcaClass(c as CcaClassInput, rates);
    } catch (err) {
      if (err instanceof UnsupportedCcaClassError) return null;
      throw err;
    }
  });
}
