/**
 * AT1 Net File transmitter / software identity (the EDI schedule).
 *
 * This is TaxFoundry-as-the-transmitter config, not per-return data. The TRA
 * issues the Software Certification Code (SCC) at certification; until then a dev
 * placeholder is used. Sourced from env so prod injects the real values.
 */
import type { At1TransmitterInfo } from '@classytic/ca-tax/t2';

export const at1SoftwareCertCode = process.env.TRA_SOFTWARE_CERT_CODE ?? 'AB0000';

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
    phone: process.env.TRANSMITTER_PHONE ?? '0000000000',
    email: process.env.TRANSMITTER_EMAIL ?? 'filing@taxfoundry.ca',
  },
};
