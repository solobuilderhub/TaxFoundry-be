/**
 * The AT1 SOAP client, tested against the SPECIFICATION'S OWN samples.
 *
 * The response bodies below are copied from Chapter 3 §3.3.17 — TRA's published
 * "response with two errors" and "response with success messages" — rather than
 * invented. A client tested only against fixtures I wrote would prove that it
 * agrees with me, which is not the question.
 *
 * ── The trap this file exists to pin ────────────────────────────────────────
 *
 * **TRA answers HTTP 200 whether or not the return was filed.** The outcome is
 * in the body. So the one mistake that matters — reading a 200 as success — is
 * the thing most of these cases are about.
 */
import { describe, expect, it } from 'vitest';
import {
  At1SoapClient,
  buildFileReturnEnvelope,
  interpretFileReturnResponse,
  parseFileReturnResponse,
} from '../src/filing/at1-soap-client.js';

/** §3.3.17 Sample 1 — a rejection. Note the HTTP status is still 200. */
const SAMPLE_ERRORS = `<?xml version='1.0' encoding='UTF-8'?>
<S:Envelope xmlns:S="http://www.w3.org/2003/05/soap-envelope">
  <S:Body>
    <ns3:fileReturnResponse xmlns:ns3="http://cit.tra.fin.goa/"
      xmlns:ns2="http://goa/tra/fin/cit/CITWebService.wsdl/types/">
      <return>
        <ns2:code>20070</ns2:code>
        <ns2:type>Organization Legal Name is invalid. Please verify filer details.</ns2:type>
      </return>
      <return>
        <ns2:code>20110</ns2:code>
        <ns2:type>Email Address is invalid. Please verify filer details.</ns2:type>
      </return>
    </ns3:fileReturnResponse>
  </S:Body>
</S:Envelope>`;

/** §3.3.17 Sample 2 — acceptance. */
const SAMPLE_SUCCESS = `<S:Envelope xmlns:S="http://www.w3.org/2003/05/soap-envelope">
  <S:Body>
    <ns3:fileReturnResponse xmlns:ns3="http://cit.tra.fin.goa/"
      xmlns:ns2="http://goa/tra/fin/cit/CITWebService.wsdl/types/">
      <return><ns2:code>30001</ns2:code><ns2:type>505005079123</ns2:type></return>
      <return><ns2:code>30002</ns2:code><ns2:type>Return Successfully Filed.</ns2:type></return>
      <return><ns2:code>30003</ns2:code><ns2:type>Thank you. Your Alberta Corporate Income Tax Return has been filed.</ns2:type></return>
      <return><ns2:code>30004</ns2:code><ns2:type>123456789</ns2:type></return>
      <return><ns2:code>30005</ns2:code><ns2:type>20100228</ns2:type></return>
    </ns3:fileReturnResponse>
  </S:Body>
</S:Envelope>`;

const PAYLOAD = '<?xml version="1.0" encoding="ISO-8859-1"?>\n<ReturnSubmission><Return/></ReturnSubmission>';

const okResponse = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'application/soap+xml' } });

describe('the SOAP envelope', () => {
  it('is SOAP 1.2 and calls fileReturn in TRA’s namespace', () => {
    const env = buildFileReturnEnvelope(PAYLOAD);
    // The WSDL binding is soap12; a 1.1 envelope is rejected.
    expect(env).toContain('http://www.w3.org/2003/05/soap-envelope');
    expect(env).toContain('xmlns:cit="http://cit.tra.fin.goa/"');
    expect(env).toContain('<cit:fileReturn>');
  });

  it('carries the return inside CDATA, byte-for-byte', () => {
    const env = buildFileReturnEnvelope(PAYLOAD);
    expect(env).toContain(`<![CDATA[${PAYLOAD}]]>`);
    // The payload must not be re-serialized: the filing record's hash is taken
    // over the renderer's bytes, and a reformat would break that proof.
    expect(env).toContain('<ReturnSubmission><Return/></ReturnSubmission>');
  });

  it('survives a payload containing the CDATA terminator', () => {
    // Vanishingly unlikely in a tax return, and catastrophic if unhandled — it
    // would close the section early and truncate the filing.
    const nasty = 'before]]>after';
    const env = buildFileReturnEnvelope(nasty);
    expect(env).toContain(']]]]><![CDATA[>');
    expect(env.match(/<arg0>/g)).toHaveLength(1);
  });
});

