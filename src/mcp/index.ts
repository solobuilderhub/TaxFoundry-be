/**
 * MCP endpoint for TaxFoundry.
 *
 * Auto-generates Model Context Protocol tools from every arc resource via
 * `@classytic/arc/mcp`'s `mcpPlugin`. An AI agent (Claude Desktop, the claude.ai
 * connector, MCP Inspector, Cursor) connects over HTTP-streaming at `/api/mcp`
 * and calls the SAME handlers the UI does — so every permission preset, tenant
 * guard, provenance guard, and audit path is reused verbatim. The agent can
 * therefore operate the tax system (create clients, save schedule inputs, run
 * compute, resolve review flags, prepare filings) and "fill in" a return the
 * same way a human preparer does through the dashboard.
 *
 * Auth: per-org API keys (Better Auth `apiKey` plugin), sent as `x-api-key` or
 * `Authorization: Bearer txf_…`. Each key carries `metadata.orgId`; membership
 * is re-verified on every call so a removed user's key stops working at once.
 */

import type { ResourceLike } from '@classytic/arc/factory';
import type { McpAuthResolver, McpPluginOptions } from '@classytic/arc/mcp';
import { mcpPlugin } from '@classytic/arc/mcp';
import type { FastifyInstance } from 'fastify';

interface AuthInstance {
  api: {
    verifyApiKey?: (args: { body: { key: string } }) => Promise<{
      valid?: boolean;
      key?: {
        id?: string;
        userId?: string;
        referenceId?: string;
        metadata?: Record<string, unknown> | null;
      } | null;
    } | null>;
  };
}

export interface RegisterMcpOptions {
  resources: readonly ResourceLike[];
  auth: AuthInstance;
}

/**
 * Agent-facing system prompt — encodes TaxFoundry's governed filing workflow so
 * an autonomous preparer agent produces a fileable return instead of learning
 * the rules by hitting errors. Kept here (not inline) so it's reviewable as a
 * unit.
 */
const TAX_AGENT_INSTRUCTIONS = [
  'TaxFoundry prepares CRA T2 (federal) and Alberta AT1 corporate tax returns.',
  'Every tool is org-scoped — you act as the org of the authenticated key.',
  '',
  'TOOL NAMING: tools are `{verb}_{resource}` — e.g. `list_clients`, `create_client`,',
  '`create_engagement_year`, and per-action tools on engagement-years',
  '(`save-input`, `compute`, `generate-review`, `prepare-cif`, `prepare-netfile`,',
  '`transmit`) and review-memos (`sign-off`, `resolve-flag`). Read the live tool',
  'list for exact names.',
  '',
  'THE FILING WORKFLOW (do it in this order):',
  '1. A CLIENT is the taxpayer corporation. `create_client` needs a valid 9-digit',
  '   business number and corpType (e.g. "CCPC") — without them the return can\'t file.',
  '2. An ENGAGEMENT-YEAR is one client + one tax year + program (T2 or AT1).',
  '   `create_engagement_year { clientId, program, taxYearStart, taxYearEnd }`.',
  '3. FILL THE RETURN with the `save-input` action: `{ action:"save-input",',
  '   returnInput:{ incomeStatement, balanceSheet, sbd, cca, losses, … } }`. To import',
  '   a GIFI trial balance instead of hand-entering, use the `gifi` import tool, then',
  '   save its balanceSheet + incomeStatement.',
  '4. COMPUTE with the `compute` action (needs period + bookNetIncome +',
  '   activeBusinessIncome). This runs the engine, writes a provenance-tagged',
  '   computed return, and auto-generates the cited REVIEW.',
  '5. REVIEW: read the review-memo and act on what it says. You CANNOT resolve a',
  '   flag or sign off — those are not exposed to you (see HANDOVER below).',
  '   Fix the cited input and re-run `compute`; the review regenerates.',
  '6. EXPORT: `prepare-cif` (T2) or `prepare-netfile` (AT1) renders the filing',
  '   payload so a preparer can read it. You CANNOT transmit.',
  '',
  'HARD RULES (enforced server-side — you WILL be rejected):',
  '• A FILED value must originate from the engine, an import, or a human — NEVER a',
  '  model guess. Do not fabricate computed lines; run `compute` and read them back.',
  '• HANDOVER — four things are deliberately NOT in your tool list, and no amount',
  '  of retrying will surface them: `resolve-flag`, `sign-off`, `authorize-t183`,',
  '  `transmit`. They are where a PERSON takes responsibility for your work.',
  '  CRA requires an authorized signing officer of the corporation to sign the',
  '  T183CORP before a return is transmitted, and that officer is a human being',
  '  at the client — never software. Prepare the return completely, then say what',
  '  you did, what you assumed, and what you could not resolve, and stop.',
  '• Multi-year loss / RDTOH balances carry forward automatically from the prior',
  "  year's return — do not hand-enter opening balances that already exist in-system.",
  '',
  "Check `certification` readiness tools to see the engine's conformance status.",
].join('\n');

