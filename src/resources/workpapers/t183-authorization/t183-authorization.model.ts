/**
 * T183Authorization — the corporate officer's authorization to electronically
 * file (Form T183CORP), a control SEPARATE from the preparer's review sign-off.
 *
 * The review sign-off attests the preparer reviewed the return; the T183
 * authorization is the AUTHORIZED OFFICER attesting they authorize CRA e-filing
 * of exactly this computed return. Both bind to the SAME immutable filing
 * snapshot (`computedReturnId` + its `resultHash`), so a signature can never
 * authorize a different computation, and the signer of record is the officer who
 * authorized — never arbitrary text supplied at transmit time.
 *
 * Immutable evidence: append a new authorization when the return is recomputed
 * (a prior authorization no longer matches the current `computedReturnId`).
 */
import mongoose from 'mongoose';

/** How the officer's authorization was obtained. */
export const T183_AUTH_METHODS = [
  'wet_signature',
  'electronic_signature',
  'verbal_confirmed',
  'other',
] as const;

const t183AuthorizationSchema = new mongoose.Schema(
  {
    engagementYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EngagementYear',
      required: true,
      index: true,
    },
    // The EXACT computation the officer authorized (+ its content hash for tamper-evidence).
    computedReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ComputedReturn',
      required: true,
      index: true,
    },
    resultHash: { type: String, default: null },
    // The authorizing corporate officer (from T183CORP).
    officerName: { type: String, required: true },
    officerPosition: { type: String, required: true },
    // The ACTUAL date/time the officer signed T183 — distinct from transmission.
    signedAt: { type: Date, required: true },
    authorizationMethod: { type: String, enum: T183_AUTH_METHODS, default: 'wet_signature' },
    /** The T183 form/version the officer signed (e.g. 'T183CORP-2024'). */
    formVersion: { type: String, default: null },
    /** Reference to the retained signed T183 document (attachment id / URL / note). */
    evidenceRef: { type: String, default: null },
    /** The preparer who recorded (and holds custody of) the authorization. */
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

t183AuthorizationSchema.index({ organizationId: 1, engagementYearId: 1, computedReturnId: 1 });

export type T183AuthorizationDocument = mongoose.InferSchemaType<typeof t183AuthorizationSchema>;

const T183Authorization = mongoose.model<T183AuthorizationDocument>(
  'T183Authorization',
  t183AuthorizationSchema,
);
export default T183Authorization;
