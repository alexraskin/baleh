import { describe, expect, it } from "vitest";

import {
  BREACHED_PASSWORD,
  emailTo,
  pathOf,
  queuedEmails,
  signedInUser,
  TestClient,
  uniqueEmail,
} from "./client.ts";

describe("registration", () => {
  it("creates a user with profile fields and emails a verification link", async () => {
    const client = new TestClient();
    const email = uniqueEmail("register");

    const signUp = await client.signUp({
      email,
      name: "Maman",
      displayName: "Maman",
      preferredLanguage: "fa",
    });
    expect(signUp.status).toBe(200);
    // No session until the email is verified.
    expect(client.cookieHeader).not.toContain("session_token");
    expect((await client.request("/api/me")).status).toBe(401);

    const verification = await emailTo(email, "verify-email");
    expect(verification).toMatchObject({ to: email, name: "Maman" });
    expect(verification.url).toMatch(
      /^http:\/\/localhost:5173\/api\/auth\/verify-email\?token=[\w.-]+&callbackURL=/,
    );
  });

  it("verifies the email, signs in, and sends a welcome email once", async () => {
    const client = new TestClient();
    const email = uniqueEmail("verify");
    await client.signUp({ email, displayName: "Maman", callbackURL: "/verify-email" });
    const link = pathOf((await emailTo(email, "verify-email")).url);

    const verified = await client.request(link);
    expect(verified.status).toBe(302);
    expect(verified.data).toBe("");
    const me = await client.request("/api/me");
    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ email, displayName: "Maman" });

    const welcome = await emailTo(email, "welcome");
    expect(welcome.url).toBe("http://localhost:5173/rooms");

    // Reusing the link does nothing: no new session, no second welcome.
    const before = queuedEmails.length;
    const replay = new TestClient();
    expect((await replay.request(link)).status).toBe(302);
    expect((await replay.request("/api/me")).status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queuedEmails.slice(before).filter((job) => job.to === email)).toEqual([]);
  });

  it("sends people back with an error for a bad or tampered link", async () => {
    const client = new TestClient();
    const response = await client.request(
      "/api/auth/verify-email?token=not-a-token&callbackURL=%2Fverify-email",
      {},
    );
    expect(response.status).toBe(302);
    expect((await client.request("/api/me")).status).toBe(401);
  });

  it("won't sign in an unverified account, and sends a fresh link instead", async () => {
    const email = uniqueEmail("unverified");
    await new TestClient().signUp({ email });
    await emailTo(email, "verify-email");
    const count = queuedEmails.length;

    const client = new TestClient();
    const signIn = await client.signIn(email);
    expect(signIn.status).toBe(403);
    expect(signIn.data.code).toBe("EMAIL_NOT_VERIFIED");
    expect(client.cookieHeader).not.toContain("session_token");

    // Queued again. (Within the same second the link is identical, and only sent once.)
    await emailTo(email, "verify-email", count);
  });

  it("refuses new accounts when sign-up is off, but still lets people sign in", async () => {
    const email = uniqueEmail("closed");
    expect((await new TestClient().register({ email })).status).toBe(200);

    const closed = new TestClient({ SIGNUPS_ENABLED: "false" as Env["SIGNUPS_ENABLED"] });
    expect((await closed.signUp()).status).toBe(400);
    expect((await closed.request("/api/config")).data.signUpEnabled).toBe(false);
    expect((await closed.request("/api/config")).data.version).toMatch(/^\d+\.\d+\.\d+/);
    expect((await closed.signIn(email)).status).toBe(200);
  });

  it("requires a Turnstile token on auth forms once a secret key is set", async () => {
    const guarded = new TestClient({
      TURNSTILE_SITE_KEY: "site" as Env["TURNSTILE_SITE_KEY"],
      TURNSTILE_SECRET_KEY: "secret",
    });
    expect((await guarded.request("/api/config")).data.turnstileSiteKey).toBe("site");
    const signIn = await guarded.signIn(uniqueEmail("captcha"));
    expect(signIn.status).toBe(400);
    expect(signIn.data.code).toBe("MISSING_RESPONSE");
    expect((await new TestClient().request("/api/config")).data.turnstileSiteKey).toBeNull();
  });

  it("defaults the preferred language to English", async () => {
    const client = new TestClient();
    await client.register();
    const me = await client.request("/api/me");
    expect(me.data.preferredLanguage).toBe("en");
  });

  it("normalises email case", async () => {
    const client = new TestClient();
    const email = uniqueEmail("case");
    await client.register({ email: email.toUpperCase() });
    const me = await client.request("/api/me");
    expect(me.data.email).toBe(email);
  });

  it("doesn't reveal or take over an existing email", async () => {
    const email = uniqueEmail("dupe");
    await new TestClient().register({ email });
    // Same answer as a new sign-up, so addresses can't be probed, but no account or session.
    const second = new TestClient();
    expect((await second.signUp({ email, password: "another-password" })).status).toBe(200);
    expect(second.cookieHeader).not.toContain("session_token");
    expect((await new TestClient().signIn(email, "another-password")).status).toBe(401);
    expect((await new TestClient().signIn(email)).status).toBe(200);
  });

  it.each([
    ["a short password", { password: "short" }],
    ["a breached password", { password: BREACHED_PASSWORD }],
    ["a missing display name", { displayName: "" }],
    ["an unsupported language", { preferredLanguage: "xx" }],
    ["an invalid email", { email: "not-an-email" }],
  ])("rejects %s", async (_label, overrides) => {
    const client = new TestClient();
    const response = await client.signUp(overrides);
    expect(response.status).toBe(400);
    expect(client.cookieHeader).toBe("");
  });

  it("does not let sign-up set the avatar", async () => {
    const client = new TestClient();
    const response = await client.signUp({ avatarUrl: "https://evil.example/a.png" });
    expect(response.status).toBe(400);
    expect(response.data.code).toBe("FIELD_NOT_ALLOWED");
  });
});

