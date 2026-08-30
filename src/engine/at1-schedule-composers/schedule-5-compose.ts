/**
 * AT1 Schedule 5 — Alberta Royalty Tax Deduction.
 *
 * Composes `AlbertaSchedule5Input` (the CRTD unsuccessored pool, 005001-005027,
 * plus the SSPI/FSPI successored pools, 005101-005140) from the flat,
 * AT1-only UI slice at `ri.albertaRoyaltyDeduction5`. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule5-royalty-tax-deduction.ts`
 * for the full spec derivation (TRA spec §3.2.3.6) — this file only reshapes
 * UI input into that module's `AlbertaSchedule5Input`; it does not re-derive
 * any of the business rules (the 016/140 caps, the successored-pool mandatory
 * arithmetic, the 005025 carry-forward) itself.
 *
 * ── Cross-schedule figures are collected directly, not derived ─────────────
 *
 * That module's own docstring documents two cross-references it deliberately
 * does NOT re-derive:
 *   - 005001 (crown charges) = AT1 Schedule 7, line 061 — a sibling schedule
 *     wired under its OWN key in `ri`, in this same wiring round.
 *   - 005005 (resource allowance) = AT1 Schedule 12 line 024, or federal
 *     Schedule 1 line 346 as a fallback.
 * True cross-schedule composition (reaching into Schedule 7's or Schedule
 * 12's own `ri` slice and letting THEIR computed results feed this one) is a
 * follow-up, not this pass — every other schedule composer being wired this
 * round works from its own isolated key the same way (see
 * `schedule-3-compose.ts`'s Maximum Allowable Deduction jacket lines). So
 * both cross-references are collected here as plain numeric fields on this
 * schedule's OWN slice: `crownChargesFromSchedule7` and
 * `resourceAllowanceFromSchedule12OrFederal`. The latter collapses the
 * module's own two-input precedence (`albertaResourceAllowance` preferred,
 * `federalResourceAllowance` as fallback) into the ONE figure a preparer
 * would actually have on hand at UI-fill time; it is passed through as
 * `albertaResourceAllowance` (the higher-precedence slot), which produces the
 * identical result the module's own precedence rule would for a single known
 * figure.
 *
 * `albertaTaxableIncomeBeforeDeduction` (AT1 core line 062) is likewise
 * collected directly — there is no AT1 jacket composer for it yet, the same
 * reasoning `schedule-3-compose.ts` already documents for ITS jacket-line
 * inputs (068/070/071/072/074).
 *
 * `ri.albertaRoyaltyDeduction5` is expected to carry (matching
 * `AlbertaRoyaltyDeduction5Values` in
 * `apps/web/.../_config/schedules/alberta-schedule5.ts` field for field):
 *   crownChargesFromSchedule7, resourceAllowanceFromSchedule12OrFederal,
 *   reimbursementsForCrownCharges, openingUnsuccessoredPoolBalance,
 *   predecessorTransfers[], crtdAmountClaimed, transferredOnDisposal,
 *   hasSuccessoredPools ("yes"/"no"), secondSuccessoredPools[],
 *   firstSuccessoredPools[], poolTransfer, changeInControlEndedPrecedingYear
 *   ("yes"/"no"), albertaTaxableIncomeBeforeDeduction
 */
import {
  type AlbertaSchedule5Input,
  type AlbertaSchedule5Result,
  computeAlbertaSchedule5,
} from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';
const yes = (v: unknown): boolean => v === 'yes';

function predecessorTransfers(ri: Ri): AlbertaSchedule5Input['predecessorTransfers'] {
  const rows: Ri[] = ri.predecessorTransfers ?? [];
  return rows
    .filter((r) => present(r?.predecessorName) || present(r?.amountTransferred))
    .map((r) => ({
      predecessorName: String(r.predecessorName ?? ''),
      ...(present(r.albertaCorporateAccountNumber)
        ? { albertaCorporateAccountNumber: String(r.albertaCorporateAccountNumber) }
        : {}),
      dateOfEvent: String(r.dateOfEvent ?? ''),
      amountTransferred: num(r.amountTransferred),
    }));
}

