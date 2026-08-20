/**
 * Review sign-off — the L1 human checkpoint before filing.
 *
 * Signing off gates fail-closed on UNRESOLVED RED flags (you cannot sign a return
 * with open errors), stamps who signed and when, and appends a ReviewSignedOff
 * fact (provenance 'human') to the ledger. `transmitAt1` then requires a
 * signed-off memo before it will file.
 */

import { withTransaction } from '@classytic/mongokit';
import { createError } from '@classytic/repo-core/errors';
import mongoose from 'mongoose';
import type { ReviewMemoDocument } from '#resources/workpapers/review-memo/review-memo.model.js';
import reviewMemoRepository from '#resources/workpapers/review-memo/review-memo.repository.js';
import { appendFact } from '#shared/append-fact.js';
import type { WithId } from '#shared/db.js';

export interface SignOffParams {
  memoId: string;
  orgId: string;
  userId: string;
}

export interface SignOffResult {
  memoId: string;
  status: 'signed_off';
  signedOffBy: string;
  signedOffAt: Date;
}

export async function signOffReviewMemo(params: SignOffParams): Promise<SignOffResult> {
  const memo = (await reviewMemoRepository.getOne({
    _id: params.memoId,
    organizationId: params.orgId,
  })) as WithId<ReviewMemoDocument> | null;
  if (!memo) throw createError(404, 'Review memo not found');
  if (memo.status === 'signed_off') throw createError(409, 'Review memo is already signed off');

  const flags = (memo.flags ?? []) as { severity: string; resolved: boolean }[];
  const unresolvedReds = flags.filter((f) => f.severity === 'red' && !f.resolved);
  if (unresolvedReds.length > 0) {
    throw createError(
      422,
      `Cannot sign off: ${unresolvedReds.length} unresolved red flag(s) must be resolved first`,
    );
  }

  const signedOffAt = new Date();
  // ATOMIC: the memo status change and its ReviewSignedOff audit fact land
  // together or not at all — a memo can never be signed without its ledger fact.
  await withTransaction(
    mongoose.connection,
    async (session) => {
      await reviewMemoRepository.update(
        String(memo._id),
        { status: 'signed_off', signedOffBy: params.userId, signedOffAt },
        { session },
      );
      await appendFact(
        {
          engagementYearId: memo.engagementYearId,
          orgId: params.orgId,
          actor: params.userId,
          type: 'ReviewSignedOff',
          provenance: 'human',
          reason: 'Review memo signed off (no unresolved red flags)',
          // Bind the sign-off to the EXACT computed return it reviewed.
          payload: {
            memoId: String(memo._id),
            computedReturnId: String(memo.computedReturnId ?? ''),
          },
        },
        session,
      );
    },
    { allowFallback: true },
  );

  return {
    memoId: String(memo._id),
    status: 'signed_off',
    signedOffBy: params.userId,
    signedOffAt,
  };
}
