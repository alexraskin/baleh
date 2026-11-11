import { defaultLanguage, isLanguageCode } from "../../shared/languages.ts";
import {
  createMessageSchema,
  historyQuerySchema,
  REPLY_PREVIEW_LENGTH,
  type Message,
  type MessagePage,
  type MessageTranslation,
  type ReplyPreview,
} from "../../shared/messages.ts";
import type { Attachment } from "../../shared/media.ts";
import type { Auth } from "../auth.ts";
import { USER_ID_HEADER, USER_NAME_HEADER } from "../chat-room.ts";
import { HttpError, json, parseJson } from "../http.ts";
import { deletePrefix, readClaim, verifyUpload } from "../media.ts";
import { pushNewMessage } from "../push.ts";
import { messageAad, readText, seal, translationAad } from "../sealed.ts";
import {
  chatRoom,
  connectUserHub,
  notifyMembers,
  notifyRoom,
  requireMembership,
} from "../rooms.ts";
import {
  assertSameOrigin,
  assertWithinRateLimit,
  chargeDailyBudget,
  requireUser,
} from "../session.ts";
import type { TranslationJob } from "../translation.ts";

interface MessageRow {
  id: string;
  roomId: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  sealedText: string | null;
  language: string;
  clientId: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  /** JSON array of MessageTranslation. */
  translations: string;
  /** JSON array of attachment columns. */
  attachments: string;
  /** JSON object of the quoted message, or null. */
  replyTo: string | null;
}

type StoredTranslation = MessageTranslation & { sealed: string | null };
type StoredReply = Omit<ReplyPreview, "hasImage" | "deleted"> & {
  sealed: string | null;
  hasImage: number;
  deleted: number;
};

async function toMessage(env: Env, { sealedText, ...row }: MessageRow): Promise<Message> {
  const translations = await Promise.all(
    (JSON.parse(row.translations) as StoredTranslation[])
      .filter((translation) => isLanguageCode(translation.language))
      .map(async ({ sealed, ...translation }) => ({
        ...translation,
        text: await readText(
          env.MESSAGE_KEY,
          sealed,
          translation.text,
          translationAad(row.id, translation.language),
        ),
      })),
  );
  const attachments = (JSON.parse(row.attachments) as Omit<Attachment, "kind" | "url">[]).map(
    (attachment): Attachment => ({
      ...attachment,
      kind: "image",
      url: `/api/attachments/${attachment.id}`,
    }),
  );
  const reply = row.replyTo ? await toReplyPreview(env, JSON.parse(row.replyTo)) : null;
  return {
    ...row,
    text: (await readText(env.MESSAGE_KEY, sealedText, row.text, messageAad(row.id))) ?? "",
    language: isLanguageCode(row.language) ? row.language : defaultLanguage,
    translations,
    attachments,
    replyTo: reply,
  };
}

async function toReplyPreview(
  env: Env,
  { sealed, hasImage, deleted, ...reply }: StoredReply,
): Promise<ReplyPreview> {
  const text = (await readText(env.MESSAGE_KEY, sealed, reply.text, messageAad(reply.id))) ?? "";
  return {
    ...reply,
    // Code points, as SQLite's substr counts them for legacy rows.
    text: Array.from(text).slice(0, REPLY_PREVIEW_LENGTH).join(""),
    language: isLanguageCode(reply.language) ? reply.language : defaultLanguage,
    hasImage: Boolean(hasImage),
    deleted: Boolean(deleted),
  };
}

const messageSelect = `select m."id", m."roomId", m."senderId", u."displayName" as "senderName",
    m."originalText" as "text", m."sealedText", m."originalLanguage" as "language", m."clientId", m."createdAt",
    m."deletedAt", m."deletedBy",
    (select json_group_array(json_object('language', t."targetLanguage", 'status', t."status",
        'text', t."translatedText", 'sealed', t."sealedText"))
      from "messageTranslation" t where t."messageId" = m."id") as "translations",
    (select json_group_array(json_object('id', a."id", 'contentType', a."contentType",
        'size', a."fileSize", 'width', a."width", 'height', a."height"))
      from "attachment" a where a."messageId" = m."id") as "attachments",
    (select json_object('id', p."id", 'senderId', p."senderId", 'senderName', pu."displayName",
        'text', substr(p."originalText", 1, ${REPLY_PREVIEW_LENGTH}), 'sealed', p."sealedText",
        'language', p."originalLanguage",
        'hasImage', exists (select 1 from "attachment" pa where pa."messageId" = p."id"),
        'deleted', p."deletedAt" is not null)
      from "message" p left join "user" pu on pu."id" = p."senderId"
      where p."id" = m."replyToId") as "replyTo"
  from "message" m
  left join "user" u on u."id" = m."senderId"`;

