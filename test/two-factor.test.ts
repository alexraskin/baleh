import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { describe, expect, it } from "vitest";

import { emailTo, queuedEmails, signedInUser, TestClient } from "./client.ts";

const PASSWORD = "correct-horse-battery";

/** Turns 2FA on for a signed-in client; returns a code generator and the backup codes. */
async function enableTwoFactor(client: TestClient) {
  const enable = await client.request("/api/auth/two-factor/enable", {
    method: "POST",
    body: { password: PASSWORD },
  });
  expect(enable.status).toBe(200);
  const secret = new URL(enable.data.totpURI).searchParams.get("secret")!;
  const otp = createOTP(base32.decode(secret));
  const backupCodes = enable.data.backupCodes as string[];

  const confirm = await client.request("/api/auth/two-factor/verify-totp", {
    method: "POST",
    body: { code: await otp.totp() },
  });
  expect(confirm.status).toBe(200);
  return { otp, backupCodes };
}

describe("two-factor authentication", () => {
  it("asks for a code after the password, and signs in with a valid one", async () => {
    const { client, email } = await signedInUser("TOTP");
    const { otp } = await enableTwoFactor(client);
    await emailTo(email, "two-factor-enabled");
    const count = queuedEmails.length;

    const next = new TestClient();
    const signIn = await next.signIn(email);
    expect(signIn.status).toBe(200);
    expect(signIn.data.twoFactorRedirect).toBe(true);
    expect((await next.request("/api/me")).status).toBe(401);

    const wrong = await next.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      body: { code: String((Number(await otp.totp()) + 1) % 1e6).padStart(6, "0") },
    });
    expect(wrong.status).toBe(401);
    expect((await next.request("/api/me")).status).toBe(401);

    const right = await next.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      body: { code: await otp.totp() },
    });
    expect(right.status).toBe(200);
    expect((await next.request("/api/me")).status).toBe(200);
    // Signing in with a code isn't a change: no second notice.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queuedEmails.slice(count).filter((job) => job.to === email)).toEqual([]);
  });

  it("accepts each backup code once", async () => {
    const { client, email } = await signedInUser("Backup");
    const { backupCodes } = await enableTwoFactor(client);
    const code = backupCodes[0]!;

    const first = new TestClient();
    await first.signIn(email);
    const used = await first.request("/api/auth/two-factor/verify-backup-code", {
      method: "POST",
      body: { code },
    });
    expect(used.status).toBe(200);
    expect((await first.request("/api/me")).status).toBe(200);

    const second = new TestClient();
    await second.signIn(email);
    const reused = await second.request("/api/auth/two-factor/verify-backup-code", {
      method: "POST",
      body: { code },
    });
    expect(reused.status).not.toBe(200);
    expect((await second.request("/api/me")).status).toBe(401);
  });

  it("needs the password to turn it off, then signs in without a code", async () => {
    const { client, email } = await signedInUser("Disable");
    await enableTwoFactor(client);

    const noPassword = await client.request("/api/auth/two-factor/disable", {
      method: "POST",
      body: {},
    });
    expect(noPassword.status).toBe(400);
    const wrong = await client.request("/api/auth/two-factor/disable", {
      method: "POST",
      body: { password: "not-my-password" },
    });
    expect(wrong.status).toBe(400);
    const off = await client.request("/api/auth/two-factor/disable", {
      method: "POST",
      body: { password: PASSWORD },
    });
    expect(off.status).toBe(200);
    const notice = await emailTo(email, "two-factor-disabled");
    expect(notice.url).toBe("http://localhost:5173/forgot-password");

    const next = new TestClient();
    expect((await next.signIn(email)).data.twoFactorRedirect).toBeUndefined();
    expect((await next.request("/api/me")).status).toBe(200);
  });

  it("keeps email OTP switched off", async () => {
    const { client } = await signedInUser("OTP");
    const sent = await client.request("/api/auth/two-factor/send-otp", {
      method: "POST",
      body: {},
    });
    expect(sent.status).toBe(404);
  });
});
