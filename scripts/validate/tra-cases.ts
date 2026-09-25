/**
 * TRA's Fall 2025 AT1 certification test cases, entered the way the editor's
 * forms store them, run through the real filing chain, and rendered as the
 * Net File payload TRA would receive.
 *
 *   npx tsx scripts/validate/tra-cases.ts [tc1|tc1a|tc2|tc3]
 *
 * The cases are research/sources/tra-test-cases/*.txt. Where TRA leaves the
 * federal side "at your discretion", the figures chosen are stated beside the
 * input. `tests/tra-certification-cases.test.ts` asserts on the same inputs.
 */
import { renderAt1NetFile } from '@classytic/ca-tax/t2';
import { assembleProvincialInput } from '../../src/engine/assemble-provincial-input.js';
import { assembleT2Input } from '../../src/engine/assemble-t2-input.js';
import { runAT1Compute } from '../../src/engine/at1-compute.js';
import { composeAt1FilingData } from '../../src/engine/at1-netfile.service.js';
import { TRA_CASES } from '../../tests/fixtures/tra-cases.js';

type Computed = {
  fields: { line: string; value: unknown }[];
  schedulePayloads?: {
    scheduleId: string;
    values: { lineItemId: string; value: string | number }[];
  }[];
};

export function runCase(id: keyof typeof TRA_CASES): { computed: Computed; xml: string } {
  const c = TRA_CASES[id];
  const engagement = { taxYearStart: c.taxYearStart, taxYearEnd: c.taxYearEnd, program: 'AT1' };
  const assembled = assembleT2Input(c.returnInput as never, engagement as never) as Record<
    string,
    unknown
  >;
  const p = assembled.period as { start: string; end: string; label: string };
  // Exactly as the product composes it (engagement-compute.service's
  // runEngine): dates revived, then the client record's CCPC status applied.
  // Without isCcpc here the case skipped Schedule 1 that the product files.
  const fed = {
    ...assembled,
    period: { start: new Date(p.start), end: new Date(p.end), label: p.label },
    isCcpc: true,
  };
  const computed = runAT1Compute(
    assembleProvincialInput('AT1', fed, c.returnInput as never, { isCcpc: true }),
  ) as Computed;
  const data = composeAt1FilingData({
    computed: { fields: computed.fields, identity: {}, filingInput: c.returnInput },
    client: c.client,
    engagement: { taxYearStart: c.taxYearStart, taxYearEnd: c.taxYearEnd },
    certification: { firstName: 'Dana', lastName: 'Whitecourt', position: 'President' },
    forFiling: false,
  } as never);
  return { computed, xml: renderAt1NetFile(data, (computed.schedulePayloads ?? []) as never) };
}

if (process.argv[1]?.endsWith('tra-cases.ts')) {
  const id = (process.argv[2] ?? 'tc1') as keyof typeof TRA_CASES;
  console.log(runCase(id).xml);
}