describe("login and logout", () => {
  it("signs in with the right password and persists the session", async () => {
    const email = uniqueEmail("login");
    await new TestClient().register({ email });

    const client = new TestClient();
    const signIn = await client.signIn(email);
    expect(signIn.status).toBe(200);

    for (let i = 0; i < 2; i++) {
      const session = await client.request("/api/auth/get-session");
      expect(session.data?.user?.email).toBe(email);
    }
  });

  it("rejects a wrong password without a session", async () => {
    const email = uniqueEmail("wrong");
    await new TestClient().register({ email });

    const client = new TestClient();
    const signIn = await client.signIn(email, "not-the-password");
    expect(signIn.status).toBe(401);
    expect((await client.request("/api/me")).status).toBe(401);
  });

  it("rejects an unknown email the same way as a wrong password", async () => {
    const client = new TestClient();
    const signIn = await client.signIn(uniqueEmail("nobody"));
    expect(signIn.status).toBe(401);
  });

  it("logs out and revokes the session server-side", async () => {
    const client = new TestClient();
    await client.register();
    const staleCookie = client.cookieHeader;

    const signOut = await client.signOut();
    expect(signOut.status).toBe(200);
    expect((await client.request("/api/me")).status).toBe(401);

    // Replaying the old cookie must not work either.
    const replay = new TestClient();
    replay.setCookieHeader(staleCookie);
    // Within the cookie cache's maxAge the replay still works (accepted trade-off); after it, not.
    replay.expireSessionCache();
    expect((await replay.request("/api/me")).status).toBe(401);
  });
});

describe("password reset", () => {
  it("emails a one-time link, resets the password, revokes sessions and sends a security notice", async () => {
    const email = uniqueEmail("reset");
    const oldSession = new TestClient();
    await oldSession.register({ email });

    const requester = new TestClient();
    const request = await requester.request("/api/auth/request-password-reset", {
      method: "POST",
      body: { email, redirectTo: "/reset-password" },
    });
    expect(request.status).toBe(200);
    const job = await emailTo(email, "reset-password");
    const token = job.url.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();

    const reset = await requester.request("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword: "a-brand-new-password" },
    });
    expect(reset.status).toBe(200);

    oldSession.expireSessionCache();
    expect((await oldSession.request("/api/me")).status).toBe(401);
    expect((await new TestClient().signIn(email)).status).toBe(401);
    expect((await new TestClient().signIn(email, "a-brand-new-password")).status).toBe(200);

    const notice = await emailTo(email, "password-changed");
    expect(notice.url).toBe("http://localhost:5173/forgot-password");

    // Tokens are single use.
    const reuse = await requester.request("/api/auth/reset-password", {
      method: "POST",
      body: { token, newPassword: "yet-another-password" },
    });
    expect(reuse.status).toBeGreaterThanOrEqual(400);
  });

  it("answers the same for an unknown email, and sends nothing", async () => {
    const email = uniqueEmail("nobody");
    const before = queuedEmails.length;
    const response = await new TestClient().request("/api/auth/request-password-reset", {
      method: "POST",
      body: { email, redirectTo: "/reset-password" },
    });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queuedEmails.slice(before).filter((job) => job.to === email)).toEqual([]);
  });

  it("validates the new password", async () => {
    const client = new TestClient();
    const response = await client.request("/api/auth/reset-password", {
      method: "POST",
      body: { token: "anything", newPassword: "short" },
    });
    expect(response.status).toBe(400);
  });
});

