/**
 * GIFI registry — the canonical set of valid GIFI / CA-chart codes.
 *
 * We do NOT hand-maintain a GIFI code list. The source of truth is
 * `@classytic/ledger-ca` (`GIFI_ACCOUNT_TYPES` — the seeded CRA chart with
 * 4-digit codes, virtual totals, and sub-accounts). A GL→GIFI mapping may only
 * point at a code this registry knows; the gifi-mapping model enforces that on
 * write, so a bad code never enters the cache.
 */
import { GIFI_ACCOUNT_TYPES } from '@classytic/ledger-ca';

interface GifiAccount {
  code: string;
  name: string;
  category?: string;
  parentCode?: string | null;
  isTotal?: boolean;
  isVirtualTotal?: boolean;
}

const LIST = GIFI_ACCOUNT_TYPES as ReadonlyArray<GifiAccount>;
const BY_CODE: ReadonlyMap<string, GifiAccount> = new Map(LIST.map((a) => [a.code, a]));

/** True if `code` is a known GIFI / CA-chart code from ledger-ca. */
export function isValidGifiCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** The GIFI account for a code, or null. */
export function getGifiAccount(code: string): GifiAccount | null {
  return BY_CODE.get(code) ?? null;
}

/**
 * Virtual totals (e.g. 2680 Taxes Payable) are rollups — you post to their
 * sub-accounts, never to them directly. A GIFI *mapping target* should be a
 * postable account, so callers can reject virtual totals.
 */
export function isPostableGifiCode(code: string): boolean {
  const a = BY_CODE.get(code);
  return !!a && !a.isVirtualTotal;
}

/** Total number of known codes — a registry sanity signal for tests/health. */
export function gifiCodeCount(): number {
  return BY_CODE.size;
}
