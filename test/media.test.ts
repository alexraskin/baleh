import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { UploadTarget } from "../shared/media.ts";
import { sweepOrphanedUploads } from "../worker/media.ts";
import worker from "../worker/index.ts";
import { ORIGIN, signedInUser, TestClient } from "./client.ts";

/** A tiny file that starts with the PNG signature. */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(24).fill(0)]);

/** An owner and a member sharing a room. */
async function sharedRoom() {
  const owner = await signedInUser("Owner");
  const member = await signedInUser("Member");
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

/** PUTs bytes to an upload URL the way the browser would. */
async function put(target: UploadTarget, bytes: Uint8Array<ArrayBuffer>, headers = target.headers) {
  const response = await worker.fetch(
    new Request(new URL(target.url, ORIGIN), { method: "PUT", headers, body: bytes }) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    env,
  );
  return response.status;
}

async function requestUpload(
  client: TestClient,
  path: string,
  bytes: Uint8Array = png,
  type = "image/png",
) {
  return client.request(path, {
    method: "POST",
    body: { contentType: type, size: bytes.byteLength },
  });
}

/** Uploads an image and sends it as a message. */
async function sendImage(client: TestClient, roomId: string, text?: string) {
  const target = (await requestUpload(client, `/api/rooms/${roomId}/uploads`)).data as UploadTarget;
  expect(await put(target, png)).toBe(200);
  return client.request(`/api/rooms/${roomId}/messages`, {
    method: "POST",
    body: {
      clientId: crypto.randomUUID(),
      ...(text && { text }),
      attachment: { token: target.token, width: 640, height: 480 },
    },
  });
}

async function fetchBytes(client: TestClient, path: string) {
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      headers: client.cookieHeader ? { Cookie: client.cookieHeader } : {},
    }) as Request<unknown, IncomingRequestCfProperties>,
    client.env,
  );
  return { status: response.status, headers: response.headers, body: await response.bytes() };
}