describe("change password", () => {
  it("needs the current password, signs out other devices and sends a security notice", async () => {
    const { client, email } = await signedInUser();
    const other = new TestClient();
    await other.signIn(email);

    const wrong = await client.request("/api/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: "nope-nope-nope",
        newPassword: "a-brand-new-password",
        revokeOtherSessions: true,
      },
    });
    expect(wrong.status).toBe(400);

    // Keeping other sessions isn't allowed; the notice email says they were signed out.
    const keep = await client.request("/api/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: "correct-horse-battery",
        newPassword: "a-brand-new-password",
        revokeOtherSessions: false,
      },
    });
    expect(keep.status).toBe(400);

    const before = queuedEmails.length;
    const changed = await client.request("/api/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: "correct-horse-battery",
        newPassword: "a-brand-new-password",
        revokeOtherSessions: true,
      },
    });
    expect(changed.status).toBe(200);
    expect((await client.request("/api/me")).status).toBe(200);
    other.expireSessionCache();
    expect((await other.request("/api/me")).status).toBe(401);
    expect((await new TestClient().signIn(email, "a-brand-new-password")).status).toBe(200);
    await emailTo(email, "password-changed", before);
  });
});

describe("change email", () => {
  it("approves from the old address, verifies the new one, then switches", async () => {
    const { client, email } = await signedInUser();
    const newEmail = uniqueEmail("moved");

    const request = await client.request("/api/auth/change-email", {
      method: "POST",
      body: { newEmail, callbackURL: "/verify-email?next=%2Fsettings" },
    });
    expect(request.status).toBe(200);

    const approval = await emailTo(email, "change-email");
    expect((await client.request(pathOf(approval.url))).status).toBe(302);
    // Not switched until the new address is proven.
    expect((await client.request("/api/me")).data.email).toBe(email);

    const verification = await emailTo(newEmail, "verify-email");
    expect((await client.request(pathOf(verification.url))).status).toBe(302);
    client.expireSessionCache();
    expect((await client.request("/api/me")).data.email).toBe(newEmail);
    expect((await new TestClient().signIn(newEmail)).status).toBe(200);
  });

  it("validates the new address and needs a session", async () => {
    const { client } = await signedInUser();
    const bad = await client.request("/api/auth/change-email", {
      method: "POST",
      body: { newEmail: "not-an-email" },
    });
    expect(bad.status).toBe(400);
    const anon = await new TestClient().request("/api/auth/change-email", {
      method: "POST",
      body: { newEmail: uniqueEmail() },
    });
    expect(anon.status).toBe(401);
  });
});

describe("delete account", () => {
  it("needs the password, keeps their messages anonymously and hands off or deletes their rooms", async () => {
    const owner = await signedInUser("Leaving");
    const member = await signedInUser("Staying");
    const shared = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Shared" } })
    ).data;
    const solo = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Solo" } })
    ).data;
    const invite = await owner.client.request(`/api/rooms/${shared.id}/invitations`, {
      method: "POST",
      body: { email: member.email },
    });
    await member.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
    await owner.client.sendMessage(shared.id, "bye");
    await member.client.sendMessage(shared.id, "see you");

    for (const body of [{}, { password: "nope-nope-nope" }]) {
      const refused = await owner.client.request("/api/auth/delete-user", { method: "POST", body });
      expect(refused.status).toBe(400);
    }

    const deleted = await owner.client.request("/api/auth/delete-user", {
      method: "POST",
      body: { password: "correct-horse-battery" },
    });
    expect(deleted.status).toBe(200);
    expect((await owner.client.request("/api/me")).status).toBe(401);
    expect((await new TestClient().signIn(owner.email)).status).toBe(401);

    const history = await member.client.request(`/api/rooms/${shared.id}/messages`);
    expect(history.data.messages).toMatchObject([
      { text: "bye", senderId: null, senderName: null },
      { text: "see you", senderId: member.id },
    ]);
    const room = await member.client.request(`/api/rooms/${shared.id}`);
    expect(room.data.members).toEqual([
      expect.objectContaining({ userId: member.id, role: "owner" }),
    ]);
    const row = await member.client.env.DB.prepare(`select 1 from "room" where "id" = ?`)
      .bind(solo.id)
      .first();
    expect(row).toBeNull();
  });
});
