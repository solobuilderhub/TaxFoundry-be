/**
 * FilingRecord — the record of a transmission to CRA/TRA (§7.2 "Filing").
 *
 * A filing is a regulatory act, so this record is never deleted (6-year+
 * retention; T183CORP custody). The transmitted payload is fixed at creation
 * (immutable payload fields); only the acknowledgement (status / confirmation /
 * error codes) is written later when CRA/TRA responds. The signed return is
 * addressed by hash, not stored inline.
 */
import mongoose from 'mongoose';
import { PROGRAMS } from '../../engagement/engagement-year/engagement-year.model.js';

export const FILING_CHANNELS = ['CIF', 'AT1_NETFILE', 'AT1_RSI', 'CO17_NETFILE'] as const;
export const FILING_STATUSES = ['submitted', 'accepted', 'rejected'] as const;

const t183Schema = new mongoose.Schema(
  {
    signedBy: { type: String, default: null }, // authorized signing officer (from the T183 authorization)
    signedPosition: { type: String, default: null },
    signedAt: { type: Date, default: null }, // actual officer signature time (not submission)
    authorizationMethod: { type: String, default: null },
    evidenceRef: { type: String, default: null },
    // The bound T183 authorization artifact (officer authorized EXACTLY this return).
    authorizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'T183Authorization',
      default: null,
    },
    // The preparer who transmitted (held custody) — distinct from the signing officer.
    transmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // e-signatures permitted since 2023-06-22; transmitter holds the original,
    // retention six years (Reg. 5800 permanent records: 2y after dissolution).
    retentionUntil: { type: Date, default: null },
  },
  { _id: false },
);

const filingRecordSchema = new mongoose.Schema(
  {
    engagementYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EngagementYear',
      required: true,
      index: true,
    },
    computedReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ComputedReturn',
      required: true,
    },
    // The signed review memo that authorized EXACTLY this computed return — the
    // review→sign-off→transmit binding (a signature can't authorize a changed return).
    reviewMemoId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReviewMemo', default: null },
    program: { type: String, enum: PROGRAMS, required: true },
    channel: { type: String, enum: FILING_CHANNELS, required: true },
    // Hash of the exact transmitted XML/SOAP payload — the immutable proof.
    payloadHash: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    t183: { type: t183Schema, default: () => ({}) },

    // Written on acknowledgement (may change once: submitted → accepted/rejected).
    status: { type: String, enum: FILING_STATUSES, default: 'submitted', index: true },
    confirmationNumber: { type: String, default: null },
    errorCodes: { type: [String], default: [] },
    acknowledgedAt: { type: Date, default: null },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

filingRecordSchema.index({ organizationId: 1, engagementYearId: 1, submittedAt: -1 });

export type FilingRecordDocument = mongoose.InferSchemaType<typeof filingRecordSchema>;
export type FilingRecordModel = mongoose.Model<FilingRecordDocument>;

const FilingRecord = mongoose.model<FilingRecordDocument>('FilingRecord', filingRecordSchema);
export default FilingRecord;
