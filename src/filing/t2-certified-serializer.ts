/**
 * The CRA-certified T2 serializer contract — the ONLY thing that may produce a
 * fileable payload.
 *
 * The draft renderer (`renderT2DraftReturn`) produces a structural preview
 * (`<T2Return status="draft">`), NOT a certified CRA payload. Transmission must
 * therefore refuse until a real certified serializer is INJECTED here — an
 * environment string (`CRA_T2_SOFTWARE_CODE`) is necessary but NOT sufficient,
 * because a code does not transform the draft schema into the certified one.
 *
 * When TaxFoundry completes CRA certification, the certified serializer (built
 * against CRA's supplied schema) is wired via `setCertifiedT2Serializer` at boot.
 * Until then `getCertifiedT2Serializer()` returns null and the transmit path
 * fails closed — no adapter, no filing.
 */
import type { T2CifData } from '@classytic/ca-tax/t2';

export interface CertifiedT2Serializer {
  /** CRA schema version this serializer targets. */
  schemaVersion: string;
  /** The software approval id CRA issued at certification. */
  softwareApprovalId: string;
  /** Serialize the reviewed filing data into the certified CRA payload. */
  serialize(data: T2CifData): string;
}

let _serializer: CertifiedT2Serializer | null = null;

/** Inject the CRA-certified serializer (boot-time, post-certification). */
export function setCertifiedT2Serializer(serializer: CertifiedT2Serializer | null): void {
  _serializer = serializer;
}

/** The certified serializer, or null when TaxFoundry is not yet T2-certified. */
export function getCertifiedT2Serializer(): CertifiedT2Serializer | null {
  return _serializer;
}
