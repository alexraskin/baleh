import { waitUntil } from "cloudflare:workers";
import { z } from "zod";

import { renderAccountEmail } from "./email-templates.ts";

/*
 * Account email: verification, password reset, welcome and security notices only.
 * Room activity never goes out by email; see notifications.ts.
 *
 * Callers enqueue a job on ACCOUNT_EMAILS; this Worker's queue handler sends it with
 * Cloudflare Email Service, retrying temporary failures. Jobs carry links with tokens
 * in them, so nothing here logs a job body or a link.
 */

export const VERIFICATION_TTL_SECONDS = 60 * 60 * 24;
export const RESET_TTL_SECONDS = 60 * 60;

const senders = {
  accounts: { email: "accounts@baleh.dev", name: "Baleh" },
  security: { email: "security@baleh.dev", name: "Baleh Security" },
} as const;

export const accountEmailKinds = [
  "verify-email",
  "reset-password",
  "welcome",
  "password-changed",
  "change-email",
  "two-factor-enabled",
  "two-factor-disabled",
] as const;

export type AccountEmailKind = (typeof accountEmailKinds)[number];

export const accountEmailJobSchema = z.object({
  /** SHA-256 of a dedupe key; a job with an id already in "emailDelivery" is skipped. */
  id: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.enum(accountEmailKinds),
  to: z.email(),
  name: z.string().max(200),
  /** The one link in the email: verify, reset, open Baleh, approve a change, or secure the account. */
  url: z.url({ protocol: /^https?$/ }),
});

export type AccountEmailJob = z.infer<typeof accountEmailJobSchema>;

export function senderFor(kind: AccountEmailKind) {
  return kind === "verify-email" || kind === "reset-password" || kind === "welcome"
    ? senders.accounts
    : senders.security;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Queues an account email without holding up the response, which also keeps
 * "does this account exist" out of the response time. `dedupeKey` names the
 * email: the same key is never sent twice.
 */
export function sendAccountEmail(
  env: Env,
  dedupeKey: string,
  job: Omit<AccountEmailJob, "id">,
): void {
  waitUntil(
    (async () => {
      const id = await sha256(dedupeKey);
      await env.ACCOUNT_EMAILS.send({ ...job, id } satisfies AccountEmailJob);
    })().catch((error: unknown) => console.error("Couldn't queue account email", job.kind, error)),
  );
}

/** Links must point back at Baleh; anything else in a job is refused. */
function isOwnLink(url: string, env: Env): boolean {
  return new URL(url).origin === new URL(env.BETTER_AUTH_URL).origin;
}

/** Email Service errors that won't go away by retrying the same message. */
const permanentErrors = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_CONTENT_TOO_LARGE",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
]);

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}

/** Exponential backoff for retries: 30s, 1m, 2m, 4m, 8m. */
function retryDelay(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 8 * 60);
}

/** Queue consumer for "baleh-account-emails". */
export async function deliverAccountEmails(batch: MessageBatch<unknown>, env: Env) {
  for (const message of batch.messages) {
    const parsed = accountEmailJobSchema.safeParse(message.body);
    if (!parsed.success || !isOwnLink(parsed.data.url, env)) {
      console.error("Dropping invalid account email job", message.id);
      message.ack();
      continue;
    }
    const job = parsed.data;

    try {
      const sent = await env.DB.prepare(`select 1 from "emailDelivery" where "id" = ?`)
        .bind(job.id)
        .first();
      if (sent) {
        message.ack();
        continue;
      }

      const { subject, html, text } = renderAccountEmail(job);
      await env.EMAIL.send({ from: senderFor(job.kind), to: job.to, subject, html, text });
    } catch (error) {
      const code = errorCode(error);
      if (permanentErrors.has(code)) {
        console.error("Account email rejected", { kind: job.kind, id: job.id, code });
        message.ack();
      } else {
        console.warn("Account email failed, will retry", {
          kind: job.kind,
          id: job.id,
          code,
          attempts: message.attempts,
        });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      }
      continue;
    }

    // Sent: record it, but never retry (and resend) just because recording failed.
    try {
      await env.DB.prepare(`insert into "emailDelivery" ("id") values (?) on conflict do nothing`)
        .bind(job.id)
        .run();
    } catch (error) {
      console.error("Couldn't record sent account email", job.id, error);
    }
    message.ack();
  }
}
