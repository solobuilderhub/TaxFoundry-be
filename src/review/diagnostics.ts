/**
 * Line-level diagnostics engine — the completeness / consistency layer.
 *
 * Mirrors what a certified T2 product shows in its "Diagnosis" panel ("an entry
 * is required at line 040", "type of corporation not specified"): a data-driven
 * set of rules, each tied to a CRA line, that flag a return which is not yet
 * complete or internally consistent enough to file. A `red` diagnostic blocks
 * sign-off exactly like a red review flag.
 *
 * Data-driven ON PURPOSE: adding a check is one entry in {@link DIAGNOSTIC_RULES}
 * — a `when(ctx)` predicate + a cited message + a line ref — never a new branch
 * in a growing if-chain. Pure and unit-testable; the review generator merges the
 * output with the semantic tax-review flags.
 */

export type Severity = 'green' | 'amber' | 'red';

export interface DiagnosticContext {
  program: string;
  /** Computed-return fold, keyed by line. */
  fold: Record<string, number>;
  /** The working return input (schedule-structured). */
  ri: Record<string, unknown>;
  /**
   * The client (BN, corp type, province of the registered address).
   *
   * `province` is here because the return input has no province field — there
   * is no control for it anywhere in the return editor. It is captured once, on
   * the client record, and a diagnostic that reads only the return therefore
   * reported "not set" against a province the preparer had plainly set.
   */
  client: { businessNumber?: string; corpType?: string; province?: string } | null;
  /** Whether a computed return exists yet. */
  hasComputed: boolean;
}

export interface DiagnosticRule {
  code: string;
  /** CRA line / schedule reference the diagnostic anchors to. */
  line?: string;
  citation?: string;
  severity: Severity;
  /** `true` ⇒ the diagnostic is RAISED. Pure predicate over the context. */
  when: (ctx: DiagnosticContext) => boolean;
  message: string | ((ctx: DiagnosticContext) => string);
}

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  line?: string;
  citation?: string;
  resolved: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────────
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const anyValue = (o: Record<string, unknown>): boolean =>
  Object.values(o).some((x) => x != null && x !== '' && !(Array.isArray(x) && x.length === 0));
const ident = (c: DiagnosticContext) => rec(c.ri.identification);
const isInactive = (c: DiagnosticContext) => ident(c).inactive === true;
/**
 * The province of permanent establishment, from wherever it was actually
 * entered: the return input if a future editor ever carries one, otherwise the
 * client's registered address, which is the only place it can be typed today.
 */
const province = (c: DiagnosticContext): string | undefined => {
  const fromReturn = ident(c).province;
  const v = (typeof fromReturn === 'string' ? fromReturn : undefined) ?? c.client?.province;
  return v && String(v).trim() !== '' ? String(v).trim() : undefined;
};

/**
 * Whether the return names a province anywhere at all.
 *
 * There are two ways a return says where the corporation operates, and the
 * provincial allocation schedule's own hint states them: a multi-jurisdiction
 * return lists a permanent establishment per province, and a single-province
 * return "uses the province on Identification".
 *
 * Reading only the second was wrong twice over. The province is entered on the
 * CLIENT record, not the return — there is no province control in the return
 * editor at all, which is what made this rule report "not set" against a
 * province the preparer had plainly set. And a corporation with establishments
 * in Ontario and British Columbia has named two provinces without touching
 * either of the fields this used to look at.
 */
const hasProvince = (c: DiagnosticContext): boolean => {
  if (province(c) !== undefined) return true;
  const allocation = rec(c.ri.provincialAllocation);
  const establishments = Array.isArray(allocation.establishments)
    ? (allocation.establishments as { province?: unknown }[])
    : [];
  return establishments.some((e) => typeof e?.province === 'string' && e.province.trim() !== '');
};

/**
 * The rule set. Each rule is a self-contained, CRA-line-referenced check. Kept
 * NON-OVERLAPPING with the semantic review flags (SBD/CCA/gains/provincial),
 * which the review generator computes separately.
 */
export const DIAGNOSTIC_RULES: DiagnosticRule[] = [
  // ── Identification (required to file) ──────────────────────────────────────
  {
    code: 'D_CORP_TYPE_REQUIRED',
    line: '040',
    severity: 'red',
    when: (c) => !(ident(c).corpType || c.client?.corpType),
    message: 'The type of corporation is not specified (line 040) — required to file.',
  },
  {
    code: 'D_TAX_YEAR_REQUIRED',
    line: '061',
    severity: 'red',
    when: (c) => !c.hasComputed && !c.fold.taxableIncome && !c.fold.netIncomeForTax,
    message: 'The tax year and financial data are incomplete — compute the return before filing.',
  },
  {
    code: 'D_PROVINCE_MISSING',
    line: '750',
    citation: 'T2 Schedule 5',
    severity: 'amber',
    when: (c) => !hasProvince(c),
    message:
      'Province of permanent establishment not set — provincial/territorial tax (Schedule 5) cannot be computed. For a single-province return it comes from the client record (Clients → the corporation → registered address); for a corporation operating in more than one, list a permanent establishment per province on the Provincial Allocation schedule.',
  },

  // ── Financial statements (GIFI) ────────────────────────────────────────────
  {
    code: 'D_INCOME_STATEMENT_REQUIRED',
    line: 'GIFI 125',
    severity: 'amber',
    when: (c) => !isInactive(c) && !anyValue(rec(c.ri.incomeStatement)),
    message:
      'No income statement entered (GIFI 125) — enter the financials or mark the return inactive.',
  },
  {
    code: 'D_BALANCE_SHEET_REQUIRED',
    line: 'GIFI 100',
    severity: 'amber',
    when: (c) => !isInactive(c) && !anyValue(rec(c.ri.balanceSheet)),
    message: 'No balance sheet entered (GIFI 100) — a T2 return requires the GIFI balance sheet.',
  },

  // ── Tax calculation sanity ─────────────────────────────────────────────────
  {
    code: 'D_NIL_RETURN',
    severity: 'green',
    when: (c) => isInactive(c) && (c.fold.totalOwing ?? 0) === 0,
    message: 'Nil / inactive return — no tax payable.',
  },
  {
    code: 'D_TAX_ON_NIL_INCOME',
    line: '360',
    citation: 'ITA Part I',
    severity: 'red',
    when: (c) => (c.fold.taxableIncome ?? 0) <= 0 && (c.fold.partITaxPayable ?? 0) > 0,
    message: 'Part I tax is positive but taxable income is nil — check the inputs.',
  },
  {
    code: 'D_LARGE_REFUND',
    line: '784',
    severity: 'amber',
    when: (c) =>
      num(c.fold.dividendRefund) > num(c.fold.partITaxPayable) + num(c.fold.partIVTaxPayable),
    message:
      'The dividend refund exceeds Part I + Part IV tax — verify the RDTOH pool and dividends paid.',
  },
];

/** Run the rule set against a context and return the raised diagnostics. */
export function runDiagnostics(
  ctx: DiagnosticContext,
  rules: readonly DiagnosticRule[] = DIAGNOSTIC_RULES,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of rules) {
    if (!r.when(ctx)) continue;
    out.push({
      severity: r.severity,
      code: r.code,
      message: typeof r.message === 'function' ? r.message(ctx) : r.message,
      ...(r.line !== undefined ? { line: r.line } : {}),
      ...(r.citation !== undefined ? { citation: r.citation } : {}),
      resolved: false,
    });
  }
  return out;
}
