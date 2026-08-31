/**
 * AT1 Schedule 15 — Alberta Resource Related Deductions — composition.
 *
 * Reshapes `ri.albertaResourceDeductions15` (the AT1-only working-return slice
 * this schedule needs — see `schedule15-resource-related-deductions.ts` for
 * the full field-by-line-number citations) into `computeAlbertaSchedule15`'s
 * input and runs it.
 *
 * As documented on the engine module itself, Schedule 15 found NO cross-
 * references to sibling AT1 schedules — every "differs from federal" field is
 * a plain federal T2/Schedule pool figure the engine has no other source for,
 * so `ri.albertaResourceDeductions15` carries them directly as money fields.
 * One shared `daysInTaxYear` (the corporation's own tax year — not a
 * per-pool concept) feeds every pool whose claim cap is prorated.
 *
 * ── Shape, and why it is FLAT rather than triple-nested ─────────────────────
 *
 * Each regular/successor pool side is its OWN top-level key on
 * `ri.albertaResourceDeductions15` (`edaRegular`, `edaSuccessor`, `ceeRegular`,
 * …) rather than nested under `eda: { regular, successor }`. This matches the
 * only other large multi-pool AT1 schedule wired this same round —
 * `alberta-schedule5.ts` / `schedule-5-compose.ts` — which keeps every block
 * at one level and uses `field.group(...)` (itself untested for nesting
 * groups inside groups) only for a single simple pair. Within each block, a
 * reconciled figure is TWO parallel fields, `federal<Name>` / `alberta<Name>`
 * (blank Alberta = same as federal) — the same parallel-naming convention
 * `cca.ts` already uses (`openingUCC` / `albertaOpeningUCC`). A field the spec
 * marks "must equal federal" (no Alberta override permitted) only gets the
 * `federal<Name>` half. `claimed` is the one discretionary claim figure per
 * block, named to match the engine's own `Input.claimed` 1:1.
 *
 * Not wired into `assemble-at1-schedules.ts` here — that integration is done
 * centrally once every concurrently-developed composer exists.
 *
 * Kept in its own file/directory (`at1-schedule-composers/`) per the existing
 * `assemble-at1-schedules.ts` convention of small, single-purpose, named
 * functions — this one is simply too large (eight pools, two of them
 * per-country arrays) to add inline without that file becoming unreadable.
 */
import {
  type AlbertaSchedule15Input,
  type AlbertaSchedule15Result,
  type CcogpeRegularFederal,
  type CcogpeRegularInput,
  type CcogpeSuccessorFederal,
  type CcogpeSuccessorInput,
  type CdeRegularFederal,
  type CdeRegularInput,
  type CdeSuccessorFederal,
  type CdeSuccessorInput,
  type CeeRegularFederal,
  type CeeRegularInput,
  type CeeSuccessorFederal,
  type CeeSuccessorInput,
  type CfreCountryRegularFederal,
  type CfreCountryRegularInput,
  type CfreCountrySuccessorFederal,
  type CfreCountrySuccessorInput,
  type CmedbFederal,
  computeAlbertaSchedule15,
  type EdaRegularFederal,
  type EdaRegularInput,
  type EdaSuccessorFederal,
  type EdaSuccessorInput,
  type FedeRegularFederal,
  type FedeRegularInput,
  type FedeSuccessorFederal,
  type FedeSuccessorInput,
  type SfedeCountryRegularFederal,
  type SfedeCountryRegularInput,
  type SfedeCountrySuccessorFederal,
  type SfedeCountrySuccessorInput,
} from '@classytic/ca-tax/t2';
import type {
  AlbertaResourceDeductions15Values,
  CcogpeRegularRow,
  CcogpeSuccessorRow,
  CdeRegularRow,
  CdeSuccessorRow,
  CeeRegularRow,
  CeeSuccessorRow,
  CfreCountryRegularRow,
  CfreCountrySuccessorRow,
  CmedbRow,
  EdaRegularRow,
  EdaSuccessorRow,
  FedeRegularRow,
  FedeSuccessorRow,
  ReturnInput,
  SfedeCountryRegularRow,
  SfedeCountrySuccessorRow,
} from '../return-input-contract.js';

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));
const yes = (v: unknown): boolean => v === 'yes';
/** A field the preparer actually entered, as opposed to left blank — `0` counts, `''`/`null`/`undefined` do not. */
const present = (v: unknown): boolean => v != null && v !== '';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** True when `v` (or anything nested inside it) carries an entered value. Used both to gate whole blocks and to decide whether an `albertaOverride` sub-object is worth including at all. */
function hasAnyValue(v: unknown): boolean {
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.some(hasAnyValue);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(hasAnyValue);
  return true;
}

