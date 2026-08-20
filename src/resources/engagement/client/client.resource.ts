/**
 * Client resource — org-scoped CRUD for taxpayer corporations.
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import Client, { type ClientDocument } from './client.model.js';
import clientRepository from './client.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['businessNumber', 'jurisdiction', 'corpType'],
});

const clientResource = defineResource<ClientDocument>({
  name: 'client',
  displayName: 'Clients',
  prefix: '/clients',
  adapter: createAdapter(Client, clientRepository),
  queryParser,
  presets: ['bulk', flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
    },
  },
});

export default clientResource;
