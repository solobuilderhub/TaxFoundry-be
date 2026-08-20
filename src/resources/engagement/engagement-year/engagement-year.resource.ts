/**
 * EngagementYear resource — org-scoped CRUD + the `compute` action.
 *
 * `compute` runs the federal T2 engine and persists the result (see
 * ../../../engine/engagement-compute.service.ts). As an arc ACTION it inherits
 * the pipeline (auth, envelope, audit) AND auto-generates an MCP tool
 * (`compute_engagement-year`) — so the agent layer can trigger a compute too.
 * Invoked via POST /engagement-years/:id/action { "action": "compute", ... }.
 */
import { defineResource } from '@classytic/arc';
import { getOrgId, getUserId } from '@classytic/arc/scope';
import { QueryParser } from '@classytic/mongokit';
import { createError } from '@classytic/repo-core/errors';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions, requireOrgManager } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import { autoFillEngagement } from '../../../afr/afr.service.js';
import { prepareAt1NetFile } from '../../../engine/at1-netfile.service.js';
import {
  computeEngagementT2,
  verifyEngagementReproducible,
} from '../../../engine/engagement-compute.service.js';
import { prepareCo17 } from '../../../filing/co17-return.service.js';
import { prepareT2Cif } from '../../../filing/t2-cif.service.js';
import { recordT183Authorization } from '../../../filing/t183-authorization.service.js';
import { transmitReturn } from '../../../filing/transmit-dispatcher.js';
import { runReview } from '../../../review/review-generator.service.js';
import EngagementYear, { type EngagementYearDocument } from './engagement-year.model.js';
import engagementYearRepository from './engagement-year.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['program', 'status', 'clientId', 'firstReturn'],
});

const engagementYearResource = defineResource<EngagementYearDocument>({
  name: 'engagement-year',
  displayName: 'Engagement Years',
  prefix: '/engagement-years',
  adapter: createAdapter(EngagementYear, engagementYearRepository),
  queryParser,
  presets: ['bulk', flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
      // Engine-owned — the app stamps it at compute time, clients never set it.
      engineVersion: { systemManaged: true },
    },
  },

  actionPermissions: requireOrgManager(),
  actions: {
    compute: {
      description: 'Run the federal T2 engine for this engagement and persist the computed return',
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        return computeEngagementT2({ engagementId: id, orgId, userId, input: data });
      },
    },
    'save-input': {
      description: 'Persist the working return input (schedule-editor draft) without computing',
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const returnInput = (data as { returnInput?: unknown }).returnInput ?? data;
        await engagementYearRepository.findOneAndUpdate(
          { _id: id, organizationId: orgId },
          { returnInput },
        );
        return { ok: true };
      },
    },
    'auto-fill': {
      description:
        "Pull the corporation's CRA data (AFR) and pre-fill the working return (fills blanks only)",
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        const programAccount = (data as { programAccount?: string })?.programAccount;
        return autoFillEngagement({
          engagementId: id,
          orgId,
          userId,
          ...(programAccount ? { programAccount } : {}),
        });
      },
    },
    'verify-reproducible': {
      description:
        'Recompute the latest return from its stored snapshot and confirm it reproduces (reproducibility check)',
      handler: async (id, _data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        return verifyEngagementReproducible({ engagementId: id, orgId });
      },
    },
    'generate-review': {
      description: 'Generate the cited red/amber/green review flags for the latest computed return',
      handler: async (id, _data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        return runReview({ engagementId: id, orgId, userId });
      },
    },
    'authorize-t183': {
      description:
        "Record the corporate officer's T183 e-file authorization, bound to the current computed return",
      /**
       * NOT agent-callable. CRA requires *"an authorized signing officer of the
       * corporation"* to sign the T183CORP before transmission, and the officer
       * certifies they have examined the return. An automated key recording that
       * is asserting something only a natural person can truthfully assert — the
       * officer is an officer of the CLIENT corporation, never the software.
       */
      mcp: false,
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        const d = (data ?? {}) as {
          officerName?: string;
          officerPosition?: string;
          signedAt?: string;
          authorizationMethod?: string;
          evidenceRef?: string;
          formVersion?: string;
        };
        return recordT183Authorization({
          engagementId: id,
          orgId,
          userId,
          officerName: String(d.officerName ?? ''),
          officerPosition: String(d.officerPosition ?? ''),
          // Passed through even when absent, so the service refuses rather than
          // the spread quietly omitting them and a default filling the gap.
          signedAt: String(d.signedAt ?? ''),
          authorizationMethod: d.authorizationMethod as never,
          ...(d.evidenceRef ? { evidenceRef: d.evidenceRef } : {}),
          ...(d.formVersion ? { formVersion: d.formVersion } : {}),
        });
      },
    },
    'prepare-cif': {
      description: 'Render the federal T2 CIF payload for review (does not transmit)',
      handler: async (id, _data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        return prepareT2Cif({ engagementId: id, orgId });
      },
    },
    'prepare-co17': {
      description: 'Render the Québec CO-17 draft/preview payload (does not transmit)',
      handler: async (id, _data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        return prepareCo17({ engagementId: id, orgId });
      },
    },
    'prepare-netfile': {
      description: 'Render the Alberta AT1 Net File payload for review (does not transmit)',
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const cert = (data.certification ?? {}) as {
          firstName?: string;
          lastName?: string;
          position?: string;
        };
        return prepareAt1NetFile({
          engagementId: id,
          orgId,
          certification: {
            firstName: cert.firstName ?? '',
            lastName: cert.lastName ?? '',
            position: cert.position ?? '',
          },
        });
      },
    },
    transmit: {
      description:
        'Transmit the return (T2→CIF, AT1→Net File), gated on a signed-off review, and record the filing',
      /**
       * NOT agent-callable. The one irreversible act in the system: it files a
       * statutory return in the corporation's name. Everything upstream is
       * recoverable — a wrong figure is recomputed, a draft re-rendered — and
       * this is not. A person presses send.
       */
      mcp: false,
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        const cert = (data.certification ?? {}) as {
          firstName?: string;
          lastName?: string;
          position?: string;
        };
        return transmitReturn({
          engagementId: id,
          orgId,
          userId,
          certification: {
            firstName: cert.firstName ?? '',
            lastName: cert.lastName ?? '',
            position: cert.position ?? '',
          },
        });
      },
    },
  },
});

export default engagementYearResource;
