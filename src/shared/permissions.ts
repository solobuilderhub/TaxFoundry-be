/**
 * Permission Helpers
 *
 * Clean, type-safe permission definitions for resources.
 */

import {
  allOf,
  allowPublic,
  anyOf,
  denyAll,
  type PermissionCheck,
  requireAuth,
  requireOwnership,
  requireRoles,
  roles,
  when,
} from '@classytic/arc/permissions';

// Re-export core helpers
export {
  allOf,
  allowPublic,
  anyOf,
  denyAll,
  requireAuth,
  requireOwnership,
  requireRoles,
  roles,
  when,
};

// ============================================================================
// Permission Helpers
// ============================================================================

/**
 * Require any authenticated user
 */
export const requireAuthenticated = (): PermissionCheck =>
  requireRoles(['user', 'admin', 'superadmin']);

/**
 * Require admin or superadmin
 */
export const requireAdmin = (): PermissionCheck => requireRoles(['admin', 'superadmin']);

/**
 * Require superadmin only
 */
export const requireSuperadmin = (): PermissionCheck => requireRoles(['superadmin']);

// ============================================================================
// Better Auth Organization & Team Permission Helpers
// ============================================================================

/**
 * Organization-level guards (per-org member.role):
 *
 * - requireRoles('admin')              — checks BOTH user.role AND org member.role (recommended)
 * - requireOrgRole(['admin','owner'])  — checks member.role in active org ONLY
 * - requireOrgMembership()             — just checks if user is in the org (any role)
 * - requireTeamMembership()            — checks if user is in the active team
 *
 * RECOMMENDED: Use requireRoles() for most cases. Since Arc 2.7.1 it defaults to
 * checking both platform AND org roles, so a single call covers BA org plugin users
 * with platform-admin overrides. Use requireOrgRole() when you ONLY want org-level
 * checks (and want to explicitly exclude platform admins).
 *
 * Platform superadmin automatically bypasses all org role checks.
 *
 * IMPORTANT: When using Better Auth's Access Control (ac) with custom roles,
 * you MUST define ALL roles (owner, admin, member, + any custom) using the
 * same AC instance. BA's built-in defaults won't cover custom statements.
 * Omitting any role causes BA's hasPermission to fail silently for that role.
 *
 * @see multi-org-betterauth boilerplate (src/shared/access-control.ts) for the recommended pattern.
 */
import {
  requireOrgMembership,
  requireOrgRole,
  requireTeamMembership,
} from '@classytic/arc/permissions';

export { requireOrgMembership, requireOrgRole, requireTeamMembership };

/**
 * Require organization owner (checks member.role, not user.role)
 */
export const requireOrgOwner = (): PermissionCheck => requireOrgRole(['owner']);

/**
 * Require organization manager or higher (checks member.role, not user.role)
 */
export const requireOrgManager = (): PermissionCheck =>
  requireOrgRole(['manager', 'admin', 'owner']);

/**
 * Require any organization member (any role)
 */
export const requireOrgStaff = (): PermissionCheck => requireOrgMembership();

// ============================================================================
// Standard Permission Sets
// ============================================================================

/**
 * Public read, authenticated write (default for most resources)
 */
export const publicReadPermissions = {
  list: allowPublic(),
  get: allowPublic(),
  create: requireAuthenticated(),
  update: requireAuthenticated(),
  delete: requireAuthenticated(),
};

/**
 * All operations require authentication
 */
export const authenticatedPermissions = {
  list: requireAuth(),
  get: requireAuth(),
  create: requireAuth(),
  update: requireAuth(),
  delete: requireAuth(),
};

/**
 * Admin only permissions
 */
export const adminPermissions = {
  list: requireAdmin(),
  get: requireAdmin(),
  create: requireSuperadmin(),
  update: requireSuperadmin(),
  delete: requireSuperadmin(),
};

/**
 * Organization staff permissions
 */
export const orgStaffPermissions = {
  list: requireOrgStaff(),
  get: requireOrgStaff(),
  create: requireOrgManager(),
  update: requireOrgManager(),
  delete: requireOrgOwner(),
};

/**
 * Team-scoped permissions (requires active team)
 * Uses Better Auth's team membership — flat groups, no team-level roles.
 */
export const teamScopedPermissions = {
  list: requireTeamMembership(),
  get: requireTeamMembership(),
  create: requireTeamMembership(),
  update: requireTeamMembership(),
  delete: requireOrgOwner(),
};
