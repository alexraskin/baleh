import { waitUntil } from "cloudflare:workers";

import {
  createInvitationSchema,
  INVITATION_TTL_MS,
  invitationTokenSchema,
  type CreatedInvitation,
  type ReceivedInvitation,
  type SentInvitation,
} from "../../shared/rooms.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json, parseJson } from "../http.ts";
import { isTrustedOrigin } from "../origins.ts";
import { isMember, notifyMembers, notifyUsers, requireOwner } from "../rooms.ts";
import { assertSameOrigin, assertWithinRateLimit, requireUser } from "../session.ts";
import type { CreatedNotification } from "../push.ts";
import { backfillTranslations } from "../translation.ts";
import {
  announceNotifications,
  invitationNotification,
  notifyMemberJoined,
} from "./notifications.ts";

type SessionUser = Awaited<ReturnType<typeof requireUser>>;

/** The room's members see pending invitations and members change; the invitee their inbox. */
function notifyInvitationChanged(env: Env, roomId: string, email: string) {
  notifyMembers(env, roomId, { type: "room-changed", roomId });
  waitUntil(
    (async () => {
      const invitee = await env.DB.prepare(`select "id" from "user" where "email" = ?`)
        .bind(email)
        .first<{ id: string }>();
      if (invitee) notifyUsers(env, [invitee.id], { type: "invitations-changed" });
    })().catch((error: unknown) => console.error("Invitation notification failed", error)),
  );
}

