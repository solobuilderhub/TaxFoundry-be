/**
 * Compute service — the engine↔ledger transaction for one engagement.
 *
 * Keeps the resource definition thin (arc best practice): the resource declares a
 * `compute` ACTION; this service holds the logic. Loads the (org-scoped)
 * engagement, runs the pure `runT2Compute`, then persists the immutable
 * computed-return snapshot (fields provenance 'engine') and appends the
 * AdjustmentComputed fact, and advances status. Throws `createError(status,…)`
 * (repo-core) so arc maps to the right HTTP code / MCP error.
 */

import { withTransaction } from '@classytic/mongokit';
import { createError } from '@classytic/repo-core/errors';
import mongoose from 'mongoose';
import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { ComputedReturnDocument } from '#resources/ledger/computed-return/computed-return.model.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import { appendFact } from '#shared/append-fact.js';
import type { WithId } from '#shared/db.js';
import { ProvenanceViolationError } from '#shared/provenance-guard.js';
import { runReview } from '../review/review-generator.service.js';
import { assembleProvincialInput } from './assemble-provincial-input.js';
import { assembleT2Input } from './assemble-t2-input.js';
import { runEngagementCompute } from './compute.js';
import type { EngineComputeOutput } from './compute-types.js';
import { applyPriorOpenings, resolvePriorYearOpenings } from './prior-year-openings.service.js';
import { assertReturnInputShape } from './return-input-validation.js';
import type { ComputationSnapshot } from './snapshot.js';
import { verifyT2Reproducible } from './t2-compute.js';

/** Schedule keys that mark a payload as the STRUCTURED working return (not engine input). */
const RETURN_SCHEDULE_KEYS = [
  'identification',
  'balanceSheet',
  'incomeStatement',
  'gifiNotes',
  'netIncome',
  'donations',
  'dividends',
  'capitalGains',
  'losses',
  'sbd',
  'cca',
  'credits',
  'foreign',
  'provincialAllocation',
  'payments',
  'shareholders',
  'quebec',
  'reserves',
  'capital',
];

/**
 * Extract the STRUCTURED working return from a compute payload, or null when the
 * payload is a legacy engine-shaped input. The web sends the structured return
 * (`{ returnInput }` or the schedule-keyed object) so the server can assemble the
 * engine input authoritatively; direct/legacy callers may still send engine input.
 */
function extractStructuredReturn(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (obj.returnInput && typeof obj.returnInput === 'object')
    return obj.returnInput as Record<string, unknown>;
  // Engine input carries `period`; the structured return never does.
  if ('period' in obj) return null;
  if (RETURN_SCHEDULE_KEYS.some((k) => k in obj)) return obj;
  return null;
}

export interface ComputeEngagementParams {
  engagementId: string;
  orgId: string;
  userId: string;
  /** Untrusted engine input (the T2 return input); validated inside runT2Compute. */
  input: unknown;
}

export interface ComputeEngagementResult {
  obligation: EngineComputeOutput['obligation'];
  computedReturnId: string;
}

/**
 * Coerce the wire shape (period dates arrive as ISO strings over JSON) to what
 * the engine validator expects (Date instances). Invalid values become Invalid
 * Dates that `t2Engine.validate` rejects → 400. Safe if already a Date.
 */
function coerceEngineInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || !('period' in input)) return input;
  const raw = input as Record<string, unknown>;
  const p = raw.period as { start?: unknown; end?: unknown; label?: unknown } | undefined;
  if (!p || typeof p !== 'object') return input;
  return {
    ...raw,
    period: { start: new Date(p.start as string), end: new Date(p.end as string), label: p.label },
  };
}

/**
 * Override CCPC status with the AUTHORITATIVE host fact, exactly as the rate book
 * is injected — the request cannot assert its own corporation type. `isCcpc` is
 * derived from the stored client's corporation type, so a request that sends
 * `isCcpc: true` for a public corporation is ignored and the SBD can never be
 * won by lying. (Province of permanent establishment is a genuine return input,
 * not an incorporation fact, so it is NOT force-overridden here.)
 */
function applyAuthoritativeIdentity(input: unknown, facts: { isCcpc: boolean }): unknown {
  if (!input || typeof input !== 'object') return input;
  return { ...(input as Record<string, unknown>), isCcpc: facts.isCcpc };
}

/**
 * Reproducibility check for the latest computed return: recompute from the stored
 * snapshot's validated input and confirm it still hashes to the recorded result.
 * Proves a filed return can be regenerated — the reviewer's reproducibility gap.
 */
