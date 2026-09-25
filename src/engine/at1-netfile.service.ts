/**
 * Prepare the Alberta AT1 Net File payload for review.
 *
 * Composes `At1FilingData` from the ledger (engagement period), the client record
 * (identity + address + CAN), the latest computed-return (allocation factor +
 * Alberta tax), the certification (supplied at prepare/sign time), and the
 * transmitter config — then renders the XML and hashes it. Read-only: this does
 * NOT write a filing-record. A filing-record is created only by an actual
 * transmission (the SOAP client), so a rendered-but-unsent return never looks filed.
 */
import { createHash } from 'node:crypto';
import {
  At1CriticalFieldMissingError,
  type At1FilingData,
  At1MandatoryFieldMissingError,
  type At1ScheduleData,
  At1TaxPayableMismatchError,
  type At1TransmitterInfo,
  assertAt1MandatoryComplete,
  assertAt1SchedulesComplete,
  renderAt1NetFile,
} from '@classytic/ca-tax/t2';
import { createError } from '@classytic/repo-core/errors';
import clientRepository from '#resources/engagement/client/client.repository.js';
import type { EngagementYearDocument } from '#resources/engagement/engagement-year/engagement-year.model.js';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import computedReturnRepository from '#resources/ledger/computed-return/computed-return.repository.js';
import type { WithId } from '#shared/db.js';

export interface Certification {
  firstName: string;
  lastName: string;
  position: string;
}

export interface PrepareAt1Params {
  engagementId: string;
  orgId: string;
  certification: Certification;
  /**
   * True on the real filing path. Enforces every mandatory jacket field that has
   * no safe default. A DRAFT stays lenient and renders anyway — refusing to show
   * a preparer the return is not how they discover which box is empty.
   */
  forFiling?: boolean;
}

export interface PrepareAt1Result {
  payloadHash: string;
  xml: string;
  /**
   * The transmitter actually composed into this payload — the EDI schedule as
   * the preparer entered it.
   *
   * Returned so the transmit boundary can validate what is being SENT.  It
   * used to validate `at1Transmitter`, the deployment config, which was the
   * same object back when config was the only source. Once the EDI schedule
   * became preparer-entered that guard checked the wrong thing in both
   * directions: a configured deployment passed while transmitting whatever
   * was typed, and an unconfigured one failed even when correctly filled in.
   */
  transmitter: At1TransmitterInfo;
}

function fieldValue(fields: readonly { line: string; value: unknown }[], line: string): number {
  const f = fields.find((x) => x.line === line);
  return f ? Number(f.value) : 0;
}

/** A trimmed string, or undefined — never the empty string, which reads as supplied. */
const str = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s === '' ? undefined : s;
};

/** The same rule for a figure carried on the frozen filing input. */
const frozenNum = (
  frozen: Record<string, unknown> | undefined,
  key: string,
): Record<string, number> => {
  const v = frozen?.[key];
  return v != null && Number.isFinite(Number(v)) ? { [key]: Number(v) } : {};
};

/**
 * A yes/no answer from the editor, which stores the literal `"yes"` / `"no"` a
 * radio produced. An UNANSWERED question is not "No": the specification encodes
 * No as `2`, so defaulting to false would answer for the corporation. Anything
 * that is not one of the two known answers is treated as unanswered, and the
 * filing path refuses rather than guessing.
 *
 * Booleans are accepted too, so a caller assembling `At1FilingData` directly
 * (the engine tests, a future importer) is not forced through the editor's
 * string representation.
 */
const flag = (
  source: Record<string, unknown> | undefined,
  key: string,
): Record<string, boolean> => {
  const v = source?.[key];
  if (typeof v === 'boolean') return { [key]: v };
  if (v === 'yes') return { [key]: true };
  if (v === 'no') return { [key]: false };
  return {};
};

/**
 * A single-digit code answer (jacket 030, 039, 041, 051), absent when blank.
 *
 * Kept separate from `flag` because these are not yes/no: the editor stores the
 * code the select produced, and the value IS the answer rather than a boolean's
 * encoding. Kept separate from `str` because the key has to be omitted
 * entirely, not set to undefined — `At1FilingData` distinguishes "no answer"
 * from "answered", and an explicit `undefined` property would satisfy neither
 * the spread nor the completeness check cleanly.
 */