/**
 * Reads a block's parallel `federal<Name>` / `alberta<Name>` fields into the
 * engine's `{ federal, albertaOverride }` shape. `overridableFields` is a
 * (possibly proper) subset of `fields` — the "must equal federal" lines the
 * spec gives no Alberta variant for simply never look up an `alberta<Name>`
 * key.
 *
 * `raw`'s type expresses the SAME `federal<Name>`/`alberta<Name>` pairing
 * every `XxxRow` type in `return-input-contract.ts` declares explicitly
 * (`EdaRegularRow.federalOpeningBalance`/`.albertaOpeningBalance`, etc.) —
 * `Capitalize<T>` derives the exact key set from the same `fields` tuple each
 * call site already passes, so a real row type (which has those keys) is
 * assignable here without a cast; only `cap(f)` itself — a runtime string
 * transform TypeScript cannot verify matches `Capitalize<T>` at the type
 * level — needs one narrow, local assertion to bridge the two.
 */
function readBlock<T extends string>(
  raw: Partial<Record<`federal${Capitalize<T>}` | `alberta${Capitalize<T>}`, number>> | undefined,
  fields: readonly T[],
  overridableFields: readonly T[],
): { federal: Partial<Record<T, number>>; albertaOverride: Partial<Record<T, number>> } {
  const federal: Partial<Record<T, number>> = {};
  const albertaOverride: Partial<Record<T, number>> = {};
  for (const f of fields) {
    const key = `federal${cap(f)}` as `federal${Capitalize<T>}`;
    if (present(raw?.[key])) federal[f] = num(raw?.[key]);
  }
  for (const f of overridableFields) {
    const key = `alberta${cap(f)}` as `alberta${Capitalize<T>}`;
    if (present(raw?.[key])) albertaOverride[f] = num(raw?.[key]);
  }
  return { federal, albertaOverride };
}

// ── Field lists — one per pool, matching schedule15-resource-related-deductions.ts's `XxxFederal` interfaces exactly (logical names; the actual UI/`ri` field is `federal<Name>` / `alberta<Name>`) ──

