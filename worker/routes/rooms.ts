import { defaultLanguage, isLanguageCode } from "../../shared/languages.ts";
import {
  createRoomSchema,
  updateMemberSchema,
  updateRoomSchema,
  type RoomDetail,
  type RoomMember,
  type RoomSummary,
} from "../../shared/rooms.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json, parseJson } from "../http.ts";
import { deleteRoomMedia } from "../media.ts";
import {
  memberIds,
  notifyMembers,
  notifyRoom,
  notifyUsers,
  requireMembership,
  requireModerator,
  requireOwner,
  toRole,
} from "../rooms.ts";
import { assertSameOrigin, assertWithinRateLimit, requireUser } from "../session.ts";
import { roomAvatarUrl } from "./media.ts";
import { notifyRemovedFromRoom } from "./notifications.ts";

interface RoomRow {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  avatarVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemberRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  preferredLanguage: string;
  role: string;
  joinedAt: string;
  deliveredThrough: string | null;
  readThrough: string | null;
}

function toSummary(row: RoomRow): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    role: toRole(row.role),
    memberCount: row.memberCount,
    avatarUrl: roomAvatarUrl(row.id, row.avatarVersion),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const roomColumns = `r."id", r."name", m."role", r."avatarVersion", r."createdAt", r."updatedAt",
  (select count(*) from "roomMember" c where c."roomId" = r."id") as "memberCount"`;

async function loadRoom(db: D1Database, roomId: string, userId: string): Promise<RoomDetail> {
  const [room, members] = await db.batch<RoomRow | MemberRow>([
    db
      .prepare(
        `select ${roomColumns}
         from "room" r join "roomMember" m on m."roomId" = r."id" and m."userId" = ?
         where r."id" = ?`,
      )
      .bind(userId, roomId),
    db
      .prepare(
        `select m."userId", u."displayName", u."avatarUrl", u."preferredLanguage", m."role", m."joinedAt",
           m."deliveredThrough", m."readThrough"
         from "roomMember" m join "user" u on u."id" = m."userId"
         where m."roomId" = ?
         order by m."role" = 'owner' desc, m."role" = 'admin' desc, m."joinedAt", m."userId"`,
      )
      .bind(roomId),
  ]);

  const row = room?.results[0] as RoomRow | undefined;
  if (!row) throw new HttpError(404, "Room not found");
  return {
    ...toSummary(row),
    members: ((members?.results ?? []) as MemberRow[]).map((member): RoomMember => ({
      ...member,
      preferredLanguage: isLanguageCode(member.preferredLanguage)
        ? member.preferredLanguage
        : defaultLanguage,
      role: toRole(member.role),
    })),
  };
}

export async function listRooms(request: Request, env: Env, auth: Auth) {
  const user = await requireUser(auth, request);
  const { results } = await env.DB.prepare(
    `select ${roomColumns}
     from "roomMember" m join "room" r on r."id" = m."roomId"
     where m."userId" = ?
     order by r."updatedAt" desc, r."id"`,
  )
    .bind(user.id)
    .all<RoomRow>();
  return json({ rooms: results.map(toSummary) });
}

export async function createRoom(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await assertWithinRateLimit(env, user.id);
  const { name } = await parseJson(request, createRoomSchema);

  const roomId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`insert into "room" ("id", "name", "createdBy") values (?, ?, ?)`).bind(
      roomId,
      name,
      user.id,
    ),
    env.DB.prepare(
      `insert into "roomMember" ("roomId", "userId", "role") values (?, ?, 'owner')`,
    ).bind(roomId, user.id),
  ]);

  notifyUsers(env, [user.id], { type: "room-changed", roomId });
  return json(await loadRoom(env.DB, roomId, user.id), { status: 201 });
}

export async function getRoom(request: Request, env: Env, auth: Auth, roomId: string) {
  const user = await requireUser(auth, request);
  return json(await loadRoom(env.DB, roomId, user.id));
}

export async function updateRoom(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);
  const { name } = await parseJson(request, updateRoomSchema);

  await env.DB.prepare(`update "room" set "name" = ?, "updatedAt" = ? where "id" = ?`)
    .bind(name, new Date().toISOString(), roomId)
    .run();
  notifyMembers(env, roomId, { type: "room-changed", roomId });
  return json(await loadRoom(env.DB, roomId, user.id));
}

