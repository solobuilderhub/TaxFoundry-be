/**
 * AT1 Net File transmission gateway — the ONLY component that reaches TRA.
 *
 * Per the repo boundary rule, transmission (network egress, credentials,
 * endpoints, ack parsing) is a HOST gateway adapter — NOT a package. The pure
 * renderer lives in @classytic/ca-tax; this sends its output.
 *
 * The default implementation REFUSES to transmit (no TRA endpoint configured), so
 * dev/test can never accidentally write a filing-record for a return that was
 * never actually sent. The real SOAP client (against the TRA WSDL) is injected
 * via `setAt1FilingGateway` once certified; tests inject a controllable fake.
 */
import { createError } from '@classytic/repo-core/errors';

export interface At1TransmitResult {
  status: 'accepted' | 'rejected';
  confirmationNumber: string | null;
  errorCodes: string[];
}

export interface At1FilingGateway {
  transmit(payloadXml: string): Promise<At1TransmitResult>;
}

class NotConfiguredGateway implements At1FilingGateway {
  async transmit(): Promise<At1TransmitResult> {
    throw createError(
      503,
      'AT1 Net File transmission is not configured (no TRA endpoint). Wire the SOAP client via setAt1FilingGateway().',
    );
  }
}

let gateway: At1FilingGateway = new NotConfiguredGateway();

/** Install the transmission gateway (the real SOAP client, or a test fake). */
export function setAt1FilingGateway(g: At1FilingGateway): void {
  gateway = g;
}

export function getAt1FilingGateway(): At1FilingGateway {
  return gateway;
}
