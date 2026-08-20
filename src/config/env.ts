/**
 * Environment Loader
 *
 * MUST be imported FIRST before any other imports.
 * Loads .env files based on NODE_ENV with Next.js-style priority:
 *
 *   .env.local        (always loaded first — gitignored, machine-specific overrides)
 *   .env.{environment} (e.g., .env.production, .env.dev, .env.test)
 *   .env              (fallback defaults)
 *
 * Supports both long-form (production, development, test) and
 * short-form (prod, dev, test) env file names.
 *
 * Usage:
 *   import '#config/env.js';  // First line of entry point
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

type EnvName = 'prod' | 'dev' | 'test';
const ENV_ALIASES: Record<EnvName, string> = {
  prod: 'production',
  dev: 'development',
  test: 'test',
};

function normalizeEnv(env: string | undefined): EnvName {
  const raw = (env || '').toLowerCase();
  if (raw === 'production' || raw === 'prod') return 'prod';
  if (raw === 'test' || raw === 'qa') return 'test';
  return 'dev';
}

const env = normalizeEnv(process.env.NODE_ENV);
const longForm = ENV_ALIASES[env];

// Priority: .env.local → .env.{long} → .env.{short} → .env
// Same convention as Next.js — .env.local always wins, never committed to git
const candidates = ['.env.local', `.env.${longForm}`, `.env.${env}`, '.env'].map((f) =>
  resolve(process.cwd(), f),
);

const loaded: string[] = [];
for (const file of candidates) {
  if (existsSync(file)) {
    // override: false means earlier files take priority (first loaded wins)
    dotenv.config({ path: file, override: false });
    loaded.push(file.split(/[\\/]/).pop() ?? file);
  }
}

// Only log in development (silent in production/test)
if (env === 'dev' && loaded.length > 0) {
  console.log(`env: ${loaded.join(' + ')}`);
} else if (loaded.length === 0) {
  console.warn('No .env file found — using process environment only');
}

export const ENV = env;