function successoredPoolEntries(
  rows: Ri[] | undefined,
): AlbertaSchedule5Input['secondSuccessoredPools'] {
  return (rows ?? [])
    .filter(
      (r) =>
        present(r?.vendorName) || present(r?.poolBroughtForward) || present(r?.acquisitionAmount),
    )
    .map((r) => ({
      vendorName: String(r.vendorName ?? ''),
      dateOfEvent: String(r.dateOfEvent ?? ''),
      ...(present(r.poolBroughtForward) ? { poolBroughtForward: num(r.poolBroughtForward) } : {}),
      ...(present(r.acquisitionAmount) ? { acquisitionAmount: num(r.acquisitionAmount) } : {}),
      propertyIncome: num(r.propertyIncome),
    }));
}

function poolTransfer(ri: Ri): AlbertaSchedule5Input['poolTransfer'] {
  const pt: Ri = ri.poolTransfer ?? {};
  if (!present(pt.type)) return undefined;
  const type = Number(pt.type);
  if (type !== 1 && type !== 2 && type !== 3) return undefined;
  return {
    type,
    ...(present(pt.acquirerName) ? { acquirerName: String(pt.acquirerName) } : {}),
  };
}

/**
 * The composition entry point. Returns `undefined` when nothing meaningful
 * was entered for either the CRTD pool or the successored pools — an
 * all-blank slice is not a Schedule 5 to file, matching the `undefined`-return
 * pattern the rest of `assemble-at1-schedules.ts` uses (e.g. `scheduleTwenty`,
 * `scheduleTen`) and `assembleSchedule3`'s own gate.
 */
export function assembleSchedule5(ri: Ri): AlbertaSchedule5Result | undefined {
  const s5: Ri = ri.albertaRoyaltyDeduction5 ?? {};

  const hasCrtdActivity =
    present(s5.crownChargesFromSchedule7) ||
    present(s5.resourceAllowanceFromSchedule12OrFederal) ||
    present(s5.reimbursementsForCrownCharges) ||
    present(s5.openingUnsuccessoredPoolBalance) ||
    (Array.isArray(s5.predecessorTransfers) && s5.predecessorTransfers.length > 0);
  const hasSuccessoredPools = yes(s5.hasSuccessoredPools);
  const hasPoolTransfer = present(s5.poolTransfer?.type);
  const hasChangeInControlAnswer = present(s5.changeInControlEndedPrecedingYear);

  if (!hasCrtdActivity && !hasSuccessoredPools && !hasPoolTransfer && !hasChangeInControlAnswer) {
    return undefined; // nothing to file
  }

  const input: AlbertaSchedule5Input = {
    ...(present(s5.crownChargesFromSchedule7)
      ? { crownChargesNetOfReimbursements: num(s5.crownChargesFromSchedule7) }
      : {}),
    ...(present(s5.resourceAllowanceFromSchedule12OrFederal)
      ? { albertaResourceAllowance: num(s5.resourceAllowanceFromSchedule12OrFederal) }
      : {}),
    ...(present(s5.reimbursementsForCrownCharges)
      ? { reimbursementsForCrownCharges: num(s5.reimbursementsForCrownCharges) }
      : {}),
    ...(present(s5.openingUnsuccessoredPoolBalance)
      ? { openingUnsuccessoredPoolBalance: num(s5.openingUnsuccessoredPoolBalance) }
      : {}),
    ...(Array.isArray(s5.predecessorTransfers) && s5.predecessorTransfers.length > 0
      ? { predecessorTransfers: predecessorTransfers(s5) }
      : {}),
    ...(present(s5.crtdAmountClaimed) ? { crtdAmountClaimed: num(s5.crtdAmountClaimed) } : {}),
    ...(present(s5.transferredOnDisposal)
      ? { transferredOnDisposal: num(s5.transferredOnDisposal) }
      : {}),
    hasSuccessoredPools,
    ...(hasSuccessoredPools && Array.isArray(s5.secondSuccessoredPools)
      ? { secondSuccessoredPools: successoredPoolEntries(s5.secondSuccessoredPools) }
      : {}),
    ...(hasSuccessoredPools && Array.isArray(s5.firstSuccessoredPools)
      ? { firstSuccessoredPools: successoredPoolEntries(s5.firstSuccessoredPools) }
      : {}),
    ...(hasPoolTransfer ? { poolTransfer: poolTransfer(s5) } : {}),
    ...(hasChangeInControlAnswer
      ? { changeInControlEndedPrecedingYear: yes(s5.changeInControlEndedPrecedingYear) }
      : {}),
    ...(present(s5.albertaTaxableIncomeBeforeDeduction)
      ? { albertaTaxableIncomeBeforeDeduction: num(s5.albertaTaxableIncomeBeforeDeduction) }
      : {}),
  };

  return computeAlbertaSchedule5(input);
}
