/**
 * CRA Auto-fill My Return gateway — the ONLY component that reaches CRA's AFR-CT
 * (Corporations Auto-fill) e-service.
 *
 * The network call, the CRA credential / Represent-a-Client (RepID + RC59)
 * authorization, and the redirect handshake are all HOST integration, not a
 * package. The default REFUSES (503, no CRA connection), so dev/test never
 * silently "auto-fill" from nowhere. A real AFR client is injected via
 * `setAfrGateway` once the org is enrolled with CRA My Business Account /
 * Represent-a-Client; tests inject a controllable fake.
 */
import { createError } from '@classytic/repo-core/errors';
import type { AfrRequest, AfrResponse } from './afr-types.js';

export interface AfrGateway {
  fetchCorporateData(req: AfrRequest): Promise<AfrResponse>;
}

class NotConfiguredAfrGateway implements AfrGateway {
  async fetchCorporateData(): Promise<AfrResponse> {
    throw createError(
      503,
      'CRA Auto-fill is not configured. It requires enrollment with CRA My Business Account or Represent a Client (RepID + a valid RC59 on file). Wire the AFR client via setAfrGateway().',
    );
  }
}

let gateway: AfrGateway = new NotConfiguredAfrGateway();

export function setAfrGateway(g: AfrGateway): void {
  gateway = g;
}

export function getAfrGateway(): AfrGateway {
  return gateway;
}
