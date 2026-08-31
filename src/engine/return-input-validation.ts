/**
 * Runtime (Zod) half of the `ReturnInput` contract — the other half of the
 * fix `return-input-contract.ts`'s own header comment describes: a TYPE
 * catches a mistake in code written against it at COMPILE TIME, but says
 * nothing about what a live HTTP request body actually contains. A
 * preparer's browser (or a direct API caller) can post any JSON shape at
 * all, and this is what stands between that JSON and `engagement.returnInput`.
 *
 * `ReturnInputSchema` (from `./contracts/return-input.js`) is now FULL
 * field-level validation — every slice, every nested row, every field's
 * real type — not a shape-only check. This used to be a deliberately
 * shallower "is each slice a plain object" check to avoid hand-duplicating
 * ~1500 lines of field-by-field Zod on top of the already-hand-duplicated
 * TS type; now that the SAME schema also drives `apps/web`'s generated
 * `_lib/return-input.ts` (see `scripts/emit-return-input.ts`), there is
 * only one definition to keep in sync, so the fuller validation is free.
 *
 * Unrecognized top-level keys are still ALLOWED THROUGH (`.passthrough()`,
 * set on `ReturnInputSchema` itself) — apps/web and apps/server are
 * independent repos that deploy separately, so a new schedule key rolled
 * out on web before server catches up must not 400 every save until server
 * redeploys.
 */
import { ReturnInputSchema } from './contracts/return-input.js';

export { ReturnInputSchema };

/**
 * Validate an untrusted HTTP payload against the `ReturnInput` contract.
 * Throws a `z.ZodError` (its `.message` is a readable, per-field report) on
 * a malformed shape — callers at the HTTP boundary should catch this and
 * map it to a 400, the same way every other validated input in this app
 * fails closed. Returns the PARSED object (Zod strips nothing this schema
 * doesn't explicitly know about beyond enforcing the field types — see
 * `.passthrough()` above), so callers can keep passing it around as
 * `ReturnInput` afterward.
 */
export function assertReturnInputShape(input: unknown): Record<string, unknown> {
  return ReturnInputSchema.parse(input);
}
