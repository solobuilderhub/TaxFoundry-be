/**
 * AT1 Schedule 3 — APITC available at the beginning of the year comes from
 * page 3's year-of-origin table (line 335), where the printed form collects
 * it. Page 1 used to take the same balances as three separate entries that
 * only the guided view showed, beside a page-3 table asking for them again.
 */
import { describe, expect, it } from 'vitest';
import { assembleSchedule3 } from '../src/engine/at1-schedule-composers/schedule-3-compose.js';

const table = (rows: { yearIndex: number; openingBalance?: number }[]) =>
  ({ albertaOtherCredits3: { vintages: { agriProcessingTaxCredit: rows } } }) as never;

describe('AT1 Schedule 3 — APITC availability from the page-3 table', () => {
  it('row 1 → 1st preceding, row 2 → 2nd, rows 3-10 summed', () => {
    const out = assembleSchedule3(
      table([
        { yearIndex: 1, openingBalance: 3_000 },
        { yearIndex: 2, openingBalance: 2_000 },
        { yearIndex: 3, openingBalance: 700 },
        { yearIndex: 9, openingBalance: 300 },
      ]),
    );
    expect(out?.apitc?.firstPreceding.availableAtBeginning).toBe(3_000);
    expect(out?.apitc?.secondPreceding.availableAtBeginning).toBe(2_000);
    expect(out?.apitc?.thirdToTenthPreceding.availableAtBeginning).toBe(1_000);
  });

  it('a table with balances alone is enough to file the APITC section', () => {
    expect(assembleSchedule3(table([{ yearIndex: 4, openingBalance: 500 }]))?.apitc).toBeDefined();
  });

  it('the table the form shows wins; an old page-1 entry fills only a blank table row', () => {
    const out = assembleSchedule3({
      albertaOtherCredits3: {
        apitcFirstAvailable: 9_999,
        apitcSecondAvailable: 4_444,
        vintages: { agriProcessingTaxCredit: [{ yearIndex: 1, openingBalance: 3_000 }] },
      },
    } as never);
    expect(out?.apitc?.firstPreceding.availableAtBeginning).toBe(3_000);
    expect(out?.apitc?.secondPreceding.availableAtBeginning).toBe(4_444);
  });

  it('the current-year row (0) is never counted as a carried-forward balance', () => {
    const out = assembleSchedule3(
      table([
        { yearIndex: 0, openingBalance: 5_000 },
        { yearIndex: 1, openingBalance: 1_000 },
      ]),
    );
    expect(out?.apitc?.firstPreceding.availableAtBeginning).toBe(1_000);
    expect(out?.apitc?.thirdToTenthPreceding.availableAtBeginning).toBe(0);
  });
});
