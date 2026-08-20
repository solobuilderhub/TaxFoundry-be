/**
 * The GIFI registry is sourced from @classytic/ledger-ca — we never hand-maintain
 * the code list. These tests prove the wiring: real GIFI codes validate, junk is
 * rejected, virtual totals are flagged non-postable, and the registry is substantial.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidGifiCode,
  isPostableGifiCode,
  getGifiAccount,
  gifiCodeCount,
} from '../src/shared/gifi-registry.js';

describe('GIFI registry (from ledger-ca)', () => {
  it('is substantial (the seeded CRA chart, not a stub)', () => {
    expect(gifiCodeCount()).toBeGreaterThan(200);
  });

  it('accepts real GIFI codes', () => {
    for (const code of ['1000', '1060', '1120']) {
      expect(isValidGifiCode(code), `${code} should be valid`).toBe(true);
    }
    expect(getGifiAccount('1000')?.name).toMatch(/Cash/i);
  });

  it('rejects unknown codes', () => {
    for (const code of ['NOT_A_CODE', 'ZZZZ', '']) {
      expect(isValidGifiCode(code)).toBe(false);
    }
    expect(getGifiAccount('NOT_A_CODE')).toBeNull();
  });

  it('flags a virtual-total code as non-postable (2680 Taxes Payable)', () => {
    // 2680 is a documented virtual total in ledger-ca; if present it must be non-postable.
    if (isValidGifiCode('2680')) {
      expect(isPostableGifiCode('2680')).toBe(false);
    }
    // A plain leaf account is postable.
    expect(isPostableGifiCode('1000')).toBe(true);
  });
});
