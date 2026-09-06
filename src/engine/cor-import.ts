/**
 * .cor file import — load a filed T2 return's GIFI financial statements, and
 * the corporation it belongs to, from a CRA Corporation Internet Filing file.
 *
 * A .cor is what every certified T2 package (and CRA's own tools) emits, and
 * "load a return from a COR file" is one of the three ways a competitor opens
 * a return — the one this product lacked. The parser already existed one
 * package away: `@classytic/ledger-ca/cor`'s `CORParser` reads the header,
 * company block, directors and every GIFI account line. This module is the
 * host composition over it — the same shape as `gifi-import.ts`, which it
 * reuses for the classification step, so a .cor and a pasted trial balance
 * land in the return by exactly one code path.
 *
 * What comes out:
 *   - `balanceSheet` / `incomeStatement` — the GIFI accounts, classified by
 *     `importGifiTrialBalance` (Schedule 100/125 opening figures).
 *   - `identification` — who the file is for: name, business number, tax year,
 *     address, province, business activity. Returned so the editor can show it
 *     against the engagement's client BEFORE applying, because the most likely
 *     mistake with a file picker is the wrong corporation's file, and nothing
 *     about a balance sheet reveals that. Not written into the return: the
 *     business number, name and address live on the client record here, not
 *     on `returnInput`.
 *   - the parser's own warnings and errors, verbatim.
 *
 * Pure. No I/O.
 */
import { CORParser } from '@classytic/ledger-ca/cor';
import { type GifiImportResult, type GifiLine, importGifiTrialBalance } from './gifi-import.js';

export interface CorIdentification {
  corporationName?: string;
  /** CRA corporation number (field 001), where the file carries one. */
  corporationNumber?: string;
  /** Business number (field 040). */
  businessNumber?: string;
  /** ISO `YYYY-MM-DD`, from fields 060/061. */
  taxYearStart?: string;
  taxYearEnd?: string;
  /** Field 101, e.g. 2024 for "2024.1". */
  taxYear?: number;
  address: {
    line1?: string;
    city?: string;
    province?: string;
    country?: string;
    postalCode?: string;
  };
  /** Field 750 — the province code the return was filed for. */
  provinceCode?: string;
  /** Fields 063-299 — NAICS-style business activity codes. */
  businessActivityCodes: string[];
  businessDescription?: string;
  fileVersion?: string;
  fileType?: string;
}

export interface CorImportResult extends GifiImportResult {
  identification: CorIdentification;
  /** GIFI account lines the parser found in the file, before classification. */
  gifiAccountsInFile: number;
  parsingWarnings: string[];
  parsingErrors: string[];
}

const str = (v: string | null | undefined): string | undefined =>
  v == null || v === '' ? undefined : v;
// The parser builds its Dates from the file's YYYYMMDD digits at LOCAL
// midnight, so the calendar day is in the local getters — `toISOString()`
// would read them in UTC and, east of Greenwich, hand back the day before.
const isoDay = (d: Date | null | undefined): string | undefined =>
  d instanceof Date && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : undefined;
const noteText = (n: unknown): string =>
  typeof n === 'string'
    ? n
    : (n as { message?: unknown })?.message != null
      ? String((n as { message: unknown }).message)
      : JSON.stringify(n);

export function importCorFile(content: string): CorImportResult {
  const data = new CORParser().parse(content);

  // Every GIFI account with a value becomes a trial-balance line; the shared
  // classifier then skips grand-total rollups and buckets the rest, exactly as
  // it does for a pasted trial balance.
  const lines: GifiLine[] = [];
  for (const account of data.gifiAccounts.values()) {
    if (account.value == null || !Number.isFinite(account.value)) continue;
    lines.push({ code: account.code, amount: account.value });
  }
  const classified = importGifiTrialBalance(lines);

  const h = data.header;
  const c = data.companyInfo;
  const identification: CorIdentification = {
    ...(str(h.corporationName) ? { corporationName: h.corporationName as string } : {}),
    ...(str(h.corporationNumber) ? { corporationNumber: h.corporationNumber as string } : {}),
    ...(str(c.businessNumber) ? { businessNumber: c.businessNumber as string } : {}),
    ...(isoDay(h.startDate) ? { taxYearStart: isoDay(h.startDate) as string } : {}),
    ...(isoDay(h.endDate) ? { taxYearEnd: isoDay(h.endDate) as string } : {}),
    ...(h.taxYear != null ? { taxYear: h.taxYear } : {}),
    address: {
      ...(str(c.address.line1) ? { line1: c.address.line1 as string } : {}),
      ...(str(c.address.city) ? { city: c.address.city as string } : {}),
      ...(str(c.address.province) ? { province: c.address.province as string } : {}),
      ...(str(c.address.country) ? { country: c.address.country as string } : {}),
      ...(str(c.address.postalCode) ? { postalCode: c.address.postalCode as string } : {}),
    },
    ...(str(c.provinceCode) ? { provinceCode: c.provinceCode as string } : {}),
    businessActivityCodes: [...c.businessActivityCodes],
    ...(str(c.businessDescription) ? { businessDescription: c.businessDescription as string } : {}),
    ...(str(h.fileVersion) ? { fileVersion: h.fileVersion as string } : {}),
    ...(str(h.fileType) ? { fileType: h.fileType as string } : {}),
  };

  return {
    ...classified,
    identification,
    gifiAccountsInFile: data.gifiAccounts.size,
    parsingWarnings: data.parsingWarnings.map(noteText),
    parsingErrors: data.parsingErrors.map(noteText),
  };
}