export async function verifyEngagementReproducible(params: {
  engagementId: string;
  orgId: string;
}): Promise<{ reproducible: boolean; expected: string; actual: string; engineVersion: string }> {
  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: params.engagementId, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed) throw createError(409, 'No computed return yet — run compute first');
  const snapshot = (computed as { snapshot?: ComputationSnapshot }).snapshot;
  if (!snapshot)
    throw createError(
      422,
      'This computed return predates snapshotting — recompute to enable reproducibility checks',
    );
  if (computed.program !== 'T2')
    throw createError(400, 'Reproducibility check currently supports T2 returns');

  const { reproducible, expected, actual } = verifyT2Reproducible(snapshot);
  return { reproducible, expected, actual, engineVersion: computed.engineVersion };
}

export async function computeEngagementT2(
  params: ComputeEngagementParams,
): Promise<ComputeEngagementResult> {
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');

  // Derive CCPC status + province AUTHORITATIVELY from the stored client — never
  // trust the request (same trust boundary as the rate book). The web assembler
  // sends isCcpc, but a raw API caller could lie; the host fact wins.
  const client = (await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  })) as {
    name?: string;
    businessNumber?: string;
    corpType?: string;
    corporateAccountNumber?: string;
    // AT1 jacket identity — mandatory on the Alberta return, not derivable from it.
    contactPerson?: string;
    contactTelephone?: string;
    natureOfBusiness?: string;
    typeOfCorporation?: string;
    authorizedEmail?: string;
    address?: Record<string, unknown>;
  } | null;
  // A broken clientId must NOT silently become "not CCPC" (a valid-looking
  // general-rate return). Fail closed — the corporation type is a filing fact.
  if (!client)
    throw createError(
      409,
      'Client for this engagement could not be loaded — cannot determine corporation type',
    );
  const isCcpc = (client.corpType ?? '').toUpperCase().includes('CCPC');

  // FREEZE the corporate identity WITH the computed return — filing reads identity
  // from here, so editing the client record after sign-off can't change the
  // transmitted return without a new computation + review.
  const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ''));
  const frozenIdentity = {
    legalName: client.name ?? '',
    businessNumber: client.businessNumber ?? '',
    corporationType: client.corpType ?? '',
    ...(client.corporateAccountNumber
      ? { corporateAccountNumber: client.corporateAccountNumber }
      : {}),
    ...(client.address ? { address: client.address } : {}),
    // AT1 jacket identity — mandatory on the Alberta return and not derivable
    // from it. Frozen here for the same reason as the name and address: editing
    // the client record after sign-off must not change a transmitted return.
    ...(client.contactPerson ? { contactPerson: client.contactPerson } : {}),
    ...(client.contactTelephone ? { contactTelephone: client.contactTelephone } : {}),
    ...(client.natureOfBusiness ? { natureOfBusiness: client.natureOfBusiness } : {}),
    ...(client.typeOfCorporation ? { typeOfCorporation: client.typeOfCorporation } : {}),
    ...(client.authorizedEmail ? { authorizedEmail: client.authorizedEmail } : {}),
    taxYearStart: iso(engagement.taxYearStart),
    taxYearEnd: iso(engagement.taxYearEnd),
  };

  // ONE AUTHORITATIVE SOURCE. The web sends the structured working return; the
  // server persists it as `returnInput` and assembles the engine input from THAT,
  // so the calculation and the frozen filing package derive from one representation
  // (a caller can no longer send an engine input that disagrees with stored data).
  // Legacy engine-shaped payloads are still accepted for direct API / tooling.
  const extractedReturn = extractStructuredReturn(params.input);
  let structuredReturn: Record<string, unknown> | null = null;
  if (extractedReturn) {
    try {
      structuredReturn = assertReturnInputShape(extractedReturn);
    } catch (err) {
      throw createError(400, `Malformed return input: ${(err as Error).message}`);
    }
  }
  let assembledInput: unknown;
  if (structuredReturn) {
    await engagementYearRepository.update(String(engagement._id), {
      returnInput: structuredReturn,
    });
    engagement.returnInput = structuredReturn as EngagementYearDocument['returnInput'];
    assembledInput = assembleT2Input(structuredReturn, engagement);
  } else {
    assembledInput = coerceEngineInput(params.input); // legacy engine-input path
  }

  // Multi-year continuity: carry the prior tax year's closing loss/RDTOH pools
  // in as this year's opening balances (a preparer's explicit opening wins).
  const priors = await resolvePriorYearOpenings({ engagement, orgId: params.orgId });
  const federalInput = applyAuthoritativeIdentity(
    applyPriorOpenings(coerceEngineInput(assembledInput), priors),
    { isCcpc },
  );

  // A provincial engagement (Alberta AT1 / Québec CO-17) taxes the FEDERAL taxable
  // income allocated to the province, so compose its engine input from the federal
  // one (one source). A legacy engine-shaped payload for a provincial program is
  // passed straight through — the caller already sent the provincial shape.
  const isProvincial = engagement.program === 'AT1' || engagement.program === 'CO17';
  const engineInput =
    isProvincial && structuredReturn
      ? assembleProvincialInput(engagement.program, federalInput, structuredReturn, { isCcpc })
      : federalInput;

  let out: EngineComputeOutput;
  try {
    out = runEngagementCompute(engagement.program, engineInput, params.userId);
  } catch (err) {
    if (err instanceof ProvenanceViolationError) throw createError(422, err.message);
    throw createError(400, (err as Error).message);
  }

  // Persist the three ledger writes ATOMICALLY: the computed-return snapshot, the
  // append-only fact (with an atomic per-engagement sequence — no count()+1 race),
  // and the engagement status advance either all land or none do. On a MongoDB
  // deployment without transactions (standalone dev / in-memory test) this falls
  // back to running the writes without a session; the sequence stays atomic
  // (single-document $inc) so concurrent computes still can't collide on seq.
  // FREEZE the complete filing input WITH the computed return — the filing path
  // (GIFI, shareholders, questionnaire, address, instalments) must read this
  // immutable copy, NOT the live editor document, so no post-compute edit can
  // slip unreviewed filing content into a transmitted package.
  const frozenFilingInput = engagement.returnInput
    ? JSON.parse(JSON.stringify(engagement.returnInput))
    : undefined;
  const computed = await withTransaction(
    mongoose.connection,
    async (session) => {
      const created = (await computedReturnRepository.create(
        {
          engagementYearId: engagement._id,
          program: engagement.program,
          engineVersion: out.engineVersion,
          fields: out.fields.map((f) => ({
            line: f.line,
            value: f.value,
            provenance: f.provenance,
          })),
          totals: { totalOwing: out.obligation.totalOwing },
          ...(frozenFilingInput !== undefined ? { filingInput: frozenFilingInput } : {}),
          identity: frozenIdentity,
          ...(out.schedulePayloads ? { schedulePayloads: out.schedulePayloads } : {}),
          ...(out.issues && out.issues.length > 0 ? { issues: out.issues } : {}),
          // Fileable only when a T2 was computed from the server-assembled structured
          // return (calc + filing derive from ONE source). AT1 always fileable.
          fileable: engagement.program !== 'T2' || structuredReturn !== null,
          // Reproducibility record (T2 emits a snapshot; AT1 does not yet).
          ...(out.snapshot
            ? {
                inputHash: out.snapshot.inputHash,
                resultHash: out.snapshot.resultHash,
                rateTableVersion: out.snapshot.rateTableVersion,
                formVersion: out.snapshot.formVersion,
                snapshot: out.snapshot,
              }
            : {}),
          organizationId: params.orgId,
          createdBy: params.userId,
        },
        { session },
      )) as WithId<ComputedReturnDocument>;

      await appendFact(
        {
          engagementYearId: engagement._id,
          orgId: params.orgId,
          actor: out.fact.actor,
          type: out.fact.type,
          provenance: out.fact.provenance,
          reason: out.fact.reason,
          payload: out.fact.payload,
        },
        session,
      );

      // NB: do NOT persist `params.input` as `returnInput` — that is the flat,
      // engine-shaped assembly, whereas `returnInput` holds the schedule-structured
      // working return (saved via `save-input`) that the editor + review read.
      await engagementYearRepository.update(
        String(engagement._id),
        { status: 'in_progress', engineVersion: out.engineVersion },
        { session },
      );
      return created;
    },
    { allowFallback: true },
  );

  // Auto-generate the cited review flags off the fresh computed return, so the
  // review queue is always current. Never fatal to compute — a review-generation
  // hiccup must not roll back a valid computation.
  try {
    await runReview({
      engagementId: String(engagement._id),
      orgId: params.orgId,
      userId: params.userId,
    });
  } catch {
    // best-effort; the standalone generate-review action can retry
  }

  return { obligation: out.obligation, computedReturnId: String(computed._id) };
}