describe("chat image attachments", () => {
  it("uploads, sends and shows an image to room members only", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const sent = await sendImage(owner.client, roomId, "Look!");
    expect(sent.status).toBe(201);
    expect(sent.data).toMatchObject({ text: "Look!" });
    const [attachment] = sent.data.attachments;
    expect(attachment).toMatchObject({
      kind: "image",
      contentType: "image/png",
      size: png.byteLength,
      width: 640,
      height: 480,
    });
    expect(attachment.url).toBe(`/api/attachments/${attachment.id}`);

    const seen = await fetchBytes(member.client, attachment.url);
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual(png);
    expect(seen.headers.get("Content-Type")).toBe("image/png");
    expect(seen.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(seen.headers.get("Cache-Control")).toMatch(/^private/);

    const history = await member.client.request(`/api/rooms/${roomId}/messages`);
    expect(history.data.messages[0].attachments).toEqual(sent.data.attachments);

    const outsider = await signedInUser("Outsider");
    expect((await fetchBytes(outsider.client, attachment.url)).status).toBe(404);
    expect((await fetchBytes(new TestClient(), attachment.url)).status).toBe(401);
  });

  it("keys objects by room, message and attachment", async () => {
    const { owner, roomId } = await sharedRoom();
    const sent = await sendImage(owner.client, roomId);
    const key = `attachments/${roomId}/${sent.data.id}/${sent.data.attachments[0].id}`;
    expect(await env.MEDIA.head(key)).not.toBeNull();
  });

  it("sends an image without a caption, and doesn't translate it", async () => {
    const { owner, member, roomId } = await sharedRoom();
    await member.client.request("/api/me/language", {
      method: "PUT",
      body: { preferredLanguage: "fa" },
    });
    const sent = await sendImage(owner.client, roomId);
    expect(sent.status).toBe(201);
    expect(sent.data.text).toBe("");
    expect(sent.data.translations).toEqual([]);
  });

  it("treats a retried send as one message with one attachment", async () => {
    const { owner, roomId } = await sharedRoom();
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    await put(target, png);
    const body = { clientId: crypto.randomUUID(), attachment: { token: target.token } };
    const first = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body,
    });
    const retry = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body,
    });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.data).toEqual(first.data);

    // The same upload can't be attached to a second message.
    const reuse = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { ...body, clientId: crypto.randomUUID() },
    });
    expect(reuse.status).toBe(409);
  });

  it.each([
    ["an SVG", "image/svg+xml", 100],
    ["a PDF", "application/pdf", 100],
    ["an empty file", "image/png", 0],
    ["a file over 15 MB", "image/jpeg", 15 * 1024 * 1024 + 1],
  ])("refuses to authorize %s", async (_label, contentType, size) => {
    const { owner, roomId } = await sharedRoom();
    const response = await owner.client.request(`/api/rooms/${roomId}/uploads`, {
      method: "POST",
      body: { contentType, size },
    });
    expect(response.status).toBe(400);
  });

  it("only lets members upload", async () => {
    const { roomId } = await sharedRoom();
    const outsider = await signedInUser("Outsider");
    expect((await requestUpload(outsider.client, `/api/rooms/${roomId}/uploads`)).status).toBe(404);
  });

  it("rejects and deletes an upload that isn't really an image", async () => {
    const { owner, roomId } = await sharedRoom();
    const fake = new Uint8Array(new TextEncoder().encode("<script>alert(1)</script>"));
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`, fake))
      .data as UploadTarget;
    expect(await put(target, fake)).toBe(200);

    const sent = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { clientId: crypto.randomUUID(), attachment: { token: target.token } },
    });
    expect(sent.status).toBe(400);
    const listed = await env.MEDIA.list({ prefix: `attachments/${roomId}/` });
    expect(listed.objects).toEqual([]);
  });

  it("rejects a send whose upload never happened", async () => {
    const { owner, roomId } = await sharedRoom();
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    const sent = await owner.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: { clientId: crypto.randomUUID(), attachment: { token: target.token } },
    });
    expect(sent.status).toBe(400);
  });

  it("won't attach someone else's upload, or one from another room", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    await put(target, png);
    const body = { clientId: crypto.randomUUID(), attachment: { token: target.token } };

    const stolen = await member.client.request(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body,
    });
    expect(stolen.status).toBe(403);

    const other = (
      await owner.client.request("/api/rooms", { method: "POST", body: { name: "Other" } })
    ).data;
    const moved = await owner.client.request(`/api/rooms/${other.id}/messages`, {
      method: "POST",
      body,
    });
    expect(moved.status).toBe(403);
  });

  it("rejects tampered tokens", async () => {
    const { owner, roomId } = await sharedRoom();
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    const [payload, signature] = target.token.split(".");
    const claim = JSON.parse(atob(payload!.replaceAll("-", "+").replaceAll("_", "/")));
    const forged = btoa(JSON.stringify({ ...claim, size: 10 ** 9 }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const tampered = { ...target, url: `/api/uploads/${forged}.${signature}` };
    expect(await put(tampered, png)).toBe(400);
  });

  it("holds uploads to the authorized type and size", async () => {
    const { owner, roomId } = await sharedRoom();
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    expect(await put(target, png, { "Content-Type": "text/html" })).toBe(403);
    expect(await put(target, new Uint8Array([...png, 0]))).toBe(403);
  });

  it("removes a deleted room's files from R2", async () => {
    const { owner, roomId } = await sharedRoom();
    await sendImage(owner.client, roomId);
    await owner.client.request(`/api/rooms/${roomId}`, { method: "DELETE" });
    expect((await env.MEDIA.list({ prefix: `attachments/${roomId}/` })).objects).toEqual([]);
  });
});

describe("profile pictures", () => {
  async function setAvatar(client: TestClient) {
    const target = (await requestUpload(client, "/api/me/avatar/uploads")).data as UploadTarget;
    expect(await put(target, png)).toBe(200);
    return client.request("/api/me/avatar", { method: "PUT", body: { token: target.token } });
  }

  it("sets a picture that roommates can see and strangers can't", async () => {
    const { owner, member } = await sharedRoom();
    const set = await setAvatar(member.client);
    expect(set.status).toBe(200);
    const { avatarUrl } = set.data;
    expect(avatarUrl).toMatch(new RegExp(`^/api/users/${member.id}/avatar/[0-9a-f-]{36}$`));
    expect((await member.client.request("/api/me")).data.avatarUrl).toBe(avatarUrl);

    expect((await fetchBytes(owner.client, avatarUrl)).status).toBe(200);
    expect((await fetchBytes(member.client, avatarUrl)).status).toBe(200);
    const stranger = await signedInUser("Stranger");
    expect((await fetchBytes(stranger.client, avatarUrl)).status).toBe(404);
  });

  it("replaces and removes the picture, deleting old files", async () => {
    const { client, id } = await signedInUser("Changer");
    await setAvatar(client);
    await setAvatar(client);
    expect((await env.MEDIA.list({ prefix: `avatars/${id}/` })).objects).toHaveLength(1);

    expect((await client.request("/api/me/avatar", { method: "DELETE" })).status).toBe(204);
    expect((await client.request("/api/me")).data.avatarUrl).toBeNull();
    expect((await env.MEDIA.list({ prefix: `avatars/${id}/` })).objects).toEqual([]);
  });

  it("won't use an attachment upload as a profile picture", async () => {
    const { owner, roomId } = await sharedRoom();
    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    await put(target, png);
    const response = await owner.client.request("/api/me/avatar", {
      method: "PUT",
      body: { token: target.token },
    });
    expect(response.status).toBe(400);
  });
});

describe("room pictures", () => {
  it("lets the owner set the picture and members view it", async () => {
    const { owner, member, roomId } = await sharedRoom();
    expect((await requestUpload(member.client, `/api/rooms/${roomId}/avatar/uploads`)).status).toBe(
      403,
    );

    const target = (await requestUpload(owner.client, `/api/rooms/${roomId}/avatar/uploads`))
      .data as UploadTarget;
    await put(target, png);
    const set = await owner.client.request(`/api/rooms/${roomId}/avatar`, {
      method: "PUT",
      body: { token: target.token },
    });
    expect(set.status).toBe(200);
    expect(
      await env.MEDIA.head(`rooms/${roomId}/avatar/${set.data.avatarUrl.split("=").pop()}`),
    ).not.toBeNull();

    const room = (await member.client.request(`/api/rooms/${roomId}`)).data;
    expect(room.avatarUrl).toBe(set.data.avatarUrl);
    expect((await fetchBytes(member.client, room.avatarUrl)).status).toBe(200);
    const outsider = await signedInUser("Outsider");
    expect((await fetchBytes(outsider.client, room.avatarUrl)).status).toBe(404);

    // Only the owner can remove it.
    expect(
      (await member.client.request(`/api/rooms/${roomId}/avatar`, { method: "DELETE" })).status,
    ).toBe(403);
    expect(
      (await owner.client.request(`/api/rooms/${roomId}/avatar`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await member.client.request(`/api/rooms/${roomId}`)).data.avatarUrl).toBeNull();
    expect((await env.MEDIA.list({ prefix: `rooms/${roomId}/` })).objects).toEqual([]);
  });

  it("never lets an unverified upload replace the current picture", async () => {
    const { owner, member, roomId } = await sharedRoom();
    const path = `/api/rooms/${roomId}/avatar`;
    const first = (await requestUpload(owner.client, `${path}/uploads`)).data as UploadTarget;
    await put(first, png);
    const { avatarUrl } = (
      await owner.client.request(path, { method: "PUT", body: { token: first.token } })
    ).data;
    const before = await fetchBytes(member.client, avatarUrl);

    // An upload that is never confirmed, and one that fails verification.
    const skipped = (await requestUpload(owner.client, `${path}/uploads`)).data as UploadTarget;
    await put(skipped, new Uint8Array(png.byteLength));
    const bad = (await requestUpload(owner.client, `${path}/uploads`)).data as UploadTarget;
    await put(bad, new Uint8Array(png.byteLength));
    expect(
      (await owner.client.request(path, { method: "PUT", body: { token: bad.token } })).status,
    ).toBe(400);

    expect((await member.client.request(`/api/rooms/${roomId}`)).data.avatarUrl).toBe(avatarUrl);
    const after = await fetchBytes(member.client, avatarUrl);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before.body);

    // The skipped upload is swept; the current picture stays.
    await sweepOrphanedUploads(env, Date.now() + 2 * 60 * 60 * 1000);
    const keys = (await env.MEDIA.list({ prefix: `rooms/${roomId}/` })).objects.map((o) => o.key);
    expect(keys).toEqual([`rooms/${roomId}/avatar/${avatarUrl.split("=").pop()}`]);
  });

  it("still serves a picture stored before keys were versioned", async () => {
    const { owner, member, roomId } = await sharedRoom();
    await env.MEDIA.put(`rooms/${roomId}/avatar`, png, {
      httpMetadata: { contentType: "image/png" },
    });
    await env.DB.prepare(`update "room" set "avatarVersion" = 'legacy' where "id" = ?`)
      .bind(roomId)
      .run();
    const { avatarUrl } = (await member.client.request(`/api/rooms/${roomId}`)).data;
    expect((await fetchBytes(member.client, avatarUrl)).status).toBe(200);
    await sweepOrphanedUploads(env, Date.now() + 2 * 60 * 60 * 1000);
    expect(await env.MEDIA.head(`rooms/${roomId}/avatar`)).not.toBeNull();

    expect(
      (await owner.client.request(`/api/rooms/${roomId}/avatar`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(await env.MEDIA.head(`rooms/${roomId}/avatar`)).toBeNull();
  });
});

describe("upload signing", () => {
  it("presigns a direct R2 upload when S3 credentials are set", async () => {
    const { client, id } = await signedInUser("Signer", {
      R2_ACCOUNT_ID: "abc123",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
    } as unknown as Partial<Env>);
    const target = (await requestUpload(client, "/api/me/avatar/uploads")).data as UploadTarget;
    const url = new URL(target.url);
    expect(url.origin).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(url.pathname).toMatch(new RegExp(`^/baleh-media/avatars/${id}/[0-9a-f-]{36}$`));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never falls back to proxying uploads in production", async () => {
    const { client } = await signedInUser("Prod");
    client.env.ENVIRONMENT = "production" as Env["ENVIRONMENT"];
    expect((await requestUpload(client, "/api/me/avatar/uploads")).status).toBe(503);
  });
});

describe("orphaned upload sweep", () => {
  it("deletes old uploads nothing points at, and keeps used ones", async () => {
    const { owner, roomId } = await sharedRoom();
    const sent = await sendImage(owner.client, roomId);
    const unsent = (await requestUpload(owner.client, `/api/rooms/${roomId}/uploads`))
      .data as UploadTarget;
    expect(await put(unsent, png)).toBe(200);

    const avatar = (await requestUpload(owner.client, "/api/me/avatar/uploads"))
      .data as UploadTarget;
    expect(await put(avatar, png)).toBe(200);
    await owner.client.request("/api/me/avatar", { method: "PUT", body: { token: avatar.token } });
    const unsetAvatar = (await requestUpload(owner.client, "/api/me/avatar/uploads"))
      .data as UploadTarget;
    expect(await put(unsetAvatar, png)).toBe(200);

    const keys = async (prefix: string) =>
      (await env.MEDIA.list({ prefix })).objects.map((object) => object.key);
    const ownerId = (await owner.client.request("/api/me")).data.id as string;

    // Fresh uploads might still be claimed.
    await sweepOrphanedUploads(env);
    expect(await keys(`attachments/${roomId}/`)).toHaveLength(2);
    expect(await keys(`avatars/${ownerId}/`)).toHaveLength(2);

    await sweepOrphanedUploads(env, Date.now() + 2 * 60 * 60 * 1000);
    expect(await keys(`attachments/${roomId}/`)).toEqual([
      `attachments/${roomId}/${sent.data.id}/${sent.data.attachments[0].id}`,
    ]);
    const profile = await owner.client.request("/api/me");
    const [kept] = await keys(`avatars/${ownerId}/`);
    expect(profile.data.avatarUrl).toBe(`/api/users/${ownerId}/avatar/${kept!.split("/").pop()}`);
    expect(await keys(`avatars/${ownerId}/`)).toHaveLength(1);
  });
});