const EDA_REGULAR_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'saleTransfer',
  'regulation1201Claim',
] as const;
const EDA_SUCCESSOR_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'saleTransfer',
  'regulation1202Claim',
] as const;
const CMEDB_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'disposalTransfer',
] as const;
const CEE_REGULAR_ALL_FIELDS = [
  'openingBalance',
  'lookBackExpenses',
  'reclassifiedFromCde',
  'amalgamationTransfer',
  'renewableConservationExpenses',
  'otherAdditions',
  'governmentAssistance',
  'otherDeductions',
  'renouncedFlowThrough',
  'transferredToSuccessor',
  'renouncedLookBack',
] as const;
const CEE_REGULAR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherAdditions',
  'otherDeductions',
  'transferredToSuccessor',
] as const;
const CEE_SUCCESSOR_ALL_FIELDS = [
  'openingBalance',
  'reclassifiedFromCde',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
  'transferredToSuccessor',
] as const;
const CEE_SUCCESSOR_OVERRIDABLE_FIELDS = CEE_SUCCESSOR_ALL_FIELDS;
const CDE_REGULAR_ALL_FIELDS = [
  'openingBalance',
  'currentYearExpenses',
  'lookBackExpenses',
  'amalgamationTransfer',
  'otherAdditions',
  'reclassifiedFromCee',
  'governmentAssistance',
  'receivableOnDisposition',
  'otherDeductions',
  'renouncedFlowThrough',
  'transferredToSuccessor',
  'renouncedLookBack',
  'creditBalanceInCogpePool',
] as const;
const CDE_REGULAR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherAdditions',
  'receivableOnDisposition',
  'otherDeductions',
  'transferredToSuccessor',
  'creditBalanceInCogpePool',
] as const;
const CDE_SUCCESSOR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'reclassifiedFromCee',
  'creditBalanceInCogpePool',
  'otherDeductions',
  'transferredToSuccessor',
] as const;
const CDE_SUCCESSOR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'creditBalanceInCogpePool',
  'otherDeductions',
  'transferredToSuccessor',
] as const;
const CCOGPE_REGULAR_ALL_FIELDS = [
  'openingBalance',
  'currentYearExpenses',
  'amalgamationTransfer',
  'otherAdditions',
  'receivableOnDisposition',
  'governmentAssistance',
  'transferredToSuccessor',
  'otherDeductions',
] as const;
const CCOGPE_REGULAR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherAdditions',
  'receivableOnDisposition',
  'transferredToSuccessor',
  'otherDeductions',
] as const;
const CCOGPE_SUCCESSOR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'receivableOnDisposition',
  'transferredToSuccessor',
  'otherDeductions',
] as const;
// Every CCOGPE-successor field is overridable — same list both sides.
const CCOGPE_SUCCESSOR_OVERRIDABLE_FIELDS = CCOGPE_SUCCESSOR_ALL_FIELDS;
const FEDE_REGULAR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherDeductions',
  'foreignResourceIncome',
] as const;
const FEDE_REGULAR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherDeductions',
] as const;
const FEDE_SUCCESSOR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
  'foreignResourceIncome',
] as const;
const FEDE_SUCCESSOR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
] as const;
const SFEDE_REGULAR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherAdditions',
  'otherDeductions',
  'foreignResourceIncome',
] as const;
const SFEDE_REGULAR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherAdditions',
  'otherDeductions',
] as const;
const SFEDE_SUCCESSOR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
  'foreignResourceIncome',
] as const;
const SFEDE_SUCCESSOR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
] as const;
const CFRE_REGULAR_ALL_FIELDS = [
  'openingBalance',
  'currentYearExpenses',
  'amalgamationTransfer',
  'otherAdditions',
  'otherDeductions',
  'foreignResourceIncome',
] as const;
const CFRE_REGULAR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherAdditions',
  'otherDeductions',
] as const;
const CFRE_SUCCESSOR_ALL_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
  'foreignResourceIncome',
] as const;
const CFRE_SUCCESSOR_OVERRIDABLE_FIELDS = [
  'openingBalance',
  'amalgamationTransfer',
  'otherTransfer',
  'otherDeductions',
] as const;

// ── EDA ───────────────────────────────────────────────────────────────────

function edaRegular(raw: EdaRegularRow | undefined): EdaRegularInput {
  const { federal, albertaOverride } = readBlock(raw, EDA_REGULAR_FIELDS, EDA_REGULAR_FIELDS);
  return {
    federal: federal as EdaRegularFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
  };
}
function edaSuccessor(raw: EdaSuccessorRow | undefined): EdaSuccessorInput {
  const { federal, albertaOverride } = readBlock(raw, EDA_SUCCESSOR_FIELDS, EDA_SUCCESSOR_FIELDS);
  return {
    federal: federal as EdaSuccessorFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
  };
}

// ── CMEDB ─────────────────────────────────────────────────────────────────

function cmedbInput(raw: CmedbRow | undefined): AlbertaSchedule15Input['cmedb'] {
  if (!hasAnyValue(raw)) return undefined;
  const { federal, albertaOverride } = readBlock(raw, CMEDB_FIELDS, CMEDB_FIELDS);
  return {
    federal: federal as CmedbFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
  };
}

// ── CEE ───────────────────────────────────────────────────────────────────

function ceeRegular(raw: CeeRegularRow | undefined): CeeRegularInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    CEE_REGULAR_ALL_FIELDS,
    CEE_REGULAR_OVERRIDABLE_FIELDS,
  );
  const fullFederal: CeeRegularFederal = {
    currentYearExpenses: num(raw?.federalCurrentYearExpenses),
    ...federal,
  };
  return {
    federal: fullFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
  };
}
function ceeSuccessor(raw: CeeSuccessorRow | undefined): CeeSuccessorInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    CEE_SUCCESSOR_ALL_FIELDS,
    CEE_SUCCESSOR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as CeeSuccessorFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
  };
}