const code = (source: Record<string, unknown> | undefined, key: string): Record<string, string> => {
  const v = str(source?.[key]);
  return v === undefined ? {} : { [key]: v };
};

/** A date answer (jacket 052, 053) off the frozen input, where it is an ISO string. */
const dateField = (
  source: Record<string, unknown> | undefined,
  key: string,
): Record<string, Date> => {
  const v = source?.[key];
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? {} : { [key]: v };
  const s = str(v);
  if (s === undefined) return {};
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? {} : { [key]: d };
};

export interface AmendmentIdentity {
  clientId: unknown;
  program: string;
  taxYearEnd: Date | string;
}

/**
 * The relationship an amendment must have to the return it corrects: same
 * client, same program, same tax year end. Extracted as a pure function (no
 * DB access) so the business rule is unit-testable without `mongodb-memory-server` —
 * `prepareAt1NetFile` only fetches `target` and hands it here.
 */
export function assertValidAmendmentTarget(
  engagement: AmendmentIdentity,
  target: AmendmentIdentity | null,
): void {
  if (!target) {
    throw createError(422, 'This engagement amends an engagement that no longer exists');
  }
  if (
    String(target.clientId) !== String(engagement.clientId) ||
    target.program !== engagement.program ||
    new Date(target.taxYearEnd).getTime() !== new Date(engagement.taxYearEnd).getTime()
  ) {
    throw createError(
      422,
      'The engagement this return amends must be the same client, program and tax year end — an amendment corrects a filed period, it does not refile a different one',
    );
  }
}

/** What the pure composer needs — already loaded, so the function stays testable. */
export interface ComposeSources {
  computed: {
    fields: { line: string; value: unknown }[];
    identity?: Record<string, unknown>;
    filingInput?: Record<string, unknown>;
  };
  client: {
    name?: string;
    address?: { street?: string; city?: string; province?: string; postalCode?: string };
    corporateAccountNumber?: string;
    businessNumber?: string;
    contactPerson?: string;
    contactTelephone?: string;
    natureOfBusiness?: string;
    typeOfCorporation?: string;
    authorizedEmail?: string;
  };
  engagement: { taxYearStart: Date; taxYearEnd: Date };
  /**
   * Set when this engagement amends a previously-filed one (EDI071/EDI073 —
   * see `at1-netfile.service.ts`'s `prepareAt1NetFile`, which resolves and
   * validates `amendsEngagementYearId` before this composer ever sees it).
   */
  amendment?: { description: string };
  certification: Certification;
  /**
   * True on the real filing path. The live client record is then NOT consulted:
   * every identity value must come from the frozen snapshot, or the payload
   * could carry an edit made after the return was computed and reviewed.
   */
  forFiling?: boolean;
}

/**
 * The EDI schedule — Net File transmitter / software identity, as ENTERED.
 *
 * ── The preparer is the source. There is no configuration fallback ──────────
 *
 * These values were read from environment variables at boot
 * (`#config/at1-transmitter`) and there was no way to see or set them. An
 * unconfigured deployment therefore carried `AB0000` and `0000000000` — exactly
 * the two placeholders `validateAt1Transmitter` exists to refuse — and nothing
 * in the interface said so until a live transmission came back rejected with a
 * bare numeric code and no message text.
 *
 * A first attempt made the `edi` slice an OVERRIDE with config as the fallback.
 * That was worse than either option alone: the payload would then state the
 * transmitter's identity from two sources at once, and a preparer reading a
 * blank box could not tell whether it meant "nil" or "whatever the server
 * happens to be configured with". Filing is the one place a value must have
 * exactly one origin.
 *
 * So the slice is authoritative and unconditional. A field nobody entered is
 * EMPTY, not inherited — and `validateAt1Transmitter` names it at the transmit
 * boundary, which is the fail-closed behaviour this engine applies everywhere
 * else: a missing mandatory field refuses rather than filing a plausible
 * default.
 *
 * ── Two couplings this broke, both fixed at the same time ──────────────────
 *
 * 1. The jacket ALSO carries the certification code, at 000005001. It read
 *    `at1SoftwareCertCode` from config while the EDI schedule would have read
 *    the entered value, so a preparer who supplied their own code produced a
 *    payload whose two halves named different software. It reads this now.
 * 2. `at1-transmit.service.ts` validated `at1Transmitter` — the CONFIG — not
 *    the transmitter actually being sent. With entry in play that guard would
 *    have passed a configured deployment while transmitting whatever was
 *    typed, and failed an unconfigured one that had been filled in correctly.
 *    It validates the composed transmitter now.
 *
 * ── What is NOT here ───────────────────────────────────────────────────────
 *
 * `isAmended` / `amendmentDescription` (EDI071/073). Those two are genuinely
 * per-return and already come off the engagement, applied after this. Two
 * sources for one figure is how they come to disagree.
 */
