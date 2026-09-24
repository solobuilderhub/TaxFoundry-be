/**
 * The AT1 jacket's identification block, as the RETURN states it.
 *
 * Every tax package a preparer has used lets them type 010, the address, the
 * contact, 028, 029, the CAN and the BN straight onto the jacket. This product
 * used to hold them on the client record only, shown read-only on the jacket,
 * which read as "missing" and made the client form a second, unexplained step.
 *
 * So the jacket's own `alberta` slice now carries them, and an entry there is
 * what files. The client record stays a FALLBACK — a field left blank on the
 * jacket takes the client's value — so returns prepared before this change, and
 * clients whose profile already holds these, file exactly as before.
 *
 * One function, used by both compute (the frozen identity the filing path
 * reads) and review (the missing/malformed flags), so the two cannot disagree
 * about which value a return carries.
 */

export interface At1Identity {
  name?: string;
  /** 000011 — jacket only; the client record has no operating name. */
  operatingName?: string;
  businessNumber?: string;
  corporateAccountNumber?: string;
  address?: {
    street?: string;
    /** 000013 — jacket only. */
    line2?: string;
    city?: string;
    province?: string;
    /** 000016 — jacket only. */
    country?: string;
    postalCode?: string;
  };
  contactPerson?: string;
  contactTelephone?: string;
  natureOfBusiness?: string;
  typeOfCorporation?: string;
  authorizedEmail?: string;
}

/** Entered and non-blank, or undefined. Whitespace is not an answer. */
function entered(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

export function effectiveAt1Identity(
  client: At1Identity | null | undefined,
  returnInput: Record<string, unknown> | null | undefined,
): At1Identity {
  const ab = (returnInput?.alberta ?? {}) as Record<string, unknown>;
  const c = client ?? {};
  const pick = (key: string, fallback: string | undefined) => entered(ab[key]) ?? fallback;

  const street = pick('addressStreet', c.address?.street);
  const line2 = pick('addressLine2', c.address?.line2);
  const city = pick('addressCity', c.address?.city);
  const province = pick('addressProvince', c.address?.province);
  const country = pick('addressCountry', c.address?.country);
  const postalCode = pick('addressPostalCode', c.address?.postalCode);
  const hasAddress = [street, line2, city, province, country, postalCode].some(
    (v) => v !== undefined,
  );

  const out: At1Identity = {};
  const set = <K extends keyof At1Identity>(key: K, value: At1Identity[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  set('name', pick('legalName', c.name));
  set('operatingName', pick('operatingName', c.operatingName));
  set('businessNumber', pick('businessNumber', c.businessNumber));
  set('corporateAccountNumber', pick('corporateAccountNumber', c.corporateAccountNumber));
  if (hasAddress) {
    out.address = {
      ...(street !== undefined ? { street } : {}),
      ...(line2 !== undefined ? { line2 } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(province !== undefined ? { province } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(postalCode !== undefined ? { postalCode } : {}),
    };
  }
  set('contactPerson', pick('contactPerson', c.contactPerson));
  set('contactTelephone', pick('contactTelephone', c.contactTelephone));
  set('natureOfBusiness', pick('natureOfBusiness', c.natureOfBusiness));
  set('typeOfCorporation', pick('typeOfCorporation', c.typeOfCorporation));
  set('authorizedEmail', pick('authorizedEmail', c.authorizedEmail));
  return out;
}
