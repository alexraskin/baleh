import { describe, expect, it } from "vitest";

import { signedInUser } from "./client.ts";

/** An owner and two members sharing a room. */
async function room() {
  const owner = await signedInUser("Owner");
  const alice = await signedInUser("Alice");
  const bob = await signedInUser("Bob");
  const roomId = (
    await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
  ).data.id as string;
  for (const member of [alice, bob]) {
    const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: member.email },
    });
    await member.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
  }
  return { owner, alice, bob, roomId };
}

const setRole = (roomId: string, userId: string, role: string) => ({
  path: `/api/rooms/${roomId}/members/${userId}`,
  init: { method: "PATCH", body: { role } },
});

describe("room admins", () => {
  it("lets the owner and admins promote, and only the owner demote or remove admins", async () => {
    const { owner, alice, bob, roomId } = await room();

    // Members can't promote.
    let call = setRole(roomId, bob.id, "admin");
    expect((await alice.client.request(call.path, call.init)).status).toBe(403);

    call = setRole(roomId, alice.id, "admin");
    const promoted = await owner.client.request(call.path, call.init);
    expect(promoted.status).toBe(200);
    expect(promoted.data.members).toContainEqual(
      expect.objectContaining({ userId: alice.id, role: "admin" }),
    );

    // An admin promotes another member.
    call = setRole(roomId, bob.id, "admin");
    expect((await alice.client.request(call.path, call.init)).status).toBe(200);

    // But can't demote or remove another admin, or touch the owner.
    call = setRole(roomId, bob.id, "member");
    expect((await alice.client.request(call.path, call.init)).status).toBe(403);
    const removeBob = `/api/rooms/${roomId}/members/${bob.id}`;
    expect((await alice.client.request(removeBob, { method: "DELETE" })).status).toBe(403);
    call = setRole(roomId, owner.id, "member");
    expect((await alice.client.request(call.path, call.init)).status).toBe(403);

    // The owner can.
    call = setRole(roomId, bob.id, "member");
    expect((await owner.client.request(call.path, call.init)).status).toBe(200);
    // And now Alice, an admin, can remove Bob, a member.
    expect((await alice.client.request(removeBob, { method: "DELETE" })).status).toBe(204);
  });

  it("rejects unknown roles", async () => {
    const { owner, alice, roomId } = await room();
    const call = setRole(roomId, alice.id, "owner");
    expect((await owner.client.request(call.path, call.init)).status).toBe(400);
  });
});

describe("deleting messages", () => {
  it("lets senders delete their own and moderators delete anyone's", async () => {
    const { owner, alice, bob, roomId } = await room();
    const spam = (await bob.client.sendMessage(roomId, "buy now")).data;
    const mine = (await alice.client.sendMessage(roomId, "oops")).data;
    const path = (id: string) => `/api/rooms/${roomId}/messages/${id}`;

    // A member can't delete someone else's message.
    expect((await alice.client.request(path(spam.id), { method: "DELETE" })).status).toBe(403);
    // But can delete their own.
    expect((await alice.client.request(path(mine.id), { method: "DELETE" })).status).toBe(204);

    // Promote Alice; now she can remove the spam.
    const call = setRole(roomId, alice.id, "admin");
    await owner.client.request(call.path, call.init);
    expect((await alice.client.request(path(spam.id), { method: "DELETE" })).status).toBe(204);
    // Deleting twice is fine.
    expect((await alice.client.request(path(spam.id), { method: "DELETE" })).status).toBe(204);

    const history = (await owner.client.request(`/api/rooms/${roomId}/messages`)).data.messages;
    expect(history).toEqual([
      expect.objectContaining({ id: spam.id, text: "", deletedBy: alice.id, attachments: [] }),
      expect.objectContaining({ id: mine.id, text: "", deletedBy: alice.id }),
    ]);
    expect(history[0].deletedAt).toEqual(expect.any(String));
  });

  it("returns 404 for messages in other rooms", async () => {
    const first = await room();
    const second = await room();
    const message = (await first.bob.client.sendMessage(first.roomId, "hi")).data;
    const response = await second.owner.client.request(
      `/api/rooms/${second.roomId}/messages/${message.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(404);
  });
});
