/**
 * GifiMapping resource — org-scoped CRUD over the per-client GL→GIFI cache.
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import GifiMapping, { type GifiMappingDocument } from './gifi-mapping.model.js';
import gifiMappingRepository from './gifi-mapping.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['clientId', 'glAccountCode', 'gifiCode', 'source'],
});

const gifiMappingResource = defineResource<GifiMappingDocument>({
  name: 'gifi-mapping',
  displayName: 'GIFI Mappings',
  prefix: '/gifi-mappings',
  adapter: createAdapter(GifiMapping, gifiMappingRepository),
  queryParser,
  presets: ['bulk', flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
    },
  },
});

export default gifiMappingResource;
