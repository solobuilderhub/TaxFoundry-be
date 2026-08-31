/**
 * AT1 Net File SOAP client — the real transmission adapter for Alberta TRA.
 *
 * Written against the specification's own WSDL and sample messages (Chapter 3
 * §3.3.15–§3.3.17, held in `research/sources/tra-spec/`). Alberta publishes both,
 * which is why this jurisdiction can be implemented at all: CRA's certified CIF
 * schema and Revenu Québec's ImpôtNet element names are distributed only through
 * their software-certification programmes.
 *
 * ── The contract, from the spec ─────────────────────────────────────────────
 *
 *   POST {endpoint}
 *   Content-Type: application/soap+xml;charset=UTF-8      ← SOAP 1.2, not 1.1
 *
 *   <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
 *                  xmlns:cit="http://cit.tra.fin.goa/">
 *     <soap:Header/>
 *     <soap:Body>
 *       <cit:fileReturn><arg0><![CDATA[ …ReturnSubmission… ]]></arg0></cit:fileReturn>
 *     </soap:Body>
 *   </soap:Envelope>
 *
 * **The payload goes inside CDATA**, as a string argument — not as child
 * elements. That is why the renderer's output is passed through untouched and
 * never re-parsed here: re-serializing it would change the bytes that were
 * hashed into the filing record, and the hash is what proves what was sent.
 *
 * ── Reading the response ────────────────────────────────────────────────────
 *
 * TRA answers **HTTP 200 whether or not the return was accepted**. The outcome
 * is in the body: a list of `<return><code/><type/></return>` pairs.
 *
 *   30001  confirmation number          30004  Alberta corporate account number
 *   30002  "Return Successfully Filed."  30005  taxation year end
 *   30003  the message to show the filer
 *   2xxxx  an error — the return was NOT filed
 *
 * So a 200 is not success and must never be read as one. Acceptance is the
 * presence of a **30002**, and the confirmation number is the **30001** value.
 */
import { createError } from '@classytic/repo-core/errors';
import type { At1FilingGateway, At1TransmitResult } from './at1-gateway.js';

/** The success codes, named rather than scattered as magic numbers. */
const CODE_CONFIRMATION_NUMBER = '30001';
const CODE_SUCCESSFULLY_FILED = '30002';

/** Anything in the 2xxxx band is a rejection with a reason. */
const isErrorCode = (code: string): boolean => /^2\d{4}$/.test(code);

export interface At1SoapClientOptions {
  /** Full endpoint URL, e.g. `https://host/CITNetFile-…/CITReturnFilingSoap12HttpPort`. */
  endpoint: string;
  /** Abort the request after this long. TRA has no published SLA; default 60s. */
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** `<![CDATA[…]]>` cannot contain `]]>`; split it if the payload ever does. */
function cdata(payload: string): string {
  return `<![CDATA[${payload.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function buildFileReturnEnvelope(payloadXml: string): string {
  return [
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:cit="http://cit.tra.fin.goa/">',
    '  <soap:Header/>',
    '  <soap:Body>',
    '    <cit:fileReturn>',
    `      <arg0>${cdata(payloadXml)}</arg0>`,
    '    </cit:fileReturn>',
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');
}

/** One `<return>` pair from the response. */
export interface At1ResponseEntry {
  code: string;
  message: string;
}

/**
 * Pull the `<return>` pairs out of the response.
 *
 * Deliberately a regex rather than an XML parse: the element names carry
 * namespace prefixes TRA chooses (`ns2`, `ns3`) and the spec's own samples show
 * them varying, so matching on the LOCAL name is more robust than binding to a
 * prefix that is not ours to depend on.
 */
export function parseFileReturnResponse(xml: string): At1ResponseEntry[] {
  const entries: At1ResponseEntry[] = [];
  const block = /<(?:\w+:)?return>([\s\S]*?)<\/(?:\w+:)?return>/g;
  for (const m of xml.matchAll(block)) {
    const body = m[1] ?? '';
    const code = /<(?:\w+:)?code>([\s\S]*?)<\/(?:\w+:)?code>/.exec(body)?.[1]?.trim();
    const message = /<(?:\w+:)?type>([\s\S]*?)<\/(?:\w+:)?type>/.exec(body)?.[1]?.trim() ?? '';
    if (code) entries.push({ code, message });
  }
  return entries;
}

/**
 * Turn the response entries into a filing outcome.
 *
 * Fail-closed: anything that is not an explicit 30002 is a rejection. A response
 * we cannot read is NOT an acceptance — an unrecognised body means the outcome
 * is unknown, and treating unknown as filed is how a return gets marked
 * transmitted when it never was.
 */
export function interpretFileReturnResponse(entries: At1ResponseEntry[]): At1TransmitResult {
  const accepted = entries.some((e) => e.code === CODE_SUCCESSFULLY_FILED);
  const confirmationNumber =
    entries.find((e) => e.code === CODE_CONFIRMATION_NUMBER)?.message ?? null;
  const errorCodes = entries.filter((e) => isErrorCode(e.code)).map((e) => e.code);

  if (accepted) {
    return { status: 'accepted', confirmationNumber, errorCodes: [] };
  }
  return {
    status: 'rejected',
    confirmationNumber: null,
    // An empty body would otherwise yield "rejected with no reason", which reads
    // like a clean refusal. Say what actually happened.
    errorCodes: errorCodes.length > 0 ? errorCodes : ['NO_RECOGNISED_RESPONSE'],
  };
}

/** The real TRA gateway. Install with `setAt1FilingGateway(new At1SoapClient(...))`. */
export class At1SoapClient implements At1FilingGateway {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: At1SoapClientOptions) {
    if (!opts.endpoint) throw new Error('At1SoapClient requires an endpoint');
    this.endpoint = opts.endpoint;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async transmit(payloadXml: string): Promise<At1TransmitResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          // SOAP 1.2 — the binding in the WSDL is soap12, and TRA rejects a 1.1
          // envelope. `soapAction` is empty per the binding, so it is not sent.
          'Content-Type': 'application/soap+xml;charset=UTF-8',
          'Accept-Encoding': 'gzip,deflate',
        },
        body: buildFileReturnEnvelope(payloadXml),
        signal: controller.signal,
      });
    } catch (err) {
      // A network failure leaves the outcome UNKNOWN — the return may or may not
      // have reached TRA. The transmit service marks the attempt so a retry
      // reconciles rather than blindly resending; do not convert this to a
      // rejection, which would read as "TRA said no".
      throw createError(
        502,
        `AT1 transmission did not complete: ${err instanceof Error ? err.message : String(err)}. ` +
          'The outcome is UNKNOWN — reconcile before resending.',
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();

    // TRA answers 200 for both outcomes, so a non-200 is a transport problem
    // rather than a filing decision.
    if (!res.ok) {
      throw createError(
        502,
        `AT1 endpoint returned HTTP ${res.status}. The outcome is UNKNOWN — reconcile before resending.`,
      );
    }

    return { ...interpretFileReturnResponse(parseFileReturnResponse(text)), rawResponseText: text };
  }
}

/**
 * Build the client from env, or return null when no endpoint is configured.
 *
 * Absence is the normal state before certification, and it must stay a REFUSAL
 * rather than a silent no-op: `at1-gateway.ts` keeps its 503 stub installed
 * until this returns something.
 */
export function at1SoapClientFromEnv(): At1SoapClient | null {
  const endpoint = process.env.TRA_NETFILE_ENDPOINT;
  if (!endpoint) return null;
  const timeout = Number(process.env.TRA_NETFILE_TIMEOUT_MS);
  return new At1SoapClient({
    endpoint,
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
  });
}
