/**
 * FactLog — the append-only event ledger. The return is a fold over this log.
 *
 * This IS CRA IC05-1R1 ¶40's control spec (actor, timestamp, before/after, reason).
 * Records are NEVER updated or deleted (enforced at the resource: no update/delete
 * routes). `provenance` deliberately CANNOT be 'model' — the enum makes a
 * hallucinated value structurally unrepresentable on a fact.
 */
import mongoose from 'mongoose';

export const FACT_TYPES = [
  'SourceImported',
  'AccountMapped',
  'AdjustmentComputed',
  'HumanOverride',
  'DiagnosticRaised',
  'DiagnosticCleared',
  'ReviewSignedOff',
  'T183Authorized',
  'TransmissionAttempted',
  'CRAAcknowledged',
] as const;

// NOTE: 'model' is intentionally NOT a member. A filed value may only originate
// from the engine, an imported source, or a human decision.
export const PROVENANCE = ['engine', 'imported', 'human'] as const;

const factLogSchema = new mongoose.Schema(
  {
    engagementYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EngagementYear',
      required: true,
      index: true,
    },
    // Monotonic per engagement — the fold order.
    seq: { type: Number, required: true },
    type: { type: String, enum: FACT_TYPES, required: true },
    // Who caused it: a user id, 'engine', or an agent id. Free-form by design.
    actor: { type: String, required: true },
    provenance: { type: String, enum: PROVENANCE, required: true },
    // Reason / before / after payload — the audit detail.
    reason: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  },
  // Append-only: keep createdAt (the immutable event time), drop updatedAt.
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

factLogSchema.index({ organizationId: 1, engagementYearId: 1, seq: 1 }, { unique: true });

export type FactLogDocument = mongoose.InferSchemaType<typeof factLogSchema>;
export type FactLogModel = mongoose.Model<FactLogDocument>;

const FactLog = mongoose.model<FactLogDocument>('FactLog', factLogSchema);
export default FactLog;
