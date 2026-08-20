/**
 * Proposal — an agent's suggestion. This is the ONLY write path an agent has:
 * agents never write a fact or a filed value; they emit Proposals, which a human
 * (or the engine + human approval) resolves. A resolved Proposal becomes a
 * fact-log entry with provenance 'human' (or 'engine'), never 'model'.
 */
import mongoose from 'mongoose';

export const PROPOSAL_KINDS = ['gifi-mapping', 'adjustment', 'diagnostic', 'note'] as const;
export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'superseded'] as const;

const proposalSchema = new mongoose.Schema(
  {
    engagementYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EngagementYear',
      required: true,
      index: true,
    },
    kind: { type: String, enum: PROPOSAL_KINDS, required: true, index: true },
    status: { type: String, enum: PROPOSAL_STATUSES, default: 'pending', index: true },
    // The agent/run that produced it (audit: which model/prompt/version).
    source: { type: String, required: true },
    // 0..1 model confidence — surfaces low-confidence items to the human queue.
    confidence: { type: Number, min: 0, max: 1, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    // Resolution — who accepted/rejected and when (the due-diligence record).
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },

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

proposalSchema.index({ organizationId: 1, engagementYearId: 1, status: 1 });

export type ProposalDocument = mongoose.InferSchemaType<typeof proposalSchema>;
export type ProposalModel = mongoose.Model<ProposalDocument>;

const Proposal = mongoose.model<ProposalDocument>('Proposal', proposalSchema);
export default Proposal;
