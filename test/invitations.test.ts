import { describe, expect, it, vi } from "vitest";

import { signedInUser, TestClient, uniqueEmail } from "./client.ts";

async function ownerWithRoom(name = "Family") {
  const owner = await signedInUser("Owner");
  const room = (await owner.client.request("/api/rooms", { method: "POST", body: { name } })).data;
  return { owner, roomId: room.id as string };
}

function tokenOf(inviteUrl: string): string {
  return new URL(inviteUrl).pathname.split("/").at(-1)!;
}

describe("inviting", () => {
  it("creates an invitation with a one-time link and lists it for the owner", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const email = uniqueEmail("guest");

    const created = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: email.toUpperCase() },
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ email, invitedBy: "Owner" });
    expect(created.data).not.toHaveProperty("emailed");
    expect(created.data.inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\/[\w-]{43}$/);

    const list = await owner.client.request(`/api/rooms/${roomId}/invitations`);
    expect(list.data.invitations).toEqual([
      expect.objectContaining({ id: created.data.id, email }),
    ]);
    // Only the hash is stored, and it's never returned.
    expect(JSON.stringify(list.data)).not.toContain(tokenOf(created.data.inviteUrl));
  });

  it("points links at the caller's origin only when it's trusted", async () => {
    const dev = { ENVIRONMENT: "development" } as Partial<Env>;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = await signedInUser("Owner", dev);
    const room = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
    ).data;
    const created = await owner.client.request(`/api/rooms/${room.id}/invitations`, {
      method: "POST",
      headers: { Origin: "http://localhost:5199" },
      body: { email: uniqueEmail() },
    });
    expect(created.data.inviteUrl).toMatch(/^http:\/\/localhost:5199\/invite\//);
    vi.restoreAllMocks();
  });

  it("stores only a hash of the token", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const created = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: uniqueEmail() },
    });
    const row = await owner.client.env.DB.prepare(
      `select "tokenHash" from "invitation" where "id" = ?`,
    )
      .bind(created.data.id)
      .first<{ tokenHash: string }>();
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(tokenOf(created.data.inviteUrl));
  });

  it("replaces an open invitation when the same email is invited again", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const guest = await signedInUser("Guest");
    const invite = () =>
      owner.client.request(`/api/rooms/${roomId}/invitations`, {
        method: "POST",
        body: { email: guest.email },
      });
    const first = await invite();
    const second = await invite();

    const list = await owner.client.request(`/api/rooms/${roomId}/invitations`);
    expect(list.data.invitations.map((i: { id: string }) => i.id)).toEqual([second.data.id]);
    const stale = await guest.client.request("/api/invite/preview", {
      method: "POST",
      body: { token: tokenOf(first.data.inviteUrl) },
    });
    expect(stale.status).toBe(404);
  });

  it.each([
    ["an invalid email", { email: "not-an-email" }],
    ["unknown fields", { email: "a@example.com", roomId: "other" }],
  ])("rejects %s", async (_label, body) => {
    const { owner, roomId } = await ownerWithRoom();
    const response = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body,
    });
    expect(response.status).toBe(400);
  });

  it("refuses to invite existing members or yourself", async () => {
    const { owner, roomId } = await ownerWithRoom();
    expect(
      (
        await owner.client.request(`/api/rooms/${roomId}/invitations`, {
          method: "POST",
          body: { email: owner.email },
        })
      ).status,
    ).toBe(400);

    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    await guest.client.request("/api/invite/accept", {
      method: "POST",
      body: { token: tokenOf(invite.data.inviteUrl) },
    });
    const again = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    expect(again.status).toBe(409);
  });

  it("lets the owner revoke an invitation", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    const revoked = await owner.client.request(
      `/api/rooms/${roomId}/invitations/${invite.data.id}`,
      { method: "DELETE" },
    );
    expect(revoked.status).toBe(204);
    expect((await guest.client.request("/api/invitations")).data.invitations).toEqual([]);
    const accept = await guest.client.request("/api/invite/accept", {
      method: "POST",
      body: { token: tokenOf(invite.data.inviteUrl) },
    });
    expect(accept.status).toBe(404);
  });

  it("doesn't let one room's owner revoke another room's invitations", async () => {
    const a = await ownerWithRoom("A");
    const b = await ownerWithRoom("B");
    const invite = await a.owner.client.request(`/api/rooms/${a.roomId}/invitations`, {
      method: "POST",
      body: { email: uniqueEmail() },
    });
    const response = await b.owner.client.request(
      `/api/rooms/${b.roomId}/invitations/${invite.data.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(404);
    expect(
      (await a.owner.client.request(`/api/rooms/${a.roomId}/invitations`)).data.invitations,
    ).toHaveLength(1);
  });
});

describe("accepting", () => {
  it("lets an invited registered user join through the link", async () => {
    const { owner, roomId } = await ownerWithRoom("Family");
    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    const token = tokenOf(invite.data.inviteUrl);

    const preview = await guest.client.request("/api/invite/preview", {
      method: "POST",
      body: { token },
    });
    expect(preview.status).toBe(200);
    expect(preview.data).toMatchObject({
      alreadyMember: false,
      invitation: { roomId, roomName: "Family", inviterName: "Owner" },
    });

    const accepted = await guest.client.request("/api/invite/accept", {
      method: "POST",
      body: { token },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.data).toEqual({ roomId });

    const room = await guest.client.request(`/api/rooms/${roomId}`);
    expect(room.data.role).toBe("member");
    expect(
      (await owner.client.request(`/api/rooms/${roomId}/invitations`)).data.invitations,
    ).toEqual([]);

    // Opening the link again just points back at the room.
    expect(
      (await guest.client.request("/api/invite/preview", { method: "POST", body: { token } })).data
        .alreadyMember,
    ).toBe(true);
    const reuse = await guest.client.request("/api/invite/accept", {
      method: "POST",
      body: { token },
    });
    expect(reuse.status).toBe(410);
  });

  it("shows pending invitations in the app and accepts them by id", async () => {
    const { owner, roomId } = await ownerWithRoom("Family");
    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });

    const pending = await guest.client.request("/api/invitations");
    expect(pending.data.invitations).toEqual([
      expect.objectContaining({ id: invite.data.id, roomId, roomName: "Family" }),
    ]);

    const accepted = await guest.client.request(`/api/invitations/${invite.data.id}/accept`, {
      method: "POST",
    });
    expect(accepted.status).toBe(200);
    expect((await guest.client.request("/api/invitations")).data.invitations).toEqual([]);
    expect((await guest.client.request("/api/rooms")).data.rooms).toEqual([
      expect.objectContaining({ id: roomId, role: "member", memberCount: 2 }),
    ]);
  });

  it("binds the invitation to the invited email", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const guest = await signedInUser("Guest");
    const intruder = await signedInUser("Intruder");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    const token = tokenOf(invite.data.inviteUrl);

    expect(
      (await intruder.client.request("/api/invite/preview", { method: "POST", body: { token } }))
        .status,
    ).toBe(403);
    expect(
      (await intruder.client.request("/api/invite/accept", { method: "POST", body: { token } }))
        .status,
    ).toBe(403);
    for (const path of [
      `/api/invitations/${invite.data.id}/accept`,
      `/api/invitations/${invite.data.id}/decline`,
    ]) {
      expect((await intruder.client.request(path, { method: "POST" })).status, path).toBe(403);
    }
    expect((await intruder.client.request("/api/invitations")).data.invitations).toEqual([]);
    expect((await intruder.client.request(`/api/rooms/${roomId}`)).status).toBe(404);

    // The real invitee can still use it.
    expect(
      (await guest.client.request("/api/invite/accept", { method: "POST", body: { token } }))
        .status,
    ).toBe(200);
  });

  it("works for someone who registers after being invited", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const email = uniqueEmail("later");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email },
    });

    const newcomer = new TestClient();
    await newcomer.register({ email });
    const accepted = await newcomer.request("/api/invite/accept", {
      method: "POST",
      body: { token: tokenOf(invite.data.inviteUrl) },
    });
    expect(accepted.status).toBe(200);
  });

  it("rejects expired invitations", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    await owner.client.env.DB.prepare(`update "invitation" set "expiresAt" = ? where "id" = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), invite.data.id)
      .run();

    const token = tokenOf(invite.data.inviteUrl);
    expect(
      (await guest.client.request("/api/invite/preview", { method: "POST", body: { token } }))
        .status,
    ).toBe(410);
    expect(
      (await guest.client.request("/api/invite/accept", { method: "POST", body: { token } }))
        .status,
    ).toBe(410);
    expect((await guest.client.request("/api/invitations")).data.invitations).toEqual([]);
    expect((await guest.client.request(`/api/rooms/${roomId}`)).status).toBe(404);
  });

  it("returns 404 for unknown tokens", async () => {
    const { client } = await signedInUser();
    expect(
      (
        await client.request("/api/invite/preview", {
          method: "POST",
          body: { token: "not-a-real-token" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await client.request("/api/invite/accept", { method: "POST", body: { token: "nope" } }))
        .status,
    ).toBe(404);
    // The token goes in the body only; unknown fields and path tokens are rejected.
    expect(
      (await client.request("/api/invite/accept", { method: "POST", body: { token: "x", y: 1 } }))
        .status,
    ).toBe(400);
    expect(
      (await client.request("/api/invite/abc/accept", { method: "POST", body: {} })).status,
    ).toBe(404);
  });

  it("lets the invitee decline", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    const declined = await guest.client.request(`/api/invitations/${invite.data.id}/decline`, {
      method: "POST",
    });
    expect(declined.status).toBe(204);
    expect((await guest.client.request("/api/invitations")).data.invitations).toEqual([]);
    expect(
      (await owner.client.request(`/api/rooms/${roomId}/invitations`)).data.invitations,
    ).toEqual([]);
  });

  it("doesn't let a removed member back in with a used link", async () => {
    const { owner, roomId } = await ownerWithRoom();
    const guest = await signedInUser("Guest");
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    const token = tokenOf(invite.data.inviteUrl);
    await guest.client.request("/api/invite/accept", { method: "POST", body: { token } });
    await owner.client.request(`/api/rooms/${roomId}/members/${guest.id}`, { method: "DELETE" });

    expect(
      (await guest.client.request("/api/invite/accept", { method: "POST", body: { token } }))
        .status,
    ).toBe(410);
    expect((await guest.client.request(`/api/rooms/${roomId}`)).status).toBe(404);
  });
});
