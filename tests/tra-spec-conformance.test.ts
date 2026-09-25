/**
 * Every TRA certification case, rendered by the real filing chain, against the
 * specification's own cross-reference tables (§3.2.3) — read from the PDF by
 * word position into `AT1_SPEC_ROWS`.
 *
 * Two obligations, both mechanical:
 *
 *   - nothing is filed that the specification does not define for that
 *     schedule — Schedule 29 used to file 031, 208 and the 270–320 totals,
 *     which are printed-form arithmetic with no Net File line at all;
 *   - every mandatory row of a schedule that IS filed is present
 *     (§3.2.3: "all mandatory Field IDs must be output") — within a
 *     conditional section ("If … exist, then this section must be
 *     completed"), only when that section is filed at all.
 */
import { AT1_SPEC_ROWS, AT1_SPEC_SECTIONS, mandatoryFields } from '@classytic/ca-tax/t2';
import { describe, expect, it } from 'vitest';
import { runCase } from '../scripts/validate/tra-cases.js';

const CASES = ['tc1', 'tc1a', 'tc2', 'tc3'] as const;

/** schedule → the 3-digit fields filed on it. */
function filed(xml: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [, id] of xml.matchAll(/<Value LineItemID="(\w+)">/g)) {
    const schedule = (id as string).slice(0, 3);
    if (schedule === 'EDI') continue; // §3.3.6, its own listing
    const fields = out.get(schedule) ?? new Set<string>();
    fields.add((id as string).slice(3, 6));
    out.set(schedule, fields);
  }
  return out;
}

describe.each(CASES)('TRA %s — conforms to the §3.2.3 tables', (id) => {
  const schedules = filed(runCase(id).xml);

  it('files only line items the specification defines', () => {
    const undefinedLines = [...schedules].flatMap(([schedule, fields]) =>
      [...fields]
        .filter((f) => AT1_SPEC_ROWS[schedule]?.[f] === undefined)
        .map((f) => `${schedule}${f}`),
    );
    expect(undefinedLines).toEqual([]);
  });

  it('files every mandatory line of each schedule it files', () => {
    const missing = [...schedules].flatMap(([schedule, fields]) => {
      const sections = AT1_SPEC_SECTIONS[schedule] ?? {};
      const filedSections = new Set([...fields].map((f) => sections[f]).filter(Boolean));
      return mandatoryFields(schedule)
        .filter((f) => sections[f] === undefined || filedSections.has(sections[f]))
        .filter((f) => !fields.has(f))
        .map((f) => `${schedule}${f}`);
    });
    expect(missing).toEqual([]);
  });
});