export async function deleteRoom(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireOwner(env.DB, roomId, user.id);

  const members = await memberIds(env.DB, roomId);
  await env.DB.prepare(`delete from "room" where "id" = ?`).bind(roomId).run();
  await notifyRoom(env, roomId, (room) => room.disconnectAll());
  notifyUsers(env, members, { type: "room-changed", roomId });
  // D1 cascades don't reach R2.
  await deleteRoomMedia(env, roomId);
  return new Response(null, { status: 204 });
}

/**
 * Leaves a room. When the last owner leaves, the longest-standing member takes
 * over; when the last member leaves, the room is deleted. One batch, so it's atomic.
 */
export async function leaveRoom(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireMembership(env.DB, roomId, user.id);

  const [, , roomDeleted] = await env.DB.batch([
    env.DB.prepare(
      `update "roomMember" set "role" = 'owner'
       where "roomId" = ?1
         and "userId" = (
           select "userId" from "roomMember"
           where "roomId" = ?1 and "userId" != ?2
           order by "joinedAt", "userId" limit 1
         )
         and not exists (
           select 1 from "roomMember"
           where "roomId" = ?1 and "role" = 'owner' and "userId" != ?2
         )`,
    ).bind(roomId, user.id),
    env.DB.prepare(`delete from "roomMember" where "roomId" = ? and "userId" = ?`).bind(
      roomId,
      user.id,
    ),
    env.DB.prepare(
      `delete from "room"
       where "id" = ?1 and not exists (select 1 from "roomMember" where "roomId" = ?1)`,
    ).bind(roomId),
  ]);
  await notifyRoom(env, roomId, (room) => room.disconnectUser(user.id));
  // Remaining members, plus the leaver's other tabs.
  notifyMembers(env, roomId, { type: "room-changed", roomId }, [user.id]);
  if ((roomDeleted?.meta.changes ?? 0) > 0) await deleteRoomMedia(env, roomId);
  return new Response(null, { status: 204 });
}

export async function removeMember(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
  memberId: string,
) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const role = await requireModerator(env.DB, roomId, user.id);
  if (memberId === user.id) throw new HttpError(400, "Use leave to remove yourself");

  const target = await memberRole(env.DB, roomId, memberId);
  if (target === "owner") throw new HttpError(403, "Owners can't be removed");
  if (target === "admin" && role !== "owner") {
    throw new HttpError(403, "Only the owner can remove an admin");
  }

  await env.DB.prepare(`delete from "roomMember" where "roomId" = ? and "userId" = ?`)
    .bind(roomId, memberId)
    .run();
  await notifyRoom(env, roomId, (room) => room.disconnectUser(memberId));
  notifyMembers(env, roomId, { type: "room-changed", roomId }, [memberId]);
  await notifyRemovedFromRoom(env, roomId, memberId, user.id);
  return new Response(null, { status: 204 });
}

/** Promotes a member to admin, or (owner only) demotes an admin back to member. */
export async function updateMember(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
  memberId: string,
) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const role = await requireModerator(env.DB, roomId, user.id);
  const { role: newRole } = await parseJson(request, updateMemberSchema);
  if (memberId === user.id) throw new HttpError(400, "You can't change your own role");

  const target = await memberRole(env.DB, roomId, memberId);
  if (target === "owner") throw new HttpError(403, "The owner's role can't be changed");
  if (target === "admin" && newRole === "member" && role !== "owner") {
    throw new HttpError(403, "Only the owner can remove an admin");
  }

  await env.DB.prepare(`update "roomMember" set "role" = ? where "roomId" = ? and "userId" = ?`)
    .bind(newRole, roomId, memberId)
    .run();
  notifyMembers(env, roomId, { type: "room-changed", roomId });
  return json(await loadRoom(env.DB, roomId, user.id));
}

async function memberRole(db: D1Database, roomId: string, userId: string) {
  const row = await db
    .prepare(`select "role" from "roomMember" where "roomId" = ? and "userId" = ?`)
    .bind(roomId, userId)
    .first<{ role: string }>();
  if (!row) throw new HttpError(404, "Member not found");
  return toRole(row.role);
}