/** Pull a TaxFoundry API key from `x-api-key` or `Authorization: Bearer txf_…`. */
function extractApiKey(headers: Record<string, string | undefined>): string | null {
  const direct = headers['x-api-key'];
  if (direct) return direct;
  const auth = headers.authorization;
  if (auth?.startsWith('Bearer txf_')) return auth.slice('Bearer '.length);
  return null;
}

/**
 * Re-verify the key owner is still a member of the bound org and pull their org
 * role(s). `null` → membership gone (reject the key); `[]` → member with no role.
 */
async function fetchOrgRoles(userId: string, organizationId: string): Promise<string[] | null> {
  const mongoose = (await import('mongoose')).default;
  const userObjectId = mongoose.isValidObjectId(userId)
    ? new mongoose.Types.ObjectId(userId)
    : (userId as unknown as string);
  const orgObjectId = mongoose.isValidObjectId(organizationId)
    ? new mongoose.Types.ObjectId(organizationId)
    : (organizationId as unknown as string);
  const member = await mongoose.connection
    .getClient()
    .db()
    .collection('member')
    .findOne({ userId: userObjectId, organizationId: orgObjectId });
  if (!member) return null;
  const role = (member as { role?: string | string[] }).role;
  if (!role) return [];
  return Array.isArray(role) ? role : [role];
}

/** Mount the MCP endpoint at `/api/mcp` (idempotent; per-resource `mcp:false` honoured). */
export async function registerMcpEndpoint(
  fastify: FastifyInstance,
  opts: RegisterMcpOptions,
): Promise<void> {
  const exposed = opts.resources.filter((r) => typeof r.name === 'string');

  const resolveAuth: McpAuthResolver = async (headers) => {
    const key = extractApiKey(headers);
    if (!key || !opts.auth.api.verifyApiKey) return null;

    let verified: { userId: string; orgId: string } | null = null;
    try {
      const result = await opts.auth.api.verifyApiKey({ body: { key } });
      if (result?.valid && result.key) {
        const userId = (result.key.referenceId ?? result.key.userId ?? '') as string;
        const orgId = (result.key.metadata?.orgId ?? '') as string;
        if (userId && orgId) verified = { userId, orgId };
      }
    } catch {
      // invalid key → null (BA records the failure in its rate-limit counters)
    }
    if (!verified) return null;

    const orgRoles = await fetchOrgRoles(verified.userId, verified.orgId);
    if (orgRoles === null) return null;

    return { userId: verified.userId, organizationId: verified.orgId, orgRoles };
  };

  const options: McpPluginOptions = {
    resources: exposed as never,
    prefix: '/api/mcp',
    serverName: 'taxfoundry',
    serverVersion: '1.0.0',
    instructions: TAX_AGENT_INSTRUCTIONS,
    auth: resolveAuth,
    stateful: false,
    authCacheTtlMs: 5_000,
  };
  await fastify.register(mcpPlugin, options);

  fastify.log.info(`MCP endpoint mounted at /api/mcp — ${exposed.length} resources exposed`);
}
