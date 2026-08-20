/**
 * CRA Auto-fill service — pull the corporation's CRA data for an engagement and
 * pre-populate the working return.
 *
 * Flow: load the engagement + its client (the authoritative business number) →
 * call the AFR gateway (fail-closed 503 until CRA-enrolled) → map the response
 * into the structured return, FILLING BLANKS ONLY (preparer edits always win) →
 * persist the merged return + append a `SourceImported` fact (provenance
 * 'imported') for the audit trail. Returns what was filled.
 */
import { createError } from '@classytic/repo-core/errors';
import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import { appendFact } from '#shared/append-fact.js';
import type { WithId } from '#shared/db.js';
import { getAfrGateway } from './afr-gateway.js';
import { mergeAutoFill } from './afr-mapper.js';

const iso = (d: unknown): string | undefined =>
  d instanceof Date ? d.toISOString() : d ? String(d) : undefined;

export interface AutoFillParams {
  engagementId: string;
  orgId: string;
  userId: string;
  /** RC program-account identifier (default "0001"). */
  programAccount?: string;
}

export interface AutoFillResult {
  filled: string[];
  businessNumber: string;
  programAccount: string;
}

export async function autoFillEngagement(params: AutoFillParams): Promise<AutoFillResult> {
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');

  const client = (await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  })) as { businessNumber?: string } | null;
  if (!client?.businessNumber) {
    throw createError(
      409,
      'The client has no business number on file — cannot auto-fill from CRA.',
    );
  }
  // BN9 sanity check (CRA validates a full checksum; this catches obvious errors).
  const bn9 = String(client.businessNumber).replace(/\s/g, '').slice(0, 9);
  if (!/^\d{9}$/.test(bn9)) {
    throw createError(422, `Business number "${client.businessNumber}" is not a valid 9-digit BN.`);
  }
  const programAccount = params.programAccount ?? '0001';

  // Fail-closed unless a CRA AFR client is injected (NotConfigured → 503).
  const afr = await getAfrGateway().fetchCorporateData({
    businessNumber: bn9,
    programAccount,
    ...(iso(engagement.taxYearEnd) ? { taxYearEnd: iso(engagement.taxYearEnd)! } : {}),
  });

  const existing = (engagement.returnInput ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const { returnInput, filled } = mergeAutoFill(existing, afr);

  await engagementYearRepository.update(String(engagement._id), { returnInput });
  await appendFact({
    engagementYearId: engagement._id,
    orgId: params.orgId,
    actor: params.userId,
    type: 'SourceImported',
    provenance: 'imported',
    reason: `CRA Auto-fill (AFR) imported ${filled.length} field(s) for BN ${bn9} RC${programAccount}`,
    payload: { source: 'CRA-AFR', businessNumber: bn9, programAccount, filled },
  });

  return { filled, businessNumber: bn9, programAccount };
}
