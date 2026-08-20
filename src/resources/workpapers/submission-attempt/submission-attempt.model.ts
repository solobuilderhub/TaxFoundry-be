/**
 * SubmissionAttempt — a durable record created BEFORE any network egress, so a
 * transmission is never sent without a persisted trace.
 *
 * The failure it closes: if CRA/TRA accepts the return but the process or DB dies
 * immediately after, the post-response writes never commit — with no attempt
 * record, an operator could retransmit and double-file. Here the attempt is
 * written first (status `pending`), keyed by an IDEMPOTENCY KEY unique per
 * (org, program, exact payload). A retry finds the prior attempt and RECONCILES
 * by key instead of blindly resending; a concurrent double-send collides on the
 * unique index. The post-response transaction transitions the attempt to its
 * final state alongside the filing record.
 *
 *   pending → submitted → accepted | rejected      (normal)
 *   pending → unknown                               (egress error; outcome unclear → reconcile with CRA)
 */
import mongoose from 'mongoose';
import { PROGRAMS } from '../../engagement/engagement-year/engagement-year.model.js';
import { FILING_CHANNELS } from '../filing-record/filing-record.model.js';

export const SUBMISSION_STATUSES = [
  'pending',
  'submitted',
  'accepted',
  'rejected',
  'unknown',
] as const;

const submissionAttemptSchema = new mongoose.Schema(
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
    program: { type: String, enum: PROGRAMS, required: true },
    channel: { type: String, enum: FILING_CHANNELS, required: true },
    /** Unique per (org, program, exact payload) — the retry/dedupe key. */
    idempotencyKey: { type: String, required: true },
    payloadHash: { type: String, required: true },
    status: { type: String, enum: SUBMISSION_STATUSES, default: 'pending', index: true },
    confirmationNumber: { type: String, default: null },
    /** The raw gateway response retained for reconciliation of unknown outcomes. */
    rawResponse: { type: mongoose.Schema.Types.Mixed, default: null },

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

// One attempt per exact payload per org — a concurrent double-send collides here.
submissionAttemptSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });

export type SubmissionAttemptDocument = mongoose.InferSchemaType<typeof submissionAttemptSchema>;

const SubmissionAttempt = mongoose.model<SubmissionAttemptDocument>(
  'SubmissionAttempt',
  submissionAttemptSchema,
);
export default SubmissionAttempt;
