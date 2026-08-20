/**
 * Client — the taxpayer corporation TaxFoundry files for.
 * Org-scoped to the CPA firm (organizationId). A firm owns many clients.
 */
import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    // 9-digit CRA Business Number (the RC program account lives on the return, not here)
    businessNumber: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    // v1 is Alberta-only; kept explicit so the complexity gate can reason on it.
    jurisdiction: { type: String, enum: ['AB'], default: 'AB', index: true },
    corpType: { type: String, trim: true }, // CCPC, etc.
    incorporationDate: { type: Date },
    // Month (1-12) the fiscal year ends — drives return-period defaults.
    fiscalYearEndMonth: { type: Number, min: 1, max: 12 },

    // Alberta filing identity (AT1 Net File): the corporate account number and
    // the registered address that go on the return.
    corporateAccountNumber: { type: String, trim: true }, // Alberta CAN
    address: {
      type: new mongoose.Schema(
        {
          street: { type: String, trim: true },
          city: { type: String, trim: true },
          province: { type: String, trim: true, default: 'AB' },
          postalCode: { type: String, trim: true },
        },
        { _id: false },
      ),
      default: undefined,
    },

    // AT1 jacket identity that is NOT derivable from the return. Each is a
    // mandatory field on the Alberta return with no safe default — filing a
    // zero or an assumed "No" for these would state something untrue rather
    // than leave a gap. See `assertAt1MandatoryComplete`.
    contactPerson: { type: String, trim: true }, // 000025
    contactTelephone: { type: String, trim: true }, // 000026
    natureOfBusiness: { type: String, trim: true }, // 000028 — 4-digit code
    typeOfCorporation: { type: String, trim: true }, // 000029 — 1-digit code
    authorizedEmail: { type: String, trim: true }, // 000105

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

clientSchema.index({ organizationId: 1, businessNumber: 1 });
clientSchema.index({ organizationId: 1, deletedAt: 1 });

export type ClientDocument = mongoose.InferSchemaType<typeof clientSchema>;
export type ClientModel = mongoose.Model<ClientDocument>;

const Client = mongoose.model<ClientDocument>('Client', clientSchema);
export default Client;
