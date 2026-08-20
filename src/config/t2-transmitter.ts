/**
 * Federal T2 filing identity — SEPARATE from Alberta AT1.
 *
 * Federal T2 (CRA Corporation Internet Filing) and Alberta AT1 (TRA Net File) are
 * distinct filing channels with distinct certification programs and codes. They
 * MUST NOT share a software code — doing so mislabels a federal payload with a
 * provincial credential.
 *
 * TaxFoundry is not yet CRA-certified for T2 transmission. Until it is:
 *   - `t2SoftwareCode` is a dev placeholder distinct from the AB code;
 *   - `isT2FilingCertified` is false unless the real CRA code is present in env,
 *     and the transmit path is expected to FAIL CLOSED on it.
 * The structural CIF export (draft/preview) may still render with the placeholder,
 * but nothing may transmit while `isT2FilingCertified` is false.
 */

/** CRA-issued T2 software code — only set once certified. Distinct from the AB SCC. */
export const t2SoftwareCode = process.env.CRA_T2_SOFTWARE_CODE ?? 'T2-DEV-UNCERTIFIED';

/**
 * True only when a real CRA T2 software code has been injected. The transmit path
 * must refuse to send when this is false — a structural export is not a filing.
 */
export const isT2FilingCertified = Boolean(
  process.env.CRA_T2_SOFTWARE_CODE && !process.env.CRA_T2_SOFTWARE_CODE.startsWith('T2-DEV'),
);
