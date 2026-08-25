/**
 * Auth email transport — `@spinekit/auth`'s `EmailTransport` is a REQUIRED
 * collaborator (password reset and org-invitation delivery are not optional
 * fields on it), and tax-foundry has no email provider wired yet.
 *
 * This logs the link instead of pretending to deliver it. The alternative —
 * a transport that silently no-ops — would have the API return success for a
 * password reset or a staff invitation that no one ever receives, which is
 * the fabricated-attestation failure mode this codebase refuses everywhere
 * else (T183, sign-off, filing). A logged link at least reaches whoever has
 * server access.
 *
 * Replace `send` with a real provider (SMTP, Resend, arc-integrations'
 * `createHubSender`) before "forgot password" or "invite a colleague" is
 * something a client-facing user can rely on.
 */
import { emailTransportFromSend } from '@spinekit/auth/email-transport';

async function send(template: string, to: string, data: Record<string, unknown>): Promise<void> {
  console.warn(`[auth-email] NOT SENT (no provider configured) — ${template} → ${to}`, data);
}

export const authEmail = emailTransportFromSend(send, { logger: console });
