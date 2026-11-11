import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { renderAccountEmail } from "../worker/email-templates.ts";
import type { AccountEmailJob } from "../worker/email.ts";
import worker from "../worker/index.ts";

let counter = 0;

function job(overrides: Partial<AccountEmailJob> = {}): AccountEmailJob {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, "0"),
    kind: "verify-email",
    to: "person@example.com",
    name: "Maman",
    url: "http://localhost:5173/api/auth/verify-email?token=secret-token-value",
    ...overrides,
  };
}

/** Email Service stand-in: records sends, or throws like the binding does. */
function fakeEmail(fail?: (attempt: number) => string | undefined) {
  const sent: Parameters<SendEmail["send"]>[0][] = [];
  let attempt = 0;
  const binding = {
    send: async (message: Parameters<SendEmail["send"]>[0]) => {
      attempt += 1;
      const code = fail?.(attempt);
      if (code) throw Object.assign(new Error(`Failed: ${code}`), { code });
      sent.push(message);
      return { messageId: `m${attempt}` };
    },
  } as unknown as SendEmail;
  return { sent, binding };
}

/** Delivers jobs like Cloudflare Queues would, recording ack/retry per message. */
async function deliver(bodies: unknown[], email: SendEmail, attempts = 1) {
  const outcomes: ({ ack: true } | { retry: QueueRetryOptions | undefined })[] = [];
  const messages = bodies.map((body, index) => ({
    id: `msg-${index}`,
    body,
    attempts,
    timestamp: new Date(),
    ack: () => (outcomes[index] = { ack: true }),
    retry: (options?: QueueRetryOptions) => (outcomes[index] = { retry: options }),
  }));
  const batch = { queue: "baleh-account-emails", messages } as unknown as MessageBatch<unknown>;
  await worker.queue(batch, { ...env, EMAIL: email });
  return outcomes;
}

describe("account email delivery", () => {
  it("sends from the accounts address with HTML and text parts", async () => {
    const email = fakeEmail();
    const outcomes = await deliver([job()], email.binding);
    expect(outcomes).toEqual([{ ack: true }]);
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0] as EmailMessageBuilder;
    expect(message).toMatchObject({
      from: { email: "accounts@baleh.dev" },
      to: "person@example.com",
      subject: "Verify your Baleh email address",
    });
    expect(message.html).toContain('href="http://localhost:5173/api/auth/verify-email?token=');
    expect(message.text).toContain("expires in 24 hours");
  });

  it("sends security notices from the security address", async () => {
    const email = fakeEmail();
    await deliver(
      [job({ kind: "password-changed", url: "http://localhost:5173/forgot-password" })],
      email.binding,
    );
    expect(email.sent[0]).toMatchObject({
      from: { email: "security@baleh.dev" },
      subject: "Security notification from Baleh",
    });
  });

  it("never sends the same job twice", async () => {
    const email = fakeEmail();
    const once = job();
    await deliver([once], email.binding);
    expect(await deliver([once], email.binding)).toEqual([{ ack: true }]);
    expect(email.sent).toHaveLength(1);
  });

  it("retries temporary failures with backoff, without logging the link", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const email = fakeEmail(() => "E_RATE_LIMIT_EXCEEDED");
    const failing = job();
    expect(await deliver([failing], email.binding, 3)).toEqual([{ retry: { delaySeconds: 120 } }]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token-value");
    warn.mockRestore();

    // A later attempt that succeeds sends it.
    const recovered = fakeEmail();
    expect(await deliver([failing], recovered.binding, 4)).toEqual([{ ack: true }]);
    expect(recovered.sent).toHaveLength(1);
  });

  it("gives up on permanent failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const email = fakeEmail(() => "E_RECIPIENT_SUPPRESSED");
    expect(await deliver([job()], email.binding)).toEqual([{ ack: true }]);
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-token-value");
    error.mockRestore();
  });

  it("drops malformed jobs and links that don't point at Baleh", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const email = fakeEmail();
    const outcomes = await deliver(
      [
        { kind: "verify-email" },
        job({ kind: "invitation" as AccountEmailJob["kind"] }),
        job({ url: "https://evil.example/api/auth/verify-email?token=x" }),
      ],
      email.binding,
    );
    expect(outcomes).toEqual([{ ack: true }, { ack: true }, { ack: true }]);
    expect(email.sent).toEqual([]);
    error.mockRestore();
  });
});

describe("account email templates", () => {
  it.each([
    ["verify-email", "Verify your Baleh email address", "24 hours"],
    ["reset-password", "Reset your Baleh password", "1 hour"],
    ["welcome", "Welcome to Baleh", "different languages"],
    ["password-changed", "Security notification from Baleh", "reset your password now"],
    ["two-factor-enabled", "Security notification from Baleh", "turned on"],
    ["two-factor-disabled", "Security notification from Baleh", "turned off"],
  ] as const)("renders %s", (kind, subject, phrase) => {
    const email = renderAccountEmail(job({ kind }));
    expect(email.subject).toBe(subject);
    expect(email.text).toContain(phrase);
    expect(email.html).toContain("#477B65");
    expect(email.html).toContain('name="viewport"');
  });

  it("escapes names", () => {
    const email = renderAccountEmail(job({ name: '<img src=x onerror="alert(1)">' }));
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });
});
