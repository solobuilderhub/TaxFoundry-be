/**
 * ComputationSnapshot — the reproducibility record for one computed return.
 *
 * The reviewer's blocker: a summary-field ledger can't reproduce a return, and a
 * hand-maintained engine-version string doesn't prove reproducibility. This
 * captures everything needed to recompute a return byte-for-byte later:
 *
 *   - `validatedInput`  the exact (sanitized) engine input that was computed
 *   - `result`          the full engine result (every schedule, not a summary)
 *   - `engineBuild`     the engine build stamp (T2_ENGINE_VERSION)
 *   - `rateTableVersion` a content hash of the authoritative rate book used
 *   - `formVersion`     the return-form/schema version
 *   - `inputHash` / `resultHash`  content hashes for tamper-evidence + a fast
 *                        "did this recompute match?" check
 *
 * Hashing uses repo-core's `contentHash` (stable, key-order-independent SHA-256)
 * — the SAME primitive the trust/evidence layer can later TSA-timestamp + sign
 * at transmission time. Reproducibility (here) and non-repudiation (trust) are
 * separate layers that compose on one hash.
 */
import { contentHash } from '@classytic/repo-core/hash';

/** Return-form / schema version — bump when the input or line shape changes. */
export const T2_FORM_VERSION = 't2-form@2024.1';

export interface ComputationSnapshot {
  /** Engine build stamp (mirrors computed-return.engineVersion). */
  engineBuild: string;
  /**
   * The EXACT resolved rate table used for this compute — stored, not just
   * hashed, so a recompute restores the historical rates even after the host
   * book has moved on (true reproducibility, not just difference detection).
   */
  rateTable: unknown;
  /** Content hash of `rateTable`. */
  rateTableVersion: string;
  /** Return-form / schema version. */
  formVersion: string;
  /** The exact validated + sanitized engine input that produced `result`. */
  validatedInput: unknown;
  /** The full engine result (all schedules) — the reproducible output. */
  result: unknown;
  /** SHA-256 of the validated input. */
  inputHash: string;
  /** SHA-256 of the result. */
  resultHash: string;
}

export interface BuildSnapshotParams {
  engineBuild: string;
  formVersion: string;
  /** The EXACT resolved rate table used — stored verbatim + hashed. */
  rateTable: unknown;
  validatedInput: unknown;
  result: unknown;
}

/** Assemble a ComputationSnapshot, computing all three content hashes. */
export function buildSnapshot(params: BuildSnapshotParams): ComputationSnapshot {
  return {
    engineBuild: params.engineBuild,
    rateTable: params.rateTable,
    rateTableVersion: contentHash(params.rateTable),
    formVersion: params.formVersion,
    validatedInput: params.validatedInput,
    result: params.result,
    inputHash: contentHash(params.validatedInput),
    resultHash: contentHash(params.result),
  };
}

/** The content hash a value would produce — for verifying a recompute matches. */
export function hashOf(value: unknown): string {
  return contentHash(value);
}
