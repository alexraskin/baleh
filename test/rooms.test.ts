import { describe, expect, it } from "vitest";

import { signedInUser, TestClient } from "./client.ts";

async function roomWithMember() {
  const owner = await signedInUser("Owner");
  const member = await signedInUser("Member");
  const room = (
    await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
  ).data;
  const invite = await owner.client.request(`/api/rooms/${room.id}/invitations`, {
    method: "POST",
    body: { email: member.email },
  });
  const accepted = await member.client.request(`/api/invitations/${invite.data.id}/accept`, {
    method: "POST",
  });
  expect(accepted.status).toBe(200);
  return { owner, member, roomId: room.id as string };
}

describe("creating and listing rooms", () => {
  it("makes the creator the owner and lists the room for them only", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");

    const created = await alice.client.request("/api/rooms", {
      method: "POST",
      body: { name: "  Family  " },
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ name: "Family", role: "owner", memberCount: 1 });
    expect(created.data.members).toEqual([
      expect.objectContaining({ userId: alice.id, displayName: "Alice", role: "owner" }),
    ]);

    const aliceRooms = (await alice.client.request("/api/rooms")).data.rooms;
    expect(aliceRooms.map((room: { id: string }) => room.id)).toContain(created.data.id);
    expect((await bob.client.request("/api/rooms")).data.rooms).toEqual([]);
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a long name", { name: "x".repeat(81) }],
    ["unknown fields", { name: "Room", createdBy: "someone-else" }],
  ])("rejects %s", async (_label, body) => {
    const { client } = await signedInUser();
    const response = await client.request("/api/rooms", { method: "POST", body });
    expect(response.status).toBe(400);
  });
});

