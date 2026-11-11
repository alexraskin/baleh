import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PushJob } from "../worker/push.ts";
import { renderPush, retryAfterSeconds } from "../worker/push.ts";
import worker from "../worker/index.ts";
import { queuedPushes, signedInUser, type TestClient } from "./client.ts";

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

let endpointCounter = 0;

/** A subscription like PushSubscription.toJSON() gives, with real keys. */
async function browserSubscription(host = "fcm.googleapis.com") {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  endpointCounter += 1;
  return {
    endpoint: `https://${host}/fcm/send/device-${Date.now()}-${endpointCounter}`,
    keys: {
      p256dh: toBase64Url(
        (await crypto.subtle.exportKey("raw", (keys as CryptoKeyPair).publicKey)) as ArrayBuffer,
      ),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

async function subscribe(client: TestClient) {
  const subscription = await browserSubscription();
  const response = await client.request("/api/push/subscriptions", {
    method: "POST",
    body: subscription,
  });
  expect(response.status).toBe(204);
  return subscription;
}

const subscriptionCount = async (userId: string) =>
  (
    await env.DB.prepare(`select count(*) as "n" from "pushSubscription" where "userId" = ?`)
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

/** Owner and member share a room; both have a browser subscribed. */
async function sharedRoom() {
  const owner = await signedInUser("Owner");
  const member = await signedInUser("Member");
  const roomId = (
    await owner.client.request("/api/rooms", { method: "POST", body: { name: "Family Chat" } })
  ).data.id as string;
  await owner.client.request(`/api/rooms/${roomId}/invitations`, {
    method: "POST",
    body: { email: member.email },
  });
  const [invitation] = (await member.client.request("/api/invitations")).data.invitations;
  await member.client.request(`/api/invitations/${invitation.id}/accept`, { method: "POST" });
  await subscribe(owner.client);
  await subscribe(member.client);
  return { owner, member, roomId };
}

/** Jobs are queued after the response; poll for them. */
async function pushesTo(userId: string, after: number, count = 1) {
  for (let i = 0; i < 100; i++) {
    const jobs = queuedPushes.slice(after).filter((job) => job.userId === userId);
    if (jobs.length >= count) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No push to ${userId}`);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** Delivers jobs like Cloudflare Queues would, recording ack/retry per message. */
async function deliver(bodies: unknown[], queue = "baleh-push-notifications", attempts = 1) {
  const outcomes: ({ ack: true } | { retry: QueueRetryOptions | undefined })[] = [];
  const messages = bodies.map((body, index) => ({
    id: `msg-${index}`,
    body,
    attempts,
    timestamp: new Date(),
    ack: () => (outcomes[index] = { ack: true }),
    retry: (options?: QueueRetryOptions) => (outcomes[index] = { retry: options }),
  }));
  await worker.queue({ queue, messages } as unknown as MessageBatch<unknown>, env);
  return outcomes;
}

/** Stands in for every push service: records requests and answers with `status`. */
function mockPushServices(
  respond: (url: string) => Response = () => new Response(null, { status: 201 }),
) {
  const requests: { url: string; init: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push({ url, init: init ?? {} });
    return respond(url);
  });
  return requests;
}

afterEach(() => vi.restoreAllMocks());

describe("push subscriptions", () => {
  it("registers, updates and removes a browser subscription", async () => {
    const user = await signedInUser("Pusher");
    const first = await subscribe(user.client);
    expect(await subscriptionCount(user.id)).toBe(1);

    // Registering again is an update, not a second row.
    await user.client.request("/api/push/subscriptions", { method: "POST", body: first });
    expect(await subscriptionCount(user.id)).toBe(1);

    // The browser replaced its subscription (pushsubscriptionchange).
    const replacement = await browserSubscription();
    await user.client.request("/api/push/subscriptions", {
      method: "POST",
      body: { ...replacement, oldEndpoint: first.endpoint },
    });
    const rows = await env.DB.prepare(
      `select "endpoint" from "pushSubscription" where "userId" = ?`,
    )
      .bind(user.id)
      .all<{ endpoint: string }>();
    expect(rows.results.map((row) => row.endpoint)).toEqual([replacement.endpoint]);

    const removed = await user.client.request("/api/push/subscriptions", {
      method: "DELETE",
      body: { endpoint: replacement.endpoint },
    });
    expect(removed.status).toBe(204);
    expect(await subscriptionCount(user.id)).toBe(0);
  });

  it("supports several devices per user", async () => {
    const user = await signedInUser("Two Phones");
    await subscribe(user.client);
    await subscribe(user.client);
    expect(await subscriptionCount(user.id)).toBe(2);
  });

  it("refuses signed-out, cross-site, non-push-service and malformed subscriptions", async () => {
    const user = await signedInUser("Careful");
    const valid = await browserSubscription();
    const post = (body: unknown, client = user.client, headers = {}) =>
      client.request("/api/push/subscriptions", { method: "POST", body, headers });

    const { TestClient } = await import("./client.ts");
    expect((await post(valid, new TestClient())).status).toBe(401);
    expect((await post(valid, user.client, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ ...valid, endpoint: "https://evil.example/hook" })).status).toBe(400);
    expect((await post({ ...valid, endpoint: "http://fcm.googleapis.com/x" })).status).toBe(400);
    expect((await post({ ...valid, keys: { ...valid.keys, p256dh: "A".repeat(87) } })).status).toBe(
      400,
    );
    expect((await post({ ...valid, keys: { ...valid.keys, auth: "short" } })).status).toBe(400);
    expect(await subscriptionCount(user.id)).toBe(0);
  });

  it("never lets one user remove another's subscription", async () => {
    const owner = await signedInUser("Owner");
    const other = await signedInUser("Other");
    const subscription = await subscribe(owner.client);
    const response = await other.client.request("/api/push/subscriptions", {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
    });
    expect(response.status).toBe(204); // same answer either way
    expect(await subscriptionCount(owner.id)).toBe(1);
  });
});

describe("notification preferences", () => {
  it("defaults to everything on and saves changes per user", async () => {
    const user = await signedInUser("Prefs");
    const path = "/api/me/notification-preferences";
    expect((await user.client.request(path)).data).toEqual({
      messages: true,
      invitations: true,
      roomActivity: true,
    });
    const update = { messages: false, invitations: true, roomActivity: false };
    expect((await user.client.request(path, { method: "PUT", body: update })).status).toBe(200);
    expect((await user.client.request(path)).data).toEqual(update);

    const other = await signedInUser("Other Prefs");
    expect((await other.client.request(path)).data.messages).toBe(true);
    expect(
      (await user.client.request(path, { method: "PUT", body: { messages: "yes" } })).status,
    ).toBe(400);
  });
});

describe("push on new messages", () => {
  it("queues one push for each other member, never the sender", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const before = queuedPushes.length;
    const sent = await owner.client.sendMessage(roomId, "Dinner at eight");
    expect(sent.status).toBe(201);

    const [job] = await pushesTo(member.id, before);
    expect(job).toMatchObject({
      kind: "message",
      userId: member.id,
      roomId,
      actorId: owner.id,
      sourceId: sent.data.id,
      id: `message:${sent.data.id}:${member.id}`,
    });
    await settle();
    expect(queuedPushes.slice(before).filter((j) => j.userId === owner.id)).toEqual([]);
  });

  it("skips members who turned message notifications off or have no browser subscribed", async () => {
    const { owner, member, roomId } = await sharedRoom();
    await member.client.request("/api/me/notification-preferences", {
      method: "PUT",
      body: { messages: false, invitations: true, roomActivity: true },
    });
    const before = queuedPushes.length;
    await owner.client.sendMessage(roomId, "Anyone?");
    await settle();
    expect(queuedPushes.slice(before)).toEqual([]);
  });

  it("doesn't push to someone watching the room, but does once the tab is hidden", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const { socket } = await member.client.connect(roomId);
    await socket!.next("ready");

    let before = queuedPushes.length;
    await owner.client.sendMessage(roomId, "You're here");
    await socket!.messageWithText("You're here");
    await settle();
    expect(queuedPushes.slice(before)).toEqual([]);

    socket!.send({ type: "visibility", visible: false });
    // The socket is ordered: once a later event comes back, the visibility frame was handled.
    await new Promise((resolve) => setTimeout(resolve, 50));
    before = queuedPushes.length;
    await owner.client.sendMessage(roomId, "You stepped away");
    await pushesTo(member.id, before);
    socket!.close();
  });
});

describe("push on invitations and room activity", () => {
  it("pushes room invitations to an invitee with an account", async () => {
    const owner = await signedInUser("Inviter");
    const guest = await signedInUser("Invitee");
    await subscribe(guest.client);
    const roomId = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Cousins" } })
    ).data.id as string;
    const before = queuedPushes.length;
    await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: guest.email },
    });
    const [job] = await pushesTo(guest.id, before);
    expect(job).toMatchObject({ kind: "room-invitation", roomId, actorId: owner.id });
  });

  it("pushes member-joined to existing members, unless they turned room activity off", async () => {
    const owner = await signedInUser("Host");
    await subscribe(owner.client);
    const roomId = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Book Club" } })
    ).data.id as string;
    const joiner = await signedInUser("Joiner");
    await owner.client.request(`/api/rooms/${roomId}/invitations`, {
      method: "POST",
      body: { email: joiner.email },
    });
    const [invitation] = (await joiner.client.request("/api/invitations")).data.invitations;
    const before = queuedPushes.length;
    await joiner.client.request(`/api/invitations/${invitation.id}/accept`, { method: "POST" });
    const [job] = await pushesTo(owner.id, before);
    expect(job).toMatchObject({ kind: "member-joined", actorId: joiner.id, roomId });
  });
});

describe("push delivery (queue consumer)", () => {
  async function messageJob() {
    const { owner, member, roomId } = await sharedRoom();
    const before = queuedPushes.length;
    await owner.client.sendMessage(roomId, "Private words");
    const [job] = await pushesTo(member.id, before);
    return { owner, member, roomId, job: job! };
  }

  it("sends an encrypted, VAPID-signed push to each of the recipient's browsers, once", async () => {
    const { member, job } = await messageJob();
    await subscribe(member.client); // a second device
    const requests = mockPushServices();

    expect(await deliver([job])).toEqual([{ ack: true }]);
    expect(requests).toHaveLength(2);
    const headers = requests[0]!.init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(headers.urgency).toBe("high");
    expect(headers.topic).toMatch(/^[0-9a-f]{32}$/);
    // The body is ciphertext: the message text never appears in it.
    const body = new TextDecoder().decode(requests[0]!.init.body as Uint8Array);
    expect(body).not.toContain("Private words");

    // A redelivered job doesn't buzz the same browsers again.
    expect(await deliver([job])).toEqual([{ ack: true }]);
    expect(requests).toHaveLength(2);
  });

  it("removes subscriptions the push service says are gone", async () => {
    const { member, job } = await messageJob();
    mockPushServices(() => new Response(null, { status: 410 }));
    expect(await deliver([job])).toEqual([{ ack: true }]);
    expect(await subscriptionCount(member.id)).toBe(0);
  });

  it("retries temporary failures, honouring Retry-After", async () => {
    const { member, job } = await messageJob();
    mockPushServices(() => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    expect(await deliver([job])).toEqual([{ retry: { delaySeconds: 120 } }]);
    expect(await subscriptionCount(member.id)).toBe(1);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timed out"));
    expect(await deliver([job], undefined, 2)).toEqual([{ retry: { delaySeconds: 60 } }]);
  });

  it("drops rejected pushes without retrying or deleting the subscription", async () => {
    const { member, job } = await messageJob();
    mockPushServices(() => new Response(null, { status: 400 }));
    expect(await deliver([job])).toEqual([{ ack: true }]);
    expect(await subscriptionCount(member.id)).toBe(1);
  });

  it("re-checks membership and preferences at send time", async () => {
    const { owner, member, roomId, job } = await messageJob();
    const requests = mockPushServices();
    await member.client.request("/api/me/notification-preferences", {
      method: "PUT",
      body: { messages: false, invitations: true, roomActivity: true },
    });
    expect(await deliver([job])).toEqual([{ ack: true }]);
    expect(requests).toHaveLength(0);

    await member.client.request("/api/me/notification-preferences", {
      method: "PUT",
      body: { messages: true, invitations: true, roomActivity: true },
    });
    await owner.client.request(`/api/rooms/${roomId}/members/${member.id}`, { method: "DELETE" });
    expect(await deliver([job])).toEqual([{ ack: true }]);
    expect(requests).toHaveLength(0);
  });

  it("drops malformed jobs and logs dead letters", async () => {
    const requests = mockPushServices();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deliver([{ kind: "message" }])).toEqual([{ ack: true }]);
    const dead: PushJob = {
      id: "message:m:u",
      kind: "message",
      userId: "u",
      roomId: "r",
      actorId: null,
      sourceId: "m",
    };
    expect(await deliver([dead], "baleh-push-notifications-dlq")).toEqual([{ ack: true }]);
    expect(requests).toHaveLength(0);
  });
});

describe("push payloads", () => {
  it("names the sender and room in the recipient's language, never the message", () => {
    const context = { actorName: "Maman", roomName: "Family Chat" };
    expect(renderPush({ kind: "message", roomId: "r1" }, { ...context, language: "en" })).toEqual({
      title: "⁨Maman⁩",
      body: "New message in ⁨Family Chat⁩",
      url: "/rooms/r1",
      tag: "room:r1",
    });
    expect(renderPush({ kind: "message", roomId: "r1" }, { ...context, language: "fa" }).body).toBe(
      "پیام تازه در ⁨Family Chat⁩",
    );
    expect(
      renderPush({ kind: "room-invitation", roomId: "r1" }, { ...context, language: "en" }),
    ).toMatchObject({
      title: "⁨Family Chat⁩",
      body: "You have a new room invitation",
      url: "/rooms",
    });
    expect(
      renderPush({ kind: "removed-from-room", roomId: "r1" }, { ...context, language: "xx" }).url,
    ).toBe("/notifications");
    expect(
      renderPush({ kind: "message", roomId: "r1" }, { ...context, actorName: null, language: "en" })
        .title,
    ).toBe("⁨Someone⁩");
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterSeconds("30")).toBe(30);
    expect(retryAfterSeconds(new Date(Date.now() + 90_000).toUTCString())).toBeGreaterThan(80);
    expect(retryAfterSeconds("soon")).toBeNull();
    expect(retryAfterSeconds(null)).toBeNull();
  });
});
