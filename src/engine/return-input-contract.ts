/**
 * Re-exports the `ReturnInput` contract and every nested slice/row type for
 * the AT1 composers in this directory (`assemble-at1-schedules.ts` and its
 * `at1-schedule-composers/*` siblings), which import from this file rather
 * than `./contracts/index.js` directly.
 *
 * This USED TO BE the type definitions themselves — a ~1600-line hand
 * mirror of `apps/web`'s `_lib/return-input.ts`, kept in sync by hand with
 * no drift protection (its own header comment said so explicitly). It is
 * now a thin re-export: `./contracts/return-input.ts` (composing
 * `./contracts/{common,t2-input,at1-input,co17-input}.ts`) is the
 * authoritative Zod contract — see that file's own header comment for why
 * this repo, not `apps/web`, is now the source of truth. `apps/web`'s
 * `_lib/return-input.ts` is GENERATED from the same contract
 * (`scripts/emit-return-input.ts`, checked by `tests/return-input-drift.test.ts`),
 * so both sides derive from ONE definition instead of two hand-kept mirrors.
 *
 * `return-input-validation.ts` is the runtime (Zod) half of the same fix —
 * it validates untrusted HTTP input against `ReturnInputSchema` directly.
 */
export type {
  ReturnInput,
} from './contracts/return-input.js';
export * from './contracts/common.js';
export * from './contracts/t2-input.js';
export * from './contracts/at1-input.js';
export * from './contracts/co17-input.js';
