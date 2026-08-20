/**
 * Certification-readiness resource — a service resource (no CRUD, no model): it
 * exposes the T2 conformance battery from `@classytic/ca-tax` so the app can
 * render a live "are we ready to certify?" report.
 *
 * The battery is a pure engine self-test (CRA-style fictional corporations with
 * known-correct expected lines), so this route is org-agnostic and read-only —
 * any authenticated org member can pull it. It is HONEST by construction: the
 * summary stays `certificationReady: false` until the expected values are
 * CRA-official (see the harness), so the UI can never overstate our status.
 *
 *   GET /api/certification/t2/readiness → ConformanceSummary
 */
import { defineResource } from '@classytic/arc';
import {
  formatConformanceReport,
  runConformanceSuite,
  T2_CERTIFICATION_FIXTURES,
} from '@classytic/ca-tax/t2';
import { requireOrgStaff } from '#shared/permissions.js';

const certificationResource = defineResource({
  name: 'certification',
  displayName: 'Certification Readiness',
  prefix: '/certification',
  disableDefaultRoutes: true,
  routes: [
    {
      method: 'GET',
      path: '/t2/readiness',
      operation: 't2CertificationReadiness',
      summary: 'T2 engine certification-readiness conformance report',
      permissions: requireOrgStaff(),
      mcp: { annotations: { readOnlyHint: true } },
      handler: async () => {
        const summary = runConformanceSuite(T2_CERTIFICATION_FIXTURES);
        return {
          data: {
            ...summary,
            report: formatConformanceReport(summary),
          },
        };
      },
    },
  ],
});

export default certificationResource;
