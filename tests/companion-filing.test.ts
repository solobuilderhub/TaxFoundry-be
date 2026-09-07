/**
 * The companion filing — two returns, one dataset.
 *
 * A corporation with an Alberta permanent establishment owes a federal T2 and
 * an AT1. An engagement here is one filing, so that is two engagements. The
 * provincial engagement already collects the whole federal dataset, because
 * Alberta is computed from the federal figures, and until this existed the
 * preparer typed all of it a second time to file federally.
 *
 * Worse, the export screen offered a federal payload on the Alberta engagement
 * that could never be produced: `composeT2FilingData` reads federal names out
 * of the computed fold, and an Alberta computed return has none of them. These
 * tests pin both halves — the guard that keeps a wrong federal return from
 * being rendered, and the copy that means the guard costs nobody any retyping.
 */
import { describe, expect, it, vi } from 'vitest';

const engagements = new Map<string, Record<string, unknown>>();
let nextId = 1;

vi.mock('#resources/engagement/engagement-year/engagement-year.repository.js', () => ({
  default: {
    getOne: async (q: Record<string, unknown>) => {
      if (q._id) return engagements.get(String(q._id)) ?? null;
      for (const e of engagements.values()) {
        if (
          String(e.clientId) === String(q.clientId) &&
          String(e.taxYearEnd) === String(q.taxYearEnd) &&
          e.program === q.program &&
          String(e.organizationId) === String(q.organizationId)
        )
          return e;
      }
      return null;
    },
    create: async (doc: Record<string, unknown>) => {
      const _id = `eng${nextId++}`;
      const saved = { ...doc, _id };
      engagements.set(_id, saved);
      return saved;
    },
  },
}));

const { createCompanionFiling, findCompanionFiling } = await import(
  '../src/engine/companion-filing.service.js'
);

const seedAt1 = (returnInput: unknown = { identification: { corpType: 'CCPC' } }) => {
  engagements.clear();
  nextId = 1;
  engagements.set('at1-1', {
    _id: 'at1-1',
    clientId: 'client-1',
    program: 'AT1',
    taxYearStart: '2024-01-01',
    taxYearEnd: '2024-12-31',
    organizationId: 'org-1',
    returnInput,
  });
};

const params = { engagementId: 'at1-1', orgId: 'org-1', userId: 'user-1' };

describe('creating the federal engagement beside a provincial one', () => {
  it('creates it for the same client and tax year', async () => {
    seedAt1();
    const r = await createCompanionFiling(params);
    expect(r.created).toBe(true);
    expect(r.program).toBe('T2');
    const made = engagements.get(r.engagementYearId) as Record<string, unknown>;
    expect(made.clientId).toBe('client-1');
    expect(made.taxYearEnd).toBe('2024-12-31');
  });

  it('carries the return input across, so nothing is typed twice', async () => {
    seedAt1({ identification: { corpType: 'CCPC' }, netIncome: { lines: { '104': 80000 } } });
    const r = await createCompanionFiling(params);
    expect(r.returnInputCopied).toBe(true);
    const made = engagements.get(r.engagementYearId) as { returnInput?: Record<string, unknown> };
    expect(made.returnInput).toEqual({
      identification: { corpType: 'CCPC' },
      netIncome: { lines: { '104': 80000 } },
    });
  });

  /**
   * The two returns diverge from here — Alberta's reconciliation schedules are
   * the record of exactly how — so the copy must not share a reference with the
   * source. Editing one federal figure must not silently edit the Alberta one.
   */
  it('deep-copies rather than sharing the source object', async () => {
    seedAt1({ netIncome: { lines: { '104': 80000 } } });
    const r = await createCompanionFiling(params);
    const made = engagements.get(r.engagementYearId) as {
      returnInput: { netIncome: { lines: Record<string, number> } };
    };
    made.returnInput.netIncome.lines['104'] = 1;
    const source = engagements.get('at1-1') as {
      returnInput: { netIncome: { lines: Record<string, number> } };
    };
    expect(source.returnInput.netIncome.lines['104']).toBe(80000);
  });

  /** Pressing the button twice must give one federal return, not two. */
  it('is idempotent', async () => {
    seedAt1();
    const first = await createCompanionFiling(params);
    const second = await createCompanionFiling(params);
    expect(second.created).toBe(false);
    expect(second.engagementYearId).toBe(first.engagementYearId);
    expect([...engagements.values()].filter((e) => e.program === 'T2')).toHaveLength(1);
  });

  it('refuses on a federal engagement, which IS the federal return', async () => {
    engagements.clear();
    engagements.set('t2-1', {
      _id: 't2-1',
      clientId: 'client-1',
      program: 'T2',
      taxYearEnd: '2024-12-31',
      organizationId: 'org-1',
    });
    await expect(createCompanionFiling({ ...params, engagementId: 't2-1' })).rejects.toThrow(
      /no companion filing/i,
    );
  });

  it('copies nothing when the provincial return is still empty', async () => {
    seedAt1(null);
    const r = await createCompanionFiling(params);
    expect(r.created).toBe(true);
    expect(r.returnInputCopied).toBe(false);
  });
});

describe('finding an existing companion', () => {
  it('reports none before one is made, and finds it after', async () => {
    seedAt1();
    expect(await findCompanionFiling({ engagementId: 'at1-1', orgId: 'org-1' })).toBeNull();
    const r = await createCompanionFiling(params);
    expect(await findCompanionFiling({ engagementId: 'at1-1', orgId: 'org-1' })).toEqual({
      engagementYearId: r.engagementYearId,
      program: 'T2',
    });
  });

  it('reports none for a federal engagement', async () => {
    engagements.clear();
    engagements.set('t2-1', {
      _id: 't2-1',
      clientId: 'client-1',
      program: 'T2',
      taxYearEnd: '2024-12-31',
      organizationId: 'org-1',
    });
    expect(await findCompanionFiling({ engagementId: 't2-1', orgId: 'org-1' })).toBeNull();
  });
});
