/**
 * Submission attempts — the pre-egress durable trace + idempotent retry guard
 * shared by the T2 and AT1 transmitters.
 *
 * `beginSubmissionAttempt` writes a `pending` attempt BEFORE the network call and
 * refuses to proceed when a prior attempt for the exact same payload is already
 * accepted (already filed) or in an indeterminate state (reconcile with CRA
 * first). `completeSubmissionAttempt` transitions it to its final state inside
 * the caller's post-response transaction. `markSubmissionUnknown` records an
 * egress error whose outcome is unclear.
 */

import { createError } from '@classytic/repo-core/errors';
import type { ClientSession } from 'mongoose';
import type { SubmissionAttemptDocument } from '#resources/workpapers/submission-attempt/submission-attempt.model.js';
import submissionAttemptRepository from '#resources/workpapers/submission-attempt/submission-attempt.repository.js';
import type { WithId } from '#shared/db.js';

export interface BeginAttemptParams {
  engagementId: string;
  orgId: string;
  userId: string;
  program: string;
  channel: string;
  computedReturnId: unknown;
  payloadHash: string;
}

/** Create (or reuse a rejected) pending attempt BEFORE egress; block duplicates. */
export async function beginSubmissionAttempt(
  params: BeginAttemptParams,
): Promise<{ attemptId: string; idempotencyKey: string }> {
  const idempotencyKey = `${params.program}:${params.engagementId}:${params.payloadHash}`;

  const existing = (await submissionAttemptRepository.getOne({
    organizationId: params.orgId,
    idempotencyKey,
  })) as WithId<SubmissionAttemptDocument> | null;

  if (existing) {
    if (existing.status === 'accepted') {
      throw createError(
        409,
        'This return has already been accepted by CRA — it must not be transmitted again.',
      );
    }
    if (existing.status === 'rejected') {
      // Identical payload previously rejected — allow a fresh attempt (reset).
      await submissionAttemptRepository.update(String(existing._id), { status: 'pending' });
      return { attemptId: String(existing._id), idempotencyKey };
    }
    // pending / submitted / unknown — an earlier send may have reached CRA.
    throw createError(
      409,
      'A submission for this exact return is in-flight or its outcome is unknown — reconcile with CRA before retrying (do not blindly retransmit).',
    );
  }

  try {
    const created = (await submissionAttemptRepository.create({
      engagementYearId: params.engagementId,
      computedReturnId: params.computedReturnId,
      program: params.program,
      channel: params.channel,
      idempotencyKey,
      payloadHash: params.payloadHash,
      status: 'pending',
      organizationId: params.orgId,
      createdBy: params.userId,
    })) as WithId<SubmissionAttemptDocument>;
    return { attemptId: String(created._id), idempotencyKey };
  } catch (err) {
    // A concurrent transmit won the unique-index race → treat as in-flight.
    if ((err as { code?: number }).code === 11000) {
      throw createError(
        409,
        'A concurrent submission for this exact return is already in progress.',
      );
    }
    throw err;
  }
}

/** Transition the attempt to its final state — call inside the post-response transaction. */
export async function completeSubmissionAttempt(
  attemptId: string,
  update: {
    status: 'submitted' | 'accepted' | 'rejected';
    confirmationNumber?: string | null;
    rawResponse?: unknown;
  },
  session?: ClientSession,
): Promise<void> {
  await submissionAttemptRepository.update(
    attemptId,
    {
      status: update.status,
      ...(update.confirmationNumber !== undefined
        ? { confirmationNumber: update.confirmationNumber }
        : {}),
      ...(update.rawResponse !== undefined ? { rawResponse: update.rawResponse } : {}),
    },
    ...(session ? [{ session }] : []),
  );
}

/** Record an egress error whose outcome is unclear (best-effort, outside any txn). */
export async function markSubmissionUnknown(attemptId: string, rawError: unknown): Promise<void> {
  try {
    await submissionAttemptRepository.update(attemptId, {
      status: 'unknown',
      rawResponse: { error: String(rawError) },
    });
  } catch {
    // best-effort — the pending attempt already blocks a blind retry
  }
}
