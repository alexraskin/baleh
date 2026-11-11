import { describe, expect, it } from "vitest";
import { MESSAGE_MAX_LENGTH } from "../shared/messages.ts";
import { DAILY_CHARACTER_BUDGET } from "../worker/session.ts";

import { signedInUser, TestClient } from "./client.ts";

/** An owner and a member sharing a room. */
async function sharedRoom() {
  const owner = await signedInUser("Owner");
  const member = await signedInUser("Maman", {});
  await member.client.request("/api/me/language", {
    method: "PUT",
    body: { preferredLanguage: "fa" },
  });
  const room = (
    await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
  ).data;
  const invite = await owner.client.request(`/api/rooms/${room.id}/invitations`, {
    method: "POST",
    body: { email: member.email },
  });
  await member.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
  return { owner, member, roomId: room.id as string };
}

describe("sending messages", () => {
  it("saves the message with the sender and their language", async () => {
    const { owner, member, roomId } = await sharedRoom();

    const sent = await member.client.sendMessage(roomId, "  سلام عزیزم  ");
    expect(sent.status).toBe(201);
    expect(sent.data).toMatchObject({
      roomId,
      senderId: member.id,
      senderName: "Maman",
      text: "سلام عزیزم",
      language: "fa",
    });

    const history = await owner.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages).toEqual([sent.data]);
  });

  it("treats a retried send with the same client id as one message", async () => {
    const { owner, roomId } = await sharedRoom();
    const clientId = crypto.randomUUID();

    const first = await owner.client.sendMessage(roomId, "Dinner Friday?", clientId);
    const retry = await owner.client.sendMessage(roomId, "Dinner Friday?", clientId);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.data.id).toBe(first.data.id);

    const history = await owner.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages).toHaveLength(1);
  });

  it("doesn't let a client id from one room be replayed into another", async () => {
    const { owner, roomId } = await sharedRoom();
    const other = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Other" } })
    ).data;
    const clientId = crypto.randomUUID();
    await owner.client.sendMessage(roomId, "Hello", clientId);
    expect((await owner.client.sendMessage(other.id, "Hello", clientId)).status).toBe(409);
  });

  it("moves the room to the top of the list", async () => {
    const { owner, roomId } = await sharedRoom();
    await owner.client.request("/api/rooms", { method: "POST", body: { name: "Newer" } });
    await owner.client.sendMessage(roomId, "Bump");
    const rooms = (await owner.client.request("/api/rooms")).data.rooms;
    expect(rooms[0].id).toBe(roomId);
  });

  it.each([
    ["an empty message", { text: "   ", clientId: crypto.randomUUID() }],
    ["a message that's too long", { text: "x".repeat(4001), clientId: crypto.randomUUID() }],
    ["a missing client id", { text: "Hi" }],
    ["a malformed client id", { text: "Hi", clientId: "abc" }],
    ["a spoofed sender", { text: "Hi", clientId: crypto.randomUUID(), senderId: "someone" }],
  ])("rejects %s", async (_label, body) => {
    const { owner, roomId } = await sharedRoom();
    const response = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body,
    });
    expect(response.status).toBe(400);
  });

  it("only lets members read or write", async () => {
    const { owner, roomId } = await sharedRoom();
    await owner.client.sendMessage(roomId, "Private");
    const outsider = await signedInUser("Outsider");

    expect((await outsider.client.request(`/api/rooms/${roomId}/messages`)).status).toBe(404);
    expect((await outsider.client.sendMessage(roomId, "Let me in")).status).toBe(404);

    const anonymous = new TestClient();
    expect((await anonymous.request(`/api/rooms/${roomId}/messages`)).status).toBe(401);
    expect((await anonymous.sendMessage(roomId, "Hi")).status).toBe(401);
  });

  it("stops a removed member from reading history", async () => {
    const { owner, member, roomId } = await sharedRoom();
    await owner.client.sendMessage(roomId, "Before");
    await owner.client.request(`/api/rooms/${roomId}/members/${member.id}`, { method: "DELETE" });
    expect((await member.client.request(`/api/rooms/${roomId}/messages`)).status).toBe(404);
  });

  it("rejects cross-origin sends", async () => {
    const { owner, roomId } = await sharedRoom();
    const response = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: { text: "Hi", clientId: crypto.randomUUID() },
    });
    expect(response.status).toBe(403);
  });
});