export async function listMessages(request: Request, env: Env, auth: Auth, roomId: string) {
  const user = await requireUser(auth, request);
  await requireMembership(env.DB, roomId, user.id);

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = historyQuerySchema.safeParse(params);
  if (!query.success) throw new HttpError(400, query.error.issues[0]?.message ?? "Invalid query");
  const { before, after, limit } = query.data;

  const cursorId = before ?? after;
  let cursor: { createdAt: string; id: string } | null = null;
  if (cursorId) {
    cursor = await env.DB.prepare(
      `select "createdAt", "id" from "message" where "id" = ? and "roomId" = ?`,
    )
      .bind(cursorId, roomId)
      .first();
    if (!cursor) throw new HttpError(400, "Unknown cursor");
  }

  // Newest first when paging back (and for the first page), oldest first when catching up.
  const forward = Boolean(after);
  const comparison = forward ? ">" : "<";
  const direction = forward ? "asc" : "desc";
  const cursorClause = cursor ? `and (m."createdAt", m."id") ${comparison} (?, ?)` : "";
  const bindings = cursor ? [roomId, cursor.createdAt, cursor.id, limit + 1] : [roomId, limit + 1];

  const { results } = await env.DB.prepare(
    `${messageSelect}
     where m."roomId" = ? ${cursorClause}
     order by m."createdAt" ${direction}, m."id" ${direction}
     limit ?`,
  )
    .bind(...bindings)
    .all<MessageRow>();

  const hasMore = results.length > limit;
  const rows = results.slice(0, limit);
  if (!forward) rows.reverse();

  const page: MessagePage = {
    messages: await Promise.all(rows.map((row) => toMessage(env, row))),
    hasMore,
  };
  return json(page);
}

export async function createMessage(request: Request, env: Env, auth: Auth, roomId: string) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await assertWithinRateLimit(env, user.id);
  await requireMembership(env.DB, roomId, user.id);
  const { text, clientId, attachment, replyToId } = await parseJson(request, createMessageSchema);

  if (replyToId) {
    const quoted = await env.DB.prepare(`select 1 from "message" where "id" = ? and "roomId" = ?`)
      .bind(replyToId, roomId)
      .first();
    if (!quoted) throw new HttpError(400, "That message isn't in this room");
  }

  // Retries were charged the first time; charging them again could 429 a saved message.
  if (text) {
    const retry = await env.DB.prepare(
      `select 1 from "message" where "senderId" = ? and "clientId" = ?`,
    )
      .bind(user.id, clientId)
      .first();
    if (!retry) await chargeDailyBudget(env, user.id, text.length);
  }

  // An image was uploaded straight to R2 under a key we chose; check it before using it.
  const claim = attachment && (await readClaim(env, attachment.token, "attachment"));
  if (claim) {
    if (claim.userId !== user.id || claim.roomId !== roomId) {
      throw new HttpError(403, "That upload isn't yours");
    }
    await verifyUpload(env, claim);
  }

  // The upload chose the message id, since it's part of the object key.
  const id = claim?.messageId ?? crypto.randomUUID();
  // Empty text (an image alone) has nothing to hide, and '' marks "no text" in SQL below.
  const sealedText = text ? await seal(env.MESSAGE_KEY, text, messageAad(id)) : null;
  const createdAt = new Date().toISOString();
  const language = isLanguageCode(user.preferredLanguage)
    ? user.preferredLanguage
    : defaultLanguage;

  // One transaction: the message, its attachment, a pending translation per other member
  // language (the outbox the translator works from), and the room's activity time.
  // A conflict (a retried clientId, or an upload token reused for another send) inserts nothing.
  const statements = [
    env.DB.prepare(
      `insert into "message"
         ("id", "roomId", "senderId", "originalText", "sealedText", "originalLanguage", "clientId",
          "replyToId", "createdAt", "updatedAt")
       values (?, ?, ?, '', ?, ?, ?, ?, ?, ?)
       on conflict do nothing`,
    ).bind(
      id,
      roomId,
      user.id,
      sealedText,
      language,
      clientId,
      replyToId ?? null,
      createdAt,
      createdAt,
    ),
    env.DB.prepare(
      `insert into "messageTranslation" ("id", "messageId", "targetLanguage", "createdAt", "updatedAt")
       select lower(hex(randomblob(16))), ?1, u."preferredLanguage", ?2, ?2
       from "roomMember" rm join "user" u on u."id" = rm."userId"
       where rm."roomId" = ?3 and u."preferredLanguage" != ?4 and ?5 != ''
         and exists (select 1 from "message" where "id" = ?1 and "clientId" = ?6)
       group by u."preferredLanguage"
       on conflict do nothing`,
    ).bind(id, createdAt, roomId, language, text, clientId),
    // Recent activity sorts the room list.
    env.DB.prepare(
      `update "room" set "updatedAt" = ?1
       where "id" = ?2 and exists (select 1 from "message" where "id" = ?3)`,
    ).bind(createdAt, roomId, id),
  ];
  if (claim && attachment) {
    statements.push(
      env.DB.prepare(
        `insert into "attachment"
           ("id", "messageId", "roomId", "uploadedBy", "objectKey", "contentType", "fileSize",
            "width", "height", "createdAt")
         select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         where exists (select 1 from "message" where "id" = ?2 and "clientId" = ?11)
         on conflict do nothing`,
      ).bind(
        claim.objectId,
        id,
        roomId,
        user.id,
        claim.key,
        claim.contentType,
        claim.size,
        attachment.width ?? null,
        attachment.height ?? null,
        createdAt,
        clientId,
      ),
    );
  }
  const [inserted] = await env.DB.batch(statements);
  const isNew = (inserted?.meta.changes ?? 0) > 0;

  const row = await env.DB.prepare(`${messageSelect} where m."senderId" = ? and m."clientId" = ?`)
    .bind(user.id, clientId)
    .first<MessageRow>();
  if (!row || row.roomId !== roomId) throw new HttpError(409, "Duplicate message id");

  const message = await toMessage(env, row);
  if (isNew) {
    // The original goes out first; translations follow as they finish.
    try {
      await chatRoom(env, roomId).broadcast({ type: "message", message });
    } catch (error) {
      // The message is saved; clients pick it up when they next sync.
      console.error("Broadcast failed", error);
    }
    notifyMembers(env, roomId, { type: "room-activity", roomId, updatedAt: message.createdAt });
    pushNewMessage(env, roomId, message.id, user.id);
    if (message.translations.length > 0) {
      const job: TranslationJob = {
        messageId: message.id,
        roomId,
        sourceLanguage: message.language,
        targetLanguages: message.translations.map((translation) => translation.language),
      };
      try {
        await env.TRANSLATIONS.send(job);
      } catch (error) {
        // The pending rows stay behind; the translator's sweeper republishes them.
        console.error("Translation enqueue failed", error);
      }
    }
  }
  // A retry of an earlier send gets the original back.
  return json(message, { status: isNew ? 201 : 200 });
}

