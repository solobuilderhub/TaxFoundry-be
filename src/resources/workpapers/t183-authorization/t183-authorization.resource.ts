/**
 * T183Authorization resource — read-only listing of officer e-file authorizations.
 *
 * Authorizations are CREATED via the engagement-year `authorize-t183` action (so
 * they bind to the current computed return); this resource exposes org-scoped
 * read/list for the workpapers view + MCP. Immutable evidence — no update/delete.
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import T183Authorization, { type T183AuthorizationDocument } from './t183-authorization.model.js';
import t183AuthorizationRepository from './t183-authorization.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'computedReturnId'],
});

const t183AuthorizationResource = defineResource<T183AuthorizationDocument>({
  name: 't183-authorization',
  displayName: 'T183 Authorizations',
  prefix: '/t183-authorizations',
  adapter: createAdapter(T183Authorization, t183AuthorizationRepository),
  queryParser,
  presets: [flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
      recordedBy: { systemManaged: true },
    },
  },
});

export default t183AuthorizationResource;
