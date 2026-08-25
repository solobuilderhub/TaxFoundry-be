/**
 * Better Auth Configuration
 *
 * Built on `@spinekit/auth`'s `defineAuth(shape).bind(runtime)` — the ONE
 * ecosystem standard for `@classytic/arc` hosts (bearer + admin + organization
 * plugins, mongo stubs, session/rate-limit/trusted-origin defaults), the same
 * as `brihot/apps/server`. Better Auth still OWNS its tables (user, session,
 * account, verification, organization, member, invitation); arc reads them as
 * resources via `@classytic/mongokit/better-auth`'s overlay without
 * re-implementing CRUD.
 *
 * ── What moved off this file ────────────────────────────────────────────────
 *
 * The hand-rolled `betterAuth({...})` call (bearer, apiKey, organization
 * options, `registerBetterAuthStubs`) is gone — `defineAuth` assembles all of
 * that from `shape` + `runtime` below. `apiKey()` — this deployment's ONE
 * host-specific plugin (long-lived, per-org keys for MCP/CLI automation) —
 * is passed through `shape.plugins`.
 *
 * ── What did NOT move ────────────────────────────────────────────────────────
 *
 * `mcp({ loginPage })` is dropped, not migrated. Better Auth 1.7 moved it to a
 * separate `@better-auth/mcp` package that requires a `jwt()` plugin, a
 * consent page, and RFC 9728 resource metadata — real new infrastructure this
 * deployment does not have. It is safe to drop: the actual MCP connection (see
 * `apps/web/.../integrations`) authenticates with the `apiKey()` plugin's
 * bearer tokens, never with OAuth login — `mcp()` was unused scaffolding from
 * the arc CLI generator. Re-add it as its own piece of work if interactive
 * OAuth login for MCP clients (rather than a pasted key) is ever wanted.
 *
 * `organization({ teams: { enabled: true } })` is also dropped — grepping the
 * app for `teamId` / `useListTeams` turns up nothing, so this was dead
 * configuration, not a used feature.
 *
 * @see https://www.better-auth.com/docs
 * @see https://www.npmjs.com/package/@spinekit/auth
 */

import { apiKey } from '@better-auth/api-key';
import { defineAuth } from '@spinekit/auth';
import mongoose from 'mongoose';
import config from '#config/index.js';
import { authEmail } from './auth-email.js';

// `defineAuth` describes the shape once; `.bind(runtime)` needs no re-describing.
const authBlueprint = defineAuth({
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  plugins: [
    // Long-lived, per-org API keys for MCP / CLI automation. Stored hashed;
    // each key is created with metadata.orgId so a call scopes to ONE org
    // without an extra header. Endpoints under /api/auth/api-key/*.
    apiKey({
      defaultPrefix: 'txf_',
      requireName: true,
      enableMetadata: true,
      keyExpiration: { defaultExpiresIn: null }, // never expire unless opted in
      startingCharactersConfig: { shouldStore: true, charactersLength: 12 },
    }),
  ],
});

// `defineAuth().bind()` produces a typed instance, but the `mcp`-adjacent
// plugin surface still leaks un-nameable option types at the export boundary
// (same reason brihot holds its instance loosely) — the concrete `.bind()`
// call above stays the source of truth for behaviour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any = null;

/**
 * Get the Better Auth instance (lazy singleton)
 *
 * Must be called AFTER database connection is established.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAuth(): any {
  if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is required in production (min 32 chars)');
  }

  if (!_auth) {
    _auth = authBlueprint.bind({
      mongoose,
      secret: config.betterAuth.secret,
      baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${config.server.port}`,
      frontendUrl: config.frontend.url,
      corsOrigins: config.cors.origins,
      email: authEmail,
      mode: {
        isDevelopment: config.isDev,
        isProduction: config.isProd,
        isTest: process.env.NODE_ENV === 'test',
      },
    });
  }

  return _auth;
}

export default getAuth;
