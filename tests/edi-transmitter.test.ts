/**
 * The EDI schedule: the preparer is the source, and the guard still bites.
 *
 * `<Schedule Number="EDI">` carries who transmitted the return and with what
 * software. Every value used to come from environment variables read at boot
 * (`#config/at1-transmitter`) with no way to see or set them, so an
 * unconfigured deployment carried `AB0000` and `0000000000` — precisely the two
 * placeholders `validateAt1Transmitter` exists to refuse — and nothing said so
 * until a live transmission came back rejected with a bare numeric code.
 *
 * ── Why there is no configuration fallback ─────────────────────────────────
 *
 * A first attempt made this slice an OVERRIDE with config behind it. That was
 * worse than either option alone: the payload would state the transmitter's
 * identity from two sources at once, and a preparer reading a blank box could
 * not tell whether it meant "nil" or "whatever the server happens to be
 * configured with". Filing is the one place a value must have exactly one
 * origin. These tests pin the consequences of choosing entry.
 */
import { validateAt1Transmitter } from '@classytic/ca-tax/t2';
import { describe, expect, it } from 'vitest';
import { type ComposeSources, composeAt1FilingData } from '../src/engine/at1-netfile.service.js';

/** A complete, filable EDI schedule — what a preparer would enter. */
const COMPLETE = {
  softwareCertCode: 'AT1738',
  webServiceVersion: '1.0.0',
  softwareVersion: 'v2025.2',
  serialNumber: 'SR_0001',
  thirdPartyIndicator: '1',
  legalName: 'Fajr Capital',
  organizationType: 'CORPORATION',
  contactFirstName: 'Omi',
  contactLastName: 'Farhan',
  contactPosition: 'Preparer',
  contactPhone: '7805550100',
  contactEmail: 'filing@fajr.example',
  addressStreet: '10123 99 Street NW',
  addressCity: 'Edmonton',
  addressProvince: 'AB',
  addressPostalCode: 'T5J 3H1',
  addressCountry: 'CA',
};

/** The minimum a composer run needs; the EDI block is what varies. */
const sources = (edi?: Record<string, unknown>): ComposeSources => ({
  computed: {
    fields: [],
    identity: {
      legalName: 'Fajr Capital Ltd.',
      corporateAccountNumber: '1000922870',
      businessNumber: '100092287RC0001',
    },
    ...(edi ? { filingInput: { edi } } : {}),
  },
  client: {},
  engagement: { taxYearStart: new Date('2024-01-01'), taxYearEnd: new Date('2024-12-31') },
  certification: { firstName: 'A', lastName: 'B', position: 'Director' },
});

describe('the EDI schedule is entered, not configured', () => {
  it('carries every entered value into the payload', () => {
    const { transmitter } = composeAt1FilingData(sources(COMPLETE));
    expect(transmitter.softwareCertCode).toBe('AT1738');
    expect(transmitter.serialNumber).toBe('SR_0001');
    expect(transmitter.webServiceVersion).toBe('1.0.0');
    expect(transmitter.softwareVersion).toBe('v2025.2');
    expect(transmitter.thirdPartyIndicator).toBe('1');
    expect(transmitter.legalName).toBe('Fajr Capital');
    expect(transmitter.organizationType).toBe('CORPORATION');
    expect(transmitter.contact).toEqual({
      firstName: 'Omi',
      lastName: 'Farhan',
      position: 'Preparer',
      phone: '7805550100',
      email: 'filing@fajr.example',
    });
    expect(transmitter.address).toEqual({
      street: '10123 99 Street NW',
      city: 'Edmonton',
      province: 'AB',
      postalCode: 'T5J 3H1',
      country: 'CA',
    });
  });

  it('inherits NOTHING when the schedule is empty', () => {
    const { transmitter } = composeAt1FilingData(sources());
    // Not `AB0000`, not `TaxFoundry Inc.`, not the configured phone. An
    // unanswered mandatory field is absent, and the validator names it — which
    // is the fail-closed rule this engine applies everywhere else.
    expect(transmitter.softwareCertCode).toBe('');
    expect(transmitter.legalName).toBe('');
    expect(transmitter.contact.phone).toBe('');
    // And no address object at all: five empty strings is a different statement
    // from "no address was given".
    expect(transmitter.address).toBeUndefined();
  });

  it('treats blank and whitespace as unanswered, not as a value', () => {
    const { transmitter } = composeAt1FilingData(
      sources({ ...COMPLETE, softwareCertCode: '   ', legalName: '' }),
    );
    expect(transmitter.softwareCertCode).toBe('');
    expect(transmitter.legalName).toBe('');
    // The rest of the schedule is unaffected — one cleared box is not a reset.
    expect(transmitter.serialNumber).toBe('SR_0001');
  });

  it('refuses to invent an answer for the third-party indicator', () => {
    // §3.3.6.1 defines exactly '1' and '2'. Defaulting either way would state
    // something the preparer did not: '2' claims "not a third party", '1' makes
    // six more lines mandatory. So an unrecognised value is left unanswered for
    // the validator to report, not silently resolved.
    for (const junk of ['0', 'yes', '']) {
      const { transmitter } = composeAt1FilingData(
        sources({ ...COMPLETE, thirdPartyIndicator: junk }),
      );
      expect(transmitter.thirdPartyIndicator, `for ${JSON.stringify(junk)}`).toBe('');
      expect(validateAt1Transmitter(transmitter).map((d) => d.field)).toContain(
        'thirdPartyIndicator',
      );
    }
  });

  it('keeps a typed address even while the indicator says "2"', () => {
    /*
     * 023 and 051-061 are conditionally mandatory on 017 = '1', and
     * `AT1_EDI_LINE_ITEMS` already omits them when it is '2'. The RENDERER
     * decides what to emit; the composer must not also drop them, or a preparer
     * who fills the address and then flips the flag loses the lot on next save.
     */
    const { transmitter } = composeAt1FilingData(
      sources({ ...COMPLETE, thirdPartyIndicator: '2' }),
    );
    expect(transmitter.address?.street).toBe('10123 99 Street NW');
    expect(transmitter.organizationType).toBe('CORPORATION');
  });

  it('keeps a partly-entered address partly empty rather than guessing', () => {
    const { transmitter } = composeAt1FilingData(sources({ addressCity: 'Calgary' }));
    expect(transmitter.address?.city).toBe('Calgary');
    // The other parts stay empty. Filling them from anywhere would state an
    // address the preparer did not give; the validator reports the gaps.
    expect(transmitter.address?.province).toBe('');
    expect(transmitter.address?.postalCode).toBe('');
  });
});

