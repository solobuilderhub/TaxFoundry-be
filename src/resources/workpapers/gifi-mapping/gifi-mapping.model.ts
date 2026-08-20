/**
 * GifiMapping — the per-client GL→GIFI cache. THE compounding asset (§7.6):
 * year 1 establishes the mapping, year N reuses it at high confidence — cutting
 * token cost, enforcing year-over-year consistency (an audit property), and
 * creating switching cost. Keyed per client (not per engagement) so it carries
 * across tax years.
 *
 * The `gifiCode` is validated against ledger-ca's canonical registry on write —
 * an invalid code cannot enter the cache.
 */
import mongoose from 'mongoose';
import { isValidGifiCode } from '#shared/gifi-registry.js';

export const MAPPING_SOURCES = ['human', 'agent', 'carryforward'] as const;

const gifiMappingSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    // The client's own GL account (their chart), normalized.
    glAccountCode: { type: String, required: true, trim: true },
    glAccountName: { type: String, trim: true },
    // The GIFI / CA-chart code it maps to — must exist in ledger-ca.
    gifiCode: {
      type: String,
      required: true,
      validate: {
        validator: isValidGifiCode,
        message: (props: { value: string }) =>
          `${props.value} is not a valid GIFI/ledger-ca account code`,
      },
    },
    confidence: { type: Number, min: 0, max: 1, default: null },
    source: { type: String, enum: MAPPING_SOURCES, default: 'human', index: true },

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

// One mapping per (firm, client, GL account) — the cache key.
gifiMappingSchema.index({ organizationId: 1, clientId: 1, glAccountCode: 1 }, { unique: true });

export type GifiMappingDocument = mongoose.InferSchemaType<typeof gifiMappingSchema>;
export type GifiMappingModel = mongoose.Model<GifiMappingDocument>;

const GifiMapping = mongoose.model<GifiMappingDocument>('GifiMapping', gifiMappingSchema);
export default GifiMapping;
