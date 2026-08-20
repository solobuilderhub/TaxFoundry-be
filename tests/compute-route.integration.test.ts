/**
 * DB-backed integration — the engine meets the ledger.
 * POST /engagement-years/:id/compute runs the T2 engine, persists a
 * computed-return (fields provenance 'engine') + appends an AdjustmentComputed
 * fact, and advances the engagement status. Uses an in-memory Mongo
 * (mongodb-memory-server); the binary downloads on first run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { createTestApp } from '@classytic/arc/testing';
import type { TestAppContext, TestAuthProvider } from '@classytic/arc/testing';
import clientResource from '../src/resources/engagement/client/client.resource.js';
import engagementYearResource from '../src/resources/engagement/engagement-year/engagement-year.resource.js';
import computedReturnResource from '../src/resources/ledger/computed-return/computed-return.resource.js';
import factLogResource from '../src/resources/ledger/fact-log/fact-log.resource.js';
import reviewMemoResource from '../src/resources/workpapers/review-memo/review-memo.resource.js';
import filingRecordResource from '../src/resources/workpapers/filing-record/filing-record.resource.js';
import Client from '../src/resources/engagement/client/client.model.js';
import EngagementYear from '../src/resources/engagement/engagement-year/engagement-year.model.js';
import ComputedReturn from '../src/resources/ledger/computed-return/computed-return.model.js';
import FactLog from '../src/resources/ledger/fact-log/fact-log.model.js';
import ReviewMemo from '../src/resources/workpapers/review-memo/review-memo.model.js';
import FilingRecord from '../src/resources/workpapers/filing-record/filing-record.model.js';
import { setAt1FilingGateway } from '../src/filing/at1-gateway.js';
import { setT2CifGateway } from '../src/filing/t2-cif-gateway.js';
import { setCertifiedT2Serializer } from '../src/filing/t2-certified-serializer.js';
import { setAfrGateway } from '../src/afr/afr-gateway.js';

const TEST_ORG = '64f000000000000000000001';
const MANAGER = '64f0000000000000000000a1';
const CLIENT = '64f0000000000000000000b1';

describe('POST /engagement-years/:id/compute (DB-backed)', () => {
  let ctx: TestAppContext;
  let auth: TestAuthProvider;

  beforeAll(async () => {
    // db:'in-memory' spins up mongod; connectMongoose:false because arc (a file:
    // symlink) has its OWN mongoose instance — we must connect the APP's mongoose
    // (this test's import) to ctx.dbUri, or the models buffer on a different
    // singleton and every query times out.
    ctx = await createTestApp({
      resources: [
        clientResource,
        engagementYearResource,
        computedReturnResource,
        factLogResource,
        reviewMemoResource,
        filingRecordResource,
      ],
      authMode: 'jwt',
      db: 'in-memory',
      connectMongoose: false,
    });
    await mongoose.connect(ctx.dbUri!);
    // Seed the client — the compute service now derives CCPC status (and thus SBD
    // eligibility) AUTHORITATIVELY from the stored client's corpType, so the
    // request can't assert it. A CCPC here yields the expected 9%/SBD result.
    await Client.create({
      _id: CLIENT,
      name: 'Compute Test Corp',
      corpType: 'CCPC',
      businessNumber: '100000000',
      organizationId: TEST_ORG,
      createdBy: MANAGER,
    });
    // Inject a fake TRA gateway — the default refuses (no endpoint), by design.
    setAt1FilingGateway({
      async transmit() {
        return { status: 'accepted', confirmationNumber: 'TRA-TEST-0001', errorCodes: [] };
      },
    });
    if (!ctx.auth) throw new Error('test auth provider not configured');
    auth = ctx.auth;
    auth.register('manager', {
      user: { id: MANAGER, role: 'user', organizationId: TEST_ORG, orgRoles: ['manager'] },
      orgId: TEST_ORG,
    });
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await ctx?.close();
  });

  it('computes, persists a computed-return + fact, advances status', async () => {
    // Create the engagement through the API (arc harness) — exercises the create
    // path + tenant stamping, not just a raw model insert.
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: {
        clientId: CLIENT,
        program: 'T2',
        taxYearStart: '2024-01-01T00:00:00.000Z',
        taxYearEnd: '2024-12-31T00:00:00.000Z',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdJson = createRes.json();
    const created = createdJson.data ?? createdJson;
    const engId: string = created._id ?? created.id;
    expect(engId).toBeTruthy();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
        bookNetIncome: 195000,
        activeBusinessIncome: 195000,
        taxableCapital: 2000000,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    const result = json.data ?? json; // arc auto-envelopes action results as { data }
    expect(result.obligation.totalOwing).toBe(1755000); // $17,550 × 100

    const computed = await ComputedReturn.findById(result.computedReturnId).lean();
    expect(computed).toBeTruthy();
    expect(computed!.engineVersion).toBeTruthy();
    expect((computed!.fields as { provenance: string }[]).every((f) => f.provenance === 'engine')).toBe(true);

    // Compute appends the AdjustmentComputed fact AND auto-runs the review layer,
    // which appends a DiagnosticRaised fact — two facts, in sequence.
    const facts = await FactLog.find({ engagementYearId: engId }).sort({ seq: 1 }).lean();
    const computedFact = facts.find((f) => f.type === 'AdjustmentComputed');
    expect(computedFact).toBeTruthy();
    expect(computedFact!.provenance).toBe('engine');
    expect(computedFact!.seq).toBe(1);
    // The auto-review diagnostic fact is also present.
    expect(facts.some((f) => f.type === 'DiagnosticRaised')).toBe(true);

    const updated = await EngagementYear.findById(engId).lean();
    expect(updated!.status).toBe('in_progress');
  }, 20_000);

  it('atomic sequence hands out distinct values under concurrency (no count()+1 race)', async () => {
    const { nextSequence } = await import('../src/shared/sequence.js');
    const key = `test-seq:${TEST_ORG}:race`;
    // 25 concurrent allocations — count()+1 would collide; the atomic $inc cannot.
    const values = await Promise.all(Array.from({ length: 25 }, () => nextSequence(key)));
    expect(new Set(values).size).toBe(25); // all distinct
    expect(Math.max(...values)).toBe(25); // 1..25, no gaps or dupes
  }, 20_000);

  it('rejects unauthenticated compute', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${new mongoose.Types.ObjectId().toString()}/action`,
      payload: { action: 'compute' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('404 for a non-existent engagement (authed)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${new mongoose.Types.ObjectId().toString()}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
        bookNetIncome: 1,
        activeBusinessIncome: 1,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('program-aware: an AT1 engagement computes the Alberta return', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: {
        clientId: CLIENT,
        program: 'AT1',
        taxYearStart: '2024-01-01T00:00:00.000Z',
        taxYearEnd: '2024-12-31T00:00:00.000Z',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    const engId: string = (created.data ?? created)._id ?? (created.data ?? created).id;

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
        federalTaxableIncome: 195000,
        activeBusinessIncome: 195000,
      },
    });

    expect(res.statusCode).toBe(200);
    const result = res.json().data ?? res.json();
    // Alberta small-business tax: 195,000 × 2% = $3,900 → 390,000 cents.
    expect(result.obligation.jurisdiction).toBe('CA-AB');
    expect(result.obligation.totalOwing).toBe(390000);

    const computed = await ComputedReturn.findById(result.computedReturnId).lean();
    expect(computed!.program).toBe('AT1');
  }, 20_000);

  it('auto-fill is fail-closed (503) until a CRA AFR gateway is wired', async () => {
    const engRes = await ctx.app.inject({
      method: 'POST', url: '/engagement-years', headers: auth.as('manager').headers,
      payload: { clientId: CLIENT, program: 'T2', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    const engId: string = (engRes.json().data ?? engRes.json())._id;
    const res = await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
      payload: { action: 'auto-fill' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(/not configured|My Business Account|Represent a Client/i);
  }, 20_000);

  it('auto-fill pulls CRA data and pre-fills the return (blanks only) via an injected gateway', async () => {
    setAfrGateway({
      async fetchCorporateData(req) {
        expect(req.businessNumber).toBe('100000000'); // the CLIENT seed BN
        return {
          identification: { corpType: 'CCPC', province: 'ON' },
          carryforwards: { nonCapitalLossOpening: 40000, gripOpening: 150000 },
          instalmentsPaid: 25000,
        };
      },
    });
    try {
      const engRes = await ctx.app.inject({
        method: 'POST', url: '/engagement-years', headers: auth.as('manager').headers,
        payload: { clientId: CLIENT, program: 'T2', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
      });
      const engId: string = (engRes.json().data ?? engRes.json())._id;

      // Preparer already entered a GRIP — auto-fill must NOT overwrite it.
      await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
        payload: { action: 'save-input', returnInput: { dividends: { openingGrip: 999 } } },
      });

      const res = await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
        payload: { action: 'auto-fill', programAccount: '0001' },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json().data ?? res.json();
      expect(out.filled).toContain('losses.nonCapitalOpening');
      expect(out.filled).not.toContain('dividends.openingGrip'); // preparer value preserved

      const eng = await EngagementYear.findById(engId).lean();
      const ri = eng!.returnInput as Record<string, Record<string, unknown>>;
      expect(ri.losses.nonCapitalOpening).toBe(40000);
      expect(ri.dividends.openingGrip).toBe(999); // NOT overwritten by CRA's 150000
      expect(ri.payments.instalmentsPaid).toBe(25000);

      // A SourceImported (imported provenance) fact records the pull.
      const facts = await FactLog.find({ engagementYearId: engId, type: 'SourceImported' }).lean();
      expect(facts.length).toBe(1);
      expect(facts[0]!.provenance).toBe('imported');
    } finally {
      // Restore the fail-closed default so later tests aren't affected.
      setAfrGateway({ async fetchCorporateData() { throw new Error('not configured'); } });
    }
  }, 20_000);

  it('Schedule 33 taxable capital + Schedule 13 reserves flow through the structured editor path', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST', url: '/engagement-years', headers: auth.as('manager').headers,
      payload: { clientId: CLIENT, program: 'T2', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    const engId: string = (createRes.json().data ?? createRes.json())._id;

    const res = await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        returnInput: {
          identification: { corpType: 'CCPC', province: 'ON' },
          incomeStatement: { revenue: 700000, costOfSales: 100000 }, // book net income 600k
          sbd: { activeBusinessIncome: 600000 },
          // Schedule 33: $30M taxable capital → halfway through the $10M→$50M grind.
          capital: { capitalStock: 30000000 },
          // Schedule 13: a doubtful-debts reserve (opening 40k reversed, closing 55k deducted).
          reserves: { rows: [{ type: 'doubtful debts', opening: 40000, closing: 55000 }] },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json().data ?? res.json();
    const computed = await ComputedReturn.findById(result.computedReturnId).lean();
    const fields = computed!.fields as { line: string; value: number }[];
    const v = (line: string) => fields.find((f) => f.line === line)?.value;

    // S33: taxable capital employed in Canada surfaced, and the grind halved the
    // $500k business limit → SBD income capped at $250k.
    expect(v('taxableCapitalEmployedInCanada')).toBe(30000000);
    expect(v('sbdIncome')).toBe(250000);
    // S13: the closing reserve was deducted on Schedule 1.
    expect(v('reservesClosing')).toBe(55000);
    // Net income for tax reflects the reserve swing (opening +40k back, closing −55k).
    expect(v('netIncomeForTax')).toBe(600000 - 15000);
  }, 20_000);

  it('short tax year: the host passes the period so the business limit prorates (s.125(5)(b))', async () => {
    // A 182-day 2024 stub year. The engine must prorate the $500k limit by days/365
    // → ~249,315, capping SBD income below the full $500k ABI.
    const engRes = await ctx.app.inject({
      method: 'POST', url: '/engagement-years', headers: auth.as('manager').headers,
      payload: { clientId: CLIENT, program: 'T2', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-06-30T00:00:00.000Z' },
    });
    const engId: string = (engRes.json().data ?? engRes.json())._id;
    const res = await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        returnInput: {
          identification: { corpType: 'CCPC', province: 'ON' },
          incomeStatement: { revenue: 500000 }, // net income 500k
          sbd: { activeBusinessIncome: 500000 },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const computed = await ComputedReturn.findById((res.json().data ?? res.json()).computedReturnId).lean();
    const fields = computed!.fields as { line: string; value: number }[];
    // SBD income prorated to the short-year limit, NOT the full 500k.
    expect(fields.find((f) => f.line === 'sbdIncome')!.value).toBe(249_315);
  }, 20_000);

  it('program-aware: a CO17 engagement computes the Québec return from the STRUCTURED editor input', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: {
        clientId: CLIENT,
        program: 'CO17',
        taxYearStart: '2024-01-01T00:00:00.000Z',
        taxYearEnd: '2024-12-31T00:00:00.000Z',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    const engId: string = (created.data ?? created)._id ?? (created.data ?? created).id;

    // The structured working return the editor saves — federal taxable income is
    // COMPOSED from these schedules (revenue 300k − COS 100k = 200k), then allocated
    // to Québec (½rev+½payroll → 0.5) and taxed at the Québec SBD rate.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        returnInput: {
          identification: { corpType: 'CCPC', province: 'QC', quebecId: '1234567890' },
          incomeStatement: { revenue: 300000, costOfSales: 100000 },
          sbd: { activeBusinessIncome: 200000 },
          provincialAllocation: {
            establishments: [
              { province: 'QC', grossRevenue: 600000, salariesWages: 200000 },
              { province: 'ON', grossRevenue: 400000, salariesWages: 300000 },
            ],
          },
          quebec: { sbdEligibleQC: true },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const result = res.json().data ?? res.json();
    expect(result.obligation.jurisdiction).toBe('CA-QC');
    // taxable 200k × 0.5 allocation = 100k QC; eligible CCPC → 3.2% = $3,200.
    expect(result.obligation.totalOwing).toBe(320000);

    const computed = await ComputedReturn.findById(result.computedReturnId).lean();
    expect(computed!.program).toBe('CO17');
    const fields = computed!.fields as { line: string; value: number }[];
    expect(fields.find((f) => f.line === 'allocationFactor')!.value).toBeCloseTo(0.5, 6);
    expect(fields.find((f) => f.line === 'quebecTaxableIncome')!.value).toBe(100000);
    expect(fields.find((f) => f.line === 'quebecTaxPayable')!.value).toBe(3200);
    // The return is fileable (computed from the server-assembled structured return).
    expect(computed!.fileable).toBe(true);
  }, 20_000);

  it('CO17 SBD fails closed: no Québec eligibility attestation ⇒ general rate', async () => {
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: { clientId: CLIENT, program: 'CO17', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    const engId: string = (createRes.json().data ?? createRes.json())._id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        returnInput: {
          identification: { corpType: 'CCPC', province: 'QC' },
          incomeStatement: { revenue: 300000, costOfSales: 100000 },
          sbd: { activeBusinessIncome: 200000 },
          // Single QC PE (no establishments) → factor 1; NO quebec.sbdEligibleQC.
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json().data ?? res.json();
    // 200k × 1.0, all general-rate (fail-closed): 11.5% = $23,000.
    expect(result.obligation.totalOwing).toBe(2300000);
    const computed = await ComputedReturn.findById(result.computedReturnId).lean();
    const fields = computed!.fields as { line: string; value: number }[];
    expect(fields.find((f) => f.line === 'quebecSbdIncome')!.value).toBe(0);
  }, 20_000);

  it('prepare-netfile renders the AT1 payload from a real client + computed return', async () => {
    // A real client with the Alberta filing identity, created via the API.
    const clientRes = await ctx.app.inject({
      method: 'POST',
      url: '/clients',
      headers: auth.as('manager').headers,
      payload: {
        businessNumber: '100092287RC0001',
        name: 'TaxFoundry Test Corp',
        corporateAccountNumber: '123456789',
        address: { street: '9811 109 St', city: 'Edmonton', province: 'AB', postalCode: 'T5K 2L5' },
      },
    });
    expect(clientRes.statusCode).toBe(201);
    const clientDoc = clientRes.json().data ?? clientRes.json();
    const clientId: string = clientDoc._id ?? clientDoc.id;

    const engRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: { clientId, program: 'AT1', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    const engId: string = (engRes.json().data ?? engRes.json())._id;

    // compute (AT1) so a computed-return exists
    await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
        federalTaxableIncome: 195000,
        activeBusinessIncome: 195000,
      },
    });

    // prepare the Net File payload
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'prepare-netfile',
        certification: { firstName: 'Sam', lastName: 'Preparer', position: 'Director' },
      },
    });

    expect(res.statusCode).toBe(200);
    const out = res.json().data ?? res.json();
    expect(out.payloadHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(out.xml).toContain('<ProgramCode>01</ProgramCode>');
    expect(out.xml).toContain('<Value LineItemID="000010001">TaxFoundry Test Corp</Value>');
    expect(out.xml).toContain('<Value LineItemID="000035001">100092287RC0001</Value>');
    expect(out.xml).toContain('<Value LineItemID="000080001">3900</Value>'); // Alberta tax from the computed return
  }, 20_000);

  it('prepare-netfile requires certification (400)', async () => {
    const engRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: { clientId: CLIENT, program: 'AT1', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    const engId: string = (engRes.json().data ?? engRes.json())._id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: { action: 'prepare-netfile' },
    });
    expect(res.statusCode).toBe(400);
  });

  async function setupComputedAt1(): Promise<string> {
    const clientRes = await ctx.app.inject({
      method: 'POST',
      url: '/clients',
      headers: auth.as('manager').headers,
      payload: {
        businessNumber: '100092287RC0001',
        name: 'TaxFoundry Test Corp',
        corporateAccountNumber: '123456789',
        address: { street: '9811 109 St', city: 'Edmonton', province: 'AB', postalCode: 'T5K 2L5' },
      },
    });
    const clientId = (clientRes.json().data ?? clientRes.json())._id;
    const engRes = await ctx.app.inject({
      method: 'POST',
      url: '/engagement-years',
      headers: auth.as('manager').headers,
      payload: { clientId, program: 'AT1', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
    });
    const engId = (engRes.json().data ?? engRes.json())._id;
    await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: {
        action: 'compute',
        period: { start: '2024-01-01', end: '2024-12-31', label: '2024' },
        federalTaxableIncome: 195000,
        activeBusinessIncome: 195000,
      },
    });
    return engId;
  }

  const certification = { firstName: 'Sam', lastName: 'Preparer', position: 'Director' };

  it('transmit is blocked without a signed-off review memo (409)', async () => {
    const engId = await setupComputedAt1();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: { action: 'transmit', certification },
    });
    expect(res.statusCode).toBe(409);
  }, 20_000);

  it('sign-off is blocked by an unresolved red flag (422)', async () => {
    const engId = await setupComputedAt1();
    const memo = await ReviewMemo.create({
      engagementYearId: engId,
      status: 'draft',
      flags: [{ severity: 'red', code: 'S1_MISMATCH', message: 'net income mismatch', resolved: false }],
      organizationId: TEST_ORG,
      createdBy: MANAGER,
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/review-memos/${memo._id}/action`,
      headers: auth.as('manager').headers,
      payload: { action: 'sign-off' },
    });
    expect(res.statusCode).toBe(422);
  }, 20_000);

  it('full L1 loop: sign-off action → transmit files the AT1', async () => {
    const engId = await setupComputedAt1();

    // A clean review memo BOUND to the exact computed return (as production review
    // generation does) — transmit now requires the sign-off to reference it.
    const cr = await ComputedReturn.findOne({ engagementYearId: engId }).sort({ createdAt: -1 }).lean();
    const memo = await ReviewMemo.create({
      engagementYearId: engId,
      computedReturnId: cr!._id,
      status: 'draft',
      flags: [{ severity: 'green', code: 'ok', message: 'reconciles' }],
      organizationId: TEST_ORG,
      createdBy: MANAGER,
    });
    const signRes = await ctx.app.inject({
      method: 'POST',
      url: `/review-memos/${memo._id}/action`,
      headers: auth.as('manager').headers,
      payload: { action: 'sign-off' },
    });
    expect(signRes.statusCode).toBe(200);
    expect((signRes.json().data ?? signRes.json()).status).toBe('signed_off');

    // The corporate officer authorizes e-filing of THIS computed return (T183CORP).
    const authRes = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: { action: 'authorize-t183', officerName: 'Jane Officer', officerPosition: 'President', signedAt: new Date(Date.now() - 60_000).toISOString(), authorizationMethod: 'electronic_signature', evidenceRef: 'T183CORP-signed.pdf', formVersion: 'T183CORP-2024' },
    });
    expect(authRes.statusCode).toBe(200);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers,
      payload: { action: 'transmit', certification },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json().data ?? res.json();
    expect(out.status).toBe('accepted');
    expect(out.confirmationNumber).toBe('TRA-TEST-0001');

    const filing = await FilingRecord.findById(out.filingRecordId).lean();
    expect(filing!.channel).toBe('AT1_NETFILE');
    expect(filing!.status).toBe('accepted');
    expect(filing!.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(filing!.confirmationNumber).toBe('TRA-TEST-0001');
    // The T183 signer of record is the authorizing OFFICER, not the transmit text.
    expect(filing!.t183!.signedBy).toBe('Jane Officer');
    expect(filing!.t183!.signedPosition).toBe('President');
    expect(filing!.t183!.authorizationId).toBeTruthy();

    // The full audit trail: sign-off → T183 authorize → transmit → ack.
    const facts = await FactLog.find({ engagementYearId: engId }).sort({ seq: 1 }).lean();
    const types = facts.map((f) => f.type);
    expect(types).toContain('T183Authorized');
    expect(types).toContain('ReviewSignedOff');
    expect(types).toContain('TransmissionAttempted');
    expect(types).toContain('CRAAcknowledged');

    const eng = await EngagementYear.findById(engId).lean();
    expect(eng!.status).toBe('filed');

    // Idempotency: a second transmit of the ALREADY-ACCEPTED return is refused
    // (the pre-egress attempt guard blocks a double-file).
    const dup = await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`,
      headers: auth.as('manager').headers, payload: { action: 'transmit', certification },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().message).toMatch(/already been accepted|in-flight|unknown/i);
  }, 20_000);

  it('T2 transmit serializes via the CERTIFIED serializer — the DRAFT XML never reaches the gateway', async () => {
    // A fake certified serializer + a capturing gateway.
    let sentXml = '';
    setCertifiedT2Serializer({
      schemaVersion: 'test-1.0',
      softwareApprovalId: 'CRA-APPROVAL-TEST',
      serialize: (d) => `<CertifiedT2Return approvalId="CRA-APPROVAL-TEST" bn="${d.identity.businessNumber}"/>`,
    });
    setT2CifGateway({
      async transmit(xml) {
        sentXml = xml;
        return { status: 'accepted', confirmationNumber: 'CRA-CONF-1', errorCodes: [] };
      },
    });
    try {
      const clientRes = await ctx.app.inject({
        method: 'POST', url: '/clients', headers: auth.as('manager').headers,
        payload: { name: 'Certified Filing Co', businessNumber: '100000900RC0001', corpType: 'CCPC' },
      });
      const clientId = (clientRes.json().data ?? clientRes.json())._id;
      const engRes = await ctx.app.inject({
        method: 'POST', url: '/engagement-years', headers: auth.as('manager').headers,
        payload: { clientId, program: 'T2', taxYearStart: '2024-01-01T00:00:00.000Z', taxYearEnd: '2024-12-31T00:00:00.000Z' },
      });
      const engId = (engRes.json().data ?? engRes.json())._id;
      // Structured, complete, balanced (assets 50k = liab 50k) return → fileable.
      await ctx.app.inject({
        method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
        payload: { action: 'compute', returnInput: {
          identification: { corpType: 'CCPC', province: 'ON', headOffice: { line1: '1 King St', city: 'Toronto' } },
          balanceSheet: { cash: 50000, accountsPayable: 50000 },
          incomeStatement: { revenue: 100000, costOfSales: 40000 },
          gifiNotes: { preparedByAccountant: true },
          sbd: { activeBusinessIncome: 60000 },
          shareholders: { list: [{ name: 'Owner', commonPct: 100 }] },
        } },
      });
      const cr = await ComputedReturn.findOne({ engagementYearId: engId }).sort({ createdAt: -1 }).lean();
      const memo = await ReviewMemo.create({
        engagementYearId: engId, computedReturnId: cr!._id, status: 'draft',
        flags: [{ severity: 'green', code: 'ok', message: 'ok' }], organizationId: TEST_ORG, createdBy: MANAGER,
      });
      await ctx.app.inject({ method: 'POST', url: `/review-memos/${memo._id}/action`, headers: auth.as('manager').headers, payload: { action: 'sign-off' } });
      await ctx.app.inject({ method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers, payload: { action: 'authorize-t183', officerName: 'Jane Officer', officerPosition: 'President', signedAt: new Date(Date.now() - 60_000).toISOString(), authorizationMethod: 'electronic_signature', evidenceRef: 'T183-doc-1' } });

      const res = await ctx.app.inject({ method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers, payload: { action: 'transmit', certification } });
      expect(res.statusCode).toBe(200);
      // The gateway received the CERTIFIED serializer output, and NEVER the draft.
      expect(sentXml).toContain('<CertifiedT2Return');
      expect(sentXml).toContain('CRA-APPROVAL-TEST');
      expect(sentXml).not.toContain('status="draft"');
      expect(sentXml).not.toContain('<T2Return');
    } finally {
      setCertifiedT2Serializer(null); // restore fail-closed default
    }
  }, 20_000);

  it('BLOCKS a stale sign-off: signing return A then recomputing B must not authorize B', async () => {
    const engId = await setupComputedAt1();
    // Sign off return A (bound to A's computed return).
    const crA = await ComputedReturn.findOne({ engagementYearId: engId }).sort({ createdAt: -1 }).lean();
    const memoA = await ReviewMemo.create({
      engagementYearId: engId, computedReturnId: crA!._id, status: 'draft',
      flags: [{ severity: 'green', code: 'ok', message: 'A' }], organizationId: TEST_ORG, createdBy: MANAGER,
    });
    await ctx.app.inject({ method: 'POST', url: `/review-memos/${memoA._id}/action`, headers: auth.as('manager').headers, payload: { action: 'sign-off' } });

    // Recompute → a NEW computed return B (A's sign-off does not cover it).
    await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
      payload: { action: 'compute', period: { start: '2024-01-01', end: '2024-12-31', label: '2024' }, federalTaxableIncome: 250000, activeBusinessIncome: 250000 },
    });
    const crB = await ComputedReturn.findOne({ engagementYearId: engId }).sort({ createdAt: -1 }).lean();
    expect(String(crB!._id)).not.toBe(String(crA!._id)); // genuinely a new computation

    // Transmit must REFUSE — the only signed memo references A, not the current B.
    const res = await ctx.app.inject({
      method: 'POST', url: `/engagement-years/${engId}/action`, headers: auth.as('manager').headers,
      payload: { action: 'transmit', certification },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/has not been signed off/);
    const eng = await EngagementYear.findById(engId).lean();
    expect(eng!.status).not.toBe('filed');
  }, 20_000);
});
