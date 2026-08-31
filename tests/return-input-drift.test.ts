/**
 * `apps/web`'s `_lib/return-input.ts` is GENERATED from this repo's
 * `ReturnInput` Zod contract (`src/engine/contracts/`) — see
 * `scripts/emit-return-input.ts` and `src/engine/contracts/return-input.ts`'s
 * own header comment for why. Same arrangement as `packages/ca-tax`'s
 * `forms-ui-drift.test.ts`: a fresh emit is compared byte-for-byte against
 * the checked-in file, so an edit to the contract without regenerating
 * fails CI instead of silently drifting.
 *
 *   npx tsx scripts/emit-return-input.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emitReturnInput } from '../scripts/emit-return-input.js';

const CHECKED_IN = new URL(
  '../../web/app/dashboard/engagements/[id]/return/_lib/return-input.ts',
  import.meta.url,
);

describe('apps/web return-input.ts is in step with the ReturnInput contract', () => {
  it('matches a fresh emit exactly', async () => {
    const onDisk = readFileSync(CHECKED_IN, 'utf8');
    const fresh = await emitReturnInput();
    expect(
      onDisk,
      'apps/web _lib/return-input.ts is stale — run `npx tsx scripts/emit-return-input.ts` from apps/server',
    ).toBe(fresh);
  });

  it('carries every top-level schedule key the registry expects', async () => {
    const fresh = await emitReturnInput();
    for (const key of [
      'identification',
      'cca',
      'alberta',
      'albertaResourceDeductions15',
      'quebec',
    ]) {
      expect(fresh).toContain(`${key}?:`);
    }
  });

  it('emits type aliases, not interfaces — Control<T> assignability depends on it', async () => {
    const fresh = await emitReturnInput();
    expect(fresh).not.toContain('export interface ');
    expect(fresh).toContain('export type ReturnInput = {');
  });

  it('does not leak the runtime .passthrough() as an index signature on ReturnInput', async () => {
    const fresh = await emitReturnInput();
    const returnInputBlock = fresh.slice(
      fresh.indexOf('export type ReturnInput = {'),
      fresh.indexOf('};', fresh.indexOf('export type ReturnInput = {')),
    );
    expect(returnInputBlock).not.toContain('[k: string]:');
  });

  it('carries the runtime RESERVE_TYPES / AT1_DISPOSITION_CATEGORIES / n() exports', async () => {
    const fresh = await emitReturnInput();
    expect(fresh).toContain('export const RESERVE_TYPES = ');
    expect(fresh).toContain('export const AT1_DISPOSITION_CATEGORIES = ');
    expect(fresh).toContain('export const n = ');
  });
});
