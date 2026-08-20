/**
 * Transmit a Québec CO-17 via Revenu Québec — the CO-17 twin of t2-transmit.
 *
 * Same fail-closed chain: fileable computed return + a signed review memo bound
 * to it + the officer's T183-equivalent authorization + an INJECTED RQ-certified
 * serializer (the draft renderer is never sent) + a pre-egress idempotent attempt
 * + atomic post-response persistence.
 */
import { createHash } from 'node:crypto';
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
import type { Certification } from '../engine/at1-netfile.service.js';
import { getCertifiedCo17Serializer } from './co17-certified-serializer.js';
import { getCo17FilingGateway } from './co17-gateway.js';
import type { Co17TransmitResult } from './co17-gateway.js';
import { composeCo17FilingData } from './co17-return.service.js';
import {
  beginSubmissionAttempt,
  completeSubmissionAttempt,
  markSubmissionUnknown,
} from './submission-attempt.service.js';
import { findValidT183Authorization } from './t183-authorization.service.js';

const RETENTION_YEARS = 6;

export interface TransmitCo17Params {
  engagementId: string;
  orgId: string;
  userId: string;
  certification: Certification;
}

export interface TransmitCo17Result {
  filingRecordId: string;
  status: 'accepted' | 'rejected';
  confirmationNumber: string | null;
  payloadHash: string;
}

export async function transmitCo17(params: TransmitCo17Params): Promise<TransmitCo17Result> {
  // Fail closed on the RQ-certified serializer — the draft must never be sent.
  const serializer = getCertifiedCo17Serializer();
  if (!serializer) {
    throw createError(
      501,
      'CO-17 electronic filing is not Revenu-Québec-certified — no certified serializer is configured. The prepared return is a draft/preview only.',
    );
  }

  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'CO17')
    throw createError(400, 'CO-17 transmission applies to CO17 engagements');

  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed) throw createError(409, 'No computed return yet — run compute first');
  if ((computed as { fileable?: boolean }).fileable === false) {
    throw createError(
      409,
      'This computed return is not fileable — recompute from the structured return editor before filing.',
    );
  }

  const memo = (await reviewMemoRepository.getOne({
    engagementYearId: engagement._id,
    organizationId: params.orgId,
    status: 'signed_off',
    computedReturnId: computed._id,
  })) as WithId<ReviewMemoDocument> | null;
  if (!memo) {
    throw createError(
      409,
      'The current computed return has not been signed off — re-review and sign off before filing.',
    );
  }

  const t183Auth = await findValidT183Authorization({
    engagementId: String(engagement._id),
    orgId: params.orgId,
    computedReturnId: computed._id,
    resultHash: (computed as { resultHash?: string }).resultHash ?? null,
  });
  if (!t183Auth) {
    throw createError(
      409,
      'No valid officer authorization for the current computed return — authorize before transmission.',
    );
  }

  // Compose the reviewed data, serialize with the CERTIFIED serializer (never draft).
  const data = await composeCo17FilingData({
    engagementId: params.engagementId,
    orgId: params.orgId,
    certification: params.certification,
    forFiling: true,
  });
  const xml = serializer.serialize(data);
  if (/status="draft"|certified="false"/.test(xml)) {
    throw createError(
      500,
      'Certified CO-17 serializer returned draft/uncertified markup — refusing to transmit.',
    );
  }
  const payloadHash = createHash('sha256').update(xml).digest('hex');

  const fields = (computed.fields as { line: string; value: unknown; provenance: string }[]).map(
    (f): ProvenancedField => ({ line: f.line, value: f.value, provenance: f.provenance }),
  );
  assertFiledProvenance(fields);

  const { attemptId } = await beginSubmissionAttempt({
    engagementId: String(engagement._id),
    orgId: params.orgId,
    userId: params.userId,
    program: 'CO17',
    channel: 'CO17_NETFILE',
    computedReturnId: computed._id,
    payloadHash,
  });

  let result: Co17TransmitResult;
  try {
    result = await getCo17FilingGateway().transmit(xml);
  } catch (err) {
    await markSubmissionUnknown(attemptId, err);
    throw err;
  }

  const submittedAt = new Date();
  const retentionUntil = new Date(submittedAt);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + RETENTION_YEARS);

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
          program: 'CO17',
          channel: 'CO17_NETFILE',
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
          reason: `CO-17 transmitted (payloadHash ${payloadHash.slice(0, 12)}…)`,
          payload: {
            payloadHash,
            channel: 'CO17_NETFILE',
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
            reason: `Revenu Québec accepted — confirmation ${result.confirmationNumber ?? ''}`,
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
    payloadHash,
  };
}