export function resolveTransmitter(src: ComposeSources): At1TransmitterInfo {
  const edi = (src.computed.filingInput?.edi ?? {}) as Record<string, string | undefined>;
  /** Entered and non-blank, or undefined. Whitespace is not an answer. */
  const v = (key: string): string | undefined => {
    const raw = edi[key];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    return trimmed === '' ? undefined : trimmed;
  };
  /**
   * The empty string for a field nobody filled in.
   *
   * `At1TransmitterInfo` types these as required, and the honest value for an
   * unanswered mandatory field is absent — not a placeholder that looks filed.
   * `validateAt1Transmitter` reports each one by name, so the preparer is told
   * which box, rather than TRA returning a numeric code for the first of them.
   */
  const req = (key: string): string => v(key) ?? '';

  const thirdParty = v('thirdPartyIndicator');
  const info: At1TransmitterInfo = {
    softwareCertCode: req('softwareCertCode'),
    webServiceVersion: req('webServiceVersion'),
    softwareVersion: req('softwareVersion'),
    serialNumber: req('serialNumber'),
    // §3.3.6.1 defines exactly '1' and '2'. Anything else is not an answer, and
    // defaulting either way would state something the preparer did not: '2'
    // claims "not a third party", '1' makes six more lines mandatory. Left as
    // the empty string for the validator to name.
    thirdPartyIndicator: (thirdParty === '1' || thirdParty === '2'
      ? thirdParty
      : '') as At1TransmitterInfo['thirdPartyIndicator'],
    legalName: req('legalName'),
    contact: {
      firstName: req('contactFirstName'),
      lastName: req('contactLastName'),
      position: req('contactPosition'),
      phone: req('contactPhone'),
      email: req('contactEmail'),
    },
  };

  const organizationType = v('organizationType');
  if (
    organizationType === 'CORPORATION' ||
    organizationType === 'PARTNERSHIP' ||
    organizationType === 'INDIVIDUAL'
  ) {
    info.organizationType = organizationType;
  }

  /*
   * The address is emitted only when something was entered — `address` is
   * optional on the type, and an object of five empty strings is not the same
   * statement as no address at all. Which of its parts are MANDATORY depends on
   * line 017, and `AT1_EDI_LINE_ITEMS` already applies that rule when it emits;
   * every entered part is kept here regardless of the flag's current value, so
   * a preparer who fills the address and then flips 017 does not lose it.
   */
  const street = v('addressStreet');
  const line2 = v('addressLine2');
  const city = v('addressCity');
  const province = v('addressProvince');
  const postalCode = v('addressPostalCode');
  const country = v('addressCountry');
  if (street || line2 || city || province || postalCode || country) {
    info.address = {
      street: street ?? '',
      city: city ?? '',
      province: province ?? '',
      postalCode: postalCode ?? '',
      country: country ?? '',
      ...(line2 ? { line2 } : {}),
    };
  }

  return info;
}

/**
 * Shape the filing data — PURE, so the mapping can be tested without a database.
 *
 * Extracted after a mapping bug that no test could see: the AT1 jacket answers
 * were read off `computed.identity`, which carries only the client-derived
 * fields, instead of `computed.filingInput`, which is where the editor's slices
 * are frozen. Every answer silently resolved to undefined. Nothing failed,
 * because nothing exercised the composition with real editor data.
 */
