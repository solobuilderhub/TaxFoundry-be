/** The one Québec CO-17-only schedule slice. See `return-input.ts` for the composed whole. */
import { z } from 'zod';

export const QuebecValues = z
  .object({
    sbdEligibleQC: z.boolean().optional().describe(
      "The corporation meets Québec's small-business deduction eligibility (the ≥5,500 " +
        'paid-hours test, or the primary/manufacturing exemption). Fail-closed: the Québec ' +
        'SBD rate applies only when this is explicitly true AND the corporation is a CCPC.',
    ),
    businessLimit: z
      .number()
      .optional()
      .describe('Québec business limit — blank = $500,000 (share the limit for an associated group).'),
  })
  .meta({ id: 'QuebecValues' });

// A same-named TS type per exported schema — see common.ts's own comment on this pattern.
export type QuebecValues = z.infer<typeof QuebecValues>;
