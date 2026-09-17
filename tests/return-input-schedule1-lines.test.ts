import { describe, expect, it } from 'vitest';
import { ReturnInputSchema } from '../src/engine/contracts/return-input.js';

/**
 * Schedule 1's lines survive the shape the EDITOR actually sends.
 *
 * ── The production failure this exists for ──────────────────────────────────
 *
 * Every `save-input` from a return that had rendered Schedule 1 was rejected:
 *
 *   netIncome.lines: "Invalid input: expected record, received array"
 *
 * The contract stores Schedule 1 keyed by CRA line number — `{ "104": 50000 }`
 * — so a preparer's figures are already in filing shape. The editor names each
 * box for its line to match: `money("lines.101", …)`. But react-hook-form reads
 * a NUMERIC path segment as an ARRAY INDEX, so `lines.101` builds `lines[101]`,
 * and the slice leaves the browser as a sparse array 419 long (one past line
 * 418, the highest on the form) whose holes `JSON.stringify` writes as `null`.
 *
 * Two things had to be true for this to reach production, and the tests are
 * split along them because each is a separate lesson:
 *
 *   1. Nothing exercised the API CONTRACT with what the browser produces. The
 *      suite covered the engine thoroughly — assemble, compute, render, the
 *      whole filing chain — all of it starting from hand-written fixtures in
 *      the shape the contract declares. A fixture cannot disagree with the
 *      contract about the shape, so no engine test could ever have caught this.
 *      That is why these assertions start from the real payload.
 *
 *   2. A cleared money box comes back as `null`, which `z.number().optional()`
 *      also rejects — so even in the right container, editing a figure and
 *      then emptying it would have failed the save.
 *
 * It failed CLOSED, which is the one piece of good news: no return was ever
 * stored with figures on the wrong lines. But it rejected the whole save over
 * one slice, with a message about a container mismatch that told the preparer
 * nothing they could act on.
 */

const base = {
  identification: { province: 'AB' },
  incomeStatement: { revenue: 100_000 },
  sbd: { associated: [], activeBusinessIncome: 100_000, aiiDetail: {}, aaiiDetail: {} },
  alberta: {
    grossRevenue: 100_000,
    totalAssets: 0,
    associatedWithCcpcs: 'no',
    windUpOfSubsidiary: 'no',
    firstYearAfterAmalgamation: 'no',
    taxYearEndChanged: 'no',
    finalReturn: 'no',
    transferOfProperty: 'no',
    reportsDifferentAlbertaIncome: 'no',
    electsDifferentDiscretionaryAmounts: 'no',
    preparedByTaxPreparerForFee: 'no',
  },
};

/** Exactly what the browser sends: one slot per line number, holes as null. */
const sparse = (figures: Record<number, number> = {}): unknown[] => {
  const a: unknown[] = new Array(419).fill(null);
  for (const [i, v] of Object.entries(figures)) a[Number(i)] = v;
  return a;
};

const parse = (netIncome: unknown) => ReturnInputSchema.safeParse({ ...base, netIncome });
const lines = (netIncome: unknown) => {
  const r = parse(netIncome);
  if (!r.success) throw new Error(r.error.issues[0]?.message);
  return (r.data as { netIncome?: { lines?: Record<string, number> } }).netIncome?.lines;
};

describe('the return input accepts Schedule 1 as the editor sends it', () => {
  it('accepts the payload that was failing in production', () => {
    // An AT1 return whose preparer never touched Schedule 1 — every slot null.
    // This is the verbatim shape from the failing request.
    expect(parse({ lines: sparse() }).success).toBe(true);
  });

  it('reads an untouched Schedule 1 as no lines, not as lines of zero', () => {
    // The distinction is the whole reason blanks are dropped: a line reported
    // at nil is a statement about the corporation, and an untyped line is not.
    expect(lines({ lines: sparse() })).toEqual({});
  });

  it('maps each array index onto its own CRA line number', () => {
    // The property that makes normalizing safe rather than lossy: the index the
    // editor wrote to IS the line number, so nothing is guessed.
    expect(lines({ lines: sparse({ 104: 50_000, 403: 55_000 }) })).toEqual({
      '104': 50_000,
      '403': 55_000,
    });
  });

  it('still accepts the record shape it always documented', () => {
    expect(lines({ lines: { '104': 50_000 } })).toEqual({ '104': 50_000 });
  });

  it('drops a box the preparer cleared, rather than failing the save', () => {
    expect(lines({ lines: { '104': 50_000, '403': null } })).toEqual({ '104': 50_000 });
  });

  it('keeps a negative figure — Schedule 1 has genuine negative adjustments', () => {
    expect(lines({ lines: sparse({ 401: -12_000 }) })).toEqual({ '401': -12_000 });
  });

  it('does not invent a Schedule 1 when the return has none', () => {
    expect(ReturnInputSchema.safeParse(base).success).toBe(true);
    expect((ReturnInputSchema.parse(base) as { netIncome?: unknown }).netIncome).toBeUndefined();
  });

  it('does not poison the save of a DIFFERENT schedule', () => {
    /*
     * Why one bad slice took the whole return down with it, and the part that
     * made this so confusing to hit: the editor saves by sending the ENTIRE
     * working return with one slice replaced (`saveSlice` builds
     * `{ ...seeded, [key]: values }`). So once Schedule 1 had been RENDERED —
     * merely opened, never typed into — the array sat in the working copy, and
     * every subsequent save of every OTHER schedule carried it along and was
     * rejected too.
     *
     * From the preparer's side that looks like the app breaking at random on a
     * schedule they had not touched, with no way to clear it: the offending
     * slice cannot be emptied from a form that will not save.
     */
    const poisoned = {
      ...base,
      netIncome: { lines: sparse() },
      alberta: { ...base.alberta, grossRevenue: 250_000 },
    };
    expect(ReturnInputSchema.safeParse(poisoned).success).toBe(true);
  });

  it('still refuses a figure that is not a number', () => {
    // Normalizing the container is not licence to accept anything in it.
    expect(parse({ lines: { '104': 'fifty thousand' } }).success).toBe(false);
  });
});
