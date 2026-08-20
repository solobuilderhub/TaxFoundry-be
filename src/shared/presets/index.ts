/**
 * Arc Presets - Multi-Tenant Configuration
 *
 * Pre-configured presets for multi-tenant applications.
 * Includes both strict and flexible tenant isolation options.
 */

import {
  multiTenantPreset,
  ownedByUserPreset,
  slugLookupPreset,
  softDeletePreset,
} from '@classytic/arc/presets';

// Flexible preset for mixed public/private routes
export { flexibleMultiTenantPreset } from './flexible-multi-tenant.js';

/**
 * Organization-scoped preset (STRICT)
 * Always requires auth, always filters by organizationId.
 * Use for admin-only resources.
 */
export const orgScoped = multiTenantPreset({
  tenantField: 'organizationId',
});

/**
 * Owned by creator preset
 * Filters queries by createdBy field.
 */
export const ownedByCreator = ownedByUserPreset({
  ownerField: 'createdBy',
});

/**
 * Owned by user preset
 * For resources where userId references the owner.
 */
export const ownedByUser = ownedByUserPreset({
  ownerField: 'userId',
});

/**
 * Soft delete preset
 * Adds deletedAt filtering and restore endpoint.
 */
export const softDelete = softDeletePreset();

/**
 * Slug lookup preset
 * Enables GET by slug in addition to ID.
 */
export const slugLookup = slugLookupPreset();

// Export all presets
export const presets = {
  orgScoped,
  ownedByCreator,
  ownedByUser,
  softDelete,
  slugLookup,
} as const;

export default presets;
