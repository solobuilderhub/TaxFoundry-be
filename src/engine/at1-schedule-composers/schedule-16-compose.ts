/**
 * AT1 Schedule 16 — Alberta Scientific Research Expenditures (the SR&ED pool).
 *
 * Composes `AlbertaSchedule16Input` from the AT1-only UI slice at
 * `ri.albertaSred16`. See ca-tax's
 * `src/t2/at1/schedules/schedule16-sred.ts` for the spec derivation (TRA
 * §3.2.3.17); this file only reshapes UI input into that module's input shape.
 *
 * ── Why this composer did not exist ─────────────────────────────────────────
 *
 * The schedule was complete in the engine and unreachable from the app:
 * `computeAlbertaSchedule16` and `schedule16Values` were both written and
 * tested, and `alberta-return.ts` already pushes the payload whenever
 * `schedules.scientificResearch` is present — but nothing ever built it. So a
 * corporation with an Alberta SR&ED pool could not file the schedule at all,
 * and no test noticed, because every test called the builder directly.
 *
 * ── Where the six federal figures come from ─────────────────────────────────
 *
 * Lines 002, 004, 006, 008, 010 and 015 are specified as "must equal fed
 * 032nnn" and the printed form names each source beside its box — "(federal
 * schedule 32 (T661) line 400)". This product models no T661: its one federal
 * SR&ED figure, `credits.sredQualifiedExpenditures`, is the Schedule 31 ITC
 * base and is none of the six.
 *
 * So they are TRANSCRIBED on the Alberta slice, which is how the paper form
 * collects them. Deriving them from the single federal number available would
 * look sourced and be wrong; sourcing them properly needs a federal T661 slice
 * this app has never had, which is a separate piece of work. When that lands,
 * these six become defaults here and the slice keeps them only as overrides.
 *
 * Only 012 (opening pool balance), 014 (transfer in) and 020 (the claim) are
 * genuinely Alberta-variable — which is exactly why the form is required "if
 * the opening balance or the claim for Alberta purposes differs from that for
 * federal purposes".
 */
import { type AlbertaSchedule16Result, computeAlbertaSchedule16 } from '@classytic/ca-tax/t2';
import type { AlbertaSred16Values, ReturnInput } from '../return-input-contract.js';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
/** A field the preparer actually entered — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

/**
 * Returns `undefined` when the slice holds nothing real, matching the
 * `undefined`-return pattern the rest of `assemble-at1-schedules.ts` uses.
 *
 * "Nothing real" is deliberately every field, not just the expenditures: a
 * corporation claiming nil this year against an inherited pool enters only the
 * opening balance (012), and that is a Schedule 16 to file — the pool has to
 * be disclosed to be carried forward. Gating on 002 alone would drop exactly
 * the return the carry-forward exists for.
 */
export function assembleSchedule16(ri: ReturnInput): AlbertaSchedule16Result | undefined {
  const s: AlbertaSred16Values = ri.albertaSred16 ?? {};
  const entered = [
    s.currentYearExpenditures,
    s.assistance,
    s.priorYearItcClaimed,
    s.saleOfCapitalAssetsAndOther,
    s.assistanceRepayments,
    s.priorYearItcRecaptured,
    s.openingPoolBalance,
    s.poolTransferredIn,
    s.amountClaimed,
  ].some(present);
  if (!entered) return undefined;

  return computeAlbertaSchedule16({
    currentYearExpenditures: num(s.currentYearExpenditures),
    assistance: num(s.assistance),
    priorYearItcClaimed: num(s.priorYearItcClaimed),
    saleOfCapitalAssetsAndOther: num(s.saleOfCapitalAssetsAndOther),
    assistanceRepayments: num(s.assistanceRepayments),
    priorYearItcRecaptured: num(s.priorYearItcRecaptured),
    openingPoolBalance: num(s.openingPoolBalance),
    poolTransferredIn: num(s.poolTransferredIn),
    /*
     * Passed ONLY when entered. `amountClaimed` left undefined claims the
     * whole available pool, which is the engine's documented default; coercing
     * a blank to 0 would instead claim nothing, and the two are opposite
     * answers for a corporation that has income to shelter.
     */
    ...(present(s.amountClaimed) ? { amountClaimed: num(s.amountClaimed) } : {}),
  });
}
