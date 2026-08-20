/**
 * App Plugins Registry
 *
 * Register your app-specific plugins here.
 * Dependencies are passed explicitly (no shims, no magic).
 */

import { openApiPlugin, scalarPlugin } from '@classytic/arc/docs';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/index.js';

/**
 * Register all app-specific plugins
 *
 * @param app - Fastify instance
 * @param deps - Explicit dependencies (config, services, etc.)
 */
export async function registerPlugins(
  app: FastifyInstance,
  _deps: { config: AppConfig },
): Promise<void> {
  // NOTE: the error handler (CastError → 400, validation → 422, duplicate → 409)
  // is registered by `createApp` itself (registerErrorHandler, on by default,
  // preset-aware includeStack + module error mappers). Registering it again here
  // — as the arc init scaffold does — double-binds the scope and trips Fastify's
  // FSTWRN004 "overriding errorHandler" warning. So we don't. Pass
  // `errorHandler: {…}` to createApp to customise it. Docs, by contrast, are NOT
  // auto-wired by createApp — they're the intended host opt-in below.

  // API Documentation (Scalar UI)
  // OpenAPI spec: /_docs/openapi.json
  // Scalar UI: /docs
  await app.register(openApiPlugin, {
    title: 'server API',
    version: '1.0.0',
    description: 'API documentation for server',
    apiPrefix: '/api',
  });
  await app.register(scalarPlugin, {
    routePrefix: '/docs',
    theme: 'default',
  });

  // Add your custom plugins here:
  // await app.register(myCustomPlugin, { ...options });
}
