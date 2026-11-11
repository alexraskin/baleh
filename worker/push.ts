import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";

import { defaultLanguage, isLanguageCode, type LanguageCode } from "../shared/languages.ts";
import type { PushPayload } from "../shared/push.ts";
import { chatRoom, memberIds } from "./rooms.ts";

/*
 * Browser push (Web Push with VAPID, RFC 8291/8292).
 *
 * Producers run after the response (never holding up a message) and put one job per
 * recipient on PUSH_NOTIFICATIONS. A recipient gets a job only if they have a
 * subscription, want that kind, and aren't looking at the room right now. This
 * Worker's queue handler re-checks the job, renders it in the recipient's language
 * and posts it, encrypted, to each of their browsers' push services.
 *
 * Payloads name the sender and room, never message text. Subscription endpoints and
 * keys are never logged.
 */

export const pushKinds = [
  "message",
  "room-invitation",
  "member-joined",
  "removed-from-room",
] as const;
export type PushKind = (typeof pushKinds)[number];

export const pushJobSchema = z.object({
  /** Idempotency key: `${kind}:${sourceId}:${userId}`. */
  id: z.string().min(1).max(200),
  kind: z.enum(pushKinds),
  userId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  actorId: z.string().max(64).nullable(),
  /** The message id, or the in-app notification id for everything else. */
  sourceId: z.string().min(1).max(64),
});

export type PushJob = z.infer<typeof pushJobSchema>;

/** Which preference column governs a kind. */
const preferenceFor = {
  message: "messages",
  "room-invitation": "invitations",
  "member-joined": "roomActivity",
  "removed-from-room": "roomActivity",
} as const satisfies Record<PushKind, string>;

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

// Producing ------------------------------------------------------------------

interface Candidate {
  userId: string;
  sourceId: string;
}

/**
 * Queues pushes for candidates who have a browser subscribed, want this kind, aren't
 * viewing the room, and are under the per-room rate limit. Best effort, in the background.
 */
function enqueue(
  env: Env,
  kind: PushKind,
  roomId: string,
  actorId: string | null,
  load: () => Promise<Candidate[]>,
) {
  if (!vapidKeys(env)) return;
  waitUntil(
    (async () => {
      const candidates = await load();
      if (candidates.length === 0) return;

      const column = preferenceFor[kind];
      const { results } = await env.DB.prepare(
        `select c.value as "userId" from json_each(?) c
         left join "notificationPreference" p on p."userId" = c.value
         where coalesce(p."${column}", 1) = 1
           and exists (select 1 from "pushSubscription" s where s."userId" = c.value)`,
      )
        .bind(JSON.stringify(candidates.map((c) => c.userId)))
        .all<{ userId: string }>();
      if (results.length === 0) return;

      const active = await activeUserIds(env, roomId);
      const jobs: PushJob[] = [];
      for (const { userId } of results) {
        if (active.has(userId)) continue;
        const { success } = await env.PUSH_LIMITER.limit({ key: `${userId}:${roomId}` });
        if (!success) continue;
        const sourceId = candidates.find((c) => c.userId === userId)!.sourceId;
        jobs.push({ id: `${kind}:${sourceId}:${userId}`, kind, userId, roomId, actorId, sourceId });
      }
      // sendBatch takes at most 100 messages.
      for (let i = 0; i < jobs.length; i += 100) {
        await env.PUSH_NOTIFICATIONS.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body })));
      }
    })().catch((error: unknown) => console.error("Couldn't queue push notifications", kind, error)),
  );
}

/** Users with the room open in a visible tab. Approximate; on failure, nobody. */
async function activeUserIds(env: Env, roomId: string): Promise<Set<string>> {
  try {
    return new Set(await chatRoom(env, roomId).activeUserIds());
  } catch (error) {
    console.error("Couldn't read room presence", error);
    return new Set();
  }
}

/** A new message: every other member. */
export function pushNewMessage(env: Env, roomId: string, messageId: string, senderId: string) {
  enqueue(env, "message", roomId, senderId, async () =>
    (await memberIds(env.DB, roomId))
      .filter((userId) => userId !== senderId)
      .map((userId) => ({ userId, sourceId: messageId })),
  );
}

export interface CreatedNotification {
  id: string;
  userId: string;
  type: Exclude<PushKind, "message">;
  roomId: string;
  actorId: string | null;
}