// ── CDE (consumes CCOGPE's already-computed subtotal — see the engine's own
//    module doc comment for the 015105/015133 cross-linkage this feeds) ────

function cdeRegular(
  raw: CdeRegularRow | undefined,
  daysInTaxYear: number | undefined,
): CdeRegularInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    CDE_REGULAR_ALL_FIELDS,
    CDE_REGULAR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as CdeRegularFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
    ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
  };
}
function cdeSuccessor(
  raw: CdeSuccessorRow | undefined,
  daysInTaxYear: number | undefined,
): CdeSuccessorInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    CDE_SUCCESSOR_ALL_FIELDS,
    CDE_SUCCESSOR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as CdeSuccessorFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
    ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
  };
}

// ── CCOGPE ────────────────────────────────────────────────────────────────

function ccogpeRegular(
  raw: CcogpeRegularRow | undefined,
  daysInTaxYear: number | undefined,
): CcogpeRegularInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    CCOGPE_REGULAR_ALL_FIELDS,
    CCOGPE_REGULAR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as CcogpeRegularFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
    ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
  };
}
function ccogpeSuccessor(
  raw: CcogpeSuccessorRow | undefined,
  daysInTaxYear: number | undefined,
): CcogpeSuccessorInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    CCOGPE_SUCCESSOR_ALL_FIELDS,
    CCOGPE_SUCCESSOR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as CcogpeSuccessorFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
    ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
  };
}

// ── FEDE ──────────────────────────────────────────────────────────────────

function fedeRegular(
  raw: FedeRegularRow | undefined,
  daysInTaxYear: number | undefined,
): FedeRegularInput {
  const { federal, albertaOverride } = readBlock(
    raw,
    FEDE_REGULAR_ALL_FIELDS,
    FEDE_REGULAR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as FedeRegularFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
    ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
  };
}
function fedeSuccessor(raw: FedeSuccessorRow | undefined): FedeSuccessorInput {
  // No `daysInTaxYear` — FEDE successor (015221) has no percentage rate at all.
  const { federal, albertaOverride } = readBlock(
    raw,
    FEDE_SUCCESSOR_ALL_FIELDS,
    FEDE_SUCCESSOR_OVERRIDABLE_FIELDS,
  );
  return {
    federal: federal as FedeSuccessorFederal,
    ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
    ...(present(raw?.claimed) ? { claimed: num(raw?.claimed) } : {}),
  };
}

// ── SFEDE — per-country arrays. Rows with no country code are dropped, the
//    same "blank array-editor row contributes nothing" rule every other
//    per-entry composer in this engine follows. ───────────────────────────

function sfedeRegularEntries(
  rows: SfedeCountryRegularRow[] | undefined,
  daysInTaxYear: number | undefined,
): SfedeCountryRegularInput[] {
  return (rows ?? [])
    .filter((r) => present(r?.countryCode))
    .map((r) => {
      const { federal, albertaOverride } = readBlock(
        r,
        SFEDE_REGULAR_ALL_FIELDS,
        SFEDE_REGULAR_OVERRIDABLE_FIELDS,
      );
      const fullFederal: SfedeCountryRegularFederal = {
        countryCode: String(r.countryCode),
        ...federal,
      };
      return {
        federal: fullFederal,
        ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
        ...(present(r.claimed) ? { claimed: num(r.claimed) } : {}),
        ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
      };
    });
}
function sfedeSuccessorEntries(
  rows: SfedeCountrySuccessorRow[] | undefined,
): SfedeCountrySuccessorInput[] {
  return (rows ?? [])
    .filter((r) => present(r?.countryCode))
    .map((r) => {
      const { federal, albertaOverride } = readBlock(
        r,
        SFEDE_SUCCESSOR_ALL_FIELDS,
        SFEDE_SUCCESSOR_OVERRIDABLE_FIELDS,
      );
      const fullFederal: SfedeCountrySuccessorFederal = {
        countryCode: String(r.countryCode),
        ...federal,
      };
      return {
        federal: fullFederal,
        ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
        ...(present(r.claimed) ? { claimed: num(r.claimed) } : {}),
      };
    });
}

