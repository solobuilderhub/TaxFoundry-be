/**
 * AT1 Schedule 8 — Alberta Political Contributions Tax Credit.
 *
 * Composes `AlbertaSchedule8Input` (one PCD occurrence per receipted
 * contribution, plus the two APC partnership totals) from the AT1-only UI
 * slice at `ri.albertaPoliticalContributions8`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule8-political-contributions.ts`
 * for the full spec derivation (TRA spec §3.2.3.9 for the detail lines,
 * §3.2.3.1 for the jacket-line-074 tiered credit formula this module also
 * reproduces) — this file only reshapes UI input into that module's input
 * shape; it does not re-derive the three-rate-period formula itself.
 *
 * The contribution rows and the two partnership totals (008012/013) have no
 * federal source at all — entirely AT1-only input, same as Schedule 4's FIC
 * rows.
 *
 * `remainingBasicTax` (`000068 − (000070 + 000071 + 000072)`) is an AT1
 * JACKET-derived ceiling, not this schedule's own — collected here from
 * `ri.alberta` rather than under this schedule's own key, same convention as
 * Schedule 4's four jacket inputs (see `schedule-4-compose.ts`'s doc comment
 * for why those aren't currently populated anywhere yet). `000070`
 * (small business deduction) and `000071` (M&P deduction) are further
 * schedules this composer doesn't reach, so — same as Schedule 4 — the
 * SINGLE combined ceiling is taken as one input rather than its four parts,
 * matching the engine module's own input shape (which made the identical
 * choice for the identical reason).
 *
 * `@classytic/ca-tax/t2` ALSO exports a federal CCA `computeSchedule8` /
 * `Schedule8Result` (from `./schedules/schedule8.js`, a completely unrelated
 * "Schedule 8 Entry" declining-balance/leasehold/limited-life CCA
 * calculation), so the AT1 pair is imported under its `Alberta`-prefixed
 * barrel export (`computeAlbertaSchedule8`/`AlbertaSchedule8Result`) — see
 * `packages/ca-tax/src/t2/at1/index.ts`'s Schedule 8 export block for the
 * collision this avoids.
 *
 * `taxYearBegin` / `taxYearEnd` (needed only to detect the 2003/2004
 * straddling-tax-year rate period) are NOT sourced from `ri` at all: the
 * structured working return (`_lib/return-input.ts`) has no top-level tax
 * year period field — the corporation's fiscal period lives in the FEDERAL
 * engine input (`fed.period`, built by a separate T2 assembly step this
 * composer's restricted `(ri)` signature has no access to), not in `ri`
 * itself. Since that straddling period is a 20+-year-old rate transition
 * (essentially dead for any current filing) and getting it wrong silently
 * would be worse than not attempting it, these two are instead collected as
 * plain optional fields on this schedule's OWN UI slice
 * (`ri.albertaPoliticalContributions8.taxYearBegin/taxYearEnd` — see
 * `alberta-schedule8.ts`) for the rare case a preparer genuinely needs that
 * branch, rather than guessed at from a field path that doesn't exist.
 */
import { type AlbertaSchedule8Result, computeAlbertaSchedule8 } from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/**
 * The composition entry point. Returns `undefined` when no contribution and
 * neither partnership total was entered — an all-blank slice is not a
 * Schedule 8 to file, matching the `undefined`-return pattern the rest of
 * `assemble-at1-schedules.ts` uses (e.g. `scheduleTwenty`, `scheduleTen`).
 */
export function assembleSchedule8(ri: Ri): AlbertaSchedule8Result | undefined {
  const s8: Ri = ri.albertaPoliticalContributions8 ?? {};
  const rows: Ri[] = s8.contributions ?? [];
  const contributions = rows.filter(
    (c) => present(c?.name) || present(c?.amount) || present(c?.dateOfDonation),
  );

  const hasPartnership =
    present(s8.partnershipContributionsTo2003) || present(s8.partnershipContributionsFrom2004);

  if (contributions.length === 0 && !hasPartnership) return undefined; // nothing to file

  const ab: Ri = ri.alberta ?? {};

  return computeAlbertaSchedule8({
    contributions: contributions.map((c) => ({
      name: String(c.name ?? ''),
      receiptNumber: String(c.receiptNumber ?? ''),
      dateOfDonation: String(c.dateOfDonation ?? ''),
      amount: num(c.amount),
    })),
    partnershipContributionsTo2003: num(s8.partnershipContributionsTo2003),
    partnershipContributionsFrom2004: num(s8.partnershipContributionsFrom2004),
    // The 2003/2004 straddling-tax-year branch — see module doc for why these
    // two come from this schedule's own slice rather than a shared period.
    ...(present(s8.taxYearBegin) ? { taxYearBegin: String(s8.taxYearBegin) } : {}),
    ...(present(s8.taxYearEnd) ? { taxYearEnd: String(s8.taxYearEnd) } : {}),
    ...(present(ab.remainingBasicTax) ? { remainingBasicTax: num(ab.remainingBasicTax) } : {}),
  });
}
