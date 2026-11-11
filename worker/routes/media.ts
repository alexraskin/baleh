import { completeUploadSchema, uploadRequestSchema } from "../../shared/media.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json, parseJson } from "../http.ts";
import {
  createUpload,
  deleteObject,
  readClaim,
  serveObject,
  verifyUpload,
  type UploadClaim,
} from "../media.ts";
import { notifyMembers, notifyProfileChanged, requireMembership, requireOwner } from "../rooms.ts";
import {
  assertSameOrigin,
  assertWithinRateLimit,
  requireUser,
  withFreshSession,
} from "../session.ts";

/*
 * Upload and download routes for avatars and chat attachments. Attachments are
 * recorded when their message is sent (routes/messages.ts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A token issued to this user, for this purpose (and room), whose upload checks out. */
async function verifiedClaim(
  request: Request,
  env: Env,
  userId: string,
  purpose: UploadClaim["purpose"],
  roomId?: string,
) {
  const { token } = await parseJson(request, completeUploadSchema);
  const claim = await readClaim(env, token, purpose);
  if (claim.userId !== userId || claim.roomId !== roomId) {
    throw new HttpError(403, "That upload isn't yours");
  }
  await verifyUpload(env, claim);
  return claim;
}

// Profile pictures -------------------------------------------------------------

export async function requestAvatarUpload(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await assertWithinRateLimit(env, user.id);
  const { contentType, size } = await parseJson(request, uploadRequestSchema);
  const imageId = crypto.randomUUID();
  return json(
    await createUpload(env, {
      purpose: "avatar",
      key: `avatars/${user.id}/${imageId}`,
      userId: user.id,
      contentType,
      size,
      objectId: imageId,
    }),
  );
}

export async function setAvatar(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const claim = await verifiedClaim(request, env, user.id, "avatar");

  const avatarUrl = `/api/users/${encodeURIComponent(user.id)}/avatar/${claim.objectId}`;
  const previous = await env.DB.prepare(`select "avatarKey" from "user" where "id" = ?`)
    .bind(user.id)
    .first<{ avatarKey: string | null }>();
  await env.DB.prepare(
    `update "user" set "avatarKey" = ?, "avatarUrl" = ?, "updatedAt" = ? where "id" = ?`,
  )
    .bind(claim.key, avatarUrl, new Date().toISOString(), user.id)
    .run();
  if (previous?.avatarKey !== claim.key) await deleteObject(env, previous?.avatarKey);
  notifyProfileChanged(env, user.id);
  return withFreshSession(auth, request, json({ avatarUrl }));
}

export async function removeAvatar(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const row = await env.DB.prepare(`select "avatarKey" from "user" where "id" = ?`)
    .bind(user.id)
    .first<{ avatarKey: string | null }>();
  await env.DB.prepare(
    `update "user" set "avatarKey" = null, "avatarUrl" = null, "updatedAt" = ? where "id" = ?`,
  )
    .bind(new Date().toISOString(), user.id)
    .run();
  await deleteObject(env, row?.avatarKey);
  notifyProfileChanged(env, user.id);
  return withFreshSession(auth, request, new Response(null, { status: 204 }));
}

/** Visible to the person and anyone sharing a room with them. */
export async function getAvatar(
  request: Request,
  env: Env,
  auth: Auth,
  userId: string,
  imageId: string,
) {
  const viewer = await requireUser(auth, request);
  if (!UUID.test(imageId)) throw new HttpError(404, "Not found");
  if (viewer.id !== userId) {
    const shared = await env.DB.prepare(
      `select 1 from "roomMember" a join "roomMember" b on b."roomId" = a."roomId"
       where a."userId" = ? and b."userId" = ? limit 1`,
    )
      .bind(viewer.id, userId)
      .first();
    if (!shared) throw new HttpError(404, "Not found");
  }
  // The image id is in the URL, so a new picture gets a new URL and this can cache for long.
  return serveObject(env, `avatars/${userId}/${imageId}`, 7 * 86_400);
}

// Room avatars ----------------------------------------------------------------