// ── CFRE — per-country arrays, same row-dropping rule as SFEDE ─────────────

function cfreRegularEntries(
  rows: CfreCountryRegularRow[] | undefined,
  daysInTaxYear: number | undefined,
): CfreCountryRegularInput[] {
  return (rows ?? [])
    .filter((r) => present(r?.countryCode))
    .map((r) => {
      const { federal, albertaOverride } = readBlock(
        r,
        CFRE_REGULAR_ALL_FIELDS,
        CFRE_REGULAR_OVERRIDABLE_FIELDS,
      );
      const fullFederal: CfreCountryRegularFederal = {
        countryCode: String(r.countryCode),
        ...federal,
      };
      return {
        federal: fullFederal,
        ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
        ...(present(r.claimed) ? { claimed: num(r.claimed) } : {}),
        ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
        // 015293's "global foreign resource limit for the year designated for
        // that country" — no source anywhere in this engine (see the compute
        // module's doc comment); a plain per-country passthrough when the
        // preparer has that figure from elsewhere, omitted otherwise (the
        // engine then flags it and treats the B-component as nil).
        ...(present(r.globalForeignResourceLimit)
          ? { globalForeignResourceLimit: num(r.globalForeignResourceLimit) }
          : {}),
      };
    });
}
function cfreSuccessorEntries(
  rows: CfreCountrySuccessorRow[] | undefined,
  daysInTaxYear: number | undefined,
): CfreCountrySuccessorInput[] {
  return (rows ?? [])
    .filter((r) => present(r?.countryCode))
    .map((r) => {
      const { federal, albertaOverride } = readBlock(
        r,
        CFRE_SUCCESSOR_ALL_FIELDS,
        CFRE_SUCCESSOR_OVERRIDABLE_FIELDS,
      );
      const fullFederal: CfreCountrySuccessorFederal = {
        countryCode: String(r.countryCode),
        ...federal,
      };
      return {
        federal: fullFederal,
        ...(hasAnyValue(albertaOverride) ? { albertaOverride } : {}),
        ...(present(r.claimed) ? { claimed: num(r.claimed) } : {}),
        ...(daysInTaxYear !== undefined ? { daysInTaxYear } : {}),
      };
    });
}

// ── Entry point ───────────────────────────────────────────────────────────

/**
 * `ri.albertaResourceDeductions15` → `computeAlbertaSchedule15` → its result.
 * Schedule 15 applies only to corporations with resource pools (oil & gas /
 * mining), so — unlike most schedules this engine files unconditionally once
 * ANY federal figure exists — this composes ONLY when the preparer entered
 * something in at least one of the eight pools. Merely setting the 000060/
 * 000061 divergence flags or `daysInTaxYear` with no pool data is not
 * "entered something": those alone would produce every pool at a zero
 * balance, which is not a return worth filing this schedule for.
 */
