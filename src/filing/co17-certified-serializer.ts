/**
 * The Revenu-Québec-certified CO-17 serializer contract — the ONLY thing that may
 * produce a fileable CO-17 payload.
 *
 * The draft renderer (`renderCo17DraftReturn`) is a structural preview, NOT a
 * certified RQ payload. Transmission refuses until a real certified serializer
 * (built against RQ's CO-17 online-filing schema) is injected here — an
 * environment string is not sufficient. Until then this returns null and the
 * transmit path fails closed.
 */
import type { Co17ReturnData } from '@classytic/ca-tax/t2';

export interface CertifiedCo17Serializer {
  schemaVersion: string;
  /** The RQ software authorization / partner id issued at certification. */
  softwareAuthorizationId: string;
  serialize(data: Co17ReturnData): string;
}

let _serializer: CertifiedCo17Serializer | null = null;

export function setCertifiedCo17Serializer(serializer: CertifiedCo17Serializer | null): void {
  _serializer = serializer;
}

export function getCertifiedCo17Serializer(): CertifiedCo17Serializer | null {
  return _serializer;
}
