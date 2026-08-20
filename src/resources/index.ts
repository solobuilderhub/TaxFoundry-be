/**
 * Resources Registry — grouped by domain.
 *
 * Central array passed to `createApp({ resources })` in app.ts; each is mounted
 * under the resourcePrefix (/api). Auth is Better Auth at /api/auth/*.
 *
 *   engagement/  — client, engagement-year (+ the `compute` action)
 *   ledger/      — fact-log (append-only), proposal, computed-return
 *   workpapers/  — gifi-mapping, review-memo, filing-record
 */
import { clientResource, engagementYearResource } from './engagement/index.js';
import { computedReturnResource, factLogResource, proposalResource } from './ledger/index.js';
import certificationResource from './system/certification.resource.js';
import gifiResource from './system/gifi.resource.js';
import {
  filingRecordResource,
  gifiMappingResource,
  reviewMemoResource,
  submissionAttemptResource,
  t183AuthorizationResource,
} from './workpapers/index.js';

export const resources = [
  clientResource,
  engagementYearResource,
  factLogResource,
  proposalResource,
  computedReturnResource,
  gifiMappingResource,
  reviewMemoResource,
  filingRecordResource,
  t183AuthorizationResource,
  submissionAttemptResource,
  certificationResource,
  gifiResource,
] as const;
