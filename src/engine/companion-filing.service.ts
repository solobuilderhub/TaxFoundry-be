/**
 * The companion filing — the OTHER return a corporation owes for the same year.
 *
 * ── The confusion this exists to remove ─────────────────────────────────────
 *
 * A corporation with a permanent establishment in Alberta owes two returns: the
 * federal T2 to CRA and the AT1 to Alberta TRA. Quebec is the same shape. An
 * engagement in this system is ONE filing — its model says so, its review
 * sign-off, its T183 authorization and its filing record all bind one-to-one —
 * so two returns mean two engagements.
 *
 * But an Alberta engagement collects the ENTIRE federal dataset. It has to:
 * Alberta taxes the federal taxable income allocated to the province, so
 * `assembleProvincialInput` runs a full `computeFederalT2()` and composes the
 * Alberta schedules from its result. That is why the federal schedules appear
 * on an Alberta engagement, and it is the right design.
 *
 * The gap was between those two facts. The preparer entered a complete federal
 * return on the Alberta engagement, and then, to file federally, created a
 * second engagement and entered all of it again. The export screen made this
 * worse by advertising a federal payload on the Alberta engagement that could
 * never be produced — see below.
 *
 * ── Why the federal payload cannot come from an Alberta engagement ──────────
 *
 * The federal computation inside `assembleProvincialInput` is TRANSIENT. What
 * gets persisted is the Alberta result: `runAT1Compute` emits
 * `albertaTaxableIncome`, `albertaTaxPayable` and so on, and no federal line at
 * all. `composeT2FilingData` reads federal names out of the computed return's
 * fold, so pointing it at an Alberta engagement would not fail loudly — it
 * would render a federal return in which every federal figure was absent.
 *
 * That is why `composeT2FilingData` keeps its program guard. A return that
 * looks complete and is wrong is the worst outcome available here, and it is
 * strictly worse than refusing.
 *
 * ── What this does instead ─────────────────────────────────────────────────
 *
 * Creates the companion engagement and CARRIES THE RETURN INPUT ACROSS, so the
 * federal return starts from the figures already entered rather than from
 * nothing. The two engagements stay separate — each gets its own compute, its
 * own review, its own authorization and its own filing record, which is what
 * filing to two authorities actually requires — but the data is entered once.
 *
 * It is deliberately NOT a sync. The copy happens at creation and then the two
 * diverge, because they legitimately do: Alberta's reconciliation schedules
 * exist precisely to record where the provincial figures differ from federal.
 * A live mirror would fight that.
 */

import { createError } from '@classytic/repo-core/errors';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { WithId } from '#shared/db.js';

/** The program each provincial return is filed alongside. */
const COMPANION_OF: Readonly<Record<string, string>> = {
  AT1: 'T2',
  CO17: 'T2',
};

export interface CompanionFilingResult {
  engagementYearId: string;
  program: string;
  /** True when this call created it; false when it already existed. */
  created: boolean;
  /** True when the source engagement had a return input to carry across. */
  returnInputCopied: boolean;
}

export interface CreateCompanionParams {
  engagementId: string;
  orgId: string;
  userId: string;
}

/**
 * Create (or find) the federal engagement that belongs beside a provincial one.
 *
 * Idempotent by design. The model already carries a
 * `{organizationId, clientId, taxYearEnd, program}` index, so a second call
 * returns the engagement the first one made rather than a duplicate — a
 * preparer who presses the button twice gets one federal return, not two.
 */
export async function createCompanionFiling(
  params: CreateCompanionParams,
): Promise<CompanionFilingResult> {
  const source = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!source) throw createError(404, 'Engagement year not found');

  const companionProgram = COMPANION_OF[String(source.program)];
  if (!companionProgram) {
    throw createError(
      400,
      `A ${String(source.program)} engagement is the federal return itself — it has no companion filing. ` +
        'Provincial engagements (AT1, CO17) are the ones filed alongside a federal T2.',
    );
  }

  const existing = (await engagementYearRepository.getOne({
    organizationId: params.orgId,
    clientId: source.clientId,
    taxYearEnd: source.taxYearEnd,
    program: companionProgram,
  })) as WithId<EngagementYearDocument> | null;
  if (existing) {
    return {
      engagementYearId: String(existing._id),
      program: companionProgram,
      created: false,
      returnInputCopied: false,
    };
  }

  // A deep copy, not a shared reference: the two returns diverge from here, and
  // Alberta's reconciliation schedules are the record of how.
  const returnInput = source.returnInput
    ? (JSON.parse(JSON.stringify(source.returnInput)) as EngagementYearDocument['returnInput'])
    : undefined;

  const created = (await engagementYearRepository.create({
    clientId: source.clientId,
    program: companionProgram,
    taxYearStart: source.taxYearStart,
    taxYearEnd: source.taxYearEnd,
    status: 'in_progress',
    ...(returnInput ? { returnInput } : {}),
    organizationId: params.orgId,
    createdBy: params.userId,
  })) as WithId<EngagementYearDocument>;

  return {
    engagementYearId: String(created._id),
    program: companionProgram,
    created: true,
    returnInputCopied: returnInput !== undefined,
  };
}

/**
 * The companion engagement for a provincial one, when it already exists.
 *
 * Read-only, so a screen can link to the federal return without offering to
 * create a second one.
 */
export async function findCompanionFiling(params: {
  engagementId: string;
  orgId: string;
}): Promise<{ engagementYearId: string; program: string } | null> {
  const source = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!source) return null;
  const companionProgram = COMPANION_OF[String(source.program)];
  if (!companionProgram) return null;

  const existing = (await engagementYearRepository.getOne({
    organizationId: params.orgId,
    clientId: source.clientId,
    taxYearEnd: source.taxYearEnd,
    program: companionProgram,
  })) as WithId<EngagementYearDocument> | null;
  return existing ? { engagementYearId: String(existing._id), program: companionProgram } : null;
}
