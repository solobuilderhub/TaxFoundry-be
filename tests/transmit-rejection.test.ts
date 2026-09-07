/**
 * A rejection arrives on an HTTP 200 — and must not read as success.
 *
 * The REQUEST succeeded; the FILING did not. Live QA transmitted to TRA's
 * certification endpoint on 2026-09-07, TRA refused with code `20100`, and the
 * action still returned 200. The UI read the status code, announced "Return
 * filed", and left the preparer able to re-transmit a return the authority had
 * already refused, for a reason nothing surfaced. Two filing records exist from
 * exactly that.
 *
 * So the transmit result carries the refusal WITH it. These tests pin the
 * shape the caller needs to tell the two outcomes apart.
 */
import { describe, expect, it } from 'vitest';
import { interpretFileReturnResponse } from '../src/filing/at1-soap-client.js';

describe('interpretFileReturnResponse — telling acceptance from refusal', () => {
  it('reports an acceptance with its confirmation number and no errors', () => {
    const r = interpretFileReturnResponse([
      { code: '30002', message: 'Successfully filed' },
      { code: '30001', message: 'TRA-2026-000123' },
    ]);
    expect(r.status).toBe('accepted');
    expect(r.confirmationNumber).toBe('TRA-2026-000123');
    expect(r.errorCodes).toEqual([]);
    expect(r.errorMessages).toEqual([]);
  });

  it('keeps TRA’s own wording on a rejection', () => {
    const r = interpretFileReturnResponse([
      { code: '20115', message: 'Address Line 1 is invalid. Please verify filer details.' },
    ]);
    expect(r.status).toBe('rejected');
    expect(r.confirmationNumber).toBeNull();
    expect(r.errorCodes).toEqual(['20115']);
    expect(r.errorMessages[0]).toMatch(/Address Line 1 is invalid/);
  });

  it('says so when TRA sends a code with NO message — the case that was unreadable', () => {
    // This is verbatim what came back for the filer-phone rejection: a bare
    // code. Recording it as `["20100"]` and nothing else is what made the
    // failure impossible to act on.
    const r = interpretFileReturnResponse([{ code: '20100', message: '' }]);
    expect(r.status).toBe('rejected');
    expect(r.errorMessages).toEqual(['20100: (no message from TRA)']);
  });

  it('never reads an unrecognised body as an acceptance', () => {
    const r = interpretFileReturnResponse([]);
    expect(r.status).toBe('rejected');
    expect(r.errorCodes).toEqual(['NO_RECOGNISED_RESPONSE']);
  });
});
