/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-101 — "AAII grind never applies to the
 * SBD": the report's repro entered AAII at line 440 and got an unground SBD
 * ($18,000 instead of the expected $15,000).
 *
 * Does not reproduce — and the report's own repro explains why once traced.
 * Line 440 / Part 1 of Schedule 7 is AGGREGATE INVESTMENT INCOME (AII), which
 * feeds RDTOH, not the SBD grind. The SBD grind (s.125(5.1)(b)) reads
 * ADJUSTED aggregate investment income (AAII), line 745 / Part 2, a
 * genuinely different figure. This conflation was found and fixed
 * 2026-09-03 (research/findings/federal/S7-aaii-vs-aggregate-investment-
 * income-conflation.md) — `FederalT2Input` has carried separate `aaii` and
 * `aggregateInvestmentIncome` fields since, with the guided editor labelling
 * each by its real line number. The report's original repro used the wrong
 * one; its own follow-up claims re-testing with 745 directly still failed,
 * which this test cannot reproduce through the actual pipeline.
 *
 * Fed the correct field end to end, the grind computes exactly the report's
 * own "Expected" figures: business limit ground to $250,000, SBD $15,000.
 */
import { describe, expect, it } from 'vitest';
import { assembleT2Input } from '../src/engine/assemble-t2-input.js';
import { runT2Compute } from '../src/engine/t2-compute.js';

const engagement = {
  taxYearStart: new Date('2024-01-01'),
  taxYearEnd: new Date('2024-12-31'),
  program: 'T2',
};

function computeFold(ri: Record<string, unknown>) {
  const raw = assembleT2Input(ri as never, engagement as never) as {
    period: { start: string; end: string; label: string };
  };
  const engineInput = {
    ...raw,
    isCcpc: true,
    period: {
      start: new Date(raw.period.start),
      end: new Date(raw.period.end),
      label: raw.period.label,
    },
  };
  const out = runT2Compute(engineInput as never);
  const fold: Record<string, number> = {};
  for (const f of out.fields ?? []) if (typeof f.value === 'number') fold[f.line] = f.value;
  return fold;
}

describe('T2 SBD — the AAII grind, fed the correct line (BUG-101)', () => {
  it("matches the report's own exact expected figures: ABI 300,000, limit 500,000, AAII (745) 100,000 → SBD base 250,000", () => {
    const fold = computeFold({
      incomeStatement: { revenue: 300_000 },
      sbd: { activeBusinessIncome: 300_000, corporationStatus: 'ccpc', aaii: 100_000 },
    });
    // $500,000 business limit − $5 × ($100,000 − $50,000 threshold) = $250,000,
    // capped against ABI (300,000) → the lower figure, $250,000, is the SBD base.
    expect(fold.sbdIncome).toBe(250_000);
  });

  it('line 440 (aggregateInvestmentIncome) alone does NOT grind the SBD — it is a different figure (RDTOH)', () => {
    const fold = computeFold({
      incomeStatement: { revenue: 300_000 },
      sbd: {
        activeBusinessIncome: 300_000,
        corporationStatus: 'ccpc',
        aggregateInvestmentIncome: 100_000,
      },
    });
    // No AAII entered, so the grind base is nil — the full $300,000 ABI is
    // the SBD base, unground. This is the report's original repro, and
    // proves 440 and 745 are genuinely different inputs, not the engine
    // ignoring a value it should read.
    expect(fold.sbdIncome).toBe(300_000);
  });

  it('no AAII at all: the grind does not fire, full ABI is the SBD base', () => {
    const fold = computeFold({
      incomeStatement: { revenue: 300_000 },
      sbd: { activeBusinessIncome: 300_000, corporationStatus: 'ccpc' },
    });
    expect(fold.sbdIncome).toBe(300_000);
  });
});
