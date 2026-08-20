/**
 * ReviewMemo — the human-in-the-loop review artifact (§4.3).
 * A cited, colour-coded memo the preparer signs off before filing. Filing is
 * blocked until status === 'signed_off' with no unresolved red flags (enforced
 * later at the transmit route). Every flag links to its ITA section / CRA guide
 * — this cited trail is also the customer's s.163.2 due-diligence defence.
 */
import mongoose from 'mongoose';

export const FLAG_SEVERITIES = ['green', 'amber', 'red'] as const;
export const MEMO_STATUSES = ['draft', 'signed_off'] as const;

const flagSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: FLAG_SEVERITIES, required: true },
    code: { type: String, required: true }, // diagnostic id
    message: { type: String, required: true },
    citation: { type: String, default: null }, // ITA s.xxx / CRA guide ref
    line: { type: String, default: null }, // CRA line / AT1 Line-Item-ID
    resolved: { type: Boolean, default: false },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { _id: true },
);

const reviewMemoSchema = new mongoose.Schema(
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
      default: null,
    },
    status: { type: String, enum: MEMO_STATUSES, default: 'draft', index: true },
    flags: { type: [flagSchema], default: [] },
    signedOffBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    signedOffAt: { type: Date, default: null },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

reviewMemoSchema.index({ organizationId: 1, engagementYearId: 1, status: 1 });

export type ReviewMemoDocument = mongoose.InferSchemaType<typeof reviewMemoSchema>;
export type ReviewMemoModel = mongoose.Model<ReviewMemoDocument>;

const ReviewMemo = mongoose.model<ReviewMemoDocument>('ReviewMemo', reviewMemoSchema);
export default ReviewMemo;
