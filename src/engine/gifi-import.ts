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

/**
 * Which field a GIFI code belongs to, decided by the CODE.
 *
 * ── Why not by the name ─────────────────────────────────────────────────────
 *
 * This used to classify by substring-matching the account caption:
 * `has(name, 'cash', 'bank', 'deposit')` and so on. That is approximately
 * right and occasionally wrong, and the wrongness is silent — money simply
 * lands on a different line of the balance sheet.
 *
 * Measured, before this: GIFI 1486 "Security/tender deposits" matched
 * 'deposit' and imported as CASH. A tender deposit is not cash; it is an other
 * current asset, which is exactly where its code sits. The reverse risk is
 * worse: captions are CRA's prose and CRA revises them, so a caption change
 * upstream silently re-buckets a balance. Two of them changed in ledger-ca
 * this week — 1740 and 3142 — and both happened to keep matching by luck
 * rather than design.
 *
 * ── Why the code IS the answer ──────────────────────────────────────────────
 *
 * GIFI is a ranged taxonomy: the blocks carry the meaning, and CRA publishes
 * them. Every boundary below was read off the RC4088 index rather than
 * remembered, and each is named by its own block head:
 *
 *   1000 Cash and deposits          1060 Accounts receivable
 *   1120 Inventories                1180 Short-term investments
 *   1240 Loans and notes receivable 1300 Due from shareholders
 *   1400 Due from related parties   1480 Other current assets
 *   1600-2008 tangible capital      2010-2178 intangible capital
 *   2180-2589 other long-term       2620-3139 current liabilities
 *   3140-3450 long-term debt        3500-3540 share capital
 *   3600-3849 retained earnings     8000-8299 revenue
 *   8300-8519 cost of sales         8520-9368 operating expenses
 *
 * A code outside every range falls through to the caption heuristic, which is
 * kept for exactly that case: a pack may carry a non-GIFI code (ledger-ca has
 * a handful, documented in its own conformance test) and guessing from the
 * name beats dropping the balance.
 */
type BalanceSheetField =
  | 'cash'
  | 'accountsReceivable'
  | 'inventory'
  | 'capitalAssetsNet'
  | 'otherAssets'
  | 'accountsPayable'
  | 'loansPayable'
  | 'otherLiabilities'
  | 'shareCapital'
  | 'retainedEarnings';
type IncomeStatementField =
  | 'revenue'
  | 'costOfSales'
  | 'salariesAndWages'
  | 'amortization'
  | 'otherExpenses';

/** `[fromInclusive, toInclusive, field]`, in CRA's own block order. */
const CODE_RANGES: readonly [number, number, BalanceSheetField | IncomeStatementField][] = [
  // ── Current assets ────────────────────────────────────────────────────────
  [1000, 1059, 'cash'],
  [1060, 1119, 'accountsReceivable'],
  [1120, 1179, 'inventory'],
  // Short-term investments are NOT cash: IAS 7 admits only deposits redeemable
  // at a known amount within three months, which the block does not promise.
  [1180, 1239, 'otherAssets'],
  [1240, 1299, 'accountsReceivable'],
  [1300, 1479, 'otherAssets'],
  [1480, 1598, 'otherAssets'],
  // ── Capital assets. The accumulated-amortization codes sit INSIDE these
  // ranges and carry credit balances, so the block nets to book value — which
  // is what `capitalAssetsNet` means.
  [1600, 2008, 'capitalAssetsNet'],
  [2010, 2178, 'capitalAssetsNet'],
  [2180, 2589, 'otherAssets'],
  // ── Liabilities ───────────────────────────────────────────────────────────
  // 2600 bank overdraft is a liability, not negative cash: the balance sheet
  // the return files shows it as one.
  [2600, 2619, 'loansPayable'],
  [2620, 2679, 'accountsPayable'],
  [2680, 2699, 'otherLiabilities'],
  [2700, 2959, 'loansPayable'],
  [2960, 3138, 'otherLiabilities'],
  [3140, 3449, 'loansPayable'],
  // ── Equity ────────────────────────────────────────────────────────────────
  [3500, 3539, 'shareCapital'],
  [3540, 3599, 'shareCapital'],
  [3600, 3619, 'retainedEarnings'],
  [3660, 3848, 'retainedEarnings'],
  // ── Income statement ──────────────────────────────────────────────────────
  [8000, 8298, 'revenue'],
  [8300, 8518, 'costOfSales'],
  [8520, 9367, 'otherExpenses'],
  // Farming revenue and expenses (9370-9899) are a separate statement this
  // product does not model, so no range claims them and they reach the
  // category fallback below — farm revenue lands in revenue, farm expenses in
  // other expenses. Deliberately: dropping them would keep the non-farming
  // figures "pure" and understate book net income by the whole farm result.
];

/**
 * Codes inside a range whose field is NOT the range's, because CRA's block
 * ordering groups them by subject rather than by our balance-sheet line.
 *
 * Each one is an expense block head inside 8520-9367 that the return keeps as
 * its own field. Anything not listed stays with its range.
 */
const CODE_OVERRIDES: Readonly<Record<string, BalanceSheetField | IncomeStatementField>> = {
  // Salaries, wages and benefits — the return reports them separately.
  '9060': 'salariesAndWages',
  '9061': 'salariesAndWages',
  '9062': 'salariesAndWages',
  '9063': 'salariesAndWages',
  '9064': 'salariesAndWages',
  '9065': 'salariesAndWages',
  '9066': 'salariesAndWages',
  // Amortization of capital assets, likewise.
  '8670': 'amortization',
  '8671': 'amortization',
  '8672': 'amortization',
  '8673': 'amortization',
  '8674': 'amortization',
  '8675': 'amortization',
  '8676': 'amortization',
};

const BALANCE_SHEET_FIELDS = new Set<string>([
  'cash',
  'accountsReceivable',
  'inventory',
  'capitalAssetsNet',
  'otherAssets',
  'accountsPayable',
  'loansPayable',
  'otherLiabilities',
  'shareCapital',
  'retainedEarnings',
]);

/** The field this code belongs to, or undefined when no range claims it. */
function fieldForCode(code: string): BalanceSheetField | IncomeStatementField | undefined {
  const override = CODE_OVERRIDES[code];
  if (override) return override;
  const n = Number(code);
  if (!Number.isInteger(n)) return undefined;
  for (const [from, to, field] of CODE_RANGES) {
    if (n >= from && n <= to) return field;
  }
  return undefined;
}

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

    /*
     * The code decides, where CRA's own blocks claim it. Only a code outside
     * every published range reaches the caption heuristic below — see
     * `fieldForCode` for why that order and not the other one.
     */
    const byRange = fieldForCode(c);
    if (byRange) {
      if (BALANCE_SHEET_FIELDS.has(byRange)) bs[byRange as keyof typeof bs] += amt;
      else is[byRange as keyof typeof is] += amt;
      continue;
    }

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
