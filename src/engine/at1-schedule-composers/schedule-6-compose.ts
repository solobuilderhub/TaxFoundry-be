/**
 * AT1 Schedule 6 — Alberta Royalty Tax Credit.
 *
 * Composes `AlbertaSchedule6Input` from the flat, AT1-only UI slice at
 * `ri.albertaRoyaltyCredit6`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule6-royalty-tax-credit.ts` for
 * the full spec derivation (TRA spec §3.2.3.7) — this file only reshapes UI
 * input into that module's `AlbertaSchedule6Input`; it does not re-derive any
 * of the business rules (the not-associated vs. associated shelter paths, the
 * AACRS per-row/aggregate capping, the weighted-average-rate arithmetic)
 * itself.
 *
 * ── Independent of Schedule 7, for this pass ────────────────────────────────
 *
 * `albertaCrownRoyaltyIncurred` (006004) is, per the spec, `007003 + Σ007077
 * − Σ007087 + Σ007089` — every term lives on Schedule 7. Genuine cross-
 * schedule wiring (composing Schedule 6 FROM Schedule 7's computed result) is
 * a follow-up, not this pass — this composer reads `albertaCrownRoyaltyIncurred`
 * as a plain entry from `ri.albertaRoyaltyCredit6` itself, the same way
 * `computeAlbertaSchedule6` accepts it as a plain input rather than importing
 * Schedule 7. A preparer filing both schedules enters the figure once here;
 * matching it to Schedule 7's own computed total is the caller's job, not
 * this composer's.
 *
 * ── The credit-line gap flows straight through ──────────────────────────────
 *
 * `computeAlbertaSchedule6` itself pushes an `issues` entry recording that no
 * final Royalty Tax Credit dollar amount can be computed (the transcribed
 * spec never states the formula) whenever a royalty was actually incurred.
 * This composer does not add to or suppress that — inspect the returned
 * `AlbertaSchedule6Result.issues`.
 *
 * `ri.albertaRoyaltyCredit6` is expected to carry (all optional, matching
 * `AlbertaRoyaltyCredit6Values` in
 * `apps/web/.../_config/schedules/alberta-schedule6.ts` field for field):
 *   associatedWithCrownRoyaltyCorporations ("yes" | "no")
 *   albertaCrownRoyaltyIncurred, taxationYearDays
 *   longestAssociatedYearCan, longestAssociatedYearBeginning,
 *     longestAssociatedYearEnding, longestAssociatedYearDays
 *   allocations: { name, albertaCan, allocatedAmount }[]
 *   quarters: { days, rate }[]
 */
import { computeAlbertaSchedule6, type AlbertaSchedule6Result } from '@classytic/ca-tax/t2';
import type { AlbertaRoyaltyCredit6Values, ReturnInput } from '../return-input-contract.js';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const yes = (v: unknown): boolean => v === 'yes';
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/**
 * The composition entry point. Returns `undefined` when nothing meaningful
 * was entered — no royalty figure, no shelter allocation and no rate quarter
 * — matching the `undefined`-return pattern the rest of
 * `assemble-at1-schedules.ts` uses (e.g. `scheduleTwenty`, `scheduleTen`).
 */
export function assembleSchedule6(ri: ReturnInput): AlbertaSchedule6Result | undefined {
  const s6: AlbertaRoyaltyCredit6Values = ri.albertaRoyaltyCredit6 ?? {};

  const rawAllocations = Array.isArray(s6.allocations) ? s6.allocations : [];
  const allocations = rawAllocations.filter((a) => present(a?.name) || present(a?.allocatedAmount));

  const rawQuarters = Array.isArray(s6.quarters) ? s6.quarters : [];
  const quarters = rawQuarters.filter((q) => present(q?.days) || present(q?.rate));

  const hasRoyalty = present(s6.albertaCrownRoyaltyIncurred);
  if (!hasRoyalty && allocations.length === 0 && quarters.length === 0) return undefined;

  const associated = yes(s6.associatedWithCrownRoyaltyCorporations);
  const hasLongestAssociatedYear =
    present(s6.longestAssociatedYearCan) ||
    present(s6.longestAssociatedYearBeginning) ||
    present(s6.longestAssociatedYearEnding) ||
    present(s6.longestAssociatedYearDays);

  return computeAlbertaSchedule6({
    associatedWithCrownRoyaltyCorporations: associated,
    ...(present(s6.albertaCrownRoyaltyIncurred)
      ? { albertaCrownRoyaltyIncurred: num(s6.albertaCrownRoyaltyIncurred) }
      : {}),
    ...(present(s6.taxationYearDays) ? { taxationYearDays: num(s6.taxationYearDays) } : {}),
    ...(associated && hasLongestAssociatedYear
      ? {
          longestAssociatedYear: {
            ...(present(s6.longestAssociatedYearCan)
              ? { albertaCan: String(s6.longestAssociatedYearCan) }
              : {}),
            ...(present(s6.longestAssociatedYearBeginning)
              ? { taxationYearBeginning: String(s6.longestAssociatedYearBeginning) }
              : {}),
            ...(present(s6.longestAssociatedYearEnding)
              ? { taxationYearEnding: String(s6.longestAssociatedYearEnding) }
              : {}),
            days: num(s6.longestAssociatedYearDays),
          },
        }
      : {}),
    ...(allocations.length > 0
      ? {
          allocations: allocations.map((a) => ({
            name: a.name || 'Unnamed corporation',
            ...(present(a.albertaCan) ? { albertaCan: String(a.albertaCan) } : {}),
            allocatedAmount: num(a.allocatedAmount),
          })),
        }
      : {}),
    ...(quarters.length > 0
      ? {
          quarters: quarters.map((q) => ({
            days: num(q.days),
            rate: num(q.rate),
          })),
        }
      : {}),
  });
}
