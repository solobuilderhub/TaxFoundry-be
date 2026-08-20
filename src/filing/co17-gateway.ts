/**
 * Revenu Québec CO-17 transmission gateway — the ONLY component that reaches RQ.
 *
 * Transmission (network egress, credentials, endpoints, ack parsing) is a HOST
 * gateway adapter, not a package. The default REFUSES to transmit (no RQ endpoint
 * configured), so dev/test can never write a filing-record for a return that was
 * never sent. The real RQ client is injected via `setCo17FilingGateway` once
 * certified; tests inject a controllable fake.
 */
import { createError } from '@classytic/repo-core/errors';

export interface Co17TransmitResult {
  status: 'accepted' | 'rejected';
  confirmationNumber: string | null;
  errorCodes: string[];
}

export interface Co17FilingGateway {
  transmit(payloadXml: string): Promise<Co17TransmitResult>;
}

class NotConfiguredGateway implements Co17FilingGateway {
  async transmit(): Promise<Co17TransmitResult> {
    throw createError(
      503,
      'CO-17 transmission is not configured (no Revenu Québec endpoint). Wire the RQ client via setCo17FilingGateway().',
    );
  }
}

let gateway: Co17FilingGateway = new NotConfiguredGateway();

export function setCo17FilingGateway(g: Co17FilingGateway): void {
  gateway = g;
}

export function getCo17FilingGateway(): Co17FilingGateway {
  return gateway;
}
