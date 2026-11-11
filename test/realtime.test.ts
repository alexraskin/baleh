import { describe, expect, it } from "vitest";

import { signedInUser, TestClient } from "./client.ts";

async function sharedRoom() {
  const owner = await signedInUser("Owner");
  const member = await signedInUser("Sara");
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

describe("WebSocket authorization", () => {
  it("rejects connections without a session", async () => {
    const { roomId } = await sharedRoom();
    const result = await new TestClient().connect(roomId);
    expect(result.status).toBe(401);
    expect(result.socket).toBeFalsy();
  });

  it("rejects a forged session cookie", async () => {
    const { roomId } = await sharedRoom();
    const client = new TestClient();
    client.setCookieHeader("better-auth.session_token=forged.value");
    expect((await client.connect(roomId)).status).toBe(401);
  });

  it("rejects users who aren't members", async () => {
    const { roomId } = await sharedRoom();
    const outsider = await signedInUser("Outsider");
    expect((await outsider.client.connect(roomId)).status).toBe(404);
    expect((await outsider.client.connect("no-such-room")).status).toBe(404);
  });

  it("rejects cross-site handshakes", async () => {
    const { owner, roomId } = await sharedRoom();
    const result = await owner.client.connect(roomId, { Origin: "https://evil.example" });
    expect(result.status).toBe(403);
  });

  it("requires an upgrade request", async () => {
    const { owner, roomId } = await sharedRoom();
    expect((await owner.client.request(`/api/rooms/${roomId}/ws`)).status).toBe(426);
  });

  it("ignores identity headers sent by the client", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const spoof = await member.client.connect(roomId, {
      "X-Baleh-User-Id": owner.id,
      "X-Baleh-User-Name": "Owner",
    });
    const ready = await spoof.socket!.next("ready");
    expect(ready.online.map((user) => user.userId)).toEqual([member.id]);
    spoof.socket!.close();
  });

  it("disconnects a member when they're removed", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const { socket } = await member.client.connect(roomId);
    await socket!.next("ready");

    await owner.client.request(`/api/rooms/${roomId}/members/${member.id}`, { method: "DELETE" });
    expect(await socket!.closed()).toBe(4403);
    expect((await member.client.connect(roomId)).status).toBe(404);
  });

  it("disconnects everyone when the room is deleted", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const { socket } = await member.client.connect(roomId);
    await socket!.next("ready");

    await owner.client.request(`/api/rooms/${roomId}`, { method: "DELETE" });
    expect(await socket!.closed()).toBe(4404);
  });
});

