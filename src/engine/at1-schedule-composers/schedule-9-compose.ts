/**
 * AT1 Schedule 9 — Alberta Scientific Research & Experimental Development Tax
 * Credit.
 *
 * Alberta's OWN 10% investment tax credit on SR&ED spending — NOT Schedule
 * 16's expenditure pool and NOT the federal Schedule 31 ITC. See
 * `packages/ca-tax/src/t2/at1/schedules/schedule9-sred-tax-credit.ts` for the
 * full spec derivation (TRA spec §3.2.3.10) — this file only reshapes the
 * AT1-only UI slice at `ri.albertaSredCredit9` into that module's
 * `AlbertaSchedule9Input`; it does not re-derive the credit calculation.
 *
 * Entirely AT1-only input: federal T2 tracks SR&ED spending Canada-wide with
 * no Alberta split (unlike Schedule 29's IEG, this credit has no AT4970-style
 * project attachment feeding it — see the source module's docstring for why
 * `eligibleExpenditures` itself is a documented derivation with no confirmed
 * spec formula), so nothing here is composed FROM the federal result the way
 * `assemble-at1-schedules.ts` reshapes CCA/reserves/dispositions.
 *
 * ── The associated-group allocation (page 3, lines 200-240) ────────────────
 *
 * Mirrors `assembleIeg`'s `group` composition in `assemble-at1-schedules.ts`
 * (Schedule 29's associated-group layer): `ri.albertaSredCredit9.group` is an
 * array of `{ name, albertaCan?, allocated }` rows, run through
 * `allocateSchedule9ExpenditureLimit` to get each member's capped share and
 * the group's day-prorated $4,000,000 ceiling. The FILING corporation's own
 * share (row 1) becomes `allocatedExpenditureLimit` (line 009102) — same
 * "claimant is always the first row" convention as Schedule 29's Agreement.
 * A present-but-empty group (every row blank) is treated the same as no
 * group at all — it falls back to `s9.allocatedExpenditureLimit` if supplied,
 * or to the non-associated day-prorated limit otherwise.
 *
 * `allocateSchedule9ExpenditureLimit`'s own issues (an over-allocated member
 * or an over-allocated group total) are folded into the returned result's
 * `issues` array so a caller reading only `AlbertaSchedule9Result` still sees
 * them — the return type here is exactly `AlbertaSchedule9Result | undefined`,
 * with no separate slot for the allocation detail.
 */
import {
  type AlbertaSchedule9Result,
  allocateSchedule9ExpenditureLimit,
  computeAlbertaSchedule9,
  type Schedule9AllocationMember,
  type Schedule9GroupFilingInput,
} from '@classytic/ca-tax/t2';

type Ri = Record<string, any>;
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';

export interface Schedule9Composition {
  result: AlbertaSchedule9Result;
  /** Page-3 filing detail (009200/202/204/206/220/230/240) — present only when a group was entered. */
  group?: Schedule9GroupFilingInput;
}

/**
 * The composition entry point. Reads `ri.albertaSredCredit9`. Returns
 * `undefined` when the slice is absent or nothing meaningful was entered —
 * an all-blank slice is not a Schedule 9 to file, matching the
 * `undefined`-return pattern the rest of `assemble-at1-schedules.ts` uses
 * (e.g. `scheduleTwenty`, `scheduleTen`, `assembleSchedule8`).
 */
