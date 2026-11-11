import type {
  AppNotification,
  NotificationList,
  NotificationType,
} from "../../shared/notifications.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json } from "../http.ts";
import { pushNotifications, type CreatedNotification } from "../push.ts";
import { notifyUsers } from "../rooms.ts";
import { assertSameOrigin, requireUser } from "../session.ts";

/*
 * In-app notifications, stored in D1. Every query is scoped to the session's
 * user id, so nobody can read or mark someone else's.
 */

const PAGE_SIZE = 50;

interface NotificationRow {
  id: string;
  type: NotificationType;
  roomId: string | null;
  roomName: string | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
  isMember: number;
}

const now = () => new Date().toISOString();

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    roomId: row.isMember ? row.roomId : null,
    roomName: row.roomName,
    actorName: row.actorName,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export async function listNotifications(request: Request, env: Env, auth: Auth) {
  const user = await requireUser(auth, request);
  const [list, unread] = await env.DB.batch<NotificationRow | { count: number }>([
    env.DB.prepare(
      `select n."id", n."type", n."roomId", r."name" as "roomName", u."displayName" as "actorName",
         n."readAt", n."createdAt",
         exists (select 1 from "roomMember" m where m."roomId" = n."roomId" and m."userId" = n."userId")
           as "isMember"
       from "notification" n
       left join "room" r on r."id" = n."roomId"
       left join "user" u on u."id" = n."actorId"
       where n."userId" = ?
       order by n."createdAt" desc, n."id" desc
       limit ?`,
    ).bind(user.id, PAGE_SIZE),
    env.DB.prepare(
      `select count(*) as "count" from "notification" where "userId" = ? and "readAt" is null`,
    ).bind(user.id),
  ]);
  const body: NotificationList = {
    notifications: (list!.results as NotificationRow[]).map(toNotification),
    unreadCount: (unread!.results[0] as { count: number } | undefined)?.count ?? 0,
  };
  return json(body);
}

export async function markNotificationRead(request: Request, env: Env, auth: Auth, id: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const row = await env.DB.prepare(
    `update "notification" set "readAt" = coalesce("readAt", ?)
     where "id" = ? and "userId" = ? returning "id"`,
  )
    .bind(now(), id, user.id)
    .first();
  if (!row) throw new HttpError(404, "Notification not found");
  notifyUsers(env, [user.id], { type: "notifications-changed" });
  return new Response(null, { status: 204 });
}

export async function markAllNotificationsRead(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await env.DB.prepare(
    `update "notification" set "readAt" = ? where "userId" = ? and "readAt" is null`,
  )
    .bind(now(), user.id)
    .run();
  notifyUsers(env, [user.id], { type: "notifications-changed" });
  return new Response(null, { status: 204 });
}

// Creating notifications ---------------------------------------------------

const newId = `lower(hex(randomblob(16)))`;

/** Columns every insert below returns, so the new rows can also go out as pushes. */
const returning = `returning "id", "userId", "type", "roomId", "actorId"`;

/**
 * The invitee's notification, if they already have an account. Returned as a
 * statement so it lands in the same batch as the invitation; pass its results to
 * `announceNotifications`.
 */
export function invitationNotification(db: D1Database, invitationId: string) {
  return db
    .prepare(
      `insert into "notification" ("id", "userId", "type", "roomId", "actorId", "invitationId")
       select ${newId}, u."id", 'room-invitation', i."roomId", i."invitedBy", i."id"
       from "invitation" i join "user" u on u."email" = i."email"
       where i."id" = ?
       ${returning}`,
    )
    .bind(invitationId);
}

/** Tells recipients of new notifications: their open tabs, and their browsers by push. */
export function announceNotifications(env: Env, created: CreatedNotification[]) {
  notifyUsers(
    env,
    created.map((row) => row.userId),
    { type: "notifications-changed" },
  );
  pushNotifications(env, created);
}

/** Inserts notifications and tells their recipients. Best effort: the change itself is done. */
async function create(env: Env, statement: D1PreparedStatement) {
  try {
    const { results } = await statement.all<CreatedNotification>();
    announceNotifications(env, results);
  } catch (error) {
    console.error("Couldn't create notifications", error);
  }
}

/** Everyone else in the room hears that someone joined. */
export function notifyMemberJoined(env: Env, roomId: string, userId: string) {
  return create(
    env,
    env.DB.prepare(
      `insert into "notification" ("id", "userId", "type", "roomId", "actorId")
       select ${newId}, "userId", 'member-joined', "roomId", ? from "roomMember"
       where "roomId" = ? and "userId" != ?
       ${returning}`,
    ).bind(userId, roomId, userId),
  );
}

export function notifyRemovedFromRoom(env: Env, roomId: string, userId: string, actorId: string) {
  return create(
    env,
    env.DB.prepare(
      `insert into "notification" ("id", "userId", "type", "roomId", "actorId")
       values (${newId}, ?, 'removed-from-room', ?, ?)
       ${returning}`,
    ).bind(userId, roomId, actorId),
  );
}
