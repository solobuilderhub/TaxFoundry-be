/**
 * THE AUDIT INVARIANTS — DB-backed proof of the seven controls the return ledger
 * rests on. These were previously tracked as `it.todo` in ../../tests/integration
 * because they need a real database; they run here against an in-memory Mongo.
 *
 * Each control answers a question an auditor (or a s.163.2 penalty assessment)
 * would actually ask:
 *
 *   1. Can a recorded fact be changed after the event?              → no
 *   2. Is the computed return really a cache, or is it the record?  → a cache
 *   3. Does anything unfilable reach the wire?                      → no egress
 *   4. Does a 2026 rate book leak into a 2024 return?               → no
 *   5. Can an agent write a filed value?                            → no
 *   6. Can one firm see another firm's rows?                        → no
 *   7. Is there a record of what the agent said and who decided?    → yes
 *
 * The distinction that matters throughout: a route that does not EXIST is proved
 * by ../ledger.test.ts (no DB needed). What is proved HERE is that the persisted
 * data actually behaves the way the routing implies — the two together are the
 * control, and neither alone is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { createTestApp } from '@classytic/arc/testing';
import type { TestAppContext, TestAuthProvider } from '@classytic/arc/testing';
import { CORP_TAX_2024 } from '@classytic/ca-tax/t2';
import clientResource from '../src/resources/engagement/client/client.resource.js';
import engagementYearResource from '../src/resources/engagement/engagement-year/engagement-year.resource.js';
import factLogResource from '../src/resources/ledger/fact-log/fact-log.resource.js';
import proposalResource from '../src/resources/ledger/proposal/proposal.resource.js';
import computedReturnResource from '../src/resources/ledger/computed-return/computed-return.resource.js';
import reviewMemoResource from '../src/resources/workpapers/review-memo/review-memo.resource.js';
import filingRecordResource from '../src/resources/workpapers/filing-record/filing-record.resource.js';
import FactLog from '../src/resources/ledger/fact-log/fact-log.model.js';
import Proposal from '../src/resources/ledger/proposal/proposal.model.js';
import ComputedReturn from '../src/resources/ledger/computed-return/computed-return.model.js';
import EngagementYear from '../src/resources/engagement/engagement-year/engagement-year.model.js';
import FilingRecord from '../src/resources/workpapers/filing-record/filing-record.model.js';
import ReviewMemo from '../src/resources/workpapers/review-memo/review-memo.model.js';
import Client from '../src/resources/engagement/client/client.model.js';
import { setAt1FilingGateway } from '../src/filing/at1-gateway.js';
import { registerFederalRates, resetRateBooks } from '../src/engine/tax-rates.js';

const FIRM_A = '64f000000000000000000011';
const FIRM_B = '64f000000000000000000012';
const MANAGER = '64f0000000000000000000c1';
const MEMBER = '64f0000000000000000000c2';
const RIVAL = '64f0000000000000000000c3';
const CLIENT_A = '64f0000000000000000000d1';
const CLIENT_B = '64f0000000000000000000d2';

const certification = { firstName: 'Sam', lastName: 'Preparer', position: 'Director' };

/** A complete, balanced structured return — the fileable path. */
const RETURN_INPUT = {
  identification: { corpType: 'CCPC', province: 'ON', headOffice: { line1: '1 King St', city: 'Toronto' } },
  balanceSheet: { cash: 50000, accountsPayable: 50000 },
  incomeStatement: { revenue: 400000, costOfSales: 100000 },
  gifiNotes: { preparedByAccountant: true },
  sbd: { activeBusinessIncome: 300000 },
  shareholders: { list: [{ name: 'Owner', commonPct: 100 }] },
};

