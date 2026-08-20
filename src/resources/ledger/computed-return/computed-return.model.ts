/**
 * ComputedReturn — the materialized fold of the fact-log through the engine.
 *
 * A CACHE, never authoritative: always discardable and rebuildable from
 * fact-log + engineVersion. Immutable snapshot — you never edit a computed
 * return, you recompute a new one (so: create/get/list/delete, but NO update).
 * Each field carries provenance; the enum blocks 'model' at the schema level,
 * and the transmit-time provenance guard (../shared/provenance-guard) is the
 * runtime backstop.
 */
import mongoose from 'mongoose';
import { PROGRAMS } from '../../engagement/engagement-year/engagement-year.model.js';

export const FIELD_PROVENANCE = ['engine', 'imported', 'human'] as const;

const computedFieldSchema = new mongoose.Schema(
  {
    line: { type: String, required: true }, // CRA line number / AT1 Line-Item-ID
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    provenance: { type: String, enum: FIELD_PROVENANCE, required: true },
  },
  { _id: false },
);

const computedReturnSchema = new mongoose.Schema(
  {
    engagementYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EngagementYear',
      required: true,
      index: true,
    },
    program: { type: String, enum: PROGRAMS, required: true },
    // The exact engine build that produced this fold — pinned for reproducibility.
    engineVersion: { type: String, required: true },
    fields: { type: [computedFieldSchema], default: [] },
    totals: { type: mongoose.Schema.Types.Mixed, default: null },
    // Content hash of the exact validated engine input → identifies the fold input.
    inputHash: { type: String, default: null },
    // Content hash of the full engine result — the reproducibility check compares
    // a recompute's hash to this (see verifyT2Reproducible).
    resultHash: { type: String, default: null },
    // Content hash of the authoritative rate book used, and the form/schema
    // version — together with engineVersion, the full reproducibility triple.
    rateTableVersion: { type: String, default: null },
    formVersion: { type: String, default: null },
    // The reproducibility record: full validated input + full engine result. A
    // return can be recomputed byte-for-byte from this — never a lossy summary.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // FROZEN copy of the working return input (GIFI, shareholders, questionnaire,
    // address, instalments) at compute time — the filing path reads THIS, not the
    // live editor doc, so the transmitted package is exactly what was reviewed.
    filingInput: { type: mongoose.Schema.Types.Mixed, default: null },
    // FROZEN corporate identity at compute time (legal name, business number,
    // corp type, tax-year dates, address, program account). Filing reads identity
    // from HERE — editing the client record after sign-off can't silently change
    // the transmitted return without a new computation + review.
    identity: { type: mongoose.Schema.Types.Mixed, default: null },
    // Supporting-schedule line items for the filing payload, exactly as the
    // engine assembled them. Stored rather than rebuilt at filing time: the
    // `fields` array above carries a handful of jacket totals and knows nothing
    // about the schedules behind them, so reconstructing from it files a jacket
    // and nothing else.
    schedulePayloads: { type: mongoose.Schema.Types.Mixed, default: null },
    // Only returns computed from the SERVER-ASSEMBLED structured return are
    // fileable — a legacy engine-shaped payload (calc input separate from the
    // frozen filing input) is non-fileable and the transmit path refuses it.
    fileable: { type: Boolean, default: true },

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

computedReturnSchema.index({ organizationId: 1, engagementYearId: 1, createdAt: -1 });

export type ComputedReturnDocument = mongoose.InferSchemaType<typeof computedReturnSchema>;
export type ComputedReturnModel = mongoose.Model<ComputedReturnDocument>;

const ComputedReturn = mongoose.model<ComputedReturnDocument>(
  'ComputedReturn',
  computedReturnSchema,
);
export default ComputedReturn;
