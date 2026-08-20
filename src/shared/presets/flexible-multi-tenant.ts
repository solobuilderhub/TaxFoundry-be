/**
 * Flexible Multi-Tenant Preset
 *
 * Thin wrapper around arc's built-in 'multiTenantPreset' with public reads:
 *
 * - list/get WITHOUT org context → allowed through unfiltered (public data)
 * - org context present → rows filtered + stamped to the caller's org
 * - elevated (platform admin) → unfiltered, cross-tenant
 * - create/update fail closed without org context, and update overwrites any
 *   client-supplied tenant field (no cross-tenant document hops)
 *
 * The built-in preset also registers 'systemManaged' field rules for the
 * tenant field, so generated request schemas never demand it in the body —
 * the server stamps it from the caller's scope instead. Don't hand-roll
 * tenant middleware: without those field rules Fastify's validation rejects
 * creates before injection can run.
 *
 * Want members-only reads? Drop 'allowPublic' below, or use
 * 'multiTenantPreset({ tenantField })' directly on the resource.
 */

import { multiTenantPreset } from '@classytic/arc/presets/tenant';

interface FlexibleMultiTenantOptions {
  tenantField?: string;
}

export function flexibleMultiTenantPreset(options: FlexibleMultiTenantOptions = {}) {
  const { tenantField = 'organizationId' } = options;
  return multiTenantPreset({ tenantField, allowPublic: ['list', 'get'] });
}

export default flexibleMultiTenantPreset;
