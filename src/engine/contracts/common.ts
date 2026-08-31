/**
 * Cross-cutting primitives every tax-area contract shares.
 *
 * See `return-input.ts` in this directory for how these contracts compose
 * into the full `ReturnInput` schema, and its header comment for why this
 * directory — not `apps/web` — is now the authoritative source.
 */
import { z } from 'zod';

/**
 * An explicitly answered yes/no.
 *
 * Absent means UNANSWERED, which is not "No". TRA encodes No as the value
 * `2` — a positive answer the corporation gives — so a switch, which is off
 * until touched, would answer every question "No" on its behalf. These
 * render as radios with no preselection for exactly that reason.
 */
export const YesNo = z
  .enum(['yes', 'no'])
  .meta({ id: 'YesNo' })
  .describe(
    'An explicitly answered yes/no. Absent means UNANSWERED, which is not "No" — TRA encodes ' +
      'No as the value `2`, a positive answer the corporation gives, so a switch (off until ' +
      'touched) would answer every question "No" on its behalf. These render as radios with ' +
      'no preselection for exactly that reason.',
  );

/**
 * A same-named TS type per exported schema — the standard Zod pattern
 * (`export const X = z.object(...); export type X = z.infer<typeof X>;`,
 * exactly how `class Foo {}` is both a value and a type under the same
 * name). Composers in `../` import these as TYPES to destructure against;
 * the schema objects themselves are for `return-input-validation.ts` and
 * the `emit-return-input.ts` generator only.
 */
export type YesNo = z.infer<typeof YesNo>;
