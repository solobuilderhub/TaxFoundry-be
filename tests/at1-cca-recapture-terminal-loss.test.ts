/**
 * TF_DEV_BUG_LIST_2026-09-18.md, BUG-116 — "008/013 disposition columns
 * never compute: no recapture, no terminal loss".
 *
 * Investigated and does NOT reproduce on the current build. Both halves of
 * the report's own repro compute the report's own expected figures exactly,
 * once the fact pattern is entered completely:
 *
 *   Repro A (recapture)     — reproduces the report's expected -20,000
 *                              exactly. The "013 totals all dashes" half of
 *                              the complaint was the AT1 divergence gate
 *                              correctly refusing to file Schedule 13 when
 *                              000060/000061 are both unanswered — TRA
 *                              forbids the schedule outright in that state.
 *                              It fires (30,000 at 023) the moment either
 *                              flag is answered Yes.
 *   Repro B (terminal loss) — the report's repro never marks the class
 *                              EMPTIED, which is the ITA's actual trigger
 *                              for a terminal loss (s.20(16)) — dispositions
 *                              below UCC with assets still in the class are
 *                              a plain pool reduction, not a terminal loss.
 *                              Without it the engine correctly caps the
 *                              claim at the declining-balance max (6,000),
 *                              matching the report's own "Observed" figures
 *                              verbatim. WITH `classEmptied: true` the
 *                              engine produces the report's originally
 *                              "Expected" outcome exactly.
 *
 * These tests exist so the chain (disposition → recapture/terminal loss →
 * federal taxable income → Alberta taxable income → the AT1 Schedule 13
 * totals strip, gated by the divergence flags) stays pinned end to end.
 */
import { describe, expect, it } from 'vitest';
import { assembleProvincialInput } from '../src/engine/assemble-provincial-input.js';
import { runAT1Compute } from '../src/engine/at1-compute.js';

const period = { start: new Date('2024-01-01'), end: new Date('2024-12-31'), label: 'AT1 2024' };
const baseFed = {
  period,
  bookNetIncome: -50_000,
  activeBusinessIncome: -50_000,
  capitalDispositions: [],
  charitableDonations: 0,
  openingDonationPool: 0,
  reserveContinuity: [],
  openingNonCapitalLoss: 0,
  nonCapitalLossToApply: 0,
};
const noDivergence = {
  alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'no' },
  albertaSbd: { corporationStatus: 'ccpc' },
};
const divergenceDeclared = {
  alberta: { reportsDifferentAlbertaIncome: 'no', electsDifferentDiscretionaryAmounts: 'yes' },
  albertaSbd: { corporationStatus: 'ccpc' },
};

const fieldValue = (out: ReturnType<typeof runAT1Compute>, line: string) =>
  (out.fields ?? []).find((f) => String(f.line) === line)?.value;

describe('AT1 CCA — recapture reaches taxable income (BUG-116 repro A)', () => {
  const fed = {
    ...baseFed,
    ccaClasses: [{ ccaClass: '8', openingUCC: 50_000, dispositions: 80_000, claim: 0 }],
  };

  it('proceeds exceeding UCC produce recapture, which is INCOME added to a book loss', () => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', fed as never, noDivergence as never, { isCcpc: true }),
    );
    // -50,000 book loss + 30,000 recapture = -20,000, exactly.
    expect(fieldValue(out, 'albertaTaxableIncome')).toBe(-20_000);
  });

  it('Schedule 13 correctly files nothing when no Alberta/federal divergence is declared', () => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', fed as never, noDivergence as never, { isCcpc: true }),
    );
    expect(out.schedulePayloads?.find((p) => p.scheduleId === '013')).toBeUndefined();
  });

  it('the recapture reaches Schedule 13 once a divergence flag is answered Yes', () => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', fed as never, divergenceDeclared as never, { isCcpc: true }),
    );
    const s13 = out.schedulePayloads?.find((p) => p.scheduleId === '013');
    const byId = new Map((s13?.values ?? []).map((v) => [v.lineItemId, v.value]));
    // Filed per class (015 recapture); the 023/027 totals are printed, not filed.
    expect(byId.get('013015001')).toBe(30_000);
    const shown = new Map((s13?.display ?? []).map((v) => [v.lineItemId, v.value]));
    expect(shown.get('013023001')).toBe(30_000); // recapture
    expect(shown.get('013027001')).toBe(0); // no CCA can be claimed alongside recapture
  });
});

describe('AT1 CCA — terminal loss requires the class to be EMPTIED (BUG-116 repro B)', () => {
  const withoutEmptied = {
    ...baseFed,
    ccaClasses: [{ ccaClass: '8', openingUCC: 50_000, dispositions: 20_000, claim: 30_000 }],
  };
  const withEmptied = {
    ...baseFed,
    ccaClasses: [
      {
        ccaClass: '8',
        openingUCC: 50_000,
        dispositions: 20_000,
        claim: 30_000,
        classEmptied: true,
      },
    ],
  };

  it('proceeds below UCC with assets still in the class: the claim is capped, not a terminal loss', () => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', withoutEmptied as never, noDivergence as never, {
        isCcpc: true,
      }),
    );
    // The declining-balance max on a 30,000 post-disposition pool at 20% is
    // 6,000 — the explicit 30,000 claim is silently capped there, which is
    // correct engine behaviour (the field's own helper copy should say so;
    // that is a UI-copy improvement, not an engine defect).
    expect(fieldValue(out, 'albertaTaxableIncome')).toBe(-56_000); // -50,000 - 6,000
  });

  it('the same facts, with the class marked emptied: a real terminal loss, zero CCA', () => {
    const out = runAT1Compute(
      assembleProvincialInput('AT1', withEmptied as never, noDivergence as never, {
        isCcpc: true,
      }),
    );
    // -50,000 book loss - 30,000 terminal loss = -80,000.
    expect(fieldValue(out, 'albertaTaxableIncome')).toBe(-80_000);
  });
});
