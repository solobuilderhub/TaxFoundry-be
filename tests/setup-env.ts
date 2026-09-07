/**
 * Test-environment defaults, applied before any module reads `process.env`.
 *
 * `src/config/at1-transmitter.ts` resolves the filer (transmitter) identity at
 * MODULE LOAD, and `at1-transmit.service.ts` now refuses to transmit when that
 * identity would be rejected by TRA. The shipped fallback phone is
 * `0000000000`, which TRA rejects with error 20100 — so without this, every
 * test that exercises the transmit path fails on deployment configuration
 * rather than on the thing it is testing.
 *
 * These values model a CORRECTLY CONFIGURED deployment. They are deliberately
 * obvious test data, and they never reach TRA: the tests that use them install
 * a mock gateway. A real deployment supplies its own via the environment.
 */
process.env.TRANSMITTER_PHONE ??= '7805550100';
process.env.TRANSMITTER_EMAIL ??= 'filing-tests@example.com';
process.env.TRANSMITTER_LEGAL_NAME ??= 'TaxFoundry Test Filer Inc.';
process.env.TRANSMITTER_CONTACT_FIRST ??= 'Test';
process.env.TRANSMITTER_CONTACT_LAST ??= 'Filer';
process.env.TRA_SOFTWARE_CERT_CODE ??= 'AB9999';
