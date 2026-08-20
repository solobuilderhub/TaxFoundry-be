/**
 * ReviewMemo resource — org-scoped CRUD + the `sign-off` action.
 *
 * Mutable: flags get resolved, then a reviewer signs off. The `sign-off` action
 * (POST /:id/action { "action": "sign-off" }) gates on no unresolved red flags,
 * stamps the signer, and writes a ReviewSignedOff fact — the gate `transmitAt1`
 * checks before filing. As an arc action it auto-generates the MCP tool.
 */
import { defineResource } from '@classytic/arc';
import { getOrgId, getUserId } from '@classytic/arc/scope';
import { QueryParser } from '@classytic/mongokit';
import { createError } from '@classytic/repo-core/errors';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions, requireOrgManager } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import { resolveReviewFlag } from '../../../review/review-generator.service.js';
import { signOffReviewMemo } from '../../../review/review-signoff.service.js';
import ReviewMemo, { type ReviewMemoDocument } from './review-memo.model.js';
import reviewMemoRepository from './review-memo.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'status', 'computedReturnId'],
});

const reviewMemoResource = defineResource<ReviewMemoDocument>({
  name: 'review-memo',
  displayName: 'Review Memos',
  prefix: '/review-memos',
  adapter: createAdapter(ReviewMemo, reviewMemoRepository),
  queryParser,
  presets: ['bulk', flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
    },
  },

  actionPermissions: requireOrgManager(),
  actions: {
    'sign-off': {
      description:
        'Sign off the review memo (blocked by unresolved red flags); records ReviewSignedOff',
      /**
       * NOT agent-callable. Sign-off is the control the provenance guard leans
       * on for everything it cannot itself check — GIFI, the questionnaire, the
       * Alberta jacket answers and every other untagged filing input (see
       * `provenance-guard.ts`). If the actor that produced those values can also
       * approve them, the control certifies nothing.
       */
      mcp: false,
      handler: async (id, _data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        return signOffReviewMemo({ memoId: id, orgId, userId });
      },
    },
    'resolve-flag': {
      description: 'Mark a review flag (by code) resolved, so a red flag no longer blocks sign-off',
      /**
       * NOT agent-callable, for the same reason as sign-off. Resolving a flag is
       * not fixing a problem — it is JUDGING that the problem does not matter,
       * and it directly unlocks sign-off. An agent's legitimate route is to
       * correct the underlying input and recompute, which regenerates the review
       * honestly rather than silencing it.
       */
      mcp: false,
      handler: async (id, data, req) => {
        const orgId = getOrgId(req.scope);
        if (!orgId) throw createError(403, 'Organization context required');
        const userId = getUserId(req.scope) ?? 'engine';
        const code = String((data as { code?: string }).code ?? '');
        if (!code) throw createError(400, 'code is required');
        return resolveReviewFlag({ memoId: id, orgId, userId, code });
      },
    },
  },
});

export default reviewMemoResource;
