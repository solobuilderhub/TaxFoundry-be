/**
 * Proposal resource — org-scoped CRUD. Mutable: proposals move pending →
 * accepted/rejected/superseded. A resolve action (POST /:id/action) that writes
 * the corresponding fact-log entry is added in Phase 4 (agent layer).
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import Proposal, { type ProposalDocument } from './proposal.model.js';
import proposalRepository from './proposal.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'kind', 'status', 'source'],
});

const proposalResource = defineResource<ProposalDocument>({
  name: 'proposal',
  displayName: 'Proposals',
  prefix: '/proposals',
  adapter: createAdapter(Proposal, proposalRepository),
  queryParser,
  presets: ['bulk', flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
    },
  },
});

export default proposalResource;
