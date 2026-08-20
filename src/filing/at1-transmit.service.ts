/**
 * Transmit an Alberta AT1 return — the capstone of the L1 flow.
 *
 * Gates (fail closed): the engagement is AT1, has a computed-return, and has a
 * SIGNED-OFF review memo. Then: render the payload, run the provenance guard one
 * last time (nothing 'model' reaches the wire), transmit via the host gateway,
 * and ONLY on a real gateway result write the immutable filing-record + append
 * TransmissionAttempted (and, if accepted, CRAAcknowledged) facts + advance status.
 */

import { withTransaction } from '@classytic/mongokit';
import { createError } from '@classytic/repo-core/errors';
import mongoose from 'mongoose';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { ComputedReturnDocument } from '#resources/ledger/computed-return/computed-return.model.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { FilingRecordDocument } from '#resources/workpapers/filing-record/filing-record.model.js';
import filingRecordRepository from '#resources/workpapers/filing-record/filing-record.repository.js';
import type { ReviewMemoDocument } from '#resources/workpapers/review-memo/review-memo.model.js';
import reviewMemoRepository from '#resources/workpapers/review-memo/review-memo.repository.js';
import { appendFact } from '#shared/append-fact.js';
import type { WithId } from '#shared/db.js';
import { assertFiledProvenance, type ProvenancedField } from '#shared/provenance-guard.js';
import { type Certification, prepareAt1NetFile } from '../engine/at1-netfile.service.js';
import { getAt1FilingGateway } from './at1-gateway.js';
import type { At1TransmitResult } from './at1-gateway.js';
import {
  beginSubmissionAttempt,
  completeSubmissionAttempt,
  markSubmissionUnknown,
} from './submission-attempt.service.js';
import { findValidT183Authorization } from './t183-authorization.service.js';

const RETENTION_YEARS = 6; // T183 / records retention

export interface TransmitAt1Params {
  engagementId: string;
  orgId: string;
  userId: string;
  certification: Certification;
}

export interface TransmitAt1Result {
  filingRecordId: string;
  status: 'accepted' | 'rejected';
  confirmationNumber: string | null;
}

export async function transmitAt1(params: TransmitAt1Params): Promise<TransmitAt1Result> {
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'AT1')
    throw createError(400, 'Transmission applies to AT1 engagements');

  // Load the CURRENT computed return, then require a sign-off bound to EXACTLY it
  // — a signature on an earlier computation must not authorize this one.
  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed) throw createError(409, 'No computed return yet — run compute first');

  const memo = (await reviewMemoRepository.getOne({
    engagementYearId: engagement._id,
    organizationId: params.orgId,
    status: 'signed_off',
    computedReturnId: computed._id,
  })) as WithId<ReviewMemoDocument> | null;
  if (!memo) {
    throw createError(
      409,
      'The current computed return has not been signed off — re-review and sign off the latest computation before filing (an earlier sign-off does not authorize a changed return).',
    );
  }

  // Require the corporate officer's T183 authorization for EXACTLY this computed
  // return — a control separate from the preparer sign-off. The signer of record
  // is the authorizing officer, never text supplied at transmit time.
  const t183Auth = await findValidT183Authorization({
    engagementId: String(engagement._id),
    orgId: params.orgId,
    computedReturnId: computed._id,
    resultHash: (computed as { resultHash?: string }).resultHash ?? null,
  });
  if (!t183Auth) {
    throw createError(
      409,
      'No valid T183 authorization for the current computed return — the corporate officer must authorize e-filing of this exact computation (record it via authorize-t183) before transmission.',
    );
  }

  // Render the payload (also validates certification), then the final guard.
  const { xml, payloadHash } = await prepareAt1NetFile({
    engagementId: params.engagementId,
    orgId: params.orgId,
    certification: params.certification,
  });
  const fields = (computed.fields as { line: string; value: unknown; provenance: string }[]).map(
    (f): ProvenancedField => ({ line: f.line, value: f.value, provenance: f.provenance }),
  );
  assertFiledProvenance(fields); // nothing 'model' reaches the wire

  // Durable pre-egress attempt + idempotency guard.
  const { attemptId } = await beginSubmissionAttempt({
    engagementId: String(engagement._id),
    orgId: params.orgId,
    userId: params.userId,
    program: 'AT1',
    channel: 'AT1_NETFILE',
    computedReturnId: computed._id,
    payloadHash,
  });

  // Transmit — the only egress. On error the outcome is unknown (reconcile, don't resend).
  let result: At1TransmitResult;
  try {
    result = await getAt1FilingGateway().transmit(xml);
  } catch (err) {
    await markSubmissionUnknown(attemptId, err);
    throw err;
  }

  const submittedAt = new Date();
  const retentionUntil = new Date(submittedAt);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + RETENTION_YEARS);

  // After the external response, persist ATOMICALLY (all-or-none) so a network
  // acceptance can never leave a half-written internal filing state.
  const filing = await withTransaction(
    mongoose.connection,
    async (session) => {
      await completeSubmissionAttempt(
        attemptId,
        {
          status: result.status === 'accepted' ? 'accepted' : 'rejected',
          confirmationNumber: result.confirmationNumber,
          rawResponse: result,
        },
        session,
      );
      const rec = (await filingRecordRepository.create(
        {
          engagementYearId: engagement._id,
          computedReturnId: computed._id,
          program: 'AT1',
          channel: 'AT1_NETFILE',
          payloadHash,
          submittedAt,
          status: result.status,
          confirmationNumber: result.confirmationNumber,
          errorCodes: result.errorCodes,
          acknowledgedAt: submittedAt,
          t183: {
            signedBy: t183Auth.officerName,
            signedPosition: t183Auth.officerPosition,
            signedAt: t183Auth.signedAt,
            authorizationMethod: t183Auth.authorizationMethod ?? null,
            evidenceRef: t183Auth.evidenceRef ?? null,
            authorizationId: t183Auth._id,
            transmittedBy: params.userId,
            retentionUntil,
          },
          reviewMemoId: memo._id,
          organizationId: params.orgId,
          createdBy: params.userId,
        },
        { session },
      )) as WithId<FilingRecordDocument>;

      await appendFact(
        {
          engagementYearId: engagement._id,
          orgId: params.orgId,
          actor: params.userId,
          type: 'TransmissionAttempted',
          provenance: 'human',
          reason: `AT1 Net File transmitted (payloadHash ${payloadHash.slice(0, 12)}…)`,
          payload: {
            payloadHash,
            channel: 'AT1_NETFILE',
            computedReturnId: String(computed._id),
            reviewMemoId: String(memo._id),
          },
        },
        session,
      );
      if (result.status === 'accepted') {
        await appendFact(
          {
            engagementYearId: engagement._id,
            orgId: params.orgId,
            actor: params.userId,
            type: 'CRAAcknowledged',
            provenance: 'imported',
            reason: `TRA accepted — confirmation ${result.confirmationNumber ?? ''}`,
            payload: { confirmationNumber: result.confirmationNumber },
          },
          session,
        );
        await engagementYearRepository.update(
          String(engagement._id),
          { status: 'filed' },
          { session },
        );
      }
      return rec;
    },
    { allowFallback: true },
  );

  return {
    filingRecordId: String(filing._id),
    status: result.status,
    confirmationNumber: result.confirmationNumber,
  };
}
