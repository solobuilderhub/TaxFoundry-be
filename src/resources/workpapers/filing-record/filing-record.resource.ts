/**
 * FilingRecord resource — create + read + ack-update, but NEVER delete.
 *
 * crud drops the delete route (regulatory retention). Update is allowed ONLY so
 * the acknowledgement can be recorded; the transmitted payload is frozen via
 * immutableAfterCreate field rules — you cannot rewrite what was filed.
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { denyAll, requireOrgManager, requireOrgStaff } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import FilingRecord, { type FilingRecordDocument } from './filing-record.model.js';
import filingRecordRepository from './filing-record.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'program', 'channel', 'status'],
});

const filingRecordResource = defineResource<FilingRecordDocument>({
  name: 'filing-record',
  displayName: 'Filing Records',
  prefix: '/filing-records',
  adapter: createAdapter(FilingRecord, filingRecordRepository),
  queryParser,
  presets: [flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  // No delete — a filing is a regulatory act with 6-year+ retention.
  crud: { list: true, get: true, create: true, update: true, delete: false },
  permissions: {
    list: requireOrgStaff(),
    get: requireOrgStaff(),
    create: requireOrgManager(),
    update: requireOrgManager(),
    delete: denyAll(),
  },
  schemaOptions: {
    fieldRules: {
      createdBy: { systemManaged: true },
      // The transmitted payload is frozen — only the ack fields may change.
      program: { immutableAfterCreate: true },
      channel: { immutableAfterCreate: true },
      payloadHash: { immutableAfterCreate: true },
      submittedAt: { immutableAfterCreate: true },
      computedReturnId: { immutableAfterCreate: true },
    },
  },
});

export default filingRecordResource;