export function assembleSchedule15(ri: ReturnInput): AlbertaSchedule15Result | undefined {
  const root: AlbertaResourceDeductions15Values | undefined = ri.albertaResourceDeductions15;
  if (!root) return undefined;

  const edaRegularRaw = root.edaRegular;
  const edaSuccessorRaw = root.edaSuccessor;
  const cmedbRaw = root.cmedb;
  const ceeRegularRaw = root.ceeRegular;
  const ceeSuccessorRaw = root.ceeSuccessor;
  const cdeRegularRaw = root.cdeRegular;
  const cdeSuccessorRaw = root.cdeSuccessor;
  const ccogpeRegularRaw = root.ccogpeRegular;
  const ccogpeSuccessorRaw = root.ccogpeSuccessor;
  const fedeRegularRaw = root.fedeRegular;
  const fedeSuccessorRaw = root.fedeSuccessor;
  const sfedeRegularRows = root.sfedeRegular ?? [];
  const sfedeSuccessorRows = root.sfedeSuccessor ?? [];
  const cfreRegularRows = root.cfreRegular ?? [];
  const cfreSuccessorRows = root.cfreSuccessor ?? [];

  const hasEda = hasAnyValue(edaRegularRaw) || hasAnyValue(edaSuccessorRaw);
  const hasCee = hasAnyValue(ceeRegularRaw) || hasAnyValue(ceeSuccessorRaw);
  const hasCde = hasAnyValue(cdeRegularRaw) || hasAnyValue(cdeSuccessorRaw);
  const hasCcogpe = hasAnyValue(ccogpeRegularRaw) || hasAnyValue(ccogpeSuccessorRaw);
  const hasFede = hasAnyValue(fedeRegularRaw) || hasAnyValue(fedeSuccessorRaw);
  const hasSfede =
    sfedeRegularRows.some((r) => present(r?.countryCode)) ||
    sfedeSuccessorRows.some((r) => present(r?.countryCode));
  const hasCfre =
    cfreRegularRows.some((r) => present(r?.countryCode)) ||
    cfreSuccessorRows.some((r) => present(r?.countryCode));
  const hasCmedb = hasAnyValue(cmedbRaw);

  if (
    !hasEda &&
    !hasCmedb &&
    !hasCee &&
    !hasCde &&
    !hasCcogpe &&
    !hasFede &&
    !hasSfede &&
    !hasCfre
  ) {
    return undefined;
  }

  const daysInTaxYear = present(root.daysInTaxYear) ? num(root.daysInTaxYear) : undefined;

  // CCOGPE is composed BEFORE CDE, matching `computeAlbertaSchedule15`'s own
  // ordering — CDE lines 015105/015133 need the CCOGPE subtotal, and
  // `computeAlbertaSchedule15` re-derives that internally regardless of the
  // order these are passed in, so this ordering is documentation, not a
  // functional requirement.
  const input: AlbertaSchedule15Input = {
    ...(hasEda
      ? { eda: { regular: edaRegular(edaRegularRaw), successor: edaSuccessor(edaSuccessorRaw) } }
      : {}),
    ...(hasCmedb ? { cmedb: cmedbInput(cmedbRaw) } : {}),
    ...(hasCee
      ? { cee: { regular: ceeRegular(ceeRegularRaw), successor: ceeSuccessor(ceeSuccessorRaw) } }
      : {}),
    ...(hasCde
      ? {
          cde: {
            regular: cdeRegular(cdeRegularRaw, daysInTaxYear),
            successor: cdeSuccessor(cdeSuccessorRaw, daysInTaxYear),
          },
        }
      : {}),
    ...(hasCcogpe
      ? {
          ccogpe: {
            regular: ccogpeRegular(ccogpeRegularRaw, daysInTaxYear),
            successor: ccogpeSuccessor(ccogpeSuccessorRaw, daysInTaxYear),
          },
        }
      : {}),
    ...(hasFede
      ? {
          fede: {
            regular: fedeRegular(fedeRegularRaw, daysInTaxYear),
            successor: fedeSuccessor(fedeSuccessorRaw),
          },
        }
      : {}),
    ...(hasSfede
      ? {
          sfede: {
            regular: sfedeRegularEntries(sfedeRegularRows, daysInTaxYear),
            successor: sfedeSuccessorEntries(sfedeSuccessorRows),
          },
        }
      : {}),
    ...(hasCfre
      ? {
          cfre: {
            regular: cfreRegularEntries(cfreRegularRows, daysInTaxYear),
            successor: cfreSuccessorEntries(cfreSuccessorRows, daysInTaxYear),
          },
        }
      : {}),
    // 000060/000061 are AT1 JACKET lines, shared across every reconciliation-
    // gated schedule (13/17/18/15) — collected ONCE on the jacket form
    // (`ri.alberta`), not duplicated per schedule. Matches
    // `assemble-at1-schedules.ts`'s own `divergenceFlags(ab)` helper.
    reportsDifferentAlbertaIncome: yes(ri.alberta?.reportsDifferentAlbertaIncome),
    electsDifferentDiscretionaryAmounts: yes(ri.alberta?.electsDifferentDiscretionaryAmounts),
  };

  return computeAlbertaSchedule15(input);
}
