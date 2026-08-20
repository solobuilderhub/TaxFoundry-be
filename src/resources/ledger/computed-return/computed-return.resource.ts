/**
 * ComputedReturn resource — immutable snapshot cache.
 * crud allow-list: list/get/create/delete but NO update (recompute, don't edit).
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { denyAll, requireOrgManager, requireOrgStaff } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import ComputedReturn, { type ComputedReturnDocument } from './computed-return.model.js';
import computedReturnRepository from './computed-return.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'program', 'engineVersion'],
});

const computedReturnResource = defineResource<ComputedReturnDocument>({
  name: 'computed-return',
  displayName: 'Computed Returns',
  prefix: '/computed-returns',
  adapter: createAdapter(ComputedReturn, computedReturnRepository),
  queryParser,
  presets: [flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  // A computed return is a snapshot: create a new one, discard old ones — never edit.
  crud: { list: true, get: true, create: true, update: false, delete: true },
  permissions: {
    list: requireOrgStaff(),
    get: requireOrgStaff(),
    create: requireOrgStaff(),
    update: denyAll(),
    delete: requireOrgManager(),
  },
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
    },
  },
});

export default computedReturnResource;