/**
 * Soft-deletes a message: its place in the timeline stays, its content goes.
 * Senders can delete their own; room owners and admins can delete anyone's.
 */
export async function deleteMessage(
  request: Request,
  env: Env,
  auth: Auth,
  roomId: string,
  messageId: string,
) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const role = await requireMembership(env.DB, roomId, user.id);

  const message = await env.DB.prepare(
    `select "senderId", "deletedAt" from "message" where "id" = ? and "roomId" = ?`,
  )
    .bind(messageId, roomId)
    .first<{ senderId: string | null; deletedAt: string | null }>();
  if (!message) throw new HttpError(404, "Message not found");
  if (message.senderId !== user.id && role === "member") {
    throw new HttpError(403, "You can only delete your own messages");
  }
  if (message.deletedAt) return new Response(null, { status: 204 });

  const deletedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `update "message" set "originalText" = '', "sealedText" = null, "deletedAt" = ?1, "deletedBy" = ?2, "updatedAt" = ?1
       where "id" = ?3 and "deletedAt" is null`,
    ).bind(deletedAt, user.id, messageId),
    env.DB.prepare(`delete from "messageTranslation" where "messageId" = ?`).bind(messageId),
    env.DB.prepare(`delete from "attachment" where "messageId" = ?`).bind(messageId),
  ]);
  // D1 doesn't reach R2. Keys are attachments/{roomId}/{messageId}/{attachmentId}.
  await deletePrefix(env, `attachments/${roomId}/${messageId}/`);
  await notifyRoom(env, roomId, (room) =>
    room.broadcast({ type: "message-deleted", messageId, deletedAt, deletedBy: user.id }),
  );
  return new Response(null, { status: 204 });
}

/** The signed-in user's own socket, open on every page: room and invitation changes. */
export async function connectUser(request: Request, env: Env, auth: Auth) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "Expected a WebSocket upgrade");
  }
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  return connectUserHub(env, user.id, user.displayName);
}

/** Authorizes a WebSocket upgrade and hands it to the room's Durable Object. */
export async function connectRoom(request: Request, env: Env, auth: Auth, roomId: string) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "Expected a WebSocket upgrade");
  }
  // Browsers always send Origin on WebSocket handshakes; this blocks cross-site hijacking.
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  await requireMembership(env.DB, roomId, user.id);

  // A fresh request, so cookies never reach the Durable Object.
  return chatRoom(env, roomId).fetch("https://chat-room/connect", {
    headers: {
      Upgrade: "websocket",
      [USER_ID_HEADER]: user.id,
      [USER_NAME_HEADER]: encodeURIComponent(user.displayName),
    },
  });
}
