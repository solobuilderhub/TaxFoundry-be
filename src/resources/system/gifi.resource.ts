/**
 * GIFI import resource — a service resource (no CRUD): classify a GIFI-coded
 * trial balance into a return's balance sheet + income statement, so a preparer
 * can paste their accounting export instead of hand-keying every line.
 *
 * The GIFI classification is delegated to `@classytic/ledger-ca` (see
 * engine/gifi-import.ts). Read-only and org-agnostic — any org member may use it.
 *
 *   POST /api/gifi/import     { text? | lines? } → GifiImportResult
 *   POST /api/gifi/import-cor { content }        → CorImportResult
 *
 * The second reads a CRA .cor file (what every certified T2 package exports)
 * through `@classytic/ledger-ca/cor`'s parser, then classifies its GIFI
 * accounts by the same path as the first — see engine/cor-import.ts.
 */
import { defineResource } from '@classytic/arc';
import { createError } from '@classytic/repo-core/errors';
import { requireOrgStaff } from '#shared/permissions.js';
import { importCorFile } from '../../engine/cor-import.js';
import { type GifiLine, importGifiTrialBalance, parseGifiText } from '../../engine/gifi-import.js';

const gifiResource = defineResource({
  name: 'gifi',
  displayName: 'GIFI Import',
  prefix: '/gifi',
  disableDefaultRoutes: true,
  routes: [
    {
      method: 'POST',
      path: '/import',
      operation: 'gifiImport',
      summary: 'Classify a GIFI trial balance into the return schedules',
      permissions: requireOrgStaff(),
      mcp: { annotations: { readOnlyHint: true } },
      handler: async (req: { body?: unknown }) => {
        const body = (req.body ?? {}) as { text?: unknown; lines?: unknown };
        let lines: GifiLine[] = [];
        if (typeof body.text === 'string') {
          lines = parseGifiText(body.text);
        } else if (Array.isArray(body.lines)) {
          lines = body.lines
            .map((l) => l as { code?: unknown; amount?: unknown })
            .filter((l) => l.code != null)
            .map((l) => ({ code: String(l.code), amount: Number(l.amount) || 0 }));
        } else {
          throw createError(
            400,
            'Provide `text` (pasted trial balance) or `lines` [{ code, amount }]',
          );
        }
        if (lines.length === 0) throw createError(422, 'No GIFI lines found to import');
        return { data: importGifiTrialBalance(lines) };
      },
    },
    {
      method: 'POST',
      path: '/import-cor',
      operation: 'corImport',
      summary: 'Load a filed T2 return’s GIFI statements and identification from a CRA .cor file',
      permissions: requireOrgStaff(),
      mcp: { annotations: { readOnlyHint: true } },
      handler: async (req: { body?: unknown }) => {
        const body = (req.body ?? {}) as { content?: unknown };
        if (typeof body.content !== 'string' || body.content.trim() === '') {
          throw createError(400, 'Provide `content` — the text of the .cor file');
        }
        const result = importCorFile(body.content);
        if (result.gifiAccountsInFile === 0) {
          throw createError(
            422,
            `No GIFI account lines found in the file${result.parsingErrors.length ? ` — ${result.parsingErrors[0]}` : ''}`,
          );
        }
        return { data: result };
      },
    },
  ],
});

export default gifiResource;
