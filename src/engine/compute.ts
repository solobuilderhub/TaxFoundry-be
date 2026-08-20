/**
 * Program-aware compute dispatch: federal T2 vs Alberta AT1.
 * The engagement's `program` selects the engine; both return the same
 * `EngineComputeOutput` the ledger persists.
 */

import { runAT1Compute } from './at1-compute.js';
import { runCo17Compute } from './co17-compute.js';
import type { EngineComputeOutput } from './compute-types.js';
import { runT2Compute } from './t2-compute.js';

export function runEngagementCompute(
  program: string,
  input: unknown,
  actor = 'engine',
): EngineComputeOutput {
  if (program === 'AT1') return runAT1Compute(input, actor);
  if (program === 'CO17') return runCo17Compute(input, actor);
  return runT2Compute(input, actor);
}
