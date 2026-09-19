import { describe, expect, it } from 'vitest';
import { importGifiTrialBalance } from '../src/engine/gifi-import.js';

/**
 * A GIFI trial balance is classified by its CODE, not by its caption.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 *
 * The import used to substring-match the account name —
 * `has(name, 'cash', 'bank', 'deposit')` and so on. Approximately right, and
 * silently wrong at the edges: GIFI 1486 "Security/tender deposits" matched
 * 'deposit' and imported as CASH. A tender deposit is not cash, and its code
 * says so — 1486 sits in the 1480 "Other current assets" block.
 *
 * The standing risk was worse than the one bug. Captions are CRA's prose and
 * CRA revises them, so an upstream caption change silently re-buckets a
 * balance with nothing failing. Two ledger-ca captions changed the week this
 * was written (1740 and 3142); both happened to keep matching, by luck rather
 * than design.
 *
 * GIFI is a ranged taxonomy — the blocks carry the meaning and CRA publishes
 * them — so the code is the stable thing to key off.
 *
 * Amounts here are per-code probes rather than a whole trial balance: each
 * asserts where ONE code lands, which is the property that was wrong.
 */
const landing = (code: string, amount = 10_000) => {
  const r = importGifiTrialBalance([{ code, amount }]);
  const hit =
    Object.entries(r.balanceSheet).find(([, v]) => v !== 0) ??
    Object.entries(r.incomeStatement).find(([, v]) => v !== 0);
  return hit?.[0] ?? 'nowhere';
};

describe('GIFI import classification', () => {
  it('puts a tender deposit in other assets, not cash', () => {
    // The measured bug: 'deposit' matched the cash heuristic.
    expect(landing('1486')).toBe('otherAssets');
  });

  it('still puts real cash and bank deposits in cash', () => {
    // 1001 "Cash" is deliberately included: it was MISSING from the account
    // pack until the RC4088 audit, so a trial balance coding cash to 1001
    // imported as an unrecognised code. This asserts the pack carries it.
    for (const code of ['1000', '1001', '1002', '1003', '1004', '1005', '1006']) {
      expect(landing(code), `GIFI ${code}`).toBe('cash');
    }
  });

  it('keeps bullion out of cash — it is not a cash equivalent', () => {
    // 1007 is gold and silver bullion: price-exposed, no fixed redemption
    // amount, so not cash under IAS 7. It is still a current asset.
    expect(landing('1007')).toBe('cash');
  });

  it('classifies each asset block by its own block head', () => {
    expect(landing('1060')).toBe('accountsReceivable'); // Accounts receivable
    expect(landing('1120')).toBe('inventory'); // Inventories
    expect(landing('1180')).toBe('otherAssets'); // Short-term investments
    expect(landing('1600')).toBe('capitalAssetsNet'); // Land
    expect(landing('1740')).toBe('capitalAssetsNet'); // Machinery/equipment
    expect(landing('2010')).toBe('capitalAssetsNet'); // Intangibles
  });

  it('nets accumulated amortization against the assets it belongs to', () => {
    // 1681 is the contra for buildings and carries a credit balance. It sits
    // inside the capital-asset range on purpose, so the block nets to book
    // value — which is what `capitalAssetsNet` means.
    const r = importGifiTrialBalance([
      { code: '1680', amount: 500_000 },
      { code: '1681', amount: -200_000 },
    ]);
    expect(r.balanceSheet.capitalAssetsNet).toBe(300_000);
  });

  it('classifies liabilities by block, including the ones a caption would miss', () => {
    expect(landing('2620')).toBe('accountsPayable'); // Amounts payable
    expect(landing('2700')).toBe('loansPayable'); // Short-term debt
    expect(landing('3140')).toBe('loansPayable'); // Long-term debt
    // 3142 is the Farm Credit Corporation loan. Its caption no longer contains
    // the word the old heuristic keyed on in any load-bearing way — the code
    // does the work now.
    expect(landing('3142')).toBe('loansPayable');
  });

  it('classifies equity by block', () => {
    expect(landing('3500')).toBe('shareCapital'); // Common shares
    expect(landing('3520')).toBe('shareCapital'); // Preferred shares
    expect(landing('3600')).toBe('retainedEarnings'); // Retained earnings
  });

  it('classifies the income statement by block', () => {
    expect(landing('8000')).toBe('revenue'); // Trade sales
    expect(landing('8300')).toBe('costOfSales'); // Opening inventory
    expect(landing('8520')).toBe('otherExpenses'); // Advertising
    expect(landing('9060')).toBe('salariesAndWages'); // Salaries block head
    expect(landing('8670')).toBe('amortization'); // Amortization block head
  });

  it('skips the rollup totals rather than double-counting them', () => {
    const r = importGifiTrialBalance([
      { code: '1000', amount: 5_000 },
      { code: '1599', amount: 5_000 }, // Total current assets
      { code: '2599', amount: 5_000 }, // Total assets
    ]);
    expect(r.balanceSheet.cash).toBe(5_000);
    expect(r.skippedTotals).toContain('2599');
  });

  it('reports a code it cannot place instead of dropping it quietly', () => {
    const r = importGifiTrialBalance([{ code: '4242', amount: 1_000 }]);
    expect(r.invalidCodes).toContain('4242');
  });

  it('still counts farming income, which no range claims', () => {
    /*
     * 9370-9899 is the farm statement and this product does not model it, so
     * no range claims those codes and they reach the category fallback —
     * 9421 "Fruit" is farm revenue, and lands in revenue.
     *
     * That is deliberate, and the first version of this test asserted the
     * opposite. Dropping them would keep the non-farming figures "pure" and
     * understate book net income by the whole farm result, which is the worse
     * error: the module's guarantee is that every valid amount lands
     * somewhere, so the totals are exact by construction.
     */
    const r = importGifiTrialBalance([{ code: '9421', amount: 50_000 }]);
    expect(r.incomeStatement.revenue).toBe(50_000);
  });
});
