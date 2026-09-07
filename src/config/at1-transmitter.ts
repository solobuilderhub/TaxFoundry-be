/**
 * AT1 Net File transmitter / software identity (the EDI schedule).
 *
 * This is TaxFoundry-as-the-transmitter config, not per-return data. The TRA
 * issues the Software Certification Code (SCC) at certification; until then a dev
 * placeholder is used. Sourced from env so prod injects the real values.
 */
import type { At1TransmitterInfo } from '@classytic/ca-tax/t2';
import { PhoneFormatError, toNationalDigits } from '@classytic/contact/phone';

export const at1SoftwareCertCode = process.env.TRA_SOFTWARE_CERT_CODE ?? 'AB0000';

/**
 * The filer's phone, as TRA's EDI field wants it: national digits, no `+`, no
 * punctuation (specification rule 20100 — 10 to 15 digits, numeric).
 *
 * Parsed with `@classytic/contact/phone` so the operator can write the number
 * however is natural — `+1 780 555 0100`, `(780) 555-0100`, `780-555-0100` —
 * and one canonical spelling reaches the wire. That package validates against
 * real libphonenumber metadata rather than a length check, so a right-length
 * number with an unassigned prefix is caught here instead of by TRA.
 *
 * Deliberately does NOT throw: a development or test deployment with no filer
 * credentials must still boot and prepare payloads for review. An unparseable
 * value is passed through unchanged, and `validateAt1Transmitter` refuses it at
 * the transmit boundary — the one place it actually matters — naming the field.
 */
function transmitterPhone(): string {
  const raw = process.env.TRANSMITTER_PHONE ?? '0000000000';
  try {
    // No default region: TRA files Alberta returns, but the FILER may be
    // anywhere, and guessing a country silently rewrites someone's number.
    // A bare national number without a country code stays as typed.
    return raw.trim().startsWith('+') ? toNationalDigits(raw) : raw.trim();
  } catch (err) {
    if (err instanceof PhoneFormatError) return raw.trim();
    throw err;
  }
}

export const at1Transmitter: At1TransmitterInfo = {
  softwareCertCode: at1SoftwareCertCode,
  webServiceVersion: process.env.TRA_WS_VERSION ?? '0.0.1',
  softwareVersion: process.env.TAXFOUNDRY_VERSION ?? '0.1.0',
  serialNumber: process.env.TRA_SERIAL ?? 'SR_DEV',
  thirdPartyIndicator: '1', // filed by a third party (the CPA firm via TaxFoundry)
  legalName: process.env.TRANSMITTER_LEGAL_NAME ?? 'TaxFoundry Inc.',
  // Mandatory whenever thirdPartyIndicator is '1' (AT1 EDI schedule §3.3.6.1,
  // lines 023/051/055/057/059/061) — absent here, TRA's real endpoint rejects
  // with error 10025 ("missing one or more third party service provider
  // mandatory line items"), confirmed live 2026-08-30.
  organizationType: 'CORPORATION',
  address: {
    street: process.env.TRANSMITTER_ADDRESS_STREET ?? '10123 99 Street NW',
    city: process.env.TRANSMITTER_ADDRESS_CITY ?? 'Edmonton',
    province: process.env.TRANSMITTER_ADDRESS_PROVINCE ?? 'AB',
    postalCode: process.env.TRANSMITTER_ADDRESS_POSTAL ?? 'T5J 3H1',
    country: process.env.TRANSMITTER_ADDRESS_COUNTRY ?? 'CA',
  },
  contact: {
    firstName: process.env.TRANSMITTER_CONTACT_FIRST ?? 'TaxFoundry',
    lastName: process.env.TRANSMITTER_CONTACT_LAST ?? 'Support',
    position: 'Transmitter',
    phone: transmitterPhone(),
    email: process.env.TRANSMITTER_EMAIL ?? 'filing@taxfoundry.ca',
  },
};
