import { describe, expect, it } from "vitest";

import { deliveryStatus, messageCursor } from "../shared/messages.ts";
import { signedInUser } from "./client.ts";

type User = Awaited<ReturnType<typeof signedInUser>>;

async function join(owner: User, roomId: string, name: string) {
  const user = await signedInUser(name);
  const invite = await owner.client.request(`/api/rooms/${roomId}/invitations`, {
    method: "POST",
    body: { email: user.email },
  });
  await user.client.request(`/api/invitations/${invite.data.id}/accept`, { method: "POST" });
  return user;
}

/** Alex owns the room; Maman and Sara are members. */
async function familyRoom() {
  const alex = await signedInUser("Alex");
  const roomId = (
    await alex.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
  ).data.id as string;
  const maman = await join(alex, roomId, "Maman");
  const sara = await join(alex, roomId, "Sara");
  return { alex, maman, sara, roomId };
}

function ack(user: User, roomId: string, body: { delivered?: string; read?: string }) {
  return user.client.request(`/api/rooms/${roomId}/receipts`, { method: "POST", body });
}

/** The status the sender's client would show for a message. */
async function statusOf(viewer: User, roomId: string, message: Record<string, any>) {
  const room = await viewer.client.request(`/api/rooms/${roomId}`);
  return deliveryStatus(message as Parameters<typeof deliveryStatus>[0], room.data.members);
}

async function info(user: User, roomId: string, messageId: string) {
  return user.client.request(`/api/rooms/${roomId}/messages/${messageId}/receipts`);
}

