/**
 * The ONE way to append to the fact-log — every ledger fact routes through here.
 *
 * Centralises the atomic per-engagement sequence (`nextSequence`, a single-doc
 * `$inc`) so no path can regress to the race-prone `count() + 1`. Optionally joins
 * a caller transaction via `session`, so a fact rolls back with its surrounding
 * writes (compute) or stands alone (sign-off, transmission).
 */
import type { ClientSession, Types } from 'mongoose';
import factLogRepository from '#resources/ledger/fact-log/fact-log.repository.js';
import { nextSequence } from './sequence.js';

export type FactProvenance = 'engine' | 'human' | 'imported';

export interface AppendFactParams {
  engagementYearId: Types.ObjectId | string | unknown;
  orgId: string;
  actor: string;
  type: string;
  provenance: FactProvenance;
  reason: string;
  payload: Record<string, unknown>;
}

/** Append one fact with an atomic sequence. Pass `session` to join a transaction. */
export async function appendFact(
  params: AppendFactParams,
  session?: ClientSession,
): Promise<number> {
  const seq = await nextSequence(
    `factlog:${params.orgId}:${String(params.engagementYearId)}`,
    session,
  );
  await factLogRepository.create(
    {
      engagementYearId: params.engagementYearId,
      seq,
      type: params.type,
      actor: params.actor,
      provenance: params.provenance,
      reason: params.reason,
      payload: params.payload,
      organizationId: params.orgId,
      createdBy: params.actor,
    },
    ...(session ? [{ session }] : []),
  );
  return seq;
}
