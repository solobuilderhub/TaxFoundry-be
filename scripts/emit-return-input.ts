/**
 * Emit `apps/web`'s `_lib/return-input.ts` from this repo's `ReturnInput`
 * Zod contract (`src/engine/contracts/`).
 *
 * `apps/server/src/engine/contracts/return-input.ts` is now the
 * authoritative data contract — see that file's own header comment for why.
 * `apps/web` deliberately does not depend on this package or on Zod at
 * runtime, so this script converts the Zod schema to plain TypeScript
 * (via `z.toJSONSchema` + `json-schema-to-typescript`) and writes a
 * dependency-free `.ts` file into that repo — the same arrangement
 * `packages/ca-tax/scripts/emit-ui-schedule.ts` already uses for the
 * schedule form schemas.
 *
 *   npx tsx scripts/emit-return-input.ts
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import { z } from 'zod';
import { AT1_DISPOSITION_CATEGORY_VALUES, RESERVE_TYPE_VALUES } from '../src/engine/contracts/t2-input.js';
import { ReturnInputSchema } from '../src/engine/contracts/return-input.js';

const DEST =
  '../../web/app/dashboard/engagements/[id]/return/_lib/return-input.ts';

const HEADER = `/**
 * The working return — the shape persisted on \`engagement.returnInput\`.
 *
 * GENERATED — do not hand-edit. Source of truth:
 * \`apps/server/src/engine/contracts/return-input.ts\` (a Zod schema — also
 * the runtime validator at the HTTP boundary, see that repo's
 * \`return-input-validation.ts\`). Regenerate with, from \`apps/server\`:
 *
 *   npx tsx scripts/emit-return-input.ts
 *
 * A checked drift test in \`apps/server\` (\`tests/return-input-drift.test.ts\`)
 * fails CI if this file and a fresh emit disagree.
 *
 * One optional key per schedule; the key set is pinned to the registry's
 * \`ScheduleKey\` union by a compile-time assertion in \`_config/registry.ts\`.
 */
`;

const TRAILER = `
/** AT1 Schedule 17's reserve kinds — see \`ReserveType\`'s own field for the derivation. */
export const RESERVE_TYPES = ${JSON.stringify(RESERVE_TYPE_VALUES)} as const;

/** AT1 Schedule 18's six category buckets — see \`At1DispositionCategory\`'s own field for the derivation. */
export const AT1_DISPOSITION_CATEGORIES = ${JSON.stringify(AT1_DISPOSITION_CATEGORY_VALUES)} as const;

/** Numeric coercion shared by the calc + engine-mapping layers: blank ⇒ 0. */
export const n = (v: unknown): number =>
\tv == null || v === "" ? 0 : Number(v);
`;

/**
 * Produce the generated file's full text (used by both `main()`, which
 * writes it to `apps/web`, and `tests/return-input-drift.test.ts`, which
 * compares a fresh call against the checked-in file without writing anything).
 */
export async function emitReturnInput(): Promise<string> {
  const jsonSchema = z.toJSONSchema(ReturnInputSchema, {
    target: 'draft-7',
    io: 'output',
  }) as JSONSchema;

  // `ReturnInputSchema.passthrough()` is a RUNTIME concern (the HTTP
  // validator accepts-but-ignores unrecognized top-level keys — see
  // `return-input-validation.ts`'s own comment on why). It must not leak
  // into the generated TYPE as a `[k: string]: unknown` index signature,
  // which would silently accept a typo'd key on `ReturnInput` anywhere in
  // `apps/web` instead of erroring on it.
  delete jsonSchema.additionalProperties;

  const body = await compile(jsonSchema, 'ReturnInput', {
    bannerComment: '',
    additionalProperties: false,
    style: { semi: true, singleQuote: false, useTabs: true },
    $refOptions: { dereference: false },
  });

  // `json-schema-to-typescript` emits `export interface X {`; the original
  // hand-written file used `export type X = {` throughout, and that is not
  // just a style choice — `Control<InterfaceType>` (react-hook-form) is NOT
  // assignable to `Control<Record<string, unknown>>` the way
  // `Control<TypeAliasType>` is, even for two structurally identical object
  // shapes (a real interface-vs-type-alias variance quirk, confirmed against
  // the paper Form View components, which cast a generic `control` prop down
  // to a specific slice's type this way). Converting every top-level
  // generated declaration back to a type alias fixes that AND restores the
  // original convention.
  const asTypeAliases = body
    .replace(/^export interface (\w+) \{/gm, 'export type $1 = {')
    // A `type X = {...}` alias's closing brace wants a semicolon (matching
    // the original file's own style); an `interface`'s never did, which is
    // what `json-schema-to-typescript` assumed. Column-0 `}` is always a
    // top-level declaration's own closer — everything nested is indented.
    .replace(/^\}$/gm, '};');

  return (HEADER + '\n' + asTypeAliases.trimEnd() + '\n' + TRAILER).replace(/\r\n/g, '\n');
}

async function main() {
  const out = await emitReturnInput();
  writeFileSync(new URL(DEST, import.meta.url), out);
  console.log(`ReturnInput: written to ${DEST}`);
}

// Only run when invoked directly (`npx tsx scripts/emit-return-input.ts`),
// not when the drift test imports `emitReturnInput` from this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