interface InvitationRow {
  id: string;
  roomId: string;
  email: string;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  roomName: string;
  inviterName: string | null;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** 256 bits of randomness; only its SHA-256 is stored. */
function newToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toSent(row: InvitationRow): SentInvitation {
  return {
    id: row.id,
    email: row.email,
    invitedBy: row.inviterName,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function toReceived(row: InvitationRow): ReceivedInvitation {
  return {
    id: row.id,
    roomId: row.roomId,
    roomName: row.roomName,
    inviterName: row.inviterName,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

const invitationSelect = `select i."id", i."roomId", i."email", i."invitedBy", i."expiresAt",
    i."acceptedAt", i."createdAt", r."name" as "roomName", u."displayName" as "inviterName"
  from "invitation" i
  join "room" r on r."id" = i."roomId"
  left join "user" u on u."id" = i."invitedBy"`;

const now = () => new Date().toISOString();

/** Where links should point: the caller's origin when trusted (dev ports move), else the app URL. */
function appOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin");
  return origin && isTrustedOrigin(origin, env) ? origin : env.BETTER_AUTH_URL;
}

// Owner side --------------------------------------------------------------

export async function listRoomInvitations(request: Request, env: Env, auth: Auth, roomId: string) {
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  const { results } = await env.DB.prepare(
    `${invitationSelect}
     where i."roomId" = ? and i."acceptedAt" is null and i."expiresAt" > ?
     order by i."createdAt" desc`,
  )
    .bind(roomId, now())
    .all<InvitationRow>();
  return json({ invitations: results.map(toSent) });
}

export async function createInvitation(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  await assertWithinRateLimit(env, user.id);
  const { email } = await parseJson(request, createInvitationSchema);

  if (email === user.email.toLowerCase()) {
    throw new HttpError(400, "You're already in this room");
  }
  const existingMember = await env.DB.prepare(
    `select 1 from "roomMember" m join "user" u on u."id" = m."userId"
     where m."roomId" = ? and u."email" = ?`,
  )
    .bind(roomId, email)
    .first();
  if (existingMember) throw new HttpError(409, "That person is already in this room");

  const id = crypto.randomUUID();
  const token = newToken();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();

  // Re-inviting replaces any open invitation, so older links stop working.
  const [, , notified] = await env.DB.batch([
    env.DB.prepare(
      `delete from "invitation" where "roomId" = ? and "email" = ? and "acceptedAt" is null`,
    ).bind(roomId, email),
    env.DB.prepare(
      `insert into "invitation" ("id", "roomId", "invitedBy", "email", "tokenHash", "expiresAt", "createdAt")
       values (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, roomId, user.id, email, await hashToken(token), expiresAt, createdAt),
    invitationNotification(env.DB, id),
  ]);
  notifyInvitationChanged(env, roomId, email);
  announceNotifications(env, (notified?.results ?? []) as CreatedNotification[]);

  // Never emailed: the invitee sees it in Baleh, and the owner shares the link themselves.
  const inviteUrl = new URL(`/invite/${token}`, appOrigin(request, env)).toString();

  const created: CreatedInvitation = {
    id,
    email,
    invitedBy: user.displayName,
    expiresAt,
    createdAt,
    inviteUrl,
  };
  return json(created, { status: 201 });
}

export async function revokeInvitation(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
  invitationId: string,
) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  const revoked = await env.DB.prepare(
    `delete from "invitation" where "id" = ? and "roomId" = ? and "acceptedAt" is null
     returning "email"`,
  )
    .bind(invitationId, roomId)
    .first<{ email: string }>();
  if (!revoked) throw new HttpError(404, "Invitation not found");
  notifyInvitationChanged(env, roomId, revoked.email);
  return new Response(null, { status: 204 });
}

// Invitee side ------------------------------------------------------------

/**
 * Checks that an invitation can be used by this user. Invitations are bound to
 * the invited email: holding the link alone isn't enough to join.
 */
function assertUsableBy(
  row: InvitationRow | null,
  user: SessionUser,
): asserts row is InvitationRow {
  if (!row) throw new HttpError(404, "Invitation not found");
  // Better Auth only gives verified accounts a session today; don't depend on it.
  if (!user.emailVerified) throw new HttpError(403, "Verify your email address first");
  if (row.email !== user.email.toLowerCase()) {
    throw new HttpError(403, "This invitation was sent to a different email address");
  }
  if (row.acceptedAt) throw new HttpError(410, "This invitation has already been used");
  if (row.expiresAt <= now()) throw new HttpError(410, "This invitation has expired");
}

async function accept(env: Env, row: InvitationRow, userId: string) {
  const db = env.DB;
  // The insert re-checks the invitation inside the batch, so a concurrent
  // accept or revoke can't sneak a membership through.
  const acceptedAt = now();
  const [, accepted] = await db.batch([
    db
      .prepare(
        `insert into "roomMember" ("roomId", "userId", "role")
         select "roomId", ?, 'member' from "invitation"
         where "id" = ? and "acceptedAt" is null and "expiresAt" > ?
         on conflict do nothing`,
      )
      .bind(userId, row.id, acceptedAt),
    db
      .prepare(`update "invitation" set "acceptedAt" = ? where "id" = ? and "acceptedAt" is null`)
      .bind(acceptedAt, row.id),
  ]);
  if (!(await isMember(db, row.roomId, userId))) {
    throw new HttpError(410, "This invitation is no longer valid");
  }
  // Only the request that accepted it announces the newcomer, not a concurrent repeat.
  if (accepted?.meta.changes) {
    await db
      .prepare(
        `update "notification" set "readAt" = ? where "invitationId" = ? and "readAt" is null`,
      )
      .bind(acceptedAt, row.id)
      .run();
    await notifyMemberJoined(env, row.roomId, userId);
    backfillTranslations(env.DB, env.TRANSLATIONS, userId, row.roomId);
  }
  notifyInvitationChanged(env, row.roomId, row.email);
  return json({ roomId: row.roomId });
}

async function findByToken(db: D1Database, token: string) {
  return db
    .prepare(`${invitationSelect} where i."tokenHash" = ?`)
    .bind(await hashToken(token))
    .first<InvitationRow>();
}

async function findById(db: D1Database, id: string) {
  return db.prepare(`${invitationSelect} where i."id" = ?`).bind(id).first<InvitationRow>();
}

export async function listMyInvitations(request: Request, env: Env, auth: Auth) {
  const user = await requireUser(auth, request);
  const { results } = await env.DB.prepare(
    `${invitationSelect}
     where i."email" = ? and i."acceptedAt" is null and i."expiresAt" > ?
       and not exists (
         select 1 from "roomMember" m where m."roomId" = i."roomId" and m."userId" = ?
       )
     order by i."createdAt" desc`,
  )
    .bind(user.email.toLowerCase(), now(), user.id)
    .all<InvitationRow>();
  return json({ invitations: results.map(toReceived) });
}

export async function previewInvitation(request: Request, env: Env, auth: Auth) {
  const user = await requireUser(auth, request);
  const { token } = await parseJson(request, invitationTokenSchema);
  const row = await findByToken(env.DB, token);
  // Someone who already joined through this link gets sent to the room, not an error.
  if (row?.acceptedAt && (await isMember(env.DB, row.roomId, user.id))) {
    return json({ invitation: toReceived(row), alreadyMember: true });
  }
  assertUsableBy(row, user);
  return json({
    invitation: toReceived(row),
    alreadyMember: await isMember(env.DB, row.roomId, user.id),
  });
}

export async function acceptInvitationByToken(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const { token } = await parseJson(request, invitationTokenSchema);
  const row = await findByToken(env.DB, token);
  assertUsableBy(row, user);
  return accept(env, row, user.id);
}

export async function acceptInvitation(request: Request, env: Env, auth: Auth, id: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const row = await findById(env.DB, id);
  assertUsableBy(row, user);
  return accept(env, row, user.id);
}

export async function declineInvitation(request: Request, env: Env, auth: Auth, id: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const row = await findById(env.DB, id);
  assertUsableBy(row, user);
  await env.DB.prepare(`delete from "invitation" where "id" = ? and "acceptedAt" is null`)
    .bind(id)
    .run();
  notifyInvitationChanged(env, row.roomId, row.email);
  return new Response(null, { status: 204 });
}
