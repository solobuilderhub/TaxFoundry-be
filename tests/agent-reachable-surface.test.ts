/**
 * WHAT AN AGENT CAN DO — and, more importantly, what it cannot.
 *
 * `/api/mcp` auto-generates one tool per CRUD verb AND per action on every arc
 * resource. Everything was exposed by default, so the same key that prepared a
 * return could also clear the review flags that would block sign-off, sign the
 * review off, record the officer's T183 authorisation, and transmit — the whole
 * filing chain with no second party.
 *
 * ── The line, and why it is drawn here ──────────────────────────────────────
 *
 * An agent may PRODUCE work. It may not ATTEST to it or RELEASE it.
 *
 * That is not a house preference; both revenue authorities say it. CRA requires
 * *"an authorized signing officer of the corporation"* to sign Form T183CORP
 * **before** the return is transmitted, and that officer certifies they have
 * examined it. TRA's Net File attestation is the same: *"I am an authorized
 * signing officer of the corporation, or … an authorized signing officer of the
 * corporation has instructed me to file this return."* The officer is an officer
 * of the CLIENT corporation — never the software preparing the return.
 *
 * Sign-off matters for a second reason: it is the control the provenance guard
 * leans on for everything it cannot itself check. GIFI, the questionnaire, the
 * Alberta jacket answers and every other filing input are untagged (see
 * `provenance-guard.ts`), and sign-off is what makes them a human decision. If
 * the actor that produced them can also approve them, it certifies nothing.
 *
 * ── A note on this test's own history ───────────────────────────────────────
 *
 * The first version asserted that the action KEYS existed on the resource. They
 * still do — `mcp: false` removes the TOOL, not the action, which stays
 * available over HTTP to an authenticated human. So it passed both before and
 * after the closure and pinned nothing at all. It now reads the per-action `mcp`
 * flag, and is checked against a case that must be exposed so it cannot pass by
 * finding `false` everywhere.
 */
import { describe, expect, it } from 'vitest';
import { resources } from '../src/resources/index.js';

type ActionDef = { mcp?: boolean };
type ResourceLike = { name?: string; actions?: Record<string, ActionDef | undefined> };

const action = (resource: string, name: string): ActionDef | undefined =>
  (resources as unknown as ResourceLike[]).find((r) => r.name === resource)?.actions?.[name];

/** The four an agent must not reach. */
const CLOSED = [
  ['review-memo', 'resolve-flag'],
  ['review-memo', 'sign-off'],
  ['engagement-year', 'authorize-t183'],
  ['engagement-year', 'transmit'],
] as const;

/** Preparation — an agent's actual job, and it must stay reachable. */
const OPEN = [
  ['engagement-year', 'compute'],
  ['engagement-year', 'save-input'],
  ['engagement-year', 'auto-fill'],
  ['engagement-year', 'generate-review'],
  ['engagement-year', 'prepare-cif'],
  ['engagement-year', 'prepare-netfile'],
] as const;

describe('the agent-reachable surface', () => {
  for (const [resource, name] of CLOSED) {
    it(`${resource}.${name} is NOT generated as an MCP tool`, () => {
      const def = action(resource, name);
      expect(def, `${resource}.${name} no longer exists — was it renamed?`).toBeDefined();
      expect(def?.mcp).toBe(false);
    });
  }

  for (const [resource, name] of OPEN) {
    it(`${resource}.${name} stays available — preparation is the agent's job`, () => {
      const def = action(resource, name);
      expect(def, `${resource}.${name} no longer exists — was it renamed?`).toBeDefined();
      // Omitted means auto-generate. Explicit `true` is fine too.
      expect(def?.mcp === undefined || def?.mcp === true).toBe(true);
    });
  }

  it('closes the whole handover chain, not merely the last step', () => {
    // Blocking `transmit` alone would leave an agent able to manufacture the
    // approvals and hand a human a return that merely looks reviewed.
    const closed = CLOSED.filter(([r, n]) => action(r, n)?.mcp === false);
    expect(closed).toHaveLength(CLOSED.length);
  });

  it('the agent instructions match what the tools actually allow', async () => {
    // An agent told to `sign-off` by its own system prompt, then refused the
    // tool, will retry and invent workarounds. The prompt has to say the same
    // thing the surface does.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/mcp/index.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('HANDOVER');
    for (const [, name] of CLOSED) expect(src).toContain(name);
    // …and it must NOT still be instructing the agent to sign off.
    expect(src).not.toMatch(/then `sign-off`/);
  });
});
