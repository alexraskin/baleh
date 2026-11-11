import { receiptSchema, type MessageReceipt } from "../../shared/messages.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json, parseJson } from "../http.ts";
import { chatRoom, requireMembership } from "../rooms.ts";
import { assertSameOrigin, requireUser } from "../session.ts";

/** The SQL form of `messageCursor()` in shared/messages.ts. */
const cursorSql = `m."createdAt" || ' ' || m."id"`;

interface Watermarks {
  joinedAt: string;
  deliveredThrough: string | null;
  readThrough: string | null;
}

async function cursorOf(db: D1Database, roomId: string, messageId: string | undefined) {
  if (!messageId) return null;
  const row = await db
    .prepare(`select ${cursorSql} as "cursor" from "message" m where m."id" = ? and m."roomId" = ?`)
    .bind(messageId, roomId)
    .first<{ cursor: string }>();
  if (!row) throw new HttpError(400, "Unknown message");
  return row.cursor;
}

function later(a: string | null, b: string | null) {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Moves the caller's delivered and read watermarks forward and records when
 * each newly covered message was received and read. Watermarks never move back,
 * so late or repeated acknowledgements are harmless.
 */
export async function acknowledge(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const input = await parseJson(request, receiptSchema);

  // Doubles as the membership check: non-members get the same 404 as requireMembership.
  const current = await env.DB.prepare(
    `select "joinedAt", "deliveredThrough", "readThrough" from "roomMember"
     where "roomId" = ? and "userId" = ?`,
  )
    .bind(roomId, user.id)
    .first<Watermarks>();
  if (!current) throw new HttpError(404, "Room not found");

  const read = later(current.readThrough, await cursorOf(env.DB, roomId, input.read));
  const delivered = later(
    later(current.deliveredThrough, await cursorOf(env.DB, roomId, input.delivered)),
    read,
  );
  if (delivered === current.deliveredThrough && read === current.readThrough) {
    return new Response(null, { status: 204 });
  }

  const now = new Date().toISOString();
  // Messages in this window are new to this user: after the old watermark, up to the new
  // one, not their own, and not from before they joined. The cursor comparison alone can't
  // use an index, so the createdAt bounds (a cursor's first 24 chars) keep the scan to the
  // window instead of the whole history since joining.
  const newToUser = `m."roomId" = ?1 and m."createdAt" >= max(?2, substr(?5, 1, 24))
    and m."createdAt" <= substr(?6, 1, 24)
    and (m."senderId" is null or m."senderId" != ?3)`;

  const [, , watermarks] = await env.DB.batch([
    env.DB.prepare(
      `insert into "messageReceipt" ("messageId", "userId", "deliveredAt")
       select m."id", ?3, ?4 from "message" m
       where ${newToUser} and ${cursorSql} > ?5 and ${cursorSql} <= ?6
       on conflict do nothing`,
    ).bind(roomId, current.joinedAt, user.id, now, current.deliveredThrough ?? "", delivered),
    env.DB.prepare(
      `update "messageReceipt" set "readAt" = ?4
       where "userId" = ?3 and "readAt" is null and "messageId" in (
         select m."id" from "message" m
         where ${newToUser} and ${cursorSql} > ?5 and ${cursorSql} <= ?6
       )`,
    ).bind(roomId, current.joinedAt, user.id, now, current.readThrough ?? "", read ?? ""),
    // max() keeps a slower, older acknowledgement from moving a watermark back.
    env.DB.prepare(
      `update "roomMember" set
         "deliveredThrough" = max(coalesce("deliveredThrough", ''), ?3),
         "readThrough" = nullif(max(coalesce("readThrough", ''), ?4), '')
       where "roomId" = ?1 and "userId" = ?2
       returning "deliveredThrough", "readThrough"`,
    ).bind(roomId, user.id, delivered, read ?? ""),
  ]);

  const updated = watermarks?.results[0] as
    | Pick<Watermarks, "deliveredThrough" | "readThrough">
    | undefined;
  if (updated) {
    try {
      await chatRoom(env, roomId).broadcast({ type: "receipts", userId: user.id, ...updated });
    } catch (error) {
      // Saved; senders see it next time they load the room.
      console.error("Receipt broadcast failed", error);
    }
  }
  return new Response(null, { status: 204 });
}

/** Who has received and read a message. Like WhatsApp, only its sender can ask. */
export async function messageInfo(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
  messageId: string,
) {
  const user = await requireUser(auth, request);
  await requireMembership(env.DB, roomId, user.id);

  const message = await env.DB.prepare(
    `select "senderId", "createdAt" from "message" where "id" = ? and "roomId" = ?`,
  )
    .bind(messageId, roomId)
    .first<{ senderId: string | null; createdAt: string }>();
  if (!message) throw new HttpError(404, "Message not found");
  if (message.senderId !== user.id) {
    throw new HttpError(403, "Only the sender can see who read a message");
  }

  const { results } = await env.DB.prepare(
    `select rm."userId", u."displayName", u."avatarUrl", r."deliveredAt", r."readAt"
     from "roomMember" rm
     join "user" u on u."id" = rm."userId"
     left join "messageReceipt" r on r."messageId" = ?1 and r."userId" = rm."userId"
     where rm."roomId" = ?2 and rm."userId" != ?3 and rm."joinedAt" <= ?4
     order by r."readAt" is null, r."readAt", r."deliveredAt" is null, r."deliveredAt", u."displayName"`,
  )
    .bind(messageId, roomId, user.id, message.createdAt)
    .all<MessageReceipt>();
  return json({ receipts: results });
}
