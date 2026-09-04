/**
 * Prepare the Alberta AT1 RSI paper print text for review.
 *
 * The RSI is the other AT1 filing format alongside Net File (spec §3.2.1) —
 * a fixed-layout text document, certified separately from the XML Net File
 * payload but built from the SAME `At1FilingData`/`At1ScheduleData` this app
 * already assembles for it (`composeAt1FilingData` in `at1-netfile.service.ts`).
 * This module only reformats that same data through the RSI's own rules
 * (`@classytic/ca-tax/t2`'s `renderAt1Rsi` + `toRsi*` adapters) — no new
 * business arithmetic.
 */
import {
  At1CriticalFieldMissingError,
  At1MandatoryFieldMissingError,
  type At1ScheduleData,
  assertAt1MandatoryComplete,
  assertCriticalFields,
  renderAt1Rsi,
  RsiLineItemError,
  toRsiHeader,
  toRsiJacketSchedules,
  toRsiSchedule,
} from '@classytic/ca-tax/t2';
import { createError } from '@classytic/repo-core/errors';
import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { WithId } from '#shared/db.js';
import { assertValidAmendmentTarget, type Certification, composeAt1FilingData } from './at1-netfile.service.js';

export interface PrepareAt1RsiParams {
  engagementId: string;
  orgId: string;
  certification: Certification;
  /** Same meaning as `PrepareAt1Params.forFiling` in `at1-netfile.service.ts`. */
  forFiling?: boolean;
}

export interface PrepareAt1RsiResult {
  text: string;
}

/**
 * Mirrors `prepareAt1NetFile` exactly up to the point the payload is built —
 * same engagement/client/amendment/computed-return loading, same
 * frozen-input and mandatory-completeness gates — then renders RSI text
 * instead of XML. Reuses `composeAt1FilingData` (already pure and tested)
 * rather than re-deriving `At1FilingData` a second way.
 */
export async function prepareAt1Rsi(params: PrepareAt1RsiParams): Promise<PrepareAt1RsiResult> {
  const { certification } = params;
  if (!certification?.firstName || !certification?.lastName || !certification?.position) {
    throw createError(400, 'certification { firstName, lastName, position } is required');
  }

  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'AT1')
    throw createError(400, 'RSI preparation applies to AT1 engagements');

  const client = await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  });
  if (!client) throw createError(404, 'Client not found');

  let amendment: { description: string } | undefined;
  const amends = (engagement as { amendsEngagementYearId?: unknown }).amendsEngagementYearId;
  if (amends) {
    const target = (await engagementYearRepository.getOne({
      _id: amends,
      organizationId: params.orgId,
    })) as WithId<EngagementYearDocument> | null;
    assertValidAmendmentTarget(engagement, target);
    amendment = {
      description: String(
        (engagement as { amendmentDescription?: string }).amendmentDescription ?? '',
      ).trim(),
    };
  }

  const computed = await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  );
  if (!computed) throw createError(409, 'No computed return yet — run compute first');

  if (params.forFiling && (computed as { filingInput?: unknown }).filingInput === undefined) {
    throw createError(
      422,
      'This computed return predates filing-input freezing, so the printed content ' +
        'cannot be proven to match what was computed and reviewed. Recompute the ' +
        'return before printing.',
    );
  }

  const data = composeAt1FilingData({
    computed: computed as unknown as Parameters<typeof composeAt1FilingData>[0]['computed'],
    client: client as unknown as Parameters<typeof composeAt1FilingData>[0]['client'],
    engagement: engagement as unknown as Parameters<typeof composeAt1FilingData>[0]['engagement'],
    certification,
    ...(amendment ? { amendment } : {}),
    ...(params.forFiling ? { forFiling: true } : {}),
  });

  const schedulePayloads =
    (computed as { schedulePayloads?: At1ScheduleData[] }).schedulePayloads ?? [];

  if (params.forFiling) {
    try {
      assertAt1MandatoryComplete(data);
    } catch (err) {
      if (err instanceof At1MandatoryFieldMissingError) throw createError(422, err.message);
      throw err;
    }
  }

  let text: string;
  try {
    // Spec §3.2.1.2: "It should not be possible to print the AT1 RSI if
    // mandatory Field IDs are not completed" — the same critical-field gate
    // Net File enforces, checked explicitly here since `renderAt1Rsi` (the
    // shared paper-format renderer) has no Net-File-specific knowledge of it.
    assertCriticalFields(data);
    const [jacket, edi] = toRsiJacketSchedules(data);
    text = renderAt1Rsi(toRsiHeader(data), [
      jacket!,
      ...schedulePayloads.map(toRsiSchedule),
      edi!,
    ]);
  } catch (err) {
    if (err instanceof At1CriticalFieldMissingError) throw createError(422, err.message);
    if (err instanceof RsiLineItemError) throw createError(422, err.message);
    throw err;
  }
  return { text };
}