export async function requestRoomAvatarUpload(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  await assertWithinRateLimit(env, user.id);
  const { contentType, size } = await parseJson(request, uploadRequestSchema);
  const version = crypto.randomUUID();
  return json(
    await createUpload(env, {
      purpose: "roomAvatar",
      key: roomAvatarKey(roomId, version),
      userId: user.id,
      roomId,
      contentType,
      size,
      objectId: version,
    }),
  );
}

export async function setRoomAvatar(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  // Each upload has its own key, so a rejected one never touches the current picture.
  const claim = await verifiedClaim(request, env, user.id, "roomAvatar", roomId);
  const previous = await currentRoomAvatarVersion(env.DB, roomId);
  await env.DB.prepare(`update "room" set "avatarVersion" = ? where "id" = ?`)
    .bind(claim.objectId, roomId)
    .run();
  if (previous !== claim.objectId) await deleteRoomAvatar(env, roomId, previous);
  notifyMembers(env, roomId, { type: "room-changed", roomId });
  return json({ avatarUrl: roomAvatarUrl(roomId, claim.objectId) });
}

export async function removeRoomAvatar(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  const previous = await currentRoomAvatarVersion(env.DB, roomId);
  await env.DB.prepare(`update "room" set "avatarVersion" = null where "id" = ?`)
    .bind(roomId)
    .run();
  await deleteRoomAvatar(env, roomId, previous);
  notifyMembers(env, roomId, { type: "room-changed", roomId });
  return new Response(null, { status: 204 });
}

/** rooms/{roomId}/avatar/{version}. Before versioned keys, the picture lived at rooms/{roomId}/avatar. */
function roomAvatarKey(roomId: string, version: string) {
  return `rooms/${roomId}/avatar/${version}`;
}

const legacyRoomAvatarKey = (roomId: string) => `rooms/${roomId}/avatar`;

async function currentRoomAvatarVersion(db: D1Database, roomId: string) {
  const row = await db
    .prepare(`select "avatarVersion" from "room" where "id" = ?`)
    .bind(roomId)
    .first<{ avatarVersion: string | null }>();
  return row?.avatarVersion ?? null;
}

async function deleteRoomAvatar(env: Env, roomId: string, version: string | null) {
  if (!version) return;
  await deleteObject(env, roomAvatarKey(roomId, version));
  await deleteObject(env, legacyRoomAvatarKey(roomId));
}

export function roomAvatarUrl(roomId: string, version: string | null) {
  return version ? `/api/rooms/${encodeURIComponent(roomId)}/avatar?v=${version}` : null;
}

export async function getRoomAvatar(request: Request, env: Env, auth: Auth, roomId: string) {
  const user = await requireUser(auth, request);
  await requireMembership(env.DB, roomId, user.id);
  // Only the current picture is served, never an unconfirmed upload.
  const version = await currentRoomAvatarVersion(env.DB, roomId);
  if (!version) throw new HttpError(404, "Not found");
  const key = (await env.MEDIA.head(roomAvatarKey(roomId, version)))
    ? roomAvatarKey(roomId, version)
    : legacyRoomAvatarKey(roomId);
  return serveObject(env, key, 7 * 86_400);
}

// Attachments ---------------------------------------------------------------------

/** Authorizes an image upload for a new message in this room. */
export async function requestAttachmentUpload(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireMembership(env.DB, roomId, user.id);
  await assertWithinRateLimit(env, user.id);
  const { contentType, size } = await parseJson(request, uploadRequestSchema);
  const messageId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  return json(
    await createUpload(env, {
      purpose: "attachment",
      key: `attachments/${roomId}/${messageId}/${attachmentId}`,
      userId: user.id,
      roomId,
      messageId,
      contentType,
      size,
      objectId: attachmentId,
    }),
  );
}

/** Members only; anyone else gets the same 404 as a missing file. */
export async function getAttachment(request: Request, env: Env, auth: Auth, attachmentId: string) {
  const user = await requireUser(auth, request);
  const row = await env.DB.prepare(
    `select a."objectKey" from "attachment" a
     join "roomMember" m on m."roomId" = a."roomId" and m."userId" = ?
     where a."id" = ?`,
  )
    .bind(user.id, attachmentId)
    .first<{ objectKey: string }>();
  if (!row) throw new HttpError(404, "Not found");
  return serveObject(env, row.objectKey);
}