describe('the jacket and the EDI schedule name the SAME software', () => {
  it('takes the jacket’s 000005001 from the entered code', () => {
    /*
     * The jacket states the certification code too. It read
     * `at1SoftwareCertCode` from config, which was the same value while the EDI
     * block was config-only — and became a self-contradicting payload the
     * moment a preparer could type their own: EDI001 would say AT1738 while
     * 000005001 still said AB0000.
     */
    const data = composeAt1FilingData(sources(COMPLETE));
    expect(data.softwareCertCode).toBe('AT1738');
    expect(data.softwareCertCode).toBe(data.transmitter.softwareCertCode);
  });

  it('leaves both empty together when nothing was entered', () => {
    const data = composeAt1FilingData(sources());
    expect(data.softwareCertCode).toBe('');
    expect(data.transmitter.softwareCertCode).toBe('');
  });
});

describe('making the EDI schedule editable did not weaken the transmit guard', () => {
  it('names every missing mandatory field rather than failing on the first', () => {
    const { transmitter } = composeAt1FilingData(sources());
    const defects = validateAt1Transmitter(transmitter);
    // The whole point of validating here: TRA returns ONE numeric code with no
    // message text, so a preparer would fix one field per round trip. Ten
    // named fields in one response is the difference.
    expect(defects.length).toBeGreaterThanOrEqual(10);
    expect(defects.map((d) => d.field)).toEqual(
      expect.arrayContaining([
        'softwareCertCode',
        'webServiceVersion',
        'softwareVersion',
        'serialNumber',
        'thirdPartyIndicator',
        'contact.firstName',
        'contact.lastName',
        'contact.position',
        'contact.phone',
        'contact.email',
      ]),
    );
  });

  it('still refuses the placeholder SCC and phone when they are TYPED', () => {
    // Allowing input was to let a real code be supplied, not to let a bad one
    // through. Typing the placeholder is exactly as refused as inheriting it.
    const { transmitter } = composeAt1FilingData(
      sources({ ...COMPLETE, softwareCertCode: 'AB0000', contactPhone: '0000000000' }),
    );
    const codes = validateAt1Transmitter(transmitter).map((d) => d.traCode);
    expect(codes).toContain('20010');
    expect(codes).toContain('20100');
  });

  it('passes once the schedule is completed — no environment involved', () => {
    // The case this feature exists for. Nothing is set in the environment, so
    // config alone could never transmit; entered values make it filable.
    expect(validateAt1Transmitter(composeAt1FilingData(sources(COMPLETE)).transmitter)).toEqual([]);
  });

  it('leaves EDI071/073 to the engagement, not the slice', () => {
    // Those two are genuinely per-return and already had a home. A second
    // source is how one figure comes to have two values.
    const plain = composeAt1FilingData(sources(COMPLETE));
    expect(plain.transmitter.isAmended).toBeUndefined();
    expect(plain.transmitter.amendmentDescription).toBeUndefined();

    const amended = composeAt1FilingData({
      ...sources(COMPLETE),
      amendment: { description: 'Revised CCA claim on class 10.' },
    });
    expect(amended.transmitter.isAmended).toBe(true);
    expect(amended.transmitter.amendmentDescription).toBe('Revised CCA claim on class 10.');
    // And the entered details still apply on the amendment path.
    expect(amended.transmitter.softwareCertCode).toBe('AT1738');
  });
});
