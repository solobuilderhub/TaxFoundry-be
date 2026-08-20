/**
 * Shared Utilities
 *
 * Central exports for resource definitions.
 * Import from here for clean, consistent code.
 */

// Core Arc exports
export { defineResource } from '@classytic/arc';
export { createMongooseAdapter } from '@classytic/mongokit/adapter';
// Adapter factory
export { createAdapter } from './adapter.js';

// Permission helpers (core + application-level)
export * from './permissions.js';

// Presets
export * from './presets/index.js';