describe("room access", () => {
  it("hides rooms from non-members as if they didn't exist", async () => {
    const { owner, roomId } = await roomWithMember();
    const outsider = await signedInUser("Outsider");

    const requests: [string, string, unknown?][] = [
      ["GET", `/api/rooms/${roomId}`],
      ["PATCH", `/api/rooms/${roomId}`, { name: "Mine now" }],
      ["DELETE", `/api/rooms/${roomId}`],
      ["POST", `/api/rooms/${roomId}/leave`],
      ["DELETE", `/api/rooms/${roomId}/members/${owner.id}`],
      ["GET", `/api/rooms/${roomId}/invitations`],
      ["POST", `/api/rooms/${roomId}/invitations`, { email: outsider.email }],
    ];
    for (const [method, path, body] of requests) {
      const response = await outsider.client.request(path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect((await owner.client.request(`/api/rooms/${roomId}`)).data.name).toBe("Family");
  });

  it("returns 404 for a room that doesn't exist", async () => {
    const { client } = await signedInUser();
    expect((await client.request("/api/rooms/nope")).status).toBe(404);
  });

  it("requires a session for every room endpoint", async () => {
    const anonymous = new TestClient();
    for (const [method, path] of [
      ["GET", "/api/rooms"],
      ["POST", "/api/rooms"],
      ["GET", "/api/rooms/x"],
      ["PATCH", "/api/rooms/x"],
      ["DELETE", "/api/rooms/x"],
      ["POST", "/api/rooms/x/leave"],
      ["GET", "/api/invitations"],
      ["POST", "/api/invite/preview"],
    ] as const) {
      const response = await anonymous.request(path, {
        method,
        body: method === "GET" ? undefined : {},
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("lets members see the room and its members", async () => {
    const { owner, member, roomId } = await roomWithMember();
    const room = await member.client.request(`/api/rooms/${roomId}`);
    expect(room.status).toBe(200);
    expect(room.data.role).toBe("member");
    expect(room.data.memberCount).toBe(2);
    expect(
      room.data.members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    ).toEqual([
      [owner.id, "owner"],
      [member.id, "member"],
    ]);
  });
});

describe("owner-only operations", () => {
  it("forbids members from renaming, deleting, removing or inviting", async () => {
    const { owner, member, roomId } = await roomWithMember();
    const requests: [string, string, unknown?][] = [
      ["PATCH", `/api/rooms/${roomId}`, { name: "Renamed" }],
      ["DELETE", `/api/rooms/${roomId}`],
      ["DELETE", `/api/rooms/${roomId}/members/${owner.id}`],
      ["GET", `/api/rooms/${roomId}/invitations`],
      ["POST", `/api/rooms/${roomId}/invitations`, { email: "someone@example.com" }],
    ];
    for (const [method, path, body] of requests) {
      const response = await member.client.request(path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    const room = await owner.client.request(`/api/rooms/${roomId}`);
    expect(room.data).toMatchObject({ name: "Family", memberCount: 2 });
  });

  it("lets the owner rename the room", async () => {
    const { owner, member, roomId } = await roomWithMember();
    const renamed = await owner.client.request(`/api/rooms/${roomId}`, {
      method: "PATCH",
      body: { name: "Cousins" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.data.name).toBe("Cousins");
    expect((await member.client.request(`/api/rooms/${roomId}`)).data.name).toBe("Cousins");
  });

  it("lets the owner remove a member, who then loses access", async () => {
    const { owner, member, roomId } = await roomWithMember();
    const removed = await owner.client.request(`/api/rooms/${roomId}/members/${member.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect((await member.client.request(`/api/rooms/${roomId}`)).status).toBe(404);
    expect((await member.client.request("/api/rooms")).data.rooms).toEqual([]);
  });

  it("doesn't let the owner remove themselves through the members endpoint", async () => {
    const { owner, roomId } = await roomWithMember();
    const response = await owner.client.request(`/api/rooms/${roomId}/members/${owner.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
  });

  it("lets the owner delete the room for everyone", async () => {
    const { owner, member, roomId } = await roomWithMember();
    expect((await owner.client.request(`/api/rooms/${roomId}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await owner.client.request(`/api/rooms/${roomId}`)).status).toBe(404);
    expect((await member.client.request(`/api/rooms/${roomId}`)).status).toBe(404);
  });

  it("rejects cross-origin writes", async () => {
    const { owner, roomId } = await roomWithMember();
    const response = await owner.client.request(`/api/rooms/${roomId}`, {
      method: "DELETE",
      headers: { Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect((await owner.client.request(`/api/rooms/${roomId}`)).status).toBe(200);
  });
});

describe("leaving", () => {
  it("lets a member leave", async () => {
    const { owner, member, roomId } = await roomWithMember();
    const left = await member.client.request(`/api/rooms/${roomId}/leave`, { method: "POST" });
    expect(left.status).toBe(204);
    expect((await member.client.request(`/api/rooms/${roomId}`)).status).toBe(404);
    expect((await owner.client.request(`/api/rooms/${roomId}`)).data.memberCount).toBe(1);
  });

  it("hands ownership to the longest-standing member when the owner leaves", async () => {
    const { owner, member, roomId } = await roomWithMember();
    await owner.client.request(`/api/rooms/${roomId}/leave`, { method: "POST" });
    const room = await member.client.request(`/api/rooms/${roomId}`);
    expect(room.data.role).toBe("owner");
    expect(room.data.members).toHaveLength(1);
  });

  it("deletes the room when the last member leaves", async () => {
    const { client } = await signedInUser();
    const room = (await client.request("/api/rooms", { method: "POST", body: { name: "Solo" } }))
      .data;
    await client.request(`/api/rooms/${room.id}/leave`, { method: "POST" });

    const remaining = await client.env.DB.prepare(`select 1 from "room" where "id" = ?`)
      .bind(room.id)
      .first();
    expect(remaining).toBeNull();
  });
});

describe("D1 read replication", () => {
  it("returns a session bookmark and accepts it back", async () => {
    const alice = await signedInUser("Alice");
    const created = await alice.client.request("/api/rooms", {
      method: "POST",
      body: { name: "Bookmarked" },
    });
    const bookmark = created.headers.get("x-d1-bookmark");
    expect(bookmark).toBeTruthy();

    const listed = await alice.client.request("/api/rooms", {
      headers: { "x-d1-bookmark": bookmark! },
    });
    expect(listed.status).toBe(200);
    expect(listed.data.rooms.map((room: { id: string }) => room.id)).toContain(created.data.id);
  });
});
