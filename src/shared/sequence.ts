/**
 * Atomic monotonic sequences — replaces the `count() + 1` race.
 *
 * `count()+1` reads then writes non-atomically: two concurrent computes of the
 * same engagement both read N and both write N+1, colliding on the fact-log's
 * unique (org, engagement, seq) index (a 500, or worse a gap). A single-document
 * `$inc` with upsert is atomic on the server — every caller gets a distinct,
 * increasing value even under concurrency, and it works on standalone MongoDB
 * (no replica set needed), so the in-memory test path is fine too.
 *
 * When a `session` is passed the increment joins the caller's transaction, so it
 * rolls back with the rest of the compute writes (no wasted numbers on abort);
 * without a session the per-document atomicity alone still prevents duplicates.
 */
import mongoose, { type ClientSession } from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // the sequence key, e.g. `factlog:<org>:<engagement>`
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

const Counter = mongoose.models.Counter ?? mongoose.model('Counter', counterSchema);

/** Return the next value of an atomic named sequence (starts at 1). */
export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      ...(session ? { session } : {}),
    },
  ).lean<{ seq: number }>();
  return doc!.seq;
}
