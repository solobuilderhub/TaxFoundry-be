/**
 * FactLog resource — APPEND-ONLY.
 *
 * `crud` allow-lists list/get/create and OMITS update/delete → those routes are
 * never mounted. permissions additionally denyAll() on update/delete as
 * defense-in-depth. This is the structural enforcement of the append-only ledger.
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { denyAll, requireOrgStaff } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import FactLog, { type FactLogDocument } from './fact-log.model.js';
import factLogRepository from './fact-log.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'type', 'provenance', 'actor'],
});

const factLogResource = defineResource<FactLogDocument>({
  name: 'fact-log',
  displayName: 'Fact Log',
  prefix: '/fact-logs',
  adapter: createAdapter(FactLog, factLogRepository),
  queryParser,
  // NO 'softDelete' preset — the log is append-only, nothing is ever removed.
  presets: [flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  // Only read + append. update/delete routes are never created.
  crud: { list: true, get: true, create: true, update: false, delete: false },
  permissions: {
    list: requireOrgStaff(),
    get: requireOrgStaff(),
    create: requireOrgStaff(),
    update: denyAll(),
    delete: denyAll(),
  },
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
    },
  },
});

export default factLogResource;