describe('reading TRA’s response', () => {
  it('parses the spec’s own error sample', () => {
    const entries = parseFileReturnResponse(SAMPLE_ERRORS);
    expect(entries.map((e) => e.code)).toEqual(['20070', '20110']);
    expect(entries[0]?.message).toContain('Organization Legal Name is invalid');
  });

  it('parses the spec’s own success sample', () => {
    const entries = parseFileReturnResponse(SAMPLE_SUCCESS);
    expect(entries.map((e) => e.code)).toEqual(['30001', '30002', '30003', '30004', '30005']);
  });

  it('accepts only on an explicit 30002, and takes the number from 30001', () => {
    const r = interpretFileReturnResponse(parseFileReturnResponse(SAMPLE_SUCCESS));
    expect(r.status).toBe('accepted');
    expect(r.confirmationNumber).toBe('505005079123');
    expect(r.errorCodes).toEqual([]);
  });

  it('REJECTS the error sample, keeping the codes for the preparer', () => {
    const r = interpretFileReturnResponse(parseFileReturnResponse(SAMPLE_ERRORS));
    expect(r.status).toBe('rejected');
    expect(r.confirmationNumber).toBeNull();
    expect(r.errorCodes).toEqual(['20070', '20110']);
  });

  it('does NOT accept a confirmation number without a 30002', () => {
    // A partial response is not a filing. Accepting on 30001 alone would record
    // a return as transmitted on the strength of a number TRA never confirmed.
    const partial = '<return><code>30001</code><type>505005079123</type></return>';
    const r = interpretFileReturnResponse(parseFileReturnResponse(partial));
    expect(r.status).toBe('rejected');
  });

  it('treats an unreadable body as a rejection that SAYS it was unreadable', () => {
    const r = interpretFileReturnResponse(parseFileReturnResponse('<html>gateway error</html>'));
    expect(r.status).toBe('rejected');
    expect(r.errorCodes).toEqual(['NO_RECOGNISED_RESPONSE']);
  });
});

describe('At1SoapClient over the wire', () => {
  const client = (impl: typeof fetch) =>
    new At1SoapClient({ endpoint: 'https://tra.example/CITReturnFilingSoap12HttpPort', fetchImpl: impl });

  it('posts SOAP 1.2 with the right content type', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init };
      return okResponse(SAMPLE_SUCCESS);
    }) as unknown as typeof fetch;

    await client(fake).transmit(PAYLOAD);

    expect(seen.url).toContain('CITReturnFilingSoap12HttpPort');
    expect(seen.init?.method).toBe('POST');
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/soap+xml;charset=UTF-8');
    expect(String(seen.init?.body)).toContain('<cit:fileReturn>');
  });

  it('returns accepted for the success sample', async () => {
    const fake = (async () => okResponse(SAMPLE_SUCCESS)) as unknown as typeof fetch;
    await expect(client(fake).transmit(PAYLOAD)).resolves.toMatchObject({
      status: 'accepted',
      confirmationNumber: '505005079123',
    });
  });

  it('returns rejected — NOT thrown — when TRA refuses with 200', async () => {
    // The distinction matters downstream: a rejection is the preparer's problem
    // and the attempt is closed; a throw means the outcome is unknown.
    const fake = (async () => okResponse(SAMPLE_ERRORS)) as unknown as typeof fetch;
    const r = await client(fake).transmit(PAYLOAD);
    expect(r.status).toBe('rejected');
    expect(r.errorCodes).toContain('20070');
  });

  it('THROWS on a network failure, because the outcome is unknown', async () => {
    const fake = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(client(fake).transmit(PAYLOAD)).rejects.toThrow(/UNKNOWN/);
  });

  it('THROWS on a non-200, which is transport rather than a filing decision', async () => {
    const fake = (async () => new Response('gateway timeout', { status: 504 })) as unknown as typeof fetch;
    await expect(client(fake).transmit(PAYLOAD)).rejects.toThrow(/HTTP 504[\s\S]*UNKNOWN/);
  });
});
