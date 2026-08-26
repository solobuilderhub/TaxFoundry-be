/**
 * Cookie scope is an auth control, and its failure mode is the nastiest kind:
 * completely silent. A session cookie the browser drops looks exactly like a
 * successful login — sign-in returns 200 with a token, then the very next
 * request has no session and the app bounces to the login page. Nothing logs an
 * error, on either side.
 *
 * So these tests pin the observable thing: the `Set-Cookie` header Better Auth
 * actually emits, and the boot check that refuses a cookie domain no browser
 * would accept. A real Better Auth instance over the memory adapter is used
 * rather than a stub, because the whole bug lived in Better Auth's internal
 * ordering — cookies are computed before plugins init — and a stub would have
 * happily reported success.
 */
import { randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import { crossSubDomainCookies } from '../src/auth-cookie-domain.js';
import { EnvSchema } from '../src/config/index.js';

const API_URL = 'https://be.taxfoundry.ca';

/** Sign up against a throwaway instance and return its Set-Cookie headers. */
async function signUpCookies(plugins: Parameters<typeof betterAuth>[0]['plugins']) {
  const auth = betterAuth({
    baseURL: API_URL,
    secret: 'test-secret-that-is-comfortably-over-32-chars',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    // Mirrors the literal @spinekit/auth hardcodes, so the defu merge in
    // runPluginInit is exercised the same way it is in production.
    advanced: { database: { generateId: () => randomBytes(12).toString('hex') } },
    plugins,
  });

  const res = (await auth.api.signUpEmail({
    body: { email: 'preparer@taxfoundry.ca', password: 'a-good-enough-password', name: 'Preparer' },
    asResponse: true,
  })) as Response;

  expect(res.status).toBe(200);
  const cookies = res.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  return cookies;
}

const sessionCookie = (cookies: string[]) => {
  const c = cookies.find((v) => v.includes('session_token'));
  if (!c) throw new Error(`no session_token cookie in: ${cookies.join(' | ')}`);
  return c;
};

describe('cross-subdomain session cookies', () => {
  it('emits a host-only cookie without the plugin — the production bug', async () => {
    const cookie = sessionCookie(await signUpCookies([]));
    // No Domain attribute => host-only on be.taxfoundry.ca => never sent to
    // taxfoundry.ca, so the web app's server-side session guard sees nothing.
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('scopes the cookie to the shared parent domain with the plugin', async () => {
    const cookie = sessionCookie(await signUpCookies([crossSubDomainCookies('.taxfoundry.ca')]));
    expect(cookie).toMatch(/Domain=\.taxfoundry\.ca/i);
  });

  it('keeps the security attributes it had before', async () => {
    const cookie = sessionCookie(await signUpCookies([crossSubDomainCookies('.taxfoundry.ca')]));
    // Widening scope must not quietly relax anything else: an https baseURL
    // still means a __Secure- prefixed, Secure, HttpOnly, SameSite=Lax cookie.
    expect(cookie).toContain('__Secure-');
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('still issues a usable session — the cookie is scoped, not broken', async () => {
    // Guards the defu merge: `advanced.crossSubDomainCookies` must be filled in
    // WITHOUT dropping `advanced.database.generateId`, or ids stop being 24-hex
    // and the mongo adapter rejects every insert.
    const cookies = await signUpCookies([crossSubDomainCookies('.taxfoundry.ca')]);
    const token = sessionCookie(cookies).split('=')[1]?.split(';')[0];
    expect(token).toBeTruthy();
  });
});

describe('COOKIE_DOMAIN boot guard', () => {
  const base = {
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: 'a-real-production-secret-well-over-32-chars',
    BETTER_AUTH_URL: API_URL,
    FRONTEND_URL: 'https://taxfoundry.ca',
  };
  const messages = (env: Record<string, string>) => {
    const r = EnvSchema.safeParse(env);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts a domain that is a parent of both hosts', () => {
    expect(messages({ ...base, COOKIE_DOMAIN: '.taxfoundry.ca' })).toEqual([]);
  });

  it('refuses a domain that covers neither host', () => {
    const msgs = messages({ ...base, COOKIE_DOMAIN: '.example.com' });
    expect(msgs.join('\n')).toMatch(/not a parent of/);
  });

  it('refuses a domain that covers the API but not the web app', () => {
    // `.be.taxfoundry.ca` is a plausible typo and would lock out every user.
    const msgs = messages({ ...base, COOKIE_DOMAIN: '.be.taxfoundry.ca' });
    expect(msgs.join('\n')).toMatch(/FRONTEND_URL/);
  });

  it('refuses split hosts with no COOKIE_DOMAIN — the deploy that broke prod', () => {
    const msgs = messages(base);
    expect(msgs.join('\n')).toMatch(/different hosts/);
  });

  it('allows a single-host deployment to omit it', () => {
    expect(messages({ ...base, BETTER_AUTH_URL: 'https://taxfoundry.ca' })).toEqual([]);
  });

  it('allows local dev, where COOKIE_DOMAIN is blank and hosts are both localhost', () => {
    expect(
      messages({
        NODE_ENV: 'development',
        BETTER_AUTH_SECRET: 'dev-secret-change-in-production-min-32-chars',
        BETTER_AUTH_URL: 'http://localhost:8040',
        FRONTEND_URL: 'http://localhost:3042',
        COOKIE_DOMAIN: '',
      }),
    ).toEqual([]);
  });
});
