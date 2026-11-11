import { describe, expect, it } from "vitest";

import { queuedEmails, signedInUser, TestClient, uniqueEmail } from "./client.ts";

async function roomWithOwner() {
  const owner = await signedInUser("Owner");
  const room = (
    await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family" } })
  ).data;
  return { owner, roomId: room.id as string };
}

function invite(owner: TestClient, roomId: string, email: string) {
  return owner.request(`/api/rooms/${roomId}/invitations`, { method: "POST", body: { email } });
}

const notifications = async (client: TestClient) =>
  (await client.request("/api/notifications")).data;

describe("in-app notifications", () => {
  it("tells an invitee in Baleh, lets them join, tells the room, and emails nobody", async () => {
    const { owner, roomId } = await roomWithOwner();
    const guest = await signedInUser("Guest");
    const emailsBefore = queuedEmails.length;

    expect((await invite(owner.client, roomId, guest.email)).status).toBe(201);

    const inbox = await notifications(guest.client);
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.notifications).toEqual([
      expect.objectContaining({
        type: "room-invitation",
        roomName: "Family",
        actorName: "Owner",
        roomId: null, // not a member yet
        readAt: null,
      }),
    ]);
    const pending = (await guest.client.request("/api/invitations")).data.invitations;
    expect(pending).toHaveLength(1);

    const accepted = await guest.client.request(`/api/invitations/${pending[0].id}/accept`, {
      method: "POST",
    });
    expect(accepted.status).toBe(200);

    // Accepting reads the invitation's notification, which now leads to the room.
    const after = await notifications(guest.client);
    expect(after.unreadCount).toBe(0);
    expect(after.notifications[0]).toMatchObject({ roomId, readAt: expect.any(String) });

    const ownerInbox = await notifications(owner.client);
    expect(ownerInbox.notifications).toEqual([
      expect.objectContaining({ type: "member-joined", actorName: "Guest", roomId }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queuedEmails.slice(emailsBefore)).toEqual([]);
  });

  it("doesn't email or notify an address with no account, which sees it after signing up", async () => {
    const { owner, roomId } = await roomWithOwner();
    const email = uniqueEmail("later");
    const before = queuedEmails.length;
    await invite(owner.client, roomId, email);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queuedEmails.slice(before).filter((job) => job.to === email)).toEqual([]);

    const newcomer = new TestClient();
    await newcomer.register({ email });
    expect((await newcomer.request("/api/invitations")).data.invitations).toHaveLength(1);
  });

  it("removes the notification when the invitation is revoked", async () => {
    const { owner, roomId } = await roomWithOwner();
    const guest = await signedInUser("Guest");
    const created = await invite(owner.client, roomId, guest.email);
    await owner.client.request(`/api/rooms/${roomId}/invitations/${created.data.id}`, {
      method: "DELETE",
    });
    expect(await notifications(guest.client)).toEqual({ notifications: [], unreadCount: 0 });
  });

  it("tells a member they were removed, without linking to the room", async () => {
    const { owner, roomId } = await roomWithOwner();
    const guest = await signedInUser("Guest");
    const created = await invite(owner.client, roomId, guest.email);
    await guest.client.request(`/api/invitations/${created.data.id}/accept`, { method: "POST" });
    await owner.client.request(`/api/rooms/${roomId}/members/${guest.id}`, { method: "DELETE" });

    const inbox = await notifications(guest.client);
    expect(inbox.notifications[0]).toMatchObject({
      type: "removed-from-room",
      actorName: "Owner",
      roomName: "Family",
      roomId: null,
    });
  });

  it("marks one or all as read, only for their owner", async () => {
    const { owner, roomId } = await roomWithOwner();
    const { owner: other, roomId: otherRoom } = await roomWithOwner();
    const guest = await signedInUser("Guest");
    await invite(owner.client, roomId, guest.email);
    await invite(other.client, otherRoom, guest.email);

    const [first] = (await notifications(guest.client)).notifications;

    // Someone else can't see or touch them.
    expect((await notifications(owner.client)).notifications).toEqual([]);
    const stolen = await owner.client.request(`/api/notifications/${first.id}/read`, {
      method: "POST",
    });
    expect(stolen.status).toBe(404);
    expect((await notifications(guest.client)).unreadCount).toBe(2);

    const one = await guest.client.request(`/api/notifications/${first.id}/read`, {
      method: "POST",
    });
    expect(one.status).toBe(204);
    expect((await notifications(guest.client)).unreadCount).toBe(1);

    expect((await guest.client.request("/api/notifications/read", { method: "POST" })).status).toBe(
      204,
    );
    const all = await notifications(guest.client);
    expect(all.unreadCount).toBe(0);
    expect(all.notifications).toHaveLength(2);
    expect(all.notifications.every((n: { readAt: string | null }) => n.readAt)).toBe(true);
  });

  it("requires a session and a trusted origin", async () => {
    expect((await new TestClient().request("/api/notifications")).status).toBe(401);
    const guest = await signedInUser("Guest");
    const crossSite = await guest.client.request("/api/notifications/read", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);
  });
});
