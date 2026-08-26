/**
 * Application Configuration
 *
 * Environment variables are validated with Zod at startup. A missing or
 * malformed var fails fast here with a clear message — instead of surfacing
 * as a confusing runtime error on the first request. ENV files are loaded
 * by config/env.ts (imported first in the entry points).
 */

import { z } from 'zod';

// Normalize NODE_ENV to the three canonical values the rest of the app
// reasons about (matches the env loader's prod/dev/test aliasing).
const NodeEnv = z.preprocess(
  (v) => {
    const s = String(v ?? '').toLowerCase();
    if (s === 'prod' || s === 'production') return 'production';
    if (s === 'test' || s === 'qa') return 'test';
    return 'development';
  },
  z.enum(['development', 'production', 'test']),
);

/**
 * Exported so the boot-time guards can be exercised directly in tests — this
 * module `process.exit(1)`s on a bad environment, which is right for a server
 * and useless for a test runner.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: NodeEnv,
    PORT: z.coerce.number().int().positive().default(8040),
    HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
      .default('dev-secret-change-in-production-min-32-chars'),
    BETTER_AUTH_URL: z.string().url().optional(),
    // Shared parent domain for the session cookie, e.g. `.example.com`. Only
    // needed when the web app and this API are on different hosts — see the
    // header comment in src/auth-cookie-domain.ts. Empty/unset = host-only.
    COOKIE_DOMAIN: z.string().optional(),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/server'),
    ORG_HEADER: z.string().default('x-organization-id'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.BETTER_AUTH_SECRET.startsWith('dev-secret')) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message:
          'Set a strong BETTER_AUTH_SECRET in production — the bundled dev default is not allowed.',
      });
    }

    // Cookie scope. A session cookie the browser silently drops looks exactly
    // like a successful login that never sticks: sign-in returns 200, then the
    // web app's server-side guard sees no cookie and bounces to /sign-in. Both
    // ways of getting it wrong are caught here so a deploy fails at boot with
    // the reason, instead of shipping an app nobody can log into.
    const hostOf = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      try {
        return new URL(url).hostname;
      } catch {
        return undefined;
      }
    };
    const apiHost = hostOf(env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`);
    const webHost = hostOf(env.FRONTEND_URL);
    const cookieDomain = env.COOKIE_DOMAIN?.trim();

    if (cookieDomain) {
      // A Domain attribute only works for hosts at or under that domain.
      const bare = cookieDomain.replace(/^\./, '');
      const covers = (host: string) => host === bare || host.endsWith(`.${bare}`);
      for (const [name, host] of [
        ['BETTER_AUTH_URL', apiHost],
        ['FRONTEND_URL', webHost],
      ] as const) {
        if (host && !covers(host)) {
          ctx.addIssue({
            code: 'custom',
            path: ['COOKIE_DOMAIN'],
            message:
              `COOKIE_DOMAIN=${cookieDomain} is not a parent of ${name}'s host (${host}), so the ` +
              'browser will reject every session cookie and no one will be able to sign in. Set it ' +
              'to the domain both hosts share, or leave it unset for a single-host deployment ' +
              '(including local dev, where host-only cookies are what you want).',
          });
        }
      }
    } else if (apiHost && webHost && apiHost !== webHost) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_DOMAIN'],
        message:
          `FRONTEND_URL (${webHost}) and BETTER_AUTH_URL (${apiHost}) are different hosts, so ` +
          "Better Auth's host-only session cookie will never be sent to the web app: sign-in " +
          'succeeds and then every page bounces back to /sign-in. Set COOKIE_DOMAIN to the ' +
          'registrable domain they share (e.g. .example.com). If they share no parent domain the ' +
          'cookie cannot be shared at all — serve both from one origin instead.',
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${lines}`);
  process.exit(1);
}

const env = parsed.data;

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  isDev: boolean;
  isProd: boolean;
  server: {
    port: number;
    host: string;
  };
  betterAuth: {
    secret: string;
    /** Absolute public URL of this API. Undefined = derive a localhost URL. */
    url?: string;
    /** Shared parent domain for session cookies. Undefined = host-only. */
    cookieDomain?: string;
  };
  frontend: {
    url: string;
  };
  cors: {
    origins: string[] | boolean; // true = allow all ('*')
    methods: string[];
    allowedHeaders: string[];
    credentials: boolean;
  };
  database: {
    uri: string;
  };
  org: {
    header: string;
  };
}

const config: AppConfig = {
  env: env.NODE_ENV,
  isDev: env.NODE_ENV !== 'production',
  isProd: env.NODE_ENV === 'production',

  server: {
    port: env.PORT,
    host: env.HOST,
  },

  betterAuth: {
    secret: env.BETTER_AUTH_SECRET,
    ...(env.BETTER_AUTH_URL ? { url: env.BETTER_AUTH_URL } : {}),
    // Normalise '' → absent so `COOKIE_DOMAIN=` in a .env.local reads as
    // "host-only", the same as omitting it.
    ...(env.COOKIE_DOMAIN?.trim() ? { cookieDomain: env.COOKIE_DOMAIN.trim() } : {}),
  },

  frontend: {
    url: env.FRONTEND_URL,
  },

  cors: {
    // '*' = allow all origins (true), otherwise comma-separated list
    origins: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-request-id'],
    credentials: true,
  },

  database: {
    uri: env.MONGODB_URI,
  },

  org: {
    header: env.ORG_HEADER,
  },
};

export default config;
