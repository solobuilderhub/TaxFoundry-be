/**
 * The working return — the shape persisted on `engagement.returnInput`, and
 * this project's AUTHORITATIVE data contract.
 *
 * ── Why this directory, not `apps/web`, is now the source ───────────────────
 *
 * `apps/server` is the trust boundary: it is the one place that must
 * validate untrusted input regardless of caller (the web app, a direct API
 * client, an MCP agent), and filing correctness — the actual AT1/T2
 * computation — lives here. Before this file existed, the contract was
 * authored once in `apps/web/_lib/return-input.ts` and hand-mirrored into
 * `apps/server/src/engine/return-input-contract.ts` with no drift
 * protection (that mirror's own header comment said so explicitly). This
 * directory closes that gap: ONE definition, in Zod (so it doubles as the
 * runtime validator at the HTTP boundary — see `return-input-validation.ts`
 * one level up), generating BOTH `return-input-contract.ts`'s types (via
 * `z.infer`, in the same file) AND `apps/web`'s own
 * `_lib/return-input.ts` (via `scripts/emit-return-input.ts`, checked by a
 * drift test — `tests/return-input-drift.test.ts`).
 *
 * `apps/web` still does not depend on this package at runtime — the
 * generator emits a plain, dependency-free `.ts` file into that repo, same
 * as `packages/ca-tax/scripts/emit-ui-schedule.ts` already does for the
 * schedule form schemas. Zod itself never reaches the browser.
 *
 * One optional key per schedule; the key set is pinned to the registry's
 * `ScheduleKey` union by a compile-time assertion in `apps/web`'s
 * `_config/registry.ts` (unchanged by this migration).
 */
import { z } from 'zod';
import {
  AlbertaContinuityValues,
  AlbertaDonationsValues,
  AlbertaForeignInvestment4Values,
  AlbertaIegValues,
  AlbertaOtherCredits3Values,
  AlbertaPoliticalContributions8Values,
  AlbertaResourceDeductions15Values,
  AlbertaRoyaltyCredit6Values,
  AlbertaRoyaltyDeduction5Values,
  AlbertaRoyaltySupplemental7Values,
  AlbertaSbdValues,
  AlbertaSredCredit9Values,
  AlbertaValues,
} from './at1-input.js';
import { QuebecValues } from './co17-input.js';
import {
  BalanceSheetValues,
  CapitalGainsValues,
  CapitalValues,
  CcaValues,
  CreditsValues,
  DividendsValues,
  DonationsValues,
  EifelValues,
  FirstReturnValues,
  ForeignValues,
  GifiNotesValues,
  IdentificationValues,
  IncomeStatementValues,
  InternetBusinessValues,
  LossesValues,
  NetIncomeValues,
  PaymentsValues,
  PreferredSharesValues,
  ProvincialAllocationValues,
  ReservesValues,
  SbdValues,
  ShareholdersValues,
} from './t2-input.js';

export const ReturnInputSchema = z
  .object({
    identification: IdentificationValues.optional(),
    balanceSheet: BalanceSheetValues.optional(),
    incomeStatement: IncomeStatementValues.optional(),
    gifiNotes: GifiNotesValues.optional(),
    netIncome: NetIncomeValues.optional(),
    donations: DonationsValues.optional(),
    dividends: DividendsValues.optional(),
    capitalGains: CapitalGainsValues.optional(),
    losses: LossesValues.optional(),
    preferredShares: PreferredSharesValues.optional(),
    eifel: EifelValues.optional(),
    sbd: SbdValues.optional(),
    cca: CcaValues.optional(),
    credits: CreditsValues.optional(),
    foreign: ForeignValues.optional(),
    provincialAllocation: ProvincialAllocationValues.optional(),
    payments: PaymentsValues.optional(),
    shareholders: ShareholdersValues.optional(),
    internetBusiness: InternetBusinessValues.optional(),
    firstReturn: FirstReturnValues.optional(),
    reserves: ReservesValues.optional(),
    capital: CapitalValues.optional(),
    quebec: QuebecValues.optional(),
    alberta: AlbertaValues.optional(),
    albertaSbd: AlbertaSbdValues.optional(),
    albertaDonations: AlbertaDonationsValues.optional(),
    albertaContinuity: AlbertaContinuityValues.optional(),
    albertaIeg: AlbertaIegValues.optional(),
    albertaOtherCredits3: AlbertaOtherCredits3Values.optional(),
    albertaForeignInvestment4: AlbertaForeignInvestment4Values.optional(),
    albertaRoyaltyDeduction5: AlbertaRoyaltyDeduction5Values.optional(),
    albertaRoyaltyCredit6: AlbertaRoyaltyCredit6Values.optional(),
    albertaRoyaltySupplemental7: AlbertaRoyaltySupplemental7Values.optional(),
    albertaPoliticalContributions8: AlbertaPoliticalContributions8Values.optional(),
    albertaSredCredit9: AlbertaSredCredit9Values.optional(),
    albertaResourceDeductions15: AlbertaResourceDeductions15Values.optional(),
  })
  .meta({ id: 'ReturnInput' })
  // Forward-compatible: apps/web and apps/server deploy independently, so a
  // new schedule key rolled out on web before server catches up must not
  // 400 every save until server redeploys — see return-input-validation.ts.
  .passthrough();

export type ReturnInput = z.infer<typeof ReturnInputSchema>;