describe("live events", () => {
  it("delivers a saved message to everyone in the room in real time", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const ownerSocket = (await owner.client.connect(roomId)).socket!;
    const memberSocket = (await member.client.connect(roomId)).socket!;
    await Promise.all([ownerSocket.next("ready"), memberSocket.next("ready")]);

    const sent = await owner.client.sendMessage(roomId, "Dinner at seven?");
    const received = await memberSocket.next("message");
    expect(received.message).toEqual(sent.data);
    // The sender's other tabs hear about it too.
    expect((await ownerSocket.next("message")).message.id).toBe(sent.data.id);

    // And it's in D1, so it outlives the connection.
    ownerSocket.close();
    memberSocket.close();
    const history = await member.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages).toEqual([sent.data]);
  });

  it("doesn't broadcast a retried send twice", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const socket = (await member.client.connect(roomId)).socket!;
    await socket.next("ready");
    const clientId = crypto.randomUUID();

    await owner.client.sendMessage(roomId, "Once", clientId);
    await socket.next("message");
    await owner.client.sendMessage(roomId, "Once", clientId);
    await owner.client.sendMessage(roomId, "Marker");
    // Events arrive in order, so once the marker is here the retry would have been too.
    await socket.messageWithText("Marker");

    const texts = socket.events.flatMap((e) => (e.type === "message" ? [e.message.text] : []));
    expect(texts).toEqual(["Once", "Marker"]);
    socket.close();
  });

  it("tracks who's online and who left", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const ownerSocket = (await owner.client.connect(roomId)).socket!;
    const ready = await ownerSocket.next("ready");
    expect(ready.online).toEqual([{ userId: owner.id, displayName: "Owner" }]);

    const memberSocket = (await member.client.connect(roomId)).socket!;
    const joined = await ownerSocket.next("presence");
    expect(joined.online.map((user) => user.userId).sort()).toEqual([owner.id, member.id].sort());

    const mark = ownerSocket.events.length;
    memberSocket.close();
    const left = await ownerSocket.next("presence", mark);
    expect(left.online.map((user) => user.userId)).toEqual([owner.id]);
    ownerSocket.close();
  });

  it("relays typing to others but not back to the typist", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const ownerSocket = (await owner.client.connect(roomId)).socket!;
    const memberSocket = (await member.client.connect(roomId)).socket!;
    await Promise.all([ownerSocket.next("ready"), memberSocket.next("ready")]);

    memberSocket.send({ type: "typing", typing: true });
    expect(await ownerSocket.next("typing")).toEqual({
      type: "typing",
      userId: member.id,
      displayName: "Sara",
      typing: true,
    });

    // Junk and oversized frames are ignored rather than relayed.
    memberSocket.send("not json");
    memberSocket.send({ type: "message", text: "sneaky" });
    memberSocket.send({ type: "typing", typing: true, userId: owner.id });
    memberSocket.send({ type: "typing", typing: false });
    const stopped = await ownerSocket.next(
      "typing",
      ownerSocket.events.findIndex((e) => e.type === "typing") + 1,
    );
    expect(stopped).toMatchObject({ userId: member.id, typing: false });

    expect(memberSocket.events.some((event) => event.type === "typing")).toBe(false);
    ownerSocket.close();
    memberSocket.close();
  });

  it("relays a flood of repeated typing frames once", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const ownerSocket = (await owner.client.connect(roomId)).socket!;
    const memberSocket = (await member.client.connect(roomId)).socket!;
    await Promise.all([ownerSocket.next("ready"), memberSocket.next("ready")]);
    const mark = ownerSocket.events.length;

    for (let i = 0; i < 20; i++) memberSocket.send({ type: "typing", typing: true });
    memberSocket.send({ type: "typing", typing: false });
    memberSocket.send({ type: "typing", typing: false });
    // Leaving comes after the burst, so every relayed frame has arrived once it shows.
    memberSocket.close();
    let index = mark;
    for (;;) {
      const presence = await ownerSocket.next("presence", index);
      if (presence.online.length === 1) break;
      index = ownerSocket.events.indexOf(presence) + 1;
    }
    const relayed = ownerSocket.events
      .slice(mark)
      .flatMap((e) => (e.type === "typing" ? [e.typing] : []));
    // The last false is the departure's own.
    expect(relayed).toEqual([true, false, false]);
    ownerSocket.close();
  });

  it("clears a typing indicator when the typist disconnects", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const ownerSocket = (await owner.client.connect(roomId)).socket!;
    const memberSocket = (await member.client.connect(roomId)).socket!;
    await Promise.all([ownerSocket.next("ready"), memberSocket.next("ready")]);

    memberSocket.send({ type: "typing", typing: true });
    await ownerSocket.next("typing");
    const mark = ownerSocket.events.length;
    memberSocket.close();
    expect(await ownerSocket.next("typing", mark)).toMatchObject({
      userId: member.id,
      typing: false,
    });
    ownerSocket.close();
  });

  it("answers keepalive pings", async () => {
    const { owner, roomId } = await sharedRoom();
    const socket = (await owner.client.connect(roomId)).socket!;
    await socket.next("ready");
    const pong = new Promise<string>((resolve) =>
      socket.ws.addEventListener("message", (event) => {
        if (event.data === "pong") resolve(event.data);
      }),
    );
    socket.send("ping");
    expect(await pong).toBe("pong");
    socket.close();
  });
});

describe("reconnection", () => {
  it("recovers messages sent while disconnected", async () => {
    const { owner, member, roomId } = await sharedRoom();
    let socket = (await member.client.connect(roomId)).socket!;
    await socket.next("ready");
    const seen = await owner.client.sendMessage(roomId, "Seen live");
    const lastSeenId = (await socket.next("message")).message.id;
    expect(lastSeenId).toBe(seen.data.id);

    // Connection drops; the conversation carries on.
    socket.close();
    const missed = [
      (await owner.client.sendMessage(roomId, "Missed one")).data,
      (await owner.client.sendMessage(roomId, "Missed two")).data,
    ];

    // Reconnect, then catch up from the last message seen.
    socket = (await member.client.connect(roomId)).socket!;
    await socket.next("ready");
    const catchUp = await member.client.request(
      `/api/rooms/${roomId}/messages?after=${lastSeenId}`,
    );
    expect(catchUp.data.messages).toEqual(missed);

    // And live delivery resumes.
    const live = await owner.client.sendMessage(roomId, "Back in real time");
    expect((await socket.next("message")).message.id).toBe(live.data.id);
    socket.close();
  });
});

describe("Live updates on the user's own socket", () => {
  it("requires a session", async () => {
    expect((await new TestClient().connectUser()).status).toBe(401);
  });

  it("tells the owner when an invitee joins, and the invitee when they're invited", async () => {
    const owner = await signedInUser("Owner");
    const guest = await signedInUser("Guest");
    const room = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
    ).data;
    const ownerSocket = (await owner.client.connectUser()).socket!;
    const guestSocket = (await guest.client.connectUser()).socket!;
    await Promise.all([ownerSocket.next("ready"), guestSocket.next("ready")]);

    const invite = await owner.client.request(`/api/rooms/${room.id}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    await guestSocket.next("invitations-changed");

    const from = ownerSocket.events.length;
    await guest.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
    expect(await ownerSocket.next("room-changed", from)).toEqual({
      type: "room-changed",
      roomId: room.id,
    });

    const sent = await guest.client.sendMessage(room.id, "hi");
    expect(await ownerSocket.next("room-activity")).toEqual({
      type: "room-activity",
      roomId: room.id,
      updatedAt: sent.data.createdAt,
    });
    ownerSocket.close();
    guestSocket.close();
  });
});