describe("history", () => {
  async function roomWithMessages(count: number) {
    const shared = await sharedRoom();
    const sent: string[] = [];
    for (let i = 0; i < count; i++) {
      const response = await shared.owner.client.sendMessage(shared.roomId, `Message ${i}`);
      sent.push(response.data.id);
    }
    return { ...shared, sent };
  }

  it("returns the newest page first, oldest to newest within it", async () => {
    const { owner, roomId, sent } = await roomWithMessages(5);
    const page = await owner.client.request(`/api/rooms/${roomId}/messages?limit=3`);
    expect(page.data.hasMore).toBe(true);
    expect(page.data.messages.map((m: { id: string }) => m.id)).toEqual(sent.slice(2));
  });

  it("pages back through older messages with a cursor", async () => {
    const { owner, roomId, sent } = await roomWithMessages(5);
    const first = await owner.client.request(`/api/rooms/${roomId}/messages?limit=3`);
    const oldest = first.data.messages[0].id;

    const second = await owner.client.request(
      `/api/rooms/${roomId}/messages?limit=3&before=${oldest}`,
    );
    expect(second.data.hasMore).toBe(false);
    expect(second.data.messages.map((m: { id: string }) => m.id)).toEqual(sent.slice(0, 2));
  });

  it("returns messages after a cursor so reconnecting clients can catch up", async () => {
    const { owner, member, roomId, sent } = await roomWithMessages(2);
    const lastSeen = sent.at(-1)!;
    const missed = [
      (await owner.client.sendMessage(roomId, "While you were away")).data.id,
      (await owner.client.sendMessage(roomId, "And again")).data.id,
    ];

    const catchUp = await member.client.request(`/api/rooms/${roomId}/messages?after=${lastSeen}`);
    expect(catchUp.data.messages.map((m: { id: string }) => m.id)).toEqual(missed);
    expect(catchUp.data.hasMore).toBe(false);

    const upToDate = await member.client.request(
      `/api/rooms/${roomId}/messages?after=${missed.at(-1)}`,
    );
    expect(upToDate.data).toEqual({ messages: [], hasMore: false });
  });

  it("doesn't accept a cursor from another room", async () => {
    const a = await roomWithMessages(1);
    const b = await sharedRoom();
    const response = await b.owner.client.request(
      `/api/rooms/${b.roomId}/messages?before=${a.sent[0]}`,
    );
    expect(response.status).toBe(400);
  });

  it.each([
    ["a limit above the maximum", "limit=1000"],
    ["a non-numeric limit", "limit=lots"],
    ["both cursors", "before=a&after=b"],
  ])("rejects %s", async (_label, query) => {
    const { owner, roomId } = await sharedRoom();
    expect((await owner.client.request(`/api/rooms/${roomId}/messages?${query}`)).status).toBe(400);
  });

  it("survives the sender's account being deleted", async () => {
    const { owner, member, roomId } = await sharedRoom();
    await member.client.sendMessage(roomId, "Remember me");
    await owner.client.env.DB.prepare(`delete from "user" where "id" = ?`).bind(member.id).run();

    const history = await owner.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages).toEqual([
      expect.objectContaining({ text: "Remember me", senderId: null, senderName: null }),
    ]);
  });
});

describe("replies", () => {
  it("quotes the message being replied to", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const original = await owner.client.sendMessage(roomId, "Dinner at 7?");

    const reply = await member.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { text: "باشه", clientId: crypto.randomUUID(), replyToId: original.data.id },
    });
    expect(reply.status).toBe(201);
    expect(reply.data.replyTo).toEqual({
      id: original.data.id,
      senderId: owner.id,
      senderName: "Owner",
      text: "Dinner at 7?",
      language: "en",
      hasImage: false,
      deleted: false,
    });
    expect(original.data.replyTo).toBeNull();

    // Deleting the original leaves the reply pointing at its tombstone.
    await owner.client.request(`/api/rooms/${roomId}/messages/${original.data.id}`, {
      method: "DELETE",
    });
    const history = await owner.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[1].replyTo).toMatchObject({ text: "", deleted: true });
  });

  it("refuses to quote a message from another room", async () => {
    const { owner, roomId } = await sharedRoom();
    const other = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Work" } })
    ).data;
    const elsewhere = await owner.client.sendMessage(other.id, "secret");

    const reply = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { text: "hi", clientId: crypto.randomUUID(), replyToId: elsewhere.data.id },
    });
    expect(reply.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("rejects a user's sends past the per-minute limit, without affecting others", async () => {
    const { owner, member, roomId } = await sharedRoom();
    // Windows are fixed and wall-clock aligned, so a run straddling a minute boundary gets a
    // fresh window mid-loop. 121 writes can't fit in two windows of 60, so a 429 must appear.
    let status = 0;
    for (let i = 0; i < 121 && status !== 429; i++) {
      status = (await owner.client.sendMessage(roomId, `Message ${i}`)).status;
    }
    expect(status).toBe(429);
    expect((await member.client.sendMessage(roomId, "Still here")).status).toBe(201);
  }, 20_000);
});

describe("daily character budget", () => {
  it("rejects sends past the daily budget, still honours retries, and spares others", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const long = "a".repeat(MESSAGE_MAX_LENGTH);
    const first = crypto.randomUUID();
    expect((await owner.client.sendMessage(roomId, long, first)).status).toBe(201);
    for (let i = 1; i < DAILY_CHARACTER_BUDGET / MESSAGE_MAX_LENGTH - 1; i++) {
      expect((await owner.client.sendMessage(roomId, long)).status).toBe(201);
    }
    const over = await owner.client.sendMessage(roomId, long);
    expect(over.status).toBe(429);

    expect((await owner.client.sendMessage(roomId, long, first)).status).toBe(200);
    expect((await member.client.sendMessage(roomId, "Still here")).status).toBe(201);
  });
});
