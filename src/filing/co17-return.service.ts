/**
 * Compose the reviewed Québec CO-17 filing DATA from the frozen computed return,
 * and render a DRAFT preview. Mirrors the T2 split: composition is separate from
 * rendering; only an RQ-certified serializer may produce a fileable payload.
 */
import { createHash } from 'node:crypto';
import { type Co17ReturnData, renderCo17DraftReturn } from '@classytic/ca-tax/t2';
import { createError } from '@classytic/repo-core/errors';
import { co17SoftwareCode } from '#config/co17-transmitter.js';
import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { WithId } from '#shared/db.js';

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ''));
const nn = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export interface ComposeCo17Params {
  engagementId: string;
  orgId: string;
  certification?: { firstName: string; lastName: string; position: string };
  forFiling?: boolean;
}

/** Compose the CO-17 filing data from the frozen computed return. */
export async function composeCo17FilingData(params: ComposeCo17Params): Promise<Co17ReturnData> {
  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'CO17')
    throw createError(400, 'CO-17 preparation applies to CO17 engagements');

  const client = (await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  })) as {
    name?: string;
    businessNumber?: string;
    quebecId?: string;
    address?: Record<string, unknown>;
  } | null;

  const computed = await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  );
  if (!computed) throw createError(409, 'No computed return yet — run compute first');

  const fields = computed.fields as { line: string; value: unknown }[];
  const v = (line: string): number => {
    const f = fields.find((x) => x.line === line);
    return f ? Number(f.value) : 0;
  };

  // Identity from the FROZEN snapshot. The fallback to the live client record is
  // a DRAFT-ONLY concession for returns computed before freezing existed — on the
  // filing path it would let an edit made after review reach the wire.
  const frozen = (computed as { identity?: Record<string, unknown> }).identity;
  const frozenAddr = (frozen?.address ??
    (params.forFiling ? {} : (client?.address ?? {}))) as Record<string, unknown>;

  const frozenFilingInput = (computed as { filingInput?: unknown }).filingInput;
  if (params.forFiling && frozenFilingInput === undefined) {
    throw createError(
      422,
      'This computed return predates filing-input freezing, so the filed content ' +
        'cannot be proven to match what was computed and reviewed. Recompute the ' +
        'return before filing.',
    );
  }
  const ri = (frozenFilingInput ?? engagement.returnInput ?? {}) as {
    payments?: { instalmentsPaid?: number };
    identification?: { quebecId?: string };
  };

  const quebecTaxPayable = v('quebecTaxPayable');
  const instalmentsPaid = nn(ri.payments?.instalmentsPaid);
  const net = quebecTaxPayable - instalmentsPaid;

  const data: Co17ReturnData = {
    identity: {
      softwareCode: co17SoftwareCode,
      legalName: String(frozen?.legalName ?? client?.name ?? ''),
      businessNumber: String(frozen?.businessNumber ?? client?.businessNumber ?? ''),
      ...(ri.identification?.quebecId || client?.quebecId
        ? { quebecId: String(ri.identification?.quebecId ?? client?.quebecId) }
        : {}),
      address: {
        ...(frozenAddr.line1 ? { line1: String(frozenAddr.line1) } : {}),
        ...(frozenAddr.city ? { city: String(frozenAddr.city) } : {}),
        province: 'QC',
        ...(frozenAddr.postalCode ? { postalCode: String(frozenAddr.postalCode) } : {}),
      },
      taxYearStart: String(frozen?.taxYearStart ?? iso(engagement.taxYearStart)),
      taxYearEnd: String(frozen?.taxYearEnd ?? iso(engagement.taxYearEnd)),
    },
    allocationFactor: v('allocationFactor'),
    quebecTaxableIncome: v('quebecTaxableIncome'),
    quebecSbdIncome: v('quebecSbdIncome'),
    taxAtSmallBusinessRate: v('quebecTaxAtSmallBusinessRate'),
    taxAtGeneralRate: v('quebecTaxAtGeneralRate'),
    quebecTaxPayable,
    instalmentsPaid,
    balanceOwing: Math.max(0, net),
    overpaymentRefund: Math.max(0, -net),
    ...(params.certification ? { certification: params.certification } : {}),
  };
  return data;
}

export interface PrepareCo17Result {
  payloadHash: string;
  xml: string;
}

/** Render the DRAFT/PREVIEW CO-17 (structural, not certified) — never transmitted. */
export async function prepareCo17(params: ComposeCo17Params): Promise<PrepareCo17Result> {
  const data = await composeCo17FilingData(params);
  const xml = renderCo17DraftReturn(data, { forFiling: Boolean(params.forFiling) });
  const payloadHash = createHash('sha256').update(xml).digest('hex');
  return { payloadHash, xml };
}
