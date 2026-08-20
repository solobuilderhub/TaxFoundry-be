/**
 * SubmissionAttempt resource — read-only listing of transmission attempts, for
 * reconciling unknown outcomes (query by status/engagement). Attempts are
 * created/updated by the transmit services, not via CRUD.
 */
import { defineResource } from '@classytic/arc';
import { QueryParser } from '@classytic/mongokit';
import { createAdapter } from '#shared/adapter.js';
import { orgStaffPermissions } from '#shared/permissions.js';
import { flexibleMultiTenantPreset } from '#shared/presets/flexible-multi-tenant.js';
import SubmissionAttempt, { type SubmissionAttemptDocument } from './submission-attempt.model.js';
import submissionAttemptRepository from './submission-attempt.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['engagementYearId', 'computedReturnId', 'status', 'program'],
});

const submissionAttemptResource = defineResource<SubmissionAttemptDocument>({
  name: 'submission-attempt',
  displayName: 'Submission Attempts',
  prefix: '/submission-attempts',
  adapter: createAdapter(SubmissionAttempt, submissionAttemptRepository),
  queryParser,
  presets: [flexibleMultiTenantPreset({ tenantField: 'organizationId' })],
  permissions: orgStaffPermissions,
  schemaOptions: { fieldRules: { createdBy: { systemManaged: true } } },
});

export default submissionAttemptResource;
