/**
 * EngagementYear — one filing engagement: a client + a tax year + a program (T2/AT1).
 * The unit everything else (fact-log, computed-return, filing-record) hangs off.
 */
import mongoose from 'mongoose';

export const ENGAGEMENT_STATUSES = ['draft', 'in_progress', 'ready', 'filed'] as const;
export const PROGRAMS = ['T2', 'AT1', 'CO17'] as const;

const engagementYearSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    program: { type: String, enum: PROGRAMS, required: true, index: true },
    taxYearStart: { type: Date, required: true },
    taxYearEnd: { type: Date, required: true },
    firstReturn: { type: Boolean, default: false },
    status: { type: String, enum: ENGAGEMENT_STATUSES, default: 'draft', index: true },
    // Pinned at compute time; a prior-year recompute must reuse its historical
    // engine version — never recompute a 2024 return with 2026 rules.
    engineVersion: { type: String, default: null },

    // The working return the preparer edits in the schedule editor — the raw
    // human/imported inputs (S125 income statement, S1 reconciliation, S8 CCA,
    // S7 SBD …) that `compute` folds into a computed-return. Free-form by design:
    // each schedule owns its own shape; the engine assembles what it needs.
    returnInput: { type: mongoose.Schema.Types.Mixed, default: null },

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

engagementYearSchema.index({ organizationId: 1, clientId: 1, taxYearEnd: 1, program: 1 });
engagementYearSchema.index({ organizationId: 1, status: 1 });

export type EngagementYearDocument = mongoose.InferSchemaType<typeof engagementYearSchema>;
export type EngagementYearModel = mongoose.Model<EngagementYearDocument>;

const EngagementYear = mongoose.model<EngagementYearDocument>(
  'EngagementYear',
  engagementYearSchema,
);
export default EngagementYear;
