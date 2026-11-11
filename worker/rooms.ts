import { waitUntil } from "cloudflare:workers";

import type { ServerEvent } from "../shared/messages.ts";
import type { RoomRole } from "../shared/rooms.ts";
import { USER_ID_HEADER, USER_NAME_HEADER } from "./chat-room.ts";
import { HttpError } from "./http.ts";

/*
 * Membership checks shared by every room and invitation route. Each room
 * operation starts here so authorization never depends on what the client shows.
 */

export function toRole(value: string): RoomRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/**
 * The caller's role in a room. Non-members get the same 404 as a missing room,
 * so room ids can't be probed.
 */
export async function requireMembership(
  db: D1Database,
  roomId: string,
  userId: string,
): Promise<RoomRole> {
  const row = await db
    .prepare(`select "role" from "roomMember" where "roomId" = ? and "userId" = ?`)
    .bind(roomId, userId)
    .first<{ role: string }>();
  if (!row) throw new HttpError(404, "Room not found");
  return toRole(row.role);
}

export async function requireOwner(db: D1Database, roomId: string, userId: string) {
  const role = await requireMembership(db, roomId, userId);
  if (role !== "owner") throw new HttpError(403, "Only the room owner can do that");
}

/** Owners and admins moderate: they promote members and delete messages. */
export async function requireModerator(db: D1Database, roomId: string, userId: string) {
  const role = await requireMembership(db, roomId, userId);
  if (role === "member") throw new HttpError(403, "Only room owners and admins can do that");
  return role;
}

export async function isMember(db: D1Database, roomId: string, userId: string) {
  const row = await db
    .prepare(`select 1 from "roomMember" where "roomId" = ? and "userId" = ?`)
    .bind(roomId, userId)
    .first();
  return row !== null;
}

/** The room's Durable Object, which holds its live connections. */
export function chatRoom(env: Env, roomId: string) {
  return env.CHAT_ROOM.getByName(roomId);
}

/**
 * A user's own hub: every tab they have open, whatever page it's on. Reuses the
 * room object, which only fans out events; "user:" keeps it apart from room ids.
 */
function userHub(env: Env, userId: string) {
  return env.CHAT_ROOM.getByName(`user:${userId}`);
}

/**
 * Runs notification work after the response is sent, so a big room never slows
 * down the request that changed it. Best effort, like notifyRoom.
 */
function inBackground(work: () => Promise<unknown>) {
  waitUntil(work().catch((error: unknown) => console.error("User notification failed", error)));
}

async function fanOut(env: Env, userIds: Iterable<string>, event: ServerEvent) {
  const results = await Promise.allSettled(
    [...new Set(userIds)].map((userId) => userHub(env, userId).broadcast(event)),
  );
  for (const result of results) {
    if (result.status === "rejected") console.error("User notification failed", result.reason);
  }
}

/** Pushes an event to each user's open tabs. */
export function notifyUsers(env: Env, userIds: Iterable<string>, event: ServerEvent) {
  inBackground(() => fanOut(env, userIds, event));
}

export async function memberIds(db: D1Database, roomId: string) {
  const { results } = await db
    .prepare(`select "userId" from "roomMember" where "roomId" = ?`)
    .bind(roomId)
    .all<{ userId: string }>();
  return results.map((row) => row.userId);
}

/**
 * Pushes an event to every member of a room (plus `alsoNotify`, e.g. someone who
 * just left), on whatever page they're on.
 */
// ponytail: one DO request per member per event. Past a few hundred members, coalesce
// room-activity in the room's DO and shard user hubs (fixed N hubs, sockets tagged by user).
export function notifyMembers(
  env: Env,
  roomId: string,
  event: ServerEvent,
  alsoNotify: string[] = [],
) {
  inBackground(async () =>
    fanOut(env, [...(await memberIds(env.DB, roomId)), ...alsoNotify], event),
  );
}

/**
 * After a name or picture change: the user's other tabs refetch their profile,
 * and everyone sharing a room with them refetches member lists.
 */
export function notifyProfileChanged(env: Env, userId: string) {
  notifyUsers(env, [userId], { type: "profile-changed" });
  inBackground(async () => {
    const { results } = await env.DB.prepare(
      `select distinct b."userId" from "roomMember" a join "roomMember" b on b."roomId" = a."roomId"
       where a."userId" = ?`,
    )
      .bind(userId)
      .all<{ userId: string }>();
    await fanOut(
      env,
      results.map((row) => row.userId),
      { type: "room-changed" },
    );
  });
}

/** Connects an authorized user's WebSocket to their own hub. */
export function connectUserHub(env: Env, userId: string, displayName: string) {
  // A fresh request, so cookies never reach the Durable Object.
  return userHub(env, userId).fetch("https://user-hub/connect", {
    headers: {
      Upgrade: "websocket",
      [USER_ID_HEADER]: userId,
      [USER_NAME_HEADER]: encodeURIComponent(displayName),
    },
  });
}

/**
 * Tells the room's live connections about a membership change. Best effort:
 * D1 has already changed, and every request re-checks membership anyway.
 */
export async function notifyRoom(
  env: Env,
  roomId: string,
  action: (room: ReturnType<typeof chatRoom>) => Promise<void>,
) {
  try {
    await action(chatRoom(env, roomId));
  } catch (error) {
    console.error("Room notification failed", error);
  }
}
