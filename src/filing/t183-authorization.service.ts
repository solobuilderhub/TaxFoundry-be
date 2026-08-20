/**
 * T183 authorization — record and verify the corporate officer's authorization
 * to e-file EXACTLY the current computed return (Form T183CORP).
 *
 * A control separate from the review sign-off, but bound to the SAME immutable
 * snapshot: the authorization references the computed return + its result hash,
 * so transmission can require an authorization for the precise computation being
 * filed (a recompute invalidates a prior authorization). The officer of record
 * is who authorized — not text supplied at transmit time.
 */

import { withTransaction } from '@classytic/mongokit';
import { createError } from '@classytic/repo-core/errors';
import mongoose from 'mongoose';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { ComputedReturnDocument } from '#resources/ledger/computed-return/computed-return.model.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import {
  T183_AUTH_METHODS,
  type T183AuthorizationDocument,
} from '#resources/workpapers/t183-authorization/t183-authorization.model.js';
import t183AuthorizationRepository from '#resources/workpapers/t183-authorization/t183-authorization.repository.js';
import { appendFact } from '#shared/append-fact.js';
import type { WithId } from '#shared/db.js';

type Method = (typeof T183_AUTH_METHODS)[number];

export interface RecordT183Params {
  engagementId: string;
  orgId: string;
  userId: string;
  officerName: string;
  officerPosition: string;
  /**
   * ISO date/time the officer signed the T183. **Required — never defaulted.**
   *
   * CRA: *"When collecting an e-signature, the T183CORP form must report the
   * date and time the form was electronically signed."* Defaulting to `now`
   * records a signing moment nobody observed, which is a fabricated attestation
   * — the same defect as filing a zero for a figure that was never determined.
   * If the caller does not know when the officer signed, the honest outcome is
   * a refusal, not an invented timestamp.
   */
  signedAt: string;
  /**
   * How the officer authorized. **Required — never defaulted.** It used to
   * default to `wet_signature`, which is a FILEABLE method: omitting the field
   * produced the most permissive answer, backwards for a control that gates
   * transmission.
   */
  authorizationMethod: Method;
  evidenceRef?: string;
  /** The T183 form/version signed (e.g. 'T183CORP-2024'). */
  formVersion?: string;
}

/** Methods CRA accepts as a signed T183 for the FILING gate (verbal/other are notes only). */
const FILEABLE_METHODS = new Set<Method>(['wet_signature', 'electronic_signature']);

export async function recordT183Authorization(
  params: RecordT183Params,
): Promise<{ id: string; computedReturnId: string; resultHash: string | null }> {
  if (!params.officerName?.trim() || !params.officerPosition?.trim()) {
    throw createError(
      400,
      'officerName and officerPosition are required (the authorizing corporate officer)',
    );
  }
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');

  // Bind to the CURRENT computed return — the exact computation being authorized.
  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed)
    throw createError(
      409,
      'No computed return yet — compute before recording a T183 authorization',
    );

  const resultHash = (computed as { resultHash?: string }).resultHash ?? null;

  // The officer's signing moment is OBSERVED, never assumed. CRA requires the
  // date and time an e-signature was applied to be reported on the form itself,
  // so a default here would put a time on the record that nobody witnessed.
  if (!params.signedAt?.trim()) {
    throw createError(
      400,
      'signedAt is required — the date and time the authorized signing officer signed the T183. ' +
        'It is never assumed: recording a signing moment that was not observed is a fabricated attestation.',
    );
  }
  const signedAt = new Date(params.signedAt);
  if (Number.isNaN(signedAt.getTime())) throw createError(400, 'signedAt must be a valid date');
  // Signing precedes filing — a future signature date is invalid.
  if (signedAt.getTime() > Date.now() + 60_000)
    throw createError(400, 'signedAt cannot be in the future');

  // No default: omitting the method used to yield `wet_signature`, which is one
  // of the two methods that UNLOCK filing.
  const method = params.authorizationMethod;
  if (!method || !(T183_AUTH_METHODS as readonly string[]).includes(method)) {
    throw createError(
      400,
      `authorizationMethod is required and must be one of ${T183_AUTH_METHODS.join('|')} — ` +
        'it is not defaulted, because the default would be a method that permits transmission.',
    );
  }
  // A signed-form method (wet / electronic) requires the retained-document reference.
  if (FILEABLE_METHODS.has(method) && !params.evidenceRef?.trim()) {
    throw createError(
      400,
      'evidenceRef (reference to the retained signed T183) is required for a wet or electronic signature',
    );
  }

  const created = await withTransaction(
    mongoose.connection,
    async (session) => {
      const auth = (await t183AuthorizationRepository.create(
        {
          engagementYearId: engagement._id,
          computedReturnId: computed._id,
          resultHash,
          officerName: params.officerName.trim(),
          officerPosition: params.officerPosition.trim(),
          signedAt,
          authorizationMethod: method,
          ...(params.evidenceRef ? { evidenceRef: params.evidenceRef } : {}),
          ...(params.formVersion ? { formVersion: params.formVersion } : {}),
          recordedBy: params.userId,
          organizationId: params.orgId,
          createdBy: params.userId,
        },
        { session },
      )) as WithId<T183AuthorizationDocument>;

      await appendFact(
        {
          engagementYearId: engagement._id,
          orgId: params.orgId,
          actor: params.userId,
          type: 'T183Authorized',
          provenance: 'human',
          reason: `T183 e-file authorized by ${params.officerName.trim()} (${params.officerPosition.trim()})`,
          payload: {
            t183AuthorizationId: String(auth._id),
            computedReturnId: String(computed._id),
            resultHash,
          },
        },
        session,
      );
      return auth;
    },
    { allowFallback: true },
  );

  return { id: String(created._id), computedReturnId: String(computed._id), resultHash };
}

/**
 * The valid T183 authorization for a specific computed return, or null. Valid =
 * bound to that computedReturnId AND its resultHash still matches (tamper check).
 * Transmission requires this before it will file.
 */
export async function findValidT183Authorization(params: {
  engagementId: string;
  orgId: string;
  computedReturnId: unknown;
  resultHash: string | null;
}): Promise<WithId<T183AuthorizationDocument> | null> {
  const auth = (await t183AuthorizationRepository.getOne(
    {
      engagementYearId: params.engagementId,
      organizationId: params.orgId,
      computedReturnId: params.computedReturnId,
    },
    { sort: { createdAt: -1 } },
  )) as WithId<T183AuthorizationDocument> | null;
  if (!auth) return null;
  // Tamper check: the authorization's bound hash must equal the computation's.
  if (params.resultHash && auth.resultHash && auth.resultHash !== params.resultHash) return null;
  // Filing requires a SIGNED T183 (wet/electronic) with a retained-document
  // reference — a verbal confirmation is a workflow note, not filing authority.
  if (!FILEABLE_METHODS.has(auth.authorizationMethod as Method)) return null;
  if (!auth.evidenceRef) return null;
  return auth;
}
