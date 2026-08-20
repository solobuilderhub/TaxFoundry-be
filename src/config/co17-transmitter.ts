/**
 * Québec CO-17 filing identity — SEPARATE from federal T2 and Alberta AT1.
 *
 * Revenu Québec runs its own CO-17 software-certification with its own software
 * code. TaxFoundry is not yet RQ-certified; until then this is a dev placeholder
 * and the transmit path fails closed on the certified serializer (not on this).
 */
export const co17SoftwareCode = process.env.RQ_CO17_SOFTWARE_CODE ?? 'CO17-DEV-UNCERTIFIED';
