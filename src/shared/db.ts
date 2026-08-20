import type { Types } from 'mongoose';

/**
 * mongokit `Repository` read methods return the schema-inferred document type,
 * which — per Mongoose's `InferSchemaType` — omits `_id`. The documents DO carry
 * `_id` at runtime; this helper restores it in the type for service code that
 * needs the id (e.g. to reference the doc from a fact-log entry).
 */
export type WithId<T> = T & { _id: Types.ObjectId };
