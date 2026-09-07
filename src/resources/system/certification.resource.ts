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
import { isAt1FilingGatewayConfigured } from '../../filing/at1-gateway.js';
import { isCo17FilingGatewayConfigured } from '../../filing/co17-gateway.js';
import { isT2CifGatewayConfigured } from '../../filing/t2-cif-gateway.js';

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
    {
      method: 'GET',
      path: '/filing-channels',
      operation: 'filingChannelAvailability',
      summary: 'Which filing channels THIS deployment can actually transmit on',
      permissions: requireOrgStaff(),
      mcp: { annotations: { readOnlyHint: true } },
      /**
       * Reported rather than hard-coded in the interface.
       *
       * The export screen announced "live e-file isn't enabled yet" for every
       * program, on a build whose AT1 transmission reaches TRA and returns real
       * response codes. Whether a channel is live is a property of the running
       * deployment's configuration — the browser cannot know it, and guessing it
       * in copy produced a screen that contradicted its own button.
       */
      handler: async () => ({
        data: {
          T2: { transmit: isT2CifGatewayConfigured(), authority: 'CRA', channel: 'CIF' },
          AT1: {
            transmit: isAt1FilingGatewayConfigured(),
            authority: 'Alberta TRA',
            channel: 'Net File',
          },
          CO17: {
            transmit: isCo17FilingGatewayConfigured(),
            authority: 'Revenu Québec',
            channel: 'CO-17',
          },
        },
      }),
    },
  ],
});

export default certificationResource;
