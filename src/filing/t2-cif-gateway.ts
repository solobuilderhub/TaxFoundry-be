/**
 * T2 CIF (Corporation Internet Filing) transmission gateway — the ONLY component
 * that reaches CRA for a federal T2. Mirrors the AT1 gateway: transmission is a
 * HOST adapter, the pure renderer lives in @classytic/ca-tax.
 *
 * The default REFUSES (no CRA endpoint / not certified), so dev/test can never
 * write a filing-record for a return that was never sent. Inject the certified
 * CIF client via `setT2CifGateway` once enrolled in CRA's software-certification
 * program; tests inject a controllable fake.
 */
import { createError } from '@classytic/repo-core/errors';

export interface T2TransmitResult {
  status: 'accepted' | 'rejected';
  confirmationNumber: string | null;
  errorCodes: string[];
}

export interface T2CifGateway {
  transmit(payloadXml: string): Promise<T2TransmitResult>;
}

class NotConfiguredGateway implements T2CifGateway {
  async transmit(): Promise<T2TransmitResult> {
    throw createError(
      503,
      'T2 CIF transmission is not configured (no CRA endpoint / not certified). Wire the CIF client via setT2CifGateway().',
    );
  }
}

let gateway: T2CifGateway = new NotConfiguredGateway();

/** Install the T2 CIF gateway (the real CRA client, or a test fake). */
export function setT2CifGateway(g: T2CifGateway): void {
  gateway = g;
}

export function getT2CifGateway(): T2CifGateway {
  return gateway;
}