describe('Return ledger — the seven audit invariants (DB-backed)', () => {
  let ctx: TestAppContext;
  let auth: TestAuthProvider;
  /** Flipped by the fake TRA gateway — proves whether anything left the building. */
  let egressed: string | null = null;

  const unwrap = (res: { json(): Record<string, unknown> }) => {
    const j = res.json();
    return (j.data ?? j) as Record<string, unknown>;
  };

  beforeAll(async () => {
    ctx = await createTestApp({
      resources: [
        clientResource,
        engagementYearResource,
        factLogResource,
        proposalResource,
        computedReturnResource,
        reviewMemoResource,
        filingRecordResource,
      ],
      authMode: 'jwt',
      db: 'in-memory',
      connectMongoose: false,
    });
    await mongoose.connect(ctx.dbUri!);

    await Client.create([
      {
        _id: CLIENT_A, name: 'Firm A Client Ltd', corpType: 'CCPC', businessNumber: '100000101RC0001',
        // A COMPLETE Alberta filing identity — without the mailing address the
        // renderer refuses to generate at all (critical mandatory fields), which
        // would mask the provenance guard behind an earlier failure.
        corporateAccountNumber: '123456789',
        address: { street: '9811 109 St', city: 'Edmonton', province: 'AB', postalCode: 'T5K 2L5' },
        organizationId: FIRM_A, createdBy: MANAGER,
      },
      { _id: CLIENT_B, name: 'Firm B Client Ltd', corpType: 'CCPC', businessNumber: '100000202RC0001', organizationId: FIRM_B, createdBy: RIVAL },
    ]);

    setAt1FilingGateway({
      async transmit(xml: string) {
        egressed = xml;
        return { status: 'accepted' as const, confirmationNumber: 'TRA-INV-0001', errorCodes: [] };
      },
    });

    if (!ctx.auth) throw new Error('test auth provider not configured');
    auth = ctx.auth;
    auth.register('manager', { user: { id: MANAGER, role: 'user', organizationId: FIRM_A, orgRoles: ['manager'] }, orgId: FIRM_A });
    auth.register('member', { user: { id: MEMBER, role: 'user', organizationId: FIRM_A, orgRoles: ['member'] }, orgId: FIRM_A });
    auth.register('rival', { user: { id: RIVAL, role: 'user', organizationId: FIRM_B, orgRoles: ['manager'] }, orgId: FIRM_B });
  }, 120_000);

  afterAll(async () => {
    resetRateBooks();
    await mongoose.disconnect();
    await ctx?.close();
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  async function newEngagement(
    role: 'manager' | 'rival',
    program: 'T2' | 'AT1',
    clientId = role === 'rival' ? CLIENT_B : CLIENT_A,
  ): Promise<string> {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as(role).headers,
      payload: { clientId, program, taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(201);
    return String(unwrap(res)._id);
  }

  async function compute(engId: string, payload: Record<string, unknown>, role: 'manager' | 'rival' = 'manager') {
    return ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as(role).headers,
      payload: { action: 'compute', ...payload },
    });
  }

  /** Compute an AT1, sign off the review, and record the officer's T183. */
  async function readyToTransmit(): Promise<string> {
    const engId = await newEngagement('manager', 'AT1');
    const res = await compute(engId, {
      period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
      federalTaxableIncome: 195000,
      activeBusinessIncome: 195000,
    });
    expect(res.statusCode).toBe(200);
    const cr = await ComputedReturn.findOne({ engagementYearId: engId }).sort({ createdAt: -1 }).lean();
    const memo = await ReviewMemo.create({
      engagementYearId: engId,
      computedReturnId: cr!._id,
      status: 'draft',
      flags: [{ severity: 'green', code: 'ok', message: 'reconciles' }],
      organizationId: FIRM_A,
      createdBy: MANAGER,
    });
    await ctx.app.inject({
      method: 'POST', url: `/review-memos/${memo._id}/action`,
      headers: auth.as('manager').headers, payload: { action: 'sign-off' },
    });
    await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
      payload: { action: 'authorize-t183', officerName: 'Jane Officer', officerPosition: 'President', signedAt: new Date(Date.now() - 60_000).toISOString(), authorizationMethod: 'electronic_signature', evidenceRef: 'T183CORP.pdf' },
    });
    return engId;
  }

  // ── T183: the officer's attestation is OBSERVED, never assumed ────────────

  /**
   * CRA: *"an authorized signing officer of the corporation must complete and
   * sign a Form T183CORP BEFORE the tax return is transmitted"*, and for an
   * e-signature the form *"must report the date and time the form was
   * electronically signed"*. The transmitter keeps the signed original six years.
   *
   * Two defaults used to supply that attestation on the officer's behalf:
   * `signedAt` fell back to `now`, and `authorizationMethod` fell back to
   * `wet_signature` — one of the two methods that UNLOCK filing. Between them a
   * caller could record a fileable authorization while supplying neither when it
   * was signed nor how.
   */
  describe('the T183 authorization cannot be fabricated by omission', () => {
    const authorize = async (extra: Record<string, unknown>) => {
      const engId = await readyToTransmit();
      return ctx.app.inject({
        method: 'POST',
        url: `/engagement-years/${engId}/action`,
        headers: auth.as('manager').headers,
        payload: { action: 'authorize-t183', officerName: 'Jane Officer', officerPosition: 'President', ...extra },
      });
    };

    it('refuses when the signing moment was not observed', async () => {
      const res = await authorize({ authorizationMethod: 'electronic_signature', evidenceRef: 'T183.pdf' });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('signedAt is required');
    });

    it('refuses when the method was not stated — it does not assume a signature', async () => {
      const res = await authorize({ signedAt: new Date(Date.now() - 60_000).toISOString(), evidenceRef: 'T183.pdf' });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('authorizationMethod is required');
    });

    it('refuses a signature dated in the future', async () => {
      const res = await authorize({
        signedAt: new Date(Date.now() + 86_400_000).toISOString(),
        authorizationMethod: 'electronic_signature',
        evidenceRef: 'T183.pdf',
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires the retained signed form for a fileable method — the six-year record', async () => {
      const res = await authorize({
        signedAt: new Date(Date.now() - 60_000).toISOString(),
        authorizationMethod: 'wet_signature',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('evidenceRef');
    });

    it('accepts a complete attestation', async () => {
      const res = await authorize({
        signedAt: new Date(Date.now() - 60_000).toISOString(),
        authorizationMethod: 'electronic_signature',
        evidenceRef: 'T183CORP-signed.pdf',
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────

  describe('1 · a recorded fact cannot be changed after the event', () => {
    it('survives every mutating verb byte-for-byte, and never grows an updatedAt', async () => {
      const engId = await newEngagement('manager', 'T2');
      const create = await ctx.app.inject({
        method: 'POST', url: '/fact-logs', headers: auth.as('manager').headers,
        payload: {
          engagementYearId: engId, seq: 1, type: 'HumanOverride', actor: MANAGER,
          provenance: 'human', reason: 'reclassified meals to 50% deductible',
          payload: { line: 'schedule1.meals', before: 12000, after: 6000 },
        },
      });
      expect(create.statusCode).toBe(201);
      const factId = String(unwrap(create)._id);

      const before = await FactLog.findById(factId).lean();
      expect(before).toBeTruthy();
      // Append-only means event time only. An updatedAt column is itself a claim
      // that the row can change; the schema does not carry one.
      expect(before).not.toHaveProperty('updatedAt');

      for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
        const res = await ctx.app.inject({
          method, url: `/fact-logs/${factId}`, headers: auth.as('manager').headers,
          payload: { reason: 'tampered', provenance: 'human' },
        });
        expect(res.statusCode, `${method} must not be a route on an append-only ledger`).toBe(404);
      }

      const after = await FactLog.findById(factId).lean();
      expect(after).toEqual(before);
      expect(await FactLog.countDocuments({ _id: factId })).toBe(1);
    }, 30_000);

    it('refuses a fact whose provenance is a model — the enum is the wall', async () => {
      const engId = await newEngagement('manager', 'T2');
      const res = await ctx.app.inject({
        method: 'POST', url: '/fact-logs', headers: auth.as('manager').headers,
        payload: {
          engagementYearId: engId, seq: 1, type: 'AdjustmentComputed', actor: 'agent:assistant',
          provenance: 'model', reason: 'the model thinks this is right',
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(await FactLog.countDocuments({ engagementYearId: engId })).toBe(0);
    }, 30_000);
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────

  describe('2 · the computed return is a cache, not the record', () => {
    it('deleting it and refolding the same input reproduces it exactly', async () => {
      const engId = await newEngagement('manager', 'T2');
      const first = await compute(engId, { returnInput: RETURN_INPUT });
      expect(first.statusCode).toBe(200);
      const id1 = String(unwrap(first).computedReturnId);
      const cr1 = await ComputedReturn.findById(id1).lean();
      expect(cr1!.resultHash).toMatch(/^[0-9a-f]{64}$/);

      // Discard the cache outright — through the API, as an operator would.
      const del = await ctx.app.inject({
        method: 'DELETE', url: `/computed-returns/${id1}`, headers: auth.as('manager').headers,
      });
      expect(del.statusCode).toBeLessThan(300);
      expect(await ComputedReturn.findById(id1).lean()).toBeNull();

      // The fact-log survived the deletion — that is what makes the return
      // rebuildable rather than lost.
      expect(await FactLog.countDocuments({ engagementYearId: engId })).toBeGreaterThan(0);

      const second = await compute(engId, { returnInput: RETURN_INPUT });
      expect(second.statusCode).toBe(200);
      const id2 = String(unwrap(second).computedReturnId);
      expect(id2).not.toBe(id1); // genuinely a new snapshot, not a resurrection
      const cr2 = await ComputedReturn.findById(id2).lean();

      expect(cr2!.resultHash).toBe(cr1!.resultHash);
      expect(cr2!.inputHash).toBe(cr1!.inputHash);
      expect(cr2!.engineVersion).toBe(cr1!.engineVersion);
      expect(cr2!.fields).toEqual(cr1!.fields);
      expect(cr2!.totals).toEqual(cr1!.totals);
    }, 30_000);

    it('has no edit route at all — a wrong figure is recomputed, never corrected in place', async () => {
      const engId = await newEngagement('manager', 'T2');
      const res = await compute(engId, { returnInput: RETURN_INPUT });
      const id = String(unwrap(res).computedReturnId);
      const patch = await ctx.app.inject({
        method: 'PATCH', url: `/computed-returns/${id}`,
        headers: auth.as('manager').headers, payload: { totals: { totalOwing: 1 } },
      });
      expect(patch.statusCode).toBe(404);
      const cr = await ComputedReturn.findById(id).lean();
      expect((cr!.totals as { totalOwing: number }).totalOwing).not.toBe(1);
    }, 30_000);
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────

  describe('3 · the provenance guard fires BEFORE anything leaves the building', () => {
    it('a tampered field stops the transmission with the gateway untouched', async () => {
      const engId = await readyToTransmit();
      egressed = null;

      // Tamper below the application — a raw collection write, bypassing both the
      // absent update route and the schema enum. This is the threat model: the
      // guard must not depend on the write path having been honest.
      const cr = await ComputedReturn.findOne({ engagementYearId: engId }).sort({ createdAt: -1 }).lean();
      const poked = await mongoose.connection
        .collection('computedreturns')
        .updateOne({ _id: cr!._id }, { $set: { 'fields.0.provenance': 'model' } });
      expect(poked.modifiedCount).toBe(1);

      const res = await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`,
        headers: auth.as('manager').headers, payload: { action: 'transmit', certification },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.json().message).toMatch(/non-filable provenance|Refusing to transmit/i);
      // The assertion that matters: nothing reached the wire.
      expect(egressed, 'the gateway must never be called once a field is unfilable').toBeNull();
      expect(await FilingRecord.countDocuments({ engagementYearId: engId })).toBe(0);
      const eng = await EngagementYear.findById(engId).lean();
      expect(eng!.status).not.toBe('filed');
    }, 30_000);

    it('the same return transmits once the tampering is undone — proving the block was the guard', async () => {
      const engId = await readyToTransmit();
      egressed = null;
      const res = await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`,
        headers: auth.as('manager').headers, payload: { action: 'transmit', certification },
      });
      expect(res.statusCode).toBe(200);
      expect(egressed).toContain('<Value LineItemID=');
      expect(await FilingRecord.countDocuments({ engagementYearId: engId })).toBe(1);
    }, 30_000);

    it('an incomplete return is refused as the preparer’s problem (422), not the server’s', async () => {
      // A client with no mailing address. The specification requires software to
      // DISALLOW generation when a critical mandatory field is absent — so the
      // failure is correct, but it is a 422 naming the empty boxes, not a 500.
      const bare = await ctx.app.inject({
        method: 'POST', url: '/clients', headers: auth.as('manager').headers,
        payload: { name: 'No Address Ltd', businessNumber: '100000303RC0001', corpType: 'CCPC' },
      });
      const clientId = String(unwrap(bare)._id);
      const engId = await newEngagement('manager', 'AT1', clientId);
      await compute(engId, {
        period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
        federalTaxableIncome: 100000, activeBusinessIncome: 100000,
      });
      egressed = null;

      const res = await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`,
        headers: auth.as('manager').headers, payload: { action: 'prepare-netfile', certification },
      });
      expect(res.statusCode).toBe(422);
      // The message must name the fields, or the preparer cannot act on it.
      expect(res.json().message).toMatch(/000012|Mailing Address/);
      expect(egressed).toBeNull();
    }, 30_000);
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────

  describe('4 · a rate change today does not reach into a return already computed', () => {
    it('the stored return keeps its own rate table, and still reproduces after the book moves', async () => {
      const engId = await newEngagement('manager', 'T2');
      const first = await compute(engId, { returnInput: RETURN_INPUT });
      const id1 = String(unwrap(first).computedReturnId);
      const cr1 = await ComputedReturn.findById(id1).lean();
      const owingBefore = (cr1!.totals as { totalOwing: number }).totalOwing;

      const check1 = await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`,
        headers: auth.as('manager').headers, payload: { action: 'verify-reproducible' },
      });
      expect(unwrap(check1).reproducible).toBe(true);

      try {
        // A later amendment to the SAME tax year — the hardest case, because it
        // is not a new year the return could simply ignore.
        registerFederalRates([
          { taxYear: 2024, rates: { ...CORP_TAX_2024, GENERAL_RATE: 0.21, SBD_RATE: 0.14 } },
        ] as never);

        const stored = await ComputedReturn.findById(id1).lean();
        expect(stored!.rateTableVersion).toBe(cr1!.rateTableVersion);
        expect(stored!.engineVersion).toBe(cr1!.engineVersion);

        // Recomputing from the snapshot restores the HISTORICAL rates, so the
        // return still reproduces — a changed book must not masquerade as an
        // irreproducible filing.
        const check2 = await ctx.app.inject({
          method: 'POST', url: `/engagement-years/${engId}/action`,
          headers: auth.as('manager').headers, payload: { action: 'verify-reproducible' },
        });
        const out = unwrap(check2);
        expect(out.reproducible).toBe(true);
        expect(out.engineVersion).toBe(cr1!.engineVersion);

        // Control: the book really did change. A FRESH compute of the same input
        // now lands somewhere else — which is exactly why the snapshot matters.
        const second = await compute(engId, { returnInput: RETURN_INPUT });
        const cr2 = await ComputedReturn.findById(String(unwrap(second).computedReturnId)).lean();
        expect((cr2!.totals as { totalOwing: number }).totalOwing).not.toBe(owingBefore);
        expect(cr2!.rateTableVersion).not.toBe(cr1!.rateTableVersion);
      } finally {
        resetRateBooks();
      }
    }, 30_000);
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────

  /**
   * NOTE ON THE SCOPE OF THIS BLOCK. It was titled "an agent can propose, and
   * can do nothing else". That is true of the LEDGER — the fact-log enum and the
   * computed-return schema both refuse a `'model'` provenance, which is what the
   * cases below prove — and false of the SYSTEM: `/api/mcp` exposes every
   * resource action, including review sign-off and transmit, and no resource
   * sets `mcp: false`. See `agent-reachable-surface.test.ts`, which pins that.
   */
  describe('5 · the ledger refuses model-authored facts', () => {
    it('accepts a proposal carrying model metadata', async () => {
      const engId = await newEngagement('manager', 'T2');
      const res = await ctx.app.inject({
        method: 'POST', url: '/proposals', headers: auth.as('manager').headers,
        payload: {
          engagementYearId: engId, kind: 'gifi-mapping', source: 'agent:gifi-mapper@3',
          confidence: 0.62, payload: { account: 'Meals & entertainment', suggestedGifi: '8523' },
        },
      });
      expect(res.statusCode).toBe(201);
      const p = unwrap(res);
      // Confidence and source live HERE and only here — a filed value has no such
      // fields, which is the structural reason a proposal cannot become one.
      expect(p.confidence).toBe(0.62);
      expect(p.status).toBe('pending');
    }, 30_000);

    it('refuses a computed return whose field claims model provenance', async () => {
      const engId = await newEngagement('manager', 'T2');
      const res = await ctx.app.inject({
        method: 'POST', url: '/computed-returns', headers: auth.as('manager').headers,
        payload: {
          engagementYearId: engId, program: 'T2', engineVersion: 'forged@1',
          fields: [{ line: '300', value: 999999, provenance: 'model' }],
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(await ComputedReturn.countDocuments({ engagementYearId: engId })).toBe(0);
    }, 30_000);

    it('every field the engine actually wrote is engine-provenanced', async () => {
      const engId = await newEngagement('manager', 'T2');
      const res = await compute(engId, { returnInput: RETURN_INPUT });
      const cr = await ComputedReturn.findById(String(unwrap(res).computedReturnId)).lean();
      const fields = cr!.fields as { provenance: string }[];
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.every((f) => f.provenance === 'engine')).toBe(true);
      // …and no fact anywhere in the ledger claims otherwise.
      expect(await FactLog.countDocuments({ provenance: { $nin: ['engine', 'imported', 'human'] } })).toBe(0);
    }, 30_000);

    it('computing and transmitting need an elevated human, not merely a seat in the org', async () => {
      const engId = await newEngagement('manager', 'T2');
      for (const action of ['compute', 'transmit'] as const) {
        const res = await ctx.app.inject({
          method: 'POST', url: `/engagement-years/${engId}/action`,
          headers: auth.as('member').headers, payload: { action, returnInput: RETURN_INPUT, certification },
        });
        expect([401, 403], `${action} must not be open to an ordinary member`).toContain(res.statusCode);
      }
    }, 30_000);
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────

  describe('6 · one firm cannot reach another firm’s rows', () => {
    it('filters lists, refuses direct fetches, and ignores a forged tenant on write', async () => {
      const engA = await newEngagement('manager', 'T2');
      const engB = await newEngagement('rival', 'T2');

      const mk = (role: 'manager' | 'rival', engId: string, seq: number) =>
        ctx.app.inject({
          method: 'POST', url: '/fact-logs', headers: auth.as(role).headers,
          payload: { engagementYearId: engId, seq, type: 'ReviewSignedOff', actor: role, provenance: 'human', reason: `${role} fact` },
        });
      const factA = String(unwrap(await mk('manager', engA, 900))._id);
      await mk('rival', engB, 900);

      // The rival's list contains only the rival's rows.
      const list = await ctx.app.inject({ method: 'GET', url: '/fact-logs', headers: auth.as('rival').headers });
      expect(list.statusCode).toBe(200);
      const rows = ((list.json().data ?? list.json()) as { organizationId: string }[]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => String(r.organizationId) === FIRM_B)).toBe(true);

      // A known id from the other firm is not fetchable even when guessed exactly.
      const direct = await ctx.app.inject({ method: 'GET', url: `/fact-logs/${factA}`, headers: auth.as('rival').headers });
      expect(direct.statusCode).toBe(404);

      // Nor is the other firm's engagement computable.
      const cross = await compute(engA, { returnInput: RETURN_INPUT }, 'rival');
      expect(cross.statusCode).toBe(404);

      // A forged organizationId on write is overwritten by the caller's real one.
      const forged = await ctx.app.inject({
        method: 'POST', url: '/fact-logs', headers: auth.as('rival').headers,
        payload: { engagementYearId: engB, seq: 901, type: 'HumanOverride', actor: RIVAL, provenance: 'human', organizationId: FIRM_A },
      });
      expect(forged.statusCode).toBe(201);
      const stored = await FactLog.findById(String(unwrap(forged)._id)).lean();
      expect(String(stored!.organizationId)).toBe(FIRM_B);
    }, 30_000);
  });

  // ── 7 ─────────────────────────────────────────────────────────────────────

  describe('7 · the due-diligence record: what was flagged, and who decided', () => {
    it('keeps the agent’s claim and the human’s resolution on one row', async () => {
      const engId = await newEngagement('manager', 'T2');
      const created = await ctx.app.inject({
        method: 'POST', url: '/proposals', headers: auth.as('manager').headers,
        payload: {
          engagementYearId: engId, kind: 'adjustment', source: 'agent:schedule1-reviewer@7', confidence: 0.41,
          payload: { line: 'schedule1.meals', observed: 12000, suggested: 6000, basis: 'ITA 67.1 — 50% limitation' },
        },
      });
      expect(created.statusCode).toBe(201);
      const proposalId = String(unwrap(created)._id);

      const resolvedAt = new Date().toISOString();
      const resolve = await ctx.app.inject({
        method: 'PATCH', url: `/proposals/${proposalId}`, headers: auth.as('manager').headers,
        payload: { status: 'rejected', resolvedBy: MANAGER, resolvedAt },
      });
      expect(resolve.statusCode).toBe(200);

      const row = await Proposal.findById(proposalId).lean();
      // What the agent said…
      expect(row!.source).toBe('agent:schedule1-reviewer@7');
      expect(row!.confidence).toBe(0.41);
      expect((row!.payload as { basis: string }).basis).toMatch(/ITA 67.1/);
      // …and what the human did about it, with a name and a time against it.
      expect(row!.status).toBe('rejected');
      expect(String(row!.resolvedBy)).toBe(MANAGER);
      expect(row!.resolvedAt).toBeInstanceOf(Date);
    }, 30_000);

    it('a rejected suggestion changes nothing in the ledger, and an accepted one is booked as human', async () => {
      const engId = await newEngagement('manager', 'T2');
      await ctx.app.inject({
        method: 'POST', url: '/proposals', headers: auth.as('manager').headers,
        payload: { engagementYearId: engId, kind: 'adjustment', source: 'agent:x@1', confidence: 0.9, payload: { line: '300', suggested: 1 } },
      });
      // A proposal on its own never touches the fold.
      expect(await FactLog.countDocuments({ engagementYearId: engId })).toBe(0);

      // Acceptance is a human act, and it is booked as one — the agent's
      // confidence does not travel with the value.
      const fact = await ctx.app.inject({
        method: 'POST', url: '/fact-logs', headers: auth.as('manager').headers,
        payload: {
          engagementYearId: engId, seq: 1, type: 'HumanOverride', actor: MANAGER, provenance: 'human',
          reason: 'accepted agent:x@1 proposal after checking the invoice',
          payload: { line: '300', after: 1, proposalSource: 'agent:x@1' },
        },
      });
      expect(fact.statusCode).toBe(201);
      const booked = await FactLog.findOne({ engagementYearId: engId }).lean();
      expect(booked!.provenance).toBe('human');
      expect(booked!.actor).toBe(MANAGER);
      expect(booked!.reason).toMatch(/accepted agent:x@1/);
    }, 30_000);
  });
});
