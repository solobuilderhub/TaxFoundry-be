/**
 * Test-environment defaults, applied before any module reads `process.env`.
 *
 * ── Deliberately empty of transmitter settings ──────────────────────────────
 *
 * This file used to set six of them — `TRANSMITTER_PHONE`,
 * `TRA_SOFTWARE_CERT_CODE` and friends — because `src/config/at1-transmitter.ts`
 * resolved the filer identity at MODULE LOAD and `at1-transmit.service.ts`
 * refused to transmit when that identity would be rejected by TRA. Without
 * them, every test touching the transmit path failed on deployment
 * configuration rather than on the thing it was testing.
 *
 * The EDI schedule is preparer-entered now, so there is no such configuration:
 * `src/config/at1-transmitter.ts` is gone, and the filer's identity comes off
 * the return like every other filed value. A transmit fixture supplies it
 * explicitly — see `EDI_FILER` in `ledger-invariants.test.ts` and
 * `compute-route.integration.test.ts` — which is better than a module-load
 * side effect, because the test now SHOWS what makes the return filable.
 *
 * Kept as a file rather than deleted: `vitest.config.ts` names it in
 * `setupFiles`, and the next environment default that genuinely has to land
 * before module load belongs here.
 */
export {};
