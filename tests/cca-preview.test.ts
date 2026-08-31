/**
 * `previewCcaClasses` — the authoritative live-preview endpoint that replaced
 * `apps/web`'s hand-written `ccaClassPreview` re-implementation of the same
 * calculation. Confirms it calls the REAL engine (matching a known
 * `computeCcaClass` result), and fails a row closed to `null` rather than
 * throwing or silently returning a wrong number.
 */
import { describe, expect, it } from 'vitest';
import { previewCcaClasses } from '../src/engine/cca-preview.service.js';

describe('previewCcaClasses', () => {
  it('previews a class 8 addition using the real declining-balance engine calc', () => {
    const [result] = previewCcaClasses({
      taxYearEnd: new Date('2024-12-31'),
      classes: [{ ccaClass: '8', openingUCC: 100_000, additions: 20_000 }],
    });
    expect(result).not.toBeNull();
    expect(result!.rate).toBe(0.2);
    // Half-year rule on the addition: base = 100_000 + 20_000*0.5 = 110_000; 20% = 22_000.
    expect(result!.ccaClaimed).toBe(22_000);
    expect(result!.closingUCC).toBe(120_000 - 22_000);
  });

  it('caps the claim at an explicit discretionary amount', () => {
    const [result] = previewCcaClasses({
      classes: [{ ccaClass: '8', openingUCC: 100_000, claim: 5_000 }],
    });
    expect(result!.ccaClaimed).toBe(5_000);
  });

  it('previews class 13/14 as a straight opening-balance drawdown, no rate', () => {
    const [result] = previewCcaClasses({
      classes: [{ ccaClass: '13', openingUCC: 50_000 }],
    });
    expect(result!.rate).toBe(0);
    expect(result!.ccaClaimed).toBe(50_000);
  });

  it('returns null, not a thrown error, for a class 13/14 row with a current-year addition', () => {
    const [result] = previewCcaClasses({
      classes: [{ ccaClass: '13', openingUCC: 50_000, additions: 10_000 }],
    });
    expect(result).toBeNull();
  });

  it('returns null for an unrecognized class code rather than a wrong number', () => {
    const [result] = previewCcaClasses({
      classes: [{ ccaClass: 'not-a-class', openingUCC: 1_000 }],
    });
    expect(result).toBeNull();
  });

  it('returns null for a blank class code (an empty schedule-editor row)', () => {
    const [result] = previewCcaClasses({
      classes: [{ ccaClass: '', openingUCC: 0 }],
    });
    expect(result).toBeNull();
  });

  it('previews every row in one call, preserving order', () => {
    const results = previewCcaClasses({
      classes: [
        { ccaClass: '8', openingUCC: 100_000 },
        { ccaClass: 'bogus', openingUCC: 1 },
        { ccaClass: '10', openingUCC: 50_000 },
      ],
    });
    expect(results).toHaveLength(3);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
    expect(results[2]).not.toBeNull();
  });
});