/** In-app notifications just created (invitations, joins, removals) also go out as pushes. */
export function pushNotifications(env: Env, created: CreatedNotification[]) {
  const groups = new Map<string, CreatedNotification[]>();
  for (const row of created) {
    const key = `${row.type}\n${row.roomId}\n${row.actorId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    const { type, roomId, actorId } = rows[0]!;
    enqueue(env, type, roomId, actorId, async () =>
      rows.map((row) => ({ userId: row.userId, sourceId: row.id })),
    );
  }
}

// Rendering ------------------------------------------------------------------

/** First-strong isolates, so a name can't reorder the sentence around it. */
const isolate = (text: string) => `⁨${text}⁩`;

const strings: Record<
  LanguageCode,
  {
    someone: string;
    message: (room: string) => string;
    invitation: string;
    joined: (name: string) => string;
    removed: (name: string) => string;
  }
> = {
  en: {
    someone: "Someone",
    message: (room) => `New message in ${room}`,
    invitation: "You have a new room invitation",
    joined: (name) => `${name} joined`,
    removed: (name) => `${name} removed you`,
  },
  fa: {
    someone: "کسی",
    message: (room) => `پیام تازه در ${room}`,
    invitation: "یک دعوت تازه به گفتگو دارید",
    joined: (name) => `${name} پیوست`,
    removed: (name) => `${name} شما را حذف کرد`,
  },
  ar: {
    someone: "شخص ما",
    message: (room) => `رسالة جديدة في ${room}`,
    invitation: "لديك دعوة جديدة إلى محادثة",
    joined: (name) => `انضم ${name}`,
    removed: (name) => `أزالك ${name}`,
  },
  de: {
    someone: "Jemand",
    message: (room) => `Neue Nachricht in ${room}`,
    invitation: "Du hast eine neue Einladung in einen Raum",
    joined: (name) => `${name} ist beigetreten`,
    removed: (name) => `${name} hat dich entfernt`,
  },
};

export function renderPush(
  job: Pick<PushJob, "kind" | "roomId">,
  context: { language: string; actorName: string | null; roomName: string },
): PushPayload {
  const text = strings[isLanguageCode(context.language) ? context.language : defaultLanguage];
  const actor = isolate(context.actorName ?? text.someone);
  const room = isolate(context.roomName);
  const roomUrl = `/rooms/${encodeURIComponent(job.roomId)}`;
  switch (job.kind) {
    case "message":
      return { title: actor, body: text.message(room), url: roomUrl, tag: `room:${job.roomId}` };
    case "room-invitation":
      // Pending invitations are listed on the rooms page.
      return { title: room, body: text.invitation, url: "/rooms", tag: "invitations" };
    case "member-joined":
      return {
        title: room,
        body: text.joined(actor),
        url: roomUrl,
        tag: `activity:${job.roomId}`,
      };
    case "removed-from-room":
      return {
        title: room,
        body: text.removed(actor),
        url: "/notifications",
        tag: `activity:${job.roomId}`,
      };
  }
}

// Delivering -----------------------------------------------------------------

/** How long a push service keeps an undelivered push for an offline device. */
const ttlSeconds: Record<PushKind, number> = {
  message: 60 * 60 * 24,
  "room-invitation": 60 * 60 * 24 * 7,
  "member-joined": 60 * 60 * 24,
  "removed-from-room": 60 * 60 * 24,
};

const PUSH_TIMEOUT_MS = 10_000;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;

/** 30s, 1m, 2m, 4m, 8m. */
function backoff(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 8 * 60);
}

/** Retry-After as seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface JobContext {
  language: string;
  actorName: string | null;
  roomName: string | null;
  wanted: number;
  valid: number;
}

/**
 * Re-checks a job against D1 right before sending: the recipient still wants it, is
 * still a member (for messages), and the message or notification still stands.
 */
function loadContext(db: D1Database, job: PushJob) {
  const valid =
    job.kind === "message"
      ? `exists (select 1 from "roomMember" m where m."roomId" = ?3 and m."userId" = u."id")
         and exists (select 1 from "message" g where g."id" = ?4 and g."roomId" = ?3
                       and g."deletedAt" is null and g."senderId" is not u."id")`
      : `exists (select 1 from "notification" n where n."id" = ?4 and n."userId" = u."id"
                   and n."readAt" is null)`;
  return db
    .prepare(
      `select u."preferredLanguage" as "language", a."displayName" as "actorName",
         r."name" as "roomName", coalesce(p."${preferenceFor[job.kind]}", 1) as "wanted",
         ${valid} as "valid"
       from "user" u
       left join "user" a on a."id" = ?2
       left join "room" r on r."id" = ?3
       left join "notificationPreference" p on p."userId" = u."id"
       where u."id" = ?1`,
    )
    .bind(job.userId, job.actorId, job.roomId, job.sourceId)
    .first<JobContext>();
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type SendResult =
  | { outcome: "sent" | "gone" | "rejected" }
  | { outcome: "retry"; delaySeconds: number };

async function sendOne(
  vapid: VapidKeys,
  job: PushJob,
  payload: PushPayload,
  subscription: SubscriptionRow,
  attempts: number,
): Promise<SendResult> {
  const request = await buildPushPayload(
    {
      data: { ...payload },
      options: {
        ttl: ttlSeconds[job.kind],
        urgency: job.kind === "message" ? "high" : "normal",
        // A newer push for the same room replaces one the device hasn't received yet.
        topic: (await sha256Hex(payload.tag)).slice(0, 32),
      },
    },
    {
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    vapid,
  );

  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      ...request,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeouts and network failures.
    console.warn("Push request failed, will retry", { job: job.id, error: String(error) });
    return { outcome: "retry", delaySeconds: backoff(attempts) };
  }
  // Don't keep the connection waiting on a body nobody reads.
  await response.body?.cancel();

  if (response.ok) return { outcome: "sent" };
  // The browser unsubscribed, or the subscription expired: never try it again.
  if (response.status === 404 || response.status === 410) return { outcome: "gone" };
  if (response.status === 429 || response.status >= 500) {
    const delaySeconds = Math.min(
      retryAfterSeconds(response.headers.get("Retry-After")) ?? backoff(attempts),
      MAX_RETRY_DELAY_SECONDS,
    );
    console.warn("Push service busy, will retry", { job: job.id, status: response.status });
    return { outcome: "retry", delaySeconds };
  }
  // 400, 403 (VAPID key mismatch), 413: retrying the same request won't help. Not
  // deleted, since a misconfigured VAPID key would otherwise wipe every subscription;
  // browsers re-subscribe when the key changes (src/lib/push.ts).
  console.error("Push rejected", { job: job.id, status: response.status });
  return { outcome: "rejected" };
}

/**
 * Sends one job to every browser of its recipient. Returns a delay when some browser
 * should be retried; ones already reached are recorded and skipped next time.
 */
async function deliver(
  env: Env,
  vapid: VapidKeys,
  job: PushJob,
  attempts: number,
): Promise<number | null> {
  const context = await loadContext(env.DB, job);
  if (!context || !context.wanted || !context.valid || context.roomName === null) return null;
  const payload = renderPush(job, { ...context, roomName: context.roomName });

  const { results: subscriptions } = await env.DB.prepare(
    `select s."id", s."endpoint", s."p256dh", s."auth" from "pushSubscription" s
     where s."userId" = ?1
       and not exists (select 1 from "pushDelivery" d where d."id" = ?2 || ':' || s."id")`,
  )
    .bind(job.userId, job.id)
    .all<SubscriptionRow>();

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      const result = await sendOne(vapid, job, payload, subscription, attempts);
      const now = new Date().toISOString();
      if (result.outcome === "sent") {
        await env.DB.batch([
          env.DB.prepare(
            `insert into "pushDelivery" ("id") values (?) on conflict do nothing`,
          ).bind(`${job.id}:${subscription.id}`),
          env.DB.prepare(`update "pushSubscription" set "lastUsedAt" = ? where "id" = ?`).bind(
            now,
            subscription.id,
          ),
        ]);
      } else if (result.outcome === "gone") {
        await env.DB.prepare(`delete from "pushSubscription" where "id" = ?`)
          .bind(subscription.id)
          .run();
      }
      return result;
    }),
  );

  const delays = results.flatMap((result) =>
    result.outcome === "retry" ? [result.delaySeconds] : [],
  );
  return delays.length > 0 ? Math.max(...delays) : null;
}

/** Queue consumer for "baleh-push-notifications". */
export async function deliverPushNotifications(batch: MessageBatch<unknown>, env: Env) {
  const vapid = vapidKeys(env);
  for (const message of batch.messages) {
    const parsed = pushJobSchema.safeParse(message.body);
    if (!parsed.success || !vapid) {
      console.error("Dropping push job", message.id, vapid ? "invalid" : "VAPID keys not set");
      message.ack();
      continue;
    }
    try {
      const delaySeconds = await deliver(env, vapid, parsed.data, message.attempts);
      if (delaySeconds === null) message.ack();
      else message.retry({ delaySeconds });
    } catch (error) {
      console.error("Push delivery failed, will retry", parsed.data.id, error);
      message.retry({ delaySeconds: backoff(message.attempts) });
    }
  }

  // Redeliveries come within hours; two days of history is plenty to dedupe against.
  try {
    await env.DB.prepare(`delete from "pushDelivery" where "sentAt" < ?`)
      .bind(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
      .run();
  } catch (error) {
    console.error("Couldn't prune push deliveries", error);
  }
}

/**
 * Queue consumer for "baleh-push-notifications-dlq": jobs that ran out of retries.
 * A late notification is worse than none, so they're logged (ids only) and dropped.
 */
export function drainPushDeadLetters(batch: MessageBatch<unknown>) {
  for (const message of batch.messages) {
    const parsed = pushJobSchema.safeParse(message.body);
    console.error("Push job gave up", parsed.success ? parsed.data.id : message.id);
    message.ack();
  }
}
