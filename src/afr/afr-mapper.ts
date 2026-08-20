/**
 * Pure mapping: CRA AFR response → our structured `returnInput` slices.
 *
 * AFR data is imported provenance — it fills the return, it does not compute it.
 * The merge is FILL-BLANKS-ONLY: a value the preparer has already entered always
 * wins over the CRA figure, so re-running auto-fill can never overwrite hand-keyed
 * work. Each field actually filled is reported back for the audit trail / UI.
 *
 * Only maps to slices the return already models (identification, loss/donation/
 * GRIP/ITC/FTC openings, instalments). GIFI / financial statements are NOT part of
 * AFR — they come from the GIFI import.
 */
import type { AfrResponse } from './afr-types.js';

type Slice = Record<string, unknown>;
type ReturnInput = Record<string, Slice | undefined>;

const isBlank = (v: unknown): boolean => v == null || v === '';
const posNum = (v: unknown): number | undefined => {
  if (isBlank(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export interface AutoFillMergeResult {
  returnInput: ReturnInput;
  /** Human-readable "slice.field" paths that were filled from CRA (for the audit fact / UI). */
  filled: string[];
}

/**
 * Merge AFR data into the existing working return, filling only blank fields.
 * Returns a new object (does not mutate `existing`).
 */
export function mergeAutoFill(
  existing: ReturnInput | undefined,
  afr: AfrResponse,
): AutoFillMergeResult {
  const base: ReturnInput = existing ? structuredClone(existing) : {};
  const filled: string[] = [];

  /** Set base[slice][field] = value only if currently blank; record the fill. */
  const fill = (slice: string, field: string, value: unknown) => {
    if (value === undefined) return;
    const current = base[slice]?.[field];
    if (!isBlank(current)) return; // preparer's value wins
    base[slice] = { ...(base[slice] ?? {}), [field]: value };
    filled.push(`${slice}.${field}`);
  };

  const id = afr.identification ?? {};
  fill('identification', 'corpType', id.corpType);
  fill('identification', 'province', id.province ?? id.address?.province);

  const cf = afr.carryforwards ?? {};
  fill('losses', 'nonCapitalOpening', posNum(cf.nonCapitalLossOpening));
  fill('losses', 'netCapitalOpening', posNum(cf.netCapitalLossOpening));
  fill('donations', 'openingDonationPool', posNum(cf.donationPoolOpening));
  fill('dividends', 'openingGrip', posNum(cf.gripOpening));
  fill('credits', 'openingItcPool', posNum(cf.itcPoolOpening));
  fill('foreign', 'openingBusinessFtcPool', posNum(cf.businessFtcPoolOpening));

  fill('payments', 'instalmentsPaid', posNum(afr.instalmentsPaid));

  return { returnInput: base, filled };
}
