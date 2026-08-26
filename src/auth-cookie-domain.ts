/**
 * Cross-subdomain session cookies.
 *
 * The web app and this API are served from different hosts on one registrable
 * domain (`taxfoundry.ca` and `be.taxfoundry.ca`). Better Auth only puts a
 * `Domain` attribute on its cookies when `advanced.crossSubDomainCookies` is
 * enabled — see `createCookieGetter` in `better-auth/cookies`, where `domain`
 * is spread in only `...crossSubdomainEnabled ? { domain } : {}`. Without it
 * every session cookie is HOST-ONLY, so a cookie set by `be.taxfoundry.ca` is
 * never sent to `taxfoundry.ca`.
 *
 * That failure is invisible at the point it happens. Sign-in returns 200 with
 * a token and a user, and the next request — the web app's server-side session
 * guard, which reads the cookie header off the incoming request — sees nothing
 * and redirects to /sign-in. The request succeeded; the cookie was the problem.
 *
 * ── Why a plugin ────────────────────────────────────────────────────────────
 *
 * `@spinekit/auth`'s `defineAuth` hardcodes its options literal to
 * `advanced: { database: { generateId } }` and neither `AuthShape` nor
 * `AuthRuntime` exposes a passthrough (true in both 0.5.0 and 0.6.0), so the
 * flag cannot be set through the shape or the runtime. `shape.plugins` is the
 * one extension point it forwards verbatim to Better Auth.
 *
 * Flipping the option is necessary but NOT sufficient. `create-context.mjs`
 * computes `authCookies` at construction, and `runPluginInit` runs afterwards,
 * so by the time a plugin is consulted the cookie getters already exist with
 * no `Domain`. `runPluginInit` does two things this relies on: it deep-merges
 * `result.options` into `context.options` (via `defu`, which fills the missing
 * `crossSubDomainCookies` key while preserving `advanced.database.generateId`),
 * and it `Object.assign`s `result.context` straight onto the context. So this
 * returns BOTH — the flag, for the code that reads it later (notably
 * `resolveRequestContext`), and freshly computed getters, for the cookies
 * actually emitted. Returning only one of the two leaves them disagreeing.
 *
 * ── When to use it ──────────────────────────────────────────────────────────
 *
 * Only when the hosts genuinely differ. For a single-host deployment or local
 * dev, host-only cookies are correct, and a `Domain` the browser cannot match
 * fails closed in the worst way — it drops the cookie and nobody can sign in.
 * `COOKIE_DOMAIN` is validated against both hosts in src/config/index.ts so a
 * mismatch fails at boot rather than at the login form.
 */

import type { BetterAuthOptions } from 'better-auth';
import { createCookieGetter, getCookies } from 'better-auth/cookies';

type AuthPlugins = NonNullable<BetterAuthOptions['plugins']>;
type AuthPlugin = AuthPlugins[number];

/**
 * Better Auth plugin that scopes session cookies to a shared parent domain.
 *
 * @param domain Parent domain to set, e.g. `.taxfoundry.ca`.
 */
export function crossSubDomainCookies(domain: string): AuthPlugin {
  const crossSubDomainCookies = { enabled: true, domain };

  return {
    id: 'cross-subdomain-cookies',
    init(ctx) {
      // The options Better Auth *would* have been built with. Cookie names and
      // attributes are derived from `baseURL` + `advanced`, so recomputing from
      // this merged view yields exactly what the option would have produced had
      // defineAuth let us pass it in the first place.
      const merged = {
        ...ctx.options,
        advanced: { ...ctx.options.advanced, crossSubDomainCookies },
      } satisfies BetterAuthOptions;

      return {
        options: { advanced: { crossSubDomainCookies } },
        context: {
          authCookies: getCookies(merged),
          createAuthCookie: createCookieGetter(merged),
        },
      };
    },
  } satisfies AuthPlugin;
}