export function composeAt1FilingData(src: ComposeSources): At1FilingData {
  // On the filing path the live client record is off limits: an identity value
  // must come from the frozen snapshot or not at all. Falling back would let a
  // post-sign-off edit to the client reach a transmitted return, which is the
  // exact thing freezing exists to prevent.
  const live = <T>(v: T): T | undefined => (src.forFiling ? undefined : v);

  const fields = src.computed.fields as { line: string; value: unknown }[];
  // Identity from the FROZEN snapshot captured at compute time — not the live
  // client/engagement — so a post-sign-off edit can't change the filed return.
  const frozen = src.computed.identity;
  const frozenAddr = (frozen?.address ?? {}) as Record<string, unknown>;
  // The AT1 jacket answers live on the frozen RETURN INPUT, not on `identity` —
  // `identity` carries only the client-derived fields (name, address, dates).
  // Reading them off `identity` silently yielded undefined for every one.
  const ab = (src.computed.filingInput?.alberta ?? {}) as Record<string, unknown>;
  /*
   * 000082 — instalments and other payments made for the year.
   *
   * On its own slice, not `alberta`, because the editor collects it once for
   * the engagement (`payments.instalmentsPaid`) and an engagement is a single
   * program's return: an AT1 engagement's instalments are the ALBERTA ones.
   *
   * Nothing read it before, and `at1-line-items.ts` files the line as
   * `d.instalmentsPaid ?? 0`. So every AT1 for a corporation that pays
   * instalments — which is most of them — transmitted 082 as ZERO and, because
   * line 090 subtracts it, overstated the balance owing by the whole amount
   * paid. Two wrong figures on the two lines TRA uses to decide what the
   * corporation still owes.
   */
  const pay = (src.computed.filingInput?.payments ?? {}) as Record<string, unknown>;
  const transmitter = resolveTransmitter(src);
  const data: At1FilingData = {
    /*
     * 000005001 — the jacket states the certification code too, and it must be
     * the SAME code the EDI schedule states at EDI001. This read
     * `at1SoftwareCertCode` from config, which was fine while the EDI block
     * was config-only and became a self-contradicting payload the moment a
     * preparer could type their own.
     */
    softwareCertCode: transmitter.softwareCertCode,
    legalName: String(frozen?.legalName ?? live(src.client.name) ?? ''),
    // 011/013/016 are typed on the jacket only — no client-record fallback.
    ...(str(frozen?.operatingName) !== undefined
      ? { operatingName: str(frozen?.operatingName) }
      : {}),
    address: {
      street: String(frozenAddr.street ?? live(src.client.address?.street) ?? ''),
      ...(str(frozenAddr.line2) !== undefined ? { line2: str(frozenAddr.line2) } : {}),
      city: String(frozenAddr.city ?? live(src.client.address?.city) ?? ''),
      province: String(frozenAddr.province ?? live(src.client.address?.province) ?? 'AB'),
      ...(str(frozenAddr.country) !== undefined ? { country: str(frozenAddr.country) } : {}),
      postalCode: String(frozenAddr.postalCode ?? live(src.client.address?.postalCode) ?? ''),
    },
    corporateAccountNumber: String(
      frozen?.corporateAccountNumber ?? live(src.client.corporateAccountNumber) ?? '',
    ),
    businessNumber: String(frozen?.businessNumber ?? live(src.client.businessNumber) ?? ''),
    taxYearBegin: frozen?.taxYearStart
      ? new Date(frozen.taxYearStart as string)
      : src.engagement.taxYearStart,
    taxYearEnd: frozen?.taxYearEnd
      ? new Date(frozen.taxYearEnd as string)
      : src.engagement.taxYearEnd,
    allocationFactor: fieldValue(fields, 'allocationFactor'),
    albertaTaxPayable: fieldValue(fields, 'albertaTaxPayable'),
    albertaTaxableIncome: fieldValue(fields, 'albertaTaxableIncome'),
    // Lines 068 and 070, from the engine. Without them the payload files 068 as
    // a copy of 080 and 070 as nil, which reconciles arithmetically but reports
    // no small business deduction on a return that claimed one.
    basicAlbertaTax: fieldValue(fields, 'basicAlbertaTax'),
    smallBusinessDeduction: fieldValue(fields, 'albertaSmallBusinessDeduction'),

    // ── The rest of the mandatory jacket ─────────────────────────────────────
    // Identity from the client record; answers and figures from the FROZEN
    // filing input captured at compute time, never the live editor document.
    contactPerson: str(frozen?.contactPerson ?? live(src.client.contactPerson)),
    contactTelephone: str(frozen?.contactTelephone ?? live(src.client.contactTelephone)),
    natureOfBusiness: str(frozen?.natureOfBusiness ?? live(src.client.natureOfBusiness)),
    typeOfCorporation: str(frozen?.typeOfCorporation ?? live(src.client.typeOfCorporation)),
    authorizedEmail: str(frozen?.authorizedEmail ?? live(src.client.authorizedEmail)),
    // Nothing freezes a certification telephone of its own; the draft path has
    // always used the contact telephone, so filing reads the FROZEN copy of it.
    // Reading only `frozen.certificationTelephone` left 103 blank on every filing.
    certificationTelephone: str(
      frozen?.certificationTelephone ??
        frozen?.contactTelephone ??
        live(src.client.contactTelephone),
    ),
    // 000101 — the date the return is certified, which is now, not the year end.
    certificationDate: new Date(),

    // Figures the AT1 restates from the federal return.
    ...frozenNum(ab, 'grossRevenue'),
    ...frozenNum(ab, 'totalAssets'),
    // 000082 — see `pay` above. Absent stays absent: the line itself defaults
    // to zero when filed, but an explicit zero here and "never entered" are the
    // same filing, and inventing a figure would be worse than either.
    ...frozenNum(pay, 'instalmentsPaid'),

    // The jacket's yes/no answers. An UNANSWERED question stays undefined so the
    // line is dropped rather than answered "No" on the corporation's behalf —
    // the filing path then refuses, which is the correct outcome.
    //
    // `associatedWithCcpcs` (000001) is asked here directly rather than reused
    // from Schedule 1's own `isAssociated` derivation (`assemble-at1-schedules.ts`'s
    // `scheduleOne`): that derivation is undefined whenever the corporation
    // isn't claiming the Alberta SBD at all, but jacket line 001 is
    // unconditionally mandatory regardless of whether Schedule 1 applies.
    ...flag(ab, 'associatedWithCcpcs'),
    ...flag(ab, 'windUpOfSubsidiary'),
    ...flag(ab, 'firstYearAfterAmalgamation'),
    ...flag(ab, 'taxYearEndChanged'),
    ...flag(ab, 'finalReturn'),
    ...flag(ab, 'transferOfProperty'),
    ...flag(ab, 'reportsDifferentAlbertaIncome'),
    ...flag(ab, 'electsDifferentDiscretionaryAmounts'),
    ...flag(ab, 'preparedByTaxPreparerForFee'),

    // The follow-ups those answers make mandatory. Each is conditional (`X`) in
    // §3.2.3.1, so none appears in the mandatory-jacket list — but 039 becomes
    // required the moment 038 is "Yes", and 051 (then 052 or 053) the moment
    // 050 is. The engine drops any whose gate is shut, so a stale answer left
    // by a since-changed gate cannot reach TRA.
    ...code(ab, 'specialCorporationStatus'),
    ...code(ab, 'taxYearEndChangeReason'),
    ...code(ab, 'functionalCurrency'),
    ...code(ab, 'finalReturnReason'),
    ...dateField(ab, 'dateOfAmalgamation'),
    ...dateField(ab, 'dateOperationsCeased'),
    innovationEmploymentGrant: fieldValue(fields, 'innovationEmploymentGrant'),
    certification: src.certification,
    transmitter: src.amendment
      ? { ...transmitter, isAmended: true, amendmentDescription: src.amendment.description }
      : transmitter,
  };
  return data;
}