export function assembleSchedule9(ri: Ri): Schedule9Composition | undefined {
  const s9: Ri = ri.albertaSredCredit9;
  if (!s9) return undefined;

  const groupRows: Ri[] = Array.isArray(s9.group) ? s9.group : [];
  const members = groupRows.filter((m) => present(m?.name) || present(m?.allocated));

  const hasContent =
    present(s9.federalQualifiedExpenditures) ||
    present(s9.albertaPortionOfExpenditures) ||
    present(s9.eligibleExpenditures) ||
    present(s9.federalProxyAmountInAlbertaPortion) ||
    present(s9.albertaProxyAmount) ||
    present(s9.albertaCreditReducingFederalExpense) ||
    present(s9.albertaPortionOfRepayments) ||
    present(s9.priorYearFederalItcReceived) ||
    present(s9.fieldOfScience) ||
    members.length > 0;
  if (!hasContent) return undefined;

  // Page 3 — the Allocation of the Maximum Expenditure Limit, only when the
  // associated group actually has a member entered. The filing corporation
  // must be row 1 (same instruction as Schedule 29's Agreement table) — its
  // own capped share becomes line 009102.
  let allocatedExpenditureLimit: number | undefined;
  const allocationIssues: string[] = [];
  let group: Schedule9GroupFilingInput | undefined;
  if (members.length > 0) {
    const allocation = allocateSchedule9ExpenditureLimit(
      present(s9.daysInLongestYear) ? num(s9.daysInLongestYear) : 365,
      members.map(
        (m): Schedule9AllocationMember => ({
          name: String(m.name ?? ''),
          ...(present(m.albertaCan) ? { albertaCan: String(m.albertaCan) } : {}),
          allocated: num(m.allocated),
        }),
      ),
    );
    allocatedExpenditureLimit = allocation.claimantAllocatedAmount;
    allocationIssues.push(...allocation.issues);
    group = {
      ...(present(s9.longestYearCan) ? { longestYearCan: String(s9.longestYearCan) } : {}),
      ...(present(s9.longestYearBegin) ? { longestYearBegin: String(s9.longestYearBegin) } : {}),
      ...(present(s9.longestYearEnd) ? { longestYearEnd: String(s9.longestYearEnd) } : {}),
      allocation,
    };
  } else if (present(s9.allocatedExpenditureLimit)) {
    allocatedExpenditureLimit = num(s9.allocatedExpenditureLimit);
  }

  // 009100 — associated when the preparer said so directly, OR a group was
  // actually entered (a group with no association answer is still a group).
  const isAssociated = s9.isAssociated === 'yes' || members.length > 0;

  const fieldOfScienceCode = Number(s9.fieldOfScience);
  const fieldOfScience = [1, 2, 3, 4].includes(fieldOfScienceCode)
    ? (fieldOfScienceCode as 1 | 2 | 3 | 4)
    : undefined;

  const result = computeAlbertaSchedule9({
    ...(present(s9.federalQualifiedExpenditures)
      ? { federalQualifiedExpenditures: num(s9.federalQualifiedExpenditures) }
      : {}),
    ...(present(s9.albertaPortionOfExpenditures)
      ? { albertaPortionOfExpenditures: num(s9.albertaPortionOfExpenditures) }
      : {}),
    ...(present(s9.federalProxyAmountInAlbertaPortion)
      ? { federalProxyAmountInAlbertaPortion: num(s9.federalProxyAmountInAlbertaPortion) }
      : {}),
    ...(present(s9.albertaProxyAmount) ? { albertaProxyAmount: num(s9.albertaProxyAmount) } : {}),
    ...(present(s9.albertaCreditReducingFederalExpense)
      ? { albertaCreditReducingFederalExpense: num(s9.albertaCreditReducingFederalExpense) }
      : {}),
    ...(present(s9.priorYearFederalItcReceived)
      ? { priorYearFederalItcReceived: num(s9.priorYearFederalItcReceived) }
      : {}),
    ...(present(s9.totalAlbertaExpendituresAllYears)
      ? { totalAlbertaExpendituresAllYears: num(s9.totalAlbertaExpendituresAllYears) }
      : {}),
    ...(present(s9.totalFederalExpendituresAllYears)
      ? { totalFederalExpendituresAllYears: num(s9.totalFederalExpendituresAllYears) }
      : {}),
    ...(present(s9.albertaPortionOfRepayments)
      ? { albertaPortionOfRepayments: num(s9.albertaPortionOfRepayments) }
      : {}),
    ...(present(s9.eligibleExpenditures)
      ? { eligibleExpenditures: num(s9.eligibleExpenditures) }
      : {}),
    ...(fieldOfScience !== undefined ? { fieldOfScience } : {}),
    isAssociated,
    ...(allocatedExpenditureLimit != null ? { allocatedExpenditureLimit } : {}),
    ...(present(s9.daysInTaxYear) ? { daysInTaxYear: num(s9.daysInTaxYear) } : {}),
    ...(present(s9.disposalRecapture) ? { disposalRecapture: num(s9.disposalRecapture) } : {}),
    ...(present(s9.priorYearFederalItcAdjustment)
      ? { priorYearFederalItcAdjustment: num(s9.priorYearFederalItcAdjustment) }
      : {}),
    ...(present(s9.taxationYearEnd) ? { taxationYearEnd: String(s9.taxationYearEnd) } : {}),
  });

  return {
    result:
      allocationIssues.length > 0
        ? { ...result, issues: [...result.issues, ...allocationIssues] }
        : result,
    ...(group ? { group } : {}),
  };
}
