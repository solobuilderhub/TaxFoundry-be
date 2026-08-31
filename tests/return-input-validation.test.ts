/**
 * `assertReturnInputShape` — the runtime half of the `ReturnInput` contract.
 * Confirms it does what its own doc comment promises: a shape check on the
 * 34 known schedule slices (object or absent, nothing else), passthrough for
 * anything else, throwing on the malformed shapes that used to reach
 * `assembleT2Input`/the AT1 composers unchecked.
 */
import { describe, expect, it } from 'vitest';
import { assertReturnInputShape } from '../src/engine/return-input-validation.js';

describe('assertReturnInputShape', () => {
  it('accepts a well-shaped return input unchanged', () => {
    const input = {
      identification: { corpType: 'ccpc' },
      cca: { classes: [{ ccaClass: '8', openingUCC: 1000 }] },
      alberta: { grossRevenue: 500 },
    };
    expect(assertReturnInputShape(input)).toEqual(input);
  });

  it('accepts an empty object — every slice is optional', () => {
    expect(assertReturnInputShape({})).toEqual({});
  });

  it('passes unrecognized top-level keys through rather than rejecting them', () => {
    const input = { identification: {}, someNewScheduleNotYetMirrored: { foo: 1 } };
    expect(assertReturnInputShape(input)).toEqual(input);
  });

  it('rejects a slice that is a string instead of an object', () => {
    expect(() => assertReturnInputShape({ cca: 'not an object' })).toThrow();
  });

  it('rejects a slice that is an array instead of an object', () => {
    expect(() => assertReturnInputShape({ alberta: [1, 2, 3] })).toThrow();
  });

  it('rejects a slice that is null', () => {
    expect(() => assertReturnInputShape({ donations: null })).toThrow();
  });

  it('rejects a non-object top-level payload', () => {
    expect(() => assertReturnInputShape('just a string')).toThrow();
    expect(() => assertReturnInputShape(42)).toThrow();
    expect(() => assertReturnInputShape(null)).toThrow();
  });
});
