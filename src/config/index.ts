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

const EnvSchema = z
  .object({
    NODE_ENV: NodeEnv,
    PORT: z.coerce.number().int().positive().default(8040),
    HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
      .default('dev-secret-change-in-production-min-32-chars'),
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
