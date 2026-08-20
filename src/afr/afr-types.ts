/**
 * CRA Auto-fill My Return (AFR-CT / "T2 Auto-fill") — the data contract.
 *
 * AFR delivers the corporate data CRA already holds for a business number: the
 * corporation's identification and, most usefully, the CARRYFORWARD balances and
 * account figures the preparer would otherwise re-key each year (loss pools, GRIP,
 * RDTOH, unused credits, instalments paid). It does NOT deliver the financial
 * statements / GIFI — those come from the corporation's books (the GIFI import).
 *
 * This is the shape our gateway returns and our mapper consumes; the wire format
 * CRA actually sends is the concern of the injected gateway implementation.
 */

export interface AfrIdentification {
  legalName?: string;
  businessNumber?: string;
  corpType?: string;
  /** Province of the permanent establishment / head office. */
  province?: string;
  address?: {
    line1?: string;
    city?: string;
    province?: string;
    postalCode?: string;
  };
}

/** Prior-year closing balances CRA carries forward into this return as openings. */
export interface AfrCarryforwards {
  nonCapitalLossOpening?: number;
  netCapitalLossOpening?: number;
  donationPoolOpening?: number;
  gripOpening?: number;
  itcPoolOpening?: number;
  businessFtcPoolOpening?: number;
}

export interface AfrRequest {
  /** 9-digit business number (BN9). */
  businessNumber: string;
  /** RC program-account identifier (e.g. "0001"). */
  programAccount: string;
  /** Tax-year end the data is requested for (ISO). */
  taxYearEnd?: string;
}

export interface AfrResponse {
  identification?: AfrIdentification;
  carryforwards?: AfrCarryforwards;
  /** Tax paid by instalments on the CRA account this year (line 840). */
  instalmentsPaid?: number;
  /** The tax year the data pertains to, echoed back by CRA. */
  taxYear?: { start?: string; end?: string };
}