describe("tick status", () => {
  it("goes from sent to delivered to read once every recipient has", async () => {
    const { alex, maman, sara, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Dinner Friday?")).data;
    expect(await statusOf(alex, roomId, message)).toBe("sent");

    await ack(maman, roomId, { delivered: message.id });
    expect(await statusOf(alex, roomId, message)).toBe("sent");
    await ack(sara, roomId, { delivered: message.id });
    expect(await statusOf(alex, roomId, message)).toBe("delivered");

    await ack(maman, roomId, { read: message.id });
    expect(await statusOf(alex, roomId, message)).toBe("delivered");
    await ack(sara, roomId, { read: message.id });
    expect(await statusOf(alex, roomId, message)).toBe("read");
  });

  it("treats reading as delivery, and covers every earlier message", async () => {
    const { alex, maman, sara, roomId } = await familyRoom();
    const first = (await alex.client.sendMessage(roomId, "One")).data;
    const second = (await alex.client.sendMessage(roomId, "Two")).data;

    for (const user of [maman, sara]) await ack(user, roomId, { read: second.id });
    expect(await statusOf(alex, roomId, first)).toBe("read");
    expect(await statusOf(alex, roomId, second)).toBe("read");
  });

  it("never moves backwards", async () => {
    const { alex, maman, roomId } = await familyRoom();
    const first = (await alex.client.sendMessage(roomId, "One")).data;
    const second = (await alex.client.sendMessage(roomId, "Two")).data;

    await ack(maman, roomId, { read: second.id });
    expect((await ack(maman, roomId, { read: first.id, delivered: first.id })).status).toBe(204);

    const room = await alex.client.request(`/api/rooms/${roomId}`);
    const member = room.data.members.find((m: { userId: string }) => m.userId === maman.id);
    expect(member).toMatchObject({
      readThrough: messageCursor(second),
      deliveredThrough: messageCursor(second),
    });
  });

  it("ignores people who joined after the message was sent", async () => {
    const { alex, maman, sara, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Before the cousin")).data;
    for (const user of [maman, sara]) await ack(user, roomId, { read: message.id });
    await join(alex, roomId, "Cousin");

    expect(await statusOf(alex, roomId, message)).toBe("read");
  });

  it("stops waiting on someone who left", async () => {
    const { alex, maman, sara, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Hello")).data;
    await ack(maman, roomId, { read: message.id });
    expect(await statusOf(alex, roomId, message)).toBe("sent");

    await sara.client.request(`/api/rooms/${roomId}/leave`, { method: "POST" });
    expect(await statusOf(alex, roomId, message)).toBe("read");
  });

  it("stays at sent when no one else is in the room", async () => {
    const alex = await signedInUser("Alex");
    const roomId = (
      await alex.client.request("/api/rooms", { method: "POST", body: { name: "Notes" } })
    ).data.id;
    const message = (await alex.client.sendMessage(roomId, "Note to self")).data;
    await ack(alex, roomId, { read: message.id });
    expect(await statusOf(alex, roomId, message)).toBe("sent");
  });
});

describe("message info", () => {
  it("shows the sender when each person received and read it", async () => {
    const { alex, maman, sara, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Dinner Friday?")).data;
    await ack(maman, roomId, { read: message.id });
    await ack(sara, roomId, { delivered: message.id });

    const response = await info(alex, roomId, message.id);
    expect(response.status).toBe(200);
    const [first, second] = response.data.receipts;
    expect(first).toMatchObject({ userId: maman.id, displayName: "Maman" });
    expect(first.readAt).toEqual(expect.any(String));
    expect(first.deliveredAt).toEqual(expect.any(String));
    expect(second).toMatchObject({ userId: sara.id, displayName: "Sara", readAt: null });
    expect(second.deliveredAt).toEqual(expect.any(String));
  });

  it("records the time of the acknowledgement that covered each message", async () => {
    const { alex, maman, roomId } = await familyRoom();
    const first = (await alex.client.sendMessage(roomId, "One")).data;
    await ack(maman, roomId, { read: first.id });
    const firstReadAt = (await info(alex, roomId, first.id)).data.receipts[0].readAt;

    const second = (await alex.client.sendMessage(roomId, "Two")).data;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ack(maman, roomId, { read: second.id });

    expect((await info(alex, roomId, first.id)).data.receipts[0].readAt).toBe(firstReadAt);
    expect((await info(alex, roomId, second.id)).data.receipts[0].readAt > firstReadAt).toBe(true);
  });

  it("is only available to the sender", async () => {
    const { alex, maman, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Mine")).data;
    expect((await info(maman, roomId, message.id)).status).toBe(403);

    const outsider = await signedInUser("Outsider");
    expect((await info(outsider, roomId, message.id)).status).toBe(404);
  });

  it("doesn't record receipts for your own messages", async () => {
    const { alex, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Mine")).data;
    await ack(alex, roomId, { read: message.id });
    const rows = await alex.client.env.DB.prepare(
      `select count(*) as "count" from "messageReceipt" where "messageId" = ?`,
    )
      .bind(message.id)
      .first<{ count: number }>();
    expect(rows?.count).toBe(0);
  });
});

describe("acknowledging", () => {
  it("tells the sender live over the socket", async () => {
    const { alex, maman, roomId } = await familyRoom();
    const socket = (await alex.client.connect(roomId)).socket!;
    await socket.next("ready");
    const message = (await alex.client.sendMessage(roomId, "Hi")).data;

    await ack(maman, roomId, { read: message.id });
    expect(await socket.next("receipts")).toEqual({
      type: "receipts",
      userId: maman.id,
      deliveredThrough: messageCursor(message),
      readThrough: messageCursor(message),
    });
    socket.close();
  });

  it("only works for members, with messages from that room", async () => {
    const { alex, maman, roomId } = await familyRoom();
    const message = (await alex.client.sendMessage(roomId, "Hi")).data;
    const outsider = await signedInUser("Outsider");
    expect((await ack(outsider, roomId, { read: message.id })).status).toBe(404);

    const otherRoom = (
      await alex.client.request("/api/rooms", { method: "POST", body: { name: "Other" } })
    ).data.id;
    const elsewhere = (await alex.client.sendMessage(otherRoom, "Elsewhere")).data;
    expect((await ack(maman, roomId, { read: elsewhere.id })).status).toBe(400);
  });

  it.each([
    ["an empty acknowledgement", {}],
    ["unknown fields", { read: "x", userId: "someone" }],
  ])("rejects %s", async (_label, body) => {
    const { maman, roomId } = await familyRoom();
    expect((await ack(maman, roomId, body)).status).toBe(400);
  });
});
