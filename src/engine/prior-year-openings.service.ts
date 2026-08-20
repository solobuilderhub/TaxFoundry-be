/**
 * Prior-year opening balances — the multi-year continuity glue.
 *
 * Loss pools and RDTOH balances carry forward: a year's CLOSING balance is the
 * next year's OPENING. Rather than trust the client to supply (and get right)
 * last year's numbers, the host resolves them AUTHORITATIVELY from the prior
 * tax-year engagement's own computed return, and injects them at compute time.
 *
 * A preparer can still override — an explicit opening entered on the return wins
 * over the auto-linked value (see `applyPriorOpenings`), which matters for a
 * first engagement onboarded mid-history where no prior return exists in-system.
 */

import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { ComputedReturnDocument } from '#resources/ledger/computed-return/computed-return.model.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { WithId } from '#shared/db.js';

export interface PriorYearOpenings {
  openingNonCapitalLoss?: number;
  openingNetCapitalLoss?: number;
  openingErdtoh?: number;
  openingNerdtoh?: number;
  /** Prior-year closing GRIP → this year's opening GRIP (Schedule 53). */
  openingGrip?: number;
  /** Prior-year closing non-refundable SR&ED ITC pool → this year's opening (Schedule 31). */
  openingItcPool?: number;
  /** Prior-year closing donation pool → this year's opening (Schedule 2, 5-yr carryforward). */
  openingDonationPool?: number;
  /** Prior-year unused business FTC → this year's opening (Schedule 21, 10-yr carryforward). */
  openingBusinessFtcPool?: number;
  /** Prior-year closing UCC by CCA class → this year's opening UCC. */
  ccaOpeningUCC?: Record<string, number>;
}

/**
 * The closing balances of the same client's immediately-preceding tax year
 * (same program), as this year's opening pools. `{}` when there is no in-system
 * prior return.
 */
export async function resolvePriorYearOpenings(params: {
  engagement: WithId<EngagementYearDocument>;
  orgId: string;
}): Promise<PriorYearOpenings> {
  const { engagement, orgId } = params;

  const prior = (await engagementYearRepository.getOne(
    {
      clientId: engagement.clientId,
      program: engagement.program,
      organizationId: orgId,
      taxYearEnd: { $lt: engagement.taxYearStart },
    },
    { sort: { taxYearEnd: -1 } },
  )) as WithId<EngagementYearDocument> | null;
  if (!prior) return {};

  const computed = (await computedReturnRepository.getOne(
    { engagementYearId: prior._id, organizationId: orgId },
    { sort: { createdAt: -1 } },
  )) as WithId<ComputedReturnDocument> | null;
  if (!computed) return {};

  const fields = (computed.fields ?? []) as { line: string; value: unknown }[];
  const get = (line: string): number | undefined => {
    const f = fields.find((x) => x.line === line);
    return f ? Number(f.value) : undefined;
  };

  const openings: PriorYearOpenings = {};
  // Scalar closing→opening lines (per-class CCA is handled separately below).
  const map: Record<string, string> = {
    openingNonCapitalLoss: 'nonCapitalLossClosing',
    openingNetCapitalLoss: 'netCapitalLossClosing',
    openingErdtoh: 'erdtohClosing',
    openingNerdtoh: 'nerdtohClosing',
    openingGrip: 'gripClosing',
    openingItcPool: 'itcPoolClosing',
    openingDonationPool: 'donationPoolClosing',
    openingBusinessFtcPool: 'businessFtcPoolClosing',
  };
  for (const [openKey, closeLine] of Object.entries(map)) {
    const v = get(closeLine);
    if (v != null && Number.isFinite(v)) (openings as Record<string, number>)[openKey] = v;
  }

  // Per-class CCA closing UCC → opening UCC. Field lines look like "ccaClosingUCC:8".
  const ccaOpeningUCC: Record<string, number> = {};
  for (const f of fields) {
    if (typeof f.line === 'string' && f.line.startsWith('ccaClosingUCC:')) {
      const cls = f.line.slice('ccaClosingUCC:'.length);
      const v = Number(f.value);
      if (cls && Number.isFinite(v)) ccaOpeningUCC[cls] = v;
    }
  }
  if (Object.keys(ccaOpeningUCC).length > 0) openings.ccaOpeningUCC = ccaOpeningUCC;

  return openings;
}

/**
 * Fill an engine input's opening balances from `priors`, but only where the
 * input didn't already carry a non-zero explicit opening (preparer override
 * wins). Returns a new object; non-object input is passed through.
 */
export function applyPriorOpenings(input: unknown, priors: PriorYearOpenings): unknown {
  if (!input || typeof input !== 'object') return input;
  const merged = { ...(input as Record<string, unknown>) };
  const { ccaOpeningUCC, ...scalarOpenings } = priors;

  // Scalar opening balances (losses / RDTOH) — fill where the form left 0.
  for (const [k, v] of Object.entries(scalarOpenings)) {
    const cur = merged[k];
    if (v != null && (cur == null || cur === 0)) merged[k] = v;
  }

  // Per-class CCA opening UCC — fill each class's openingUCC where blank, keyed
  // by CCA class, so the prior year's closing pool rolls forward automatically.
  if (ccaOpeningUCC && Array.isArray(merged.ccaClasses)) {
    merged.ccaClasses = (merged.ccaClasses as Array<Record<string, unknown>>).map((c) => {
      const cls = String(c.ccaClass ?? '');
      const prior = ccaOpeningUCC[cls];
      const cur = c.openingUCC;
      return prior != null && (cur == null || cur === 0) ? { ...c, openingUCC: prior } : c;
    });
  }

  return merged;
}
