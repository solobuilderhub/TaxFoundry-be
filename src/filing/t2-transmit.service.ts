/**
 * Transmit a federal T2 via CIF — the T2 twin of at1-transmit.
 *
 * Same gates (fail closed): the engagement is T2, has a computed-return, and a
 * SIGNED-OFF review memo. Render the CIF payload, run the provenance guard once
 * more (nothing 'model' reaches the wire), transmit via the host CIF gateway,
 * and ONLY on a real gateway result write the immutable filing-record + append
 * facts + advance status. The default gateway REFUSES (503) until CRA-certified.
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
import {
  beginSubmissionAttempt,
  completeSubmissionAttempt,
  markSubmissionUnknown,
} from './submission-attempt.service.js';
import { getCertifiedT2Serializer } from './t2-certified-serializer.js';
import { composeT2FilingData } from './t2-cif.service.js';
import { getT2CifGateway } from './t2-cif-gateway.js';
import type { T2TransmitResult } from './t2-cif-gateway.js';
import { findValidT183Authorization } from './t183-authorization.service.js';

const RETENTION_YEARS = 6;

export interface TransmitT2Params {
  engagementId: string;
  orgId: string;
  userId: string;
  certification: Certification;
}

export interface TransmitT2Result {
  filingRecordId: string;
  status: 'accepted' | 'rejected';
  confirmationNumber: string | null;
  payloadHash: string;
}

export async function transmitT2Cif(params: TransmitT2Params): Promise<TransmitT2Result> {
  // FAIL CLOSED on an INJECTED certified serializer — never on an env string.
  // The draft renderer produces a structural preview, not a certified payload;
  // only a real CRA-certified serializer (wired via setCertifiedT2Serializer at
  // boot, post-certification) may produce a fileable payload. No adapter → refuse.
  const certifiedSerializer = getCertifiedT2Serializer();
  if (!certifiedSerializer) {
    throw createError(
      501,
      'T2 electronic filing is not CRA-certified — no certified serializer is configured. The prepared return is a draft/preview only.',
    );
  }

  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'T2')
    throw createError(400, 'CIF transmission applies to T2 engagements');

  // Load the CURRENT computed return first, then require a sign-off bound to
  // EXACTLY it — a signature on an earlier computation must not authorize this one.
  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed) throw createError(409, 'No computed return yet — run compute first');
  // Only a return computed from the server-assembled structured input is fileable
  // (calc + filing from one source); a legacy engine-input computation is not.
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
      'The current computed return has not been signed off — re-review and sign off the latest computation before filing (an earlier sign-off does not authorize a changed return).',
    );
  }

  // Require the corporate officer's T183 authorization for EXACTLY this computed
  // return (separate control from the preparer sign-off; signer of record = officer).
  const t183Auth = await findValidT183Authorization({
    engagementId: String(engagement._id),
    orgId: params.orgId,
    computedReturnId: computed._id,
    resultHash: (computed as { resultHash?: string }).resultHash ?? null,
  });
  if (!t183Auth) {
    throw createError(
      409,
      'No valid T183 authorization for the current computed return — the corporate officer must authorize e-filing of this exact computation (authorize-t183) before transmission.',
    );
  }

  // Compose the reviewed filing DATA, then serialize with the CERTIFIED serializer
  // — NOT the draft renderer. The draft (`renderT2DraftReturn`) is preview-only and
  // must never reach the gateway; the certified serializer produces the fileable
  // CRA payload, and only its output is hashed and transmitted.
  const data = await composeT2FilingData({
    engagementId: params.engagementId,
    orgId: params.orgId,
    certification: params.certification,
    forFiling: true, // enforce exact-year rate table + GIFI balancing + completeness
  });
  const xml = certifiedSerializer.serialize(data);
  if (/status="draft"|certified="false"/.test(xml)) {
    // Defence-in-depth: a serializer that returned draft markup is a mis-wire.
    throw createError(
      500,
      'Certified serializer returned draft/uncertified markup — refusing to transmit.',
    );
  }
  const payloadHash = createHash('sha256').update(xml).digest('hex');

  const fields = (computed.fields as { line: string; value: unknown; provenance: string }[]).map(
    (f): ProvenancedField => ({ line: f.line, value: f.value, provenance: f.provenance }),
  );
  assertFiledProvenance(fields);

  // Durable pre-egress attempt + idempotency guard — refuses to resend a return
  // already accepted or whose prior outcome is unknown.
  const { attemptId } = await beginSubmissionAttempt({
    engagementId: String(engagement._id),
    orgId: params.orgId,
    userId: params.userId,
    program: 'T2',
    channel: 'CIF',
    computedReturnId: computed._id,
    payloadHash,
  });

  // Transmit — the only egress. On a network error the outcome is unknown; the
  // attempt is marked so a retry reconciles instead of blindly resending.
  let result: T2TransmitResult;
  try {
    result = await getT2CifGateway().transmit(xml);
  } catch (err) {
    await markSubmissionUnknown(attemptId, err);
    throw err;
  }

  const submittedAt = new Date();
  const retentionUntil = new Date(submittedAt);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + RETENTION_YEARS);

  // After the external response, persist ATOMICALLY: the immutable filing record,
  // the transmission + acknowledgement facts, and the engagement status either all
  // land or none do (no half-written filing state once CRA has the return).
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
          program: 'T2',
          channel: 'CIF',
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
          reason: `T2 CIF transmitted (payloadHash ${payloadHash.slice(0, 12)}…)`,
          payload: {
            payloadHash,
            channel: 'CIF',
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
            reason: `CRA accepted — confirmation ${result.confirmationNumber ?? ''}`,
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
