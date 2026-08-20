/**
 * Ledger-foundation resource tests — client, engagement-year, fact-log.
 *
 * Runs WITHOUT a database (db: false): every assertion here is about routing,
 * auth gating, and the append-only enforcement — all of which arc decides before
 * a handler ever touches Mongo. Persistence/immutability-at-write tests (which
 * need a DB) live in ../../tests/integration and light up under a Mongo URI.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, expectArc } from '@classytic/arc/testing';
import type { TestAppContext } from '@classytic/arc/testing';
import clientResource from '../src/resources/engagement/client/client.resource.js';
import engagementYearResource from '../src/resources/engagement/engagement-year/engagement-year.resource.js';
import factLogResource from '../src/resources/ledger/fact-log/fact-log.resource.js';
import proposalResource from '../src/resources/ledger/proposal/proposal.resource.js';
import computedReturnResource from '../src/resources/ledger/computed-return/computed-return.resource.js';
import gifiMappingResource from '../src/resources/workpapers/gifi-mapping/gifi-mapping.resource.js';
import reviewMemoResource from '../src/resources/workpapers/review-memo/review-memo.resource.js';
import filingRecordResource from '../src/resources/workpapers/filing-record/filing-record.resource.js';

const OID = '64f000000000000000000001';

describe('Ledger foundation resources', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      resources: [
        clientResource,
        engagementYearResource,
        factLogResource,
        proposalResource,
        computedReturnResource,
        gifiMappingResource,
        reviewMemoResource,
        filingRecordResource,
      ],
      authMode: 'jwt',
      db: false,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('auth gating (all org-scoped)', () => {
    it.each([
      ['/clients'],
      ['/engagement-years'],
      ['/fact-logs'],
      ['/proposals'],
      ['/computed-returns'],
      ['/gifi-mappings'],
      ['/review-memos'],
      ['/filing-records'],
    ])(
      'rejects unauthenticated listing of %s',
      async (url) => {
        const res = await ctx.app.inject({ method: 'GET', url });
        expectArc(res).unauthorized();
      },
    );
  });

  describe('computed-return is an immutable snapshot (no update route)', () => {
    it('has NO PATCH /computed-returns/:id route (recompute, do not edit)', async () => {
      const res = await ctx.app.inject({ method: 'PATCH', url: `/computed-returns/${OID}`, payload: {} });
      expect(res.statusCode, 'a computed return is a snapshot — never edited').toBe(404);
    });

    it('DOES expose DELETE /computed-returns/:id (a cache is discardable) — gated, not missing', async () => {
      const res = await ctx.app.inject({ method: 'DELETE', url: `/computed-returns/${OID}` });
      expect(res.statusCode).not.toBe(404);
      expectArc(res).unauthorized();
    });
  });

  describe('proposal is mutable (the agent write path, human-resolved)', () => {
    it('PATCH /proposals/:id EXISTS (401, not 404) — proposals move pending→resolved', async () => {
      const res = await ctx.app.inject({ method: 'PATCH', url: `/proposals/${OID}`, payload: {} });
      expect(res.statusCode).not.toBe(404);
      expectArc(res).unauthorized();
    });
  });

  describe('filing-record is never deletable (regulatory retention)', () => {
    it('has NO DELETE /filing-records/:id route', async () => {
      const res = await ctx.app.inject({ method: 'DELETE', url: `/filing-records/${OID}` });
      expect(res.statusCode, 'a filing is a regulatory act — its record is never deleted').toBe(404);
    });

    it('DOES expose PATCH /filing-records/:id (ack update) — gated, not missing', async () => {
      const res = await ctx.app.inject({ method: 'PATCH', url: `/filing-records/${OID}`, payload: {} });
      expect(res.statusCode).not.toBe(404);
      expectArc(res).unauthorized();
    });
  });

  describe('fact-log is append-only (no update/delete routes)', () => {
    it('has NO PATCH /fact-logs/:id route (append-only)', async () => {
      const res = await ctx.app.inject({ method: 'PATCH', url: `/fact-logs/${OID}` });
      expect(res.statusCode, 'update route must not exist on the append-only ledger').toBe(404);
    });

    it('has NO DELETE /fact-logs/:id route (append-only)', async () => {
      const res = await ctx.app.inject({ method: 'DELETE', url: `/fact-logs/${OID}` });
      expect(res.statusCode, 'delete route must not exist on the append-only ledger').toBe(404);
    });

    it('DOES expose POST /fact-logs (append allowed) — gated by auth, not missing', async () => {
      const res = await ctx.app.inject({ method: 'POST', url: '/fact-logs', payload: {} });
      // Route exists → auth gate fires (401), NOT a 404.
      expect(res.statusCode).not.toBe(404);
      expectArc(res).unauthorized();
    });
  });

  describe('client/engagement-year remain mutable (control vs fact-log)', () => {
    it('PATCH /clients/:id EXISTS (401, not 404) — proving the 404 above is real', async () => {
      const res = await ctx.app.inject({ method: 'PATCH', url: `/clients/${OID}`, payload: {} });
      expect(res.statusCode).not.toBe(404);
      expectArc(res).unauthorized();
    });
  });
});
