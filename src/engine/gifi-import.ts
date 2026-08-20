/**
 * GIFI trial-balance import — populate a return's balance sheet + income
 * statement from a GIFI-coded trial balance, instead of hand-entering every
 * line.
 *
 * The classification is DELEGATED to `@classytic/ledger-ca` (via our
 * gifi-registry): each code resolves to a GIFI account with an authoritative
 * category (Asset / Liability / Equity / Income / Expense) and a name. We use
 * the category to bucket the amount and the name to place it into the return's
 * specific field (cash, receivables, salaries, …), falling back to the
 * catch-all field for its category. Every valid amount lands somewhere, so book
 * net income and the balance-sheet totals are exact by construction.
 *
 * Pure and deterministic — a host composition over the ledger-ca primitive.
 */
import { getGifiAccount } from '#shared/gifi-registry.js';

export interface GifiLine {
  code: string;
  amount: number;
}

export interface GifiImportResult {
  balanceSheet: {
    cash: number;
    accountsReceivable: number;
    inventory: number;
    capitalAssetsNet: number;
    otherAssets: number;
    accountsPayable: number;
    loansPayable: number;
    otherLiabilities: number;
    shareCapital: number;
    retainedEarnings: number;
  };
  incomeStatement: {
    revenue: number;
    costOfSales: number;
    salariesAndWages: number;
    amortization: number;
    otherExpenses: number;
  };
  bookNetIncome: number;
  totals: { assets: number; liabilitiesEquity: number; balanced: boolean };
  /** Codes not found in the ledger-ca GIFI registry (skipped). */
  invalidCodes: string[];
  /** Grand-total rollup codes skipped to avoid double-counting (e.g. 9999). */
  skippedTotals: string[];
  /** How many valid posting lines were mapped. */
  mappedLines: number;
}

/**
 * Cross-section GRAND totals — always derived from other lines, so summing them
 * double-counts. Skipped on import. Section subtotals people actually report on
 * (8299 Total Revenue, 8518 Total Cost of Sales) are NOT here — they stay usable
 * for summary-level exports.
 */
const GRAND_TOTAL_CODES = new Set([
  '9999',
  '9970',
  '9980',
  '9990', // net income / loss variants (bottom line)
  '2599', // Total Assets
  '3499', // Total Liabilities
  '3620',
  '3849', // Total Shareholder Equity
  '3640', // Total Liabilities and Shareholder Equity
]);

const has = (name: string, ...needles: string[]) => needles.some((n) => name.includes(n));

/** Parse pasted trial-balance text: one line per account, `<code> … <amount>`. */
export function parseGifiText(text: string): GifiLine[] {
  const lines: GifiLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const code = line.match(/\b(\d{3,4})\b/)?.[1];
    // Last number on the line (allow $ , ( ) negatives).
    const amounts = line.match(/-?\(?\$?\s*[\d,]+(?:\.\d+)?\)?/g);
    if (!code || !amounts?.length) continue;
    const last = amounts[amounts.length - 1];
    const negative = /^\(.*\)$/.test(last.trim());
    const n = Number(last.replace(/[(),$\s]/g, ''));
    if (!Number.isFinite(n)) continue;
    lines.push({ code, amount: negative ? -n : n });
  }
  return lines;
}

export function importGifiTrialBalance(lines: readonly GifiLine[]): GifiImportResult {
  const bs = {
    cash: 0,
    accountsReceivable: 0,
    inventory: 0,
    capitalAssetsNet: 0,
    otherAssets: 0,
    accountsPayable: 0,
    loansPayable: 0,
    otherLiabilities: 0,
    shareCapital: 0,
    retainedEarnings: 0,
  };
  const is = { revenue: 0, costOfSales: 0, salariesAndWages: 0, amortization: 0, otherExpenses: 0 };
  const invalidCodes: string[] = [];
  const skippedTotals: string[] = [];
  let mappedLines = 0;

  for (const { code, amount } of lines) {
    const c = String(code);
    if (GRAND_TOTAL_CODES.has(c)) {
      skippedTotals.push(c);
      continue;
    }
    const acct = getGifiAccount(c);
    if (!acct || !acct.category) {
      invalidCodes.push(c);
      continue;
    }
    mappedLines += 1;
    const name = (acct.name ?? '').toLowerCase();
    const amt = Number(amount) || 0;

    switch (acct.category) {
      case 'Balance Sheet-Asset':
        if (has(name, 'cash', 'bank', 'deposit')) bs.cash += amt;
        else if (has(name, 'receivable')) bs.accountsReceivable += amt;
        else if (has(name, 'inventor')) bs.inventory += amt;
        else if (
          has(
            name,
            'capital',
            'property',
            'equipment',
            'building',
            'depreciable',
            'fixed',
            'vehicle',
            'machinery',
          )
        )
          bs.capitalAssetsNet += amt;
        else bs.otherAssets += amt;
        break;
      case 'Balance Sheet-Liability':
        // Debt-shaped liabilities first (a "note payable" is a loan, not an A/P).
        if (
          has(
            name,
            'loan',
            'debt',
            'borrowing',
            'mortgage',
            'note payable',
            'line of credit',
            'bank advance',
          )
        )
          bs.loansPayable += amt;
        else if (has(name, 'payable', 'accrued')) bs.accountsPayable += amt;
        else bs.otherLiabilities += amt;
        break;
      case 'Balance Sheet-Equity':
        if (has(name, 'share', 'capital stock', 'common stock', 'contributed'))
          bs.shareCapital += amt;
        else if (has(name, 'retained', 'earnings', 'deficit')) bs.retainedEarnings += amt;
        else bs.shareCapital += amt;
        break;
      case 'Income Statement-Income':
        is.revenue += amt;
        break;
      case 'Income Statement-Expense':
        if (has(name, 'cost of sales', 'cost of goods', 'opening inventory', 'purchases', 'direct'))
          is.costOfSales += amt;
        else if (has(name, 'salar', 'wage', 'remuneration', 'benefit')) is.salariesAndWages += amt;
        else if (has(name, 'amortiz', 'depreciat')) is.amortization += amt;
        else is.otherExpenses += amt;
        break;
    }
  }

  const bookNetIncome =
    is.revenue - is.costOfSales - is.salariesAndWages - is.amortization - is.otherExpenses;
  const assets =
    bs.cash + bs.accountsReceivable + bs.inventory + bs.capitalAssetsNet + bs.otherAssets;
  const liabilitiesEquity =
    bs.accountsPayable +
    bs.loansPayable +
    bs.otherLiabilities +
    bs.shareCapital +
    bs.retainedEarnings;

  return {
    balanceSheet: bs,
    incomeStatement: is,
    bookNetIncome,
    totals: { assets, liabilitiesEquity, balanced: Math.abs(assets - liabilitiesEquity) <= 1 },
    invalidCodes,
    skippedTotals,
    mappedLines,
  };
}
