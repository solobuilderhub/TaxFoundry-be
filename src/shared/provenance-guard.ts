/**
 * PROVENANCE GUARD — refuses to transmit a COMPUTED FIELD that is not filable.
 *
 * ── What this actually covers, stated precisely ─────────────────────────────
 *
 * It inspects the `fields` array of a computed return: the engine's own output,
 * stamped `'engine'` where it is produced. It runs before every transmit and is
 * a genuine control against a regression that wires a model value into the
 * engine's output, or against a tampered snapshot (proven in
 * `ledger-invariants.test.ts` §3, which edits the database beneath the app).
 *
 * ── What it does NOT cover, and what does ───────────────────────────────────
 *
 * **The payload carries more than the computed fields.** GIFI, shareholders, the
 * questionnaire, addresses, instalments and the Alberta jacket answers all come
 * from the frozen filing input — the preparer's working return — and never pass
 * through here. Those values are untagged, so this function cannot speak for
 * them, and an earlier version of this comment claimed it did.
 *
 * What stands behind them is the REVIEW SIGN-OFF: `t2-transmit.service.ts`
 * refuses to file without a memo whose `status` is `signed_off` AND whose
 * `computedReturnId` is the return being filed — so an earlier sign-off cannot
 * authorise a changed return. That is the control that makes a filed input a
 * human decision, not this assertion.
 *
 * **That distinction matters because the sign-off action is reachable over MCP**
 * (`/api/mcp` exposes every resource action; no resource sets `mcp: false`), so
 * "a human approved it" is only as strong as who holds the API key. Do not read
 * this guard as covering that.
 *
 * Pure, dependency-free — belt-and-suspenders with the schema enum on
 * computed-return, which blocks a 'model' field at write time.
 */

export const FILED_PROVENANCE = ['engine', 'imported', 'human'] as const;
export type FiledProvenance = (typeof FILED_PROVENANCE)[number];

export interface ProvenancedField {
  /** CRA line number or AT1 Line-Item-ID */
  line: string;
  value: unknown;
  provenance: string;
}

export function isFiledProvenance(p: string): p is FiledProvenance {
  return (FILED_PROVENANCE as readonly string[]).includes(p);
}

export class ProvenanceViolationError extends Error {
  readonly offenders: ProvenancedField[];
  constructor(offenders: ProvenancedField[]) {
    const detail = offenders.map((o) => `${o.line}=${o.provenance}`).join(', ');
    super(
      `Refusing to transmit: ${offenders.length} field(s) carry non-filable provenance (${detail}). ` +
        `A filed value may only originate from ${FILED_PROVENANCE.join('|')} — never a model.`,
    );
    this.name = 'ProvenanceViolationError';
    this.offenders = offenders;
  }
}

/** Fields whose provenance is not one of engine|imported|human. */
export function findProvenanceViolations(fields: readonly ProvenancedField[]): ProvenancedField[] {
  return fields.filter((f) => !isFiledProvenance(f.provenance));
}

/** Throws {@link ProvenanceViolationError} if ANY field is not safely filable. */
export function assertFiledProvenance(fields: readonly ProvenancedField[]): void {
  const offenders = findProvenanceViolations(fields);
  if (offenders.length > 0) throw new ProvenanceViolationError(offenders);
}
