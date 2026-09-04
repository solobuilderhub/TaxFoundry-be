/**
 * The engine↔ledger composition: runT2Compute validates + computes + shapes the
 * result into provenance-tagged fields, and the provenance guard runs on real
 * engine output. Pure — no DB.
 */
import { describe, it, expect } from 'vitest';
import { runT2Compute, verifyT2Reproducible, T2_ENGINE_VERSION } from '../src/engine/t2-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: '2024' };

describe('runT2Compute', () => {
  it('computes a simple CCPC and returns a CA income obligation (cents)', () => {
    const out = runT2Compute({
      period,
      bookNetIncome: 195000,
      activeBusinessIncome: 195000,
      taxableCapital: 2000000,
      isCcpc: true, // SBD is fail-closed: a CCPC must assert it (the service derives this)
    });
    expect(out.obligation.jurisdiction).toBe('CA');
    expect(out.obligation.category).toBe('income');
    expect(out.obligation.totalOwing).toBe(1755000); // $17,550 × 100
    expect(out.engineVersion).toBe(T2_ENGINE_VERSION);
  });

  it('tags every computed field with provenance "engine" and passes the guard', () => {
    const out = runT2Compute({ period, bookNetIncome: 195000, activeBusinessIncome: 195000, taxableCapital: 2000000, isCcpc: true });
    expect(out.fields.every((f) => f.provenance === 'engine')).toBe(true);
    const partI = out.fields.find((f) => f.line === 'partITaxPayable');
    expect(partI?.value).toBe(17550);
    // No field carries a non-filable provenance → nothing to throw on.
    expect(out.fields.some((f) => f.provenance === 'model')).toBe(false);
  });

  it('records an AdjustmentComputed fact stamped with the engine version', () => {
    const out = runT2Compute({ period, bookNetIncome: 195000, activeBusinessIncome: 195000 }, 'user:abc');
    expect(out.fact.type).toBe('AdjustmentComputed');
    expect(out.fact.provenance).toBe('engine');
    expect(out.fact.actor).toBe('user:abc');
    expect(out.fact.payload.engineVersion).toBe(T2_ENGINE_VERSION);
  });

  it('rejects bad input (delegates to the engine validator)', () => {
    expect(() => runT2Compute({ bookNetIncome: 1, activeBusinessIncome: 1 })).toThrow(/period/);
    expect(() => runT2Compute({ period, activeBusinessIncome: 1 })).toThrow(/bookNetIncome/);
  });

  it('IGNORES caller-supplied rates / taxYear — the host book is authoritative', () => {
    const honest = runT2Compute({ period, bookNetIncome: 195000, activeBusinessIncome: 195000, taxableCapital: 2000000 });
    // A malicious caller tries to smuggle a zero-tax rate table and a wrong year.
    const smuggled = runT2Compute({
      period,
      bookNetIncome: 195000,
      activeBusinessIncome: 195000,
      taxableCapital: 2000000,
      rates: {
        BASIC_RATE: 0, FEDERAL_ABATEMENT: 0, SBD_RATE: 0, GENERAL_RATE_REDUCTION: 0, BUSINESS_LIMIT: 0,
        TC_GRIND_LOWER: 0, TC_GRIND_UPPER: 1, AAII_THRESHOLD: 0, AAII_REDUCTION_PER_DOLLAR: 0,
        PART_IV_RATE: 0, REFUNDABLE_PART_I_RATE: 0, CAPITAL_GAINS_INCLUSION_RATE: 0, GRIP_FACTOR: 0,
        SRED_ITC_ENHANCED_RATE: 0, SRED_ITC_BASIC_RATE: 0, SRED_EXPENDITURE_LIMIT: 0,
        DONATION_INCOME_LIMIT_RATE: 0, ZETM_GENERAL_RATE: 0, ZETM_SBD_RATE: 0,
      },
      taxYear: 1990,
    } as unknown as Parameters<typeof runT2Compute>[0]);
    // The smuggled rates are stripped → identical result to the honest compute.
    expect(smuggled.obligation.totalOwing).toBe(honest.obligation.totalOwing);
    expect(smuggled.obligation.totalOwing).toBeGreaterThan(0);
  });

  it('emits a reproducibility snapshot with full input, result, and content hashes', () => {
    const out = runT2Compute({ period, bookNetIncome: 195000, activeBusinessIncome: 195000, taxableCapital: 2000000 });
    expect(out.snapshot.engineBuild).toBe(T2_ENGINE_VERSION);
    expect(out.snapshot.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.snapshot.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.snapshot.rateTableVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(out.snapshot.formVersion).toBeTruthy();
    // The full result is captured (not a lossy summary).
    expect((out.snapshot.result as { taxableIncome: number }).taxableIncome).toBe(195000);
  });

  it('a stored snapshot recomputes byte-for-byte (verifyT2Reproducible)', () => {
    const out = runT2Compute({ period, bookNetIncome: 195000, activeBusinessIncome: 195000, taxableCapital: 2000000 });
    const check = verifyT2Reproducible(out.snapshot);
    expect(check.reproducible).toBe(true);
    expect(check.actual).toBe(check.expected);
  });

  it('gates the SBD on CCPC status — a non-CCPC pays more tax', () => {
    const ccpc = runT2Compute({ period, bookNetIncome: 300000, activeBusinessIncome: 300000, taxableCapital: 2000000, isCcpc: true } as Parameters<typeof runT2Compute>[0]);
    const nonCcpc = runT2Compute({ period, bookNetIncome: 300000, activeBusinessIncome: 300000, taxableCapital: 2000000, isCcpc: false } as Parameters<typeof runT2Compute>[0]);
    expect(nonCcpc.obligation.totalOwing).toBeGreaterThan(ccpc.obligation.totalOwing);
  });
});

describe('Schedule 1 is assembled by CRA line number', () => {
  it('maps entered line numbers onto the right side, with the form’s own captions', async () => {
    const { assembleT2Input } = await import('../src/engine/assemble-t2-input.js');
    const out = assembleT2Input(
      {
        incomeStatement: { revenue: 500000 },
        netIncome: {
          lines: {
            '101': 9000, // Provision for income taxes – current  (add)
            '121': 6000, // Non-deductible meals and entertainment (add)
            '407': 4000, // Foreign non-business tax deduction s.20(12) (deduct)
            '403': 55000, // CARRIED IN from Schedule 8 — the engine supplies it
            '500': 999999, // a TOTAL — computed, never entered
            '888': 1234, // not a Schedule 1 line at all
            '110': 0, // zero contributes nothing
          },
        },
      },
      { taxYearStart: '2024-01-01', taxYearEnd: '2024-12-31', program: 'T2' },
    ) as {
      schedule1Additions: { line: string; label: string; amount: number }[];
      schedule1Deductions: { line: string; label: string; amount: number }[];
    };

    expect(out.schedule1Additions.map((a) => a.line)).toEqual(['101', '121']);
    expect(out.schedule1Deductions.map((d) => d.line)).toEqual(['407']);
    // The caption filed is the form's, not whatever the editor happened to show.
    expect(out.schedule1Additions[0]!.label).toBe('Provision for income taxes – current');
    expect(out.schedule1Deductions[0]!.label).toBe(
      'Foreign non-business tax deduction under subsection 20(12)',
    );

    const all = [...out.schedule1Additions, ...out.schedule1Deductions];
    // 403 is CARRIED IN from Schedule 8. Accepting a keyed value would double
    // the deduction against the one the engine computes from the CCA classes.
    expect(all.some((l) => l.line === '403')).toBe(false);
    // A total and an unknown line are dropped HERE rather than transmitted.
    expect(all.some((l) => l.line === '500')).toBe(false);
    expect(all.some((l) => l.line === '888')).toBe(false);
  });

  it('fills line 104 from the income statement, and does not double it', async () => {
    const { assembleT2Input } = await import('../src/engine/assemble-t2-input.js');
    const eng = { taxYearStart: '2024-01-01', taxYearEnd: '2024-12-31', program: 'T2' };

    const auto = assembleT2Input(
      { incomeStatement: { revenue: 500000, amortization: 40000 } },
      eng,
    ) as { schedule1Additions: { line: string; amount: number }[] };
    expect(auto.schedule1Additions.find((a) => a.line === '104')?.amount).toBe(40000);

    // A preparer who keyed 104 directly wins — the figure is not added twice.
    const manual = assembleT2Input(
      { incomeStatement: { revenue: 500000, amortization: 40000 }, netIncome: { lines: { '104': 37000 } } },
      eng,
    ) as { schedule1Additions: { line: string; amount: number }[] };
    const l104 = manual.schedule1Additions.filter((a) => a.line === '104');
    expect(l104).toHaveLength(1);
    expect(l104[0]!.amount).toBe(37000);
  });

  it('ccaClaimed includes a NEW class 13/14 addition, not just the ordinary declining-balance classes', () => {
    // Regression test: QA found the "CCA" summary tile and this itemized
    // field both read only the ordinary classes' total, silently dropping a
    // class 13/14 addition even though it genuinely reduced taxable income.
    const withOrdinaryOnly = runT2Compute({
      period,
      bookNetIncome: 200000,
      activeBusinessIncome: 200000,
      ccaClasses: [{ ccaClass: '8', openingUCC: 100000 }], // 20% × 100,000 = 20,000
    });
    expect(withOrdinaryOnly.fields.find((f) => f.line === 'ccaClaimed')?.value).toBe(20000);

    // A return with ONLY a class 13 layer and no ordinary classes at all —
    // this used to file no `ccaClaimed` field whatsoever (gated on `b.cca`).
    const class13Only = runT2Compute({
      period,
      bookNetIncome: 200000,
      activeBusinessIncome: 200000,
      class13: { layers: [{ capitalCost: 100000, periods: 10 }], openingUCC: 100000 },
    });
    const claimed = class13Only.fields.find((f) => f.line === 'ccaClaimed');
    expect(claimed).toBeDefined();
    expect(claimed?.value).toBeGreaterThan(0);

    // Both an ordinary class AND a class 13 layer — the field is their SUM.
    const both = runT2Compute({
      period,
      bookNetIncome: 200000,
      activeBusinessIncome: 200000,
      ccaClasses: [{ ccaClass: '8', openingUCC: 100000 }],
      class13: { layers: [{ capitalCost: 100000, periods: 10 }], openingUCC: 100000 },
    });
    const bothClaimed = both.fields.find((f) => f.line === 'ccaClaimed')?.value as number;
    expect(bothClaimed).toBe(20000 + (claimed!.value as number));
  });
});