export async function prepareAt1NetFile(params: PrepareAt1Params): Promise<PrepareAt1Result> {
  const { certification } = params;
  if (!certification?.firstName || !certification?.lastName || !certification?.position) {
    throw createError(400, 'certification { firstName, lastName, position } is required');
  }

  const engagement = (await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  })) as WithId<EngagementYearDocument> | null;
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program !== 'AT1')
    throw createError(400, 'Net File preparation applies to AT1 engagements');

  const client = await clientRepository.getOne({
    _id: engagement.clientId,
    organizationId: params.orgId,
  });
  if (!client) throw createError(404, 'Client not found');

  // Amended-return filing (EDI071/EDI073). Validated HERE, not at write time:
  // `amendsEngagementYearId` is only ever meaningful in relation to Net File
  // preparation, so that is where a stale/cross-client/cross-year reference
  // gets caught, rather than duplicating the check on every save.
  let amendment: { description: string } | undefined;
  const amends = (engagement as { amendsEngagementYearId?: unknown }).amendsEngagementYearId;
  if (amends) {
    const target = (await engagementYearRepository.getOne({
      _id: amends,
      organizationId: params.orgId,
    })) as WithId<EngagementYearDocument> | null;
    assertValidAmendmentTarget(engagement, target);
    // A blank description is NOT refused here — same leniency as every other
    // mandatory-without-default field in this file (gross revenue, contact
    // info, …): a draft must still render so the preparer can see what to
    // fill in. `assertAt1MandatoryComplete` (below, `forFiling` only) is the
    // actual gate.
    amendment = {
      description: String(
        (engagement as { amendmentDescription?: string }).amendmentDescription ?? '',
      ).trim(),
    };
  }

  // Latest computed snapshot for this engagement.
  const computed = await computedReturnRepository.getOne(
    { engagementYearId: engagement._id, organizationId: params.orgId },
    { sort: { createdAt: -1 } },
  );
  if (!computed) throw createError(409, 'No computed return yet — run compute first');

  // Freezing is what makes a filed return provably the one that was reviewed. A
  // snapshot without it cannot support that claim, so a FILING refuses and asks
  // for a recompute; a draft still renders from the live input.
  if (params.forFiling && (computed as { filingInput?: unknown }).filingInput === undefined) {
    throw createError(
      422,
      'This computed return predates filing-input freezing, so the filed content ' +
        'cannot be proven to match what was computed and reviewed. Recompute the ' +
        'return before filing.',
    );
  }

  const data = composeAt1FilingData({
    computed: computed as unknown as ComposeSources['computed'],
    client: client as unknown as ComposeSources['client'],
    engagement: engagement as unknown as ComposeSources['engagement'],
    certification,
    ...(amendment ? { amendment } : {}),
    ...(params.forFiling ? { forFiling: true } : {}),
  });

  // The schedules as the ENGINE assembled them, stored with the computed return.
  // Rendering without them files a jacket and nothing else — which is what this
  // path did until the payload was persisted alongside the summary fields.
  const schedulePayloads =
    (computed as { schedulePayloads?: At1ScheduleData[] }).schedulePayloads ?? [];

  // The renderer refuses to generate a payload missing a critical mandatory field
  // (spec §3.2.3 — software MUST disallow it). That is a preparer-correctable
  // omission, not a server fault: surface it as 422 with the field names intact,
  // so the return editor can say WHICH box is empty rather than "server error".
  // On the real filing path, every mandatory field with no safe default must be
  // present. A draft deliberately skips this and renders anyway, so the preparer
  // can SEE the return they need to complete.
  if (params.forFiling) {
    try {
      assertAt1MandatoryComplete(data);
      assertAt1SchedulesComplete(schedulePayloads);
    } catch (err) {
      if (err instanceof At1MandatoryFieldMissingError) throw createError(422, err.message);
      throw err;
    }
  }

  let xml: string;
  try {
    xml = renderAt1NetFile(data, schedulePayloads);
  } catch (err) {
    if (err instanceof At1CriticalFieldMissingError) throw createError(422, err.message);
    if (err instanceof At1TaxPayableMismatchError) throw createError(422, err.message);
    throw err;
  }
  const payloadHash = createHash('sha256').update(xml, 'utf8').digest('hex');
  return { payloadHash, xml, transmitter: data.transmitter };
}
