import {
  notificationPreferencesSchema,
  pushSubscriptionSchema,
  removePushSubscriptionSchema,
  type NotificationPreferences,
} from "../../shared/push.ts";
import type { Auth } from "../auth.ts";
import { HttpError, json, parseJson } from "../http.ts";
import { vapidKeys } from "../push.ts";
import { assertSameOrigin, requireUser } from "../session.ts";

/*
 * Push subscription and preference management. Everything is scoped to the session's
 * user; endpoints and keys are write-only (never returned).
 */

/** Browsers beyond this many are dropped, least recently updated first. */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * The push services browsers use. The server POSTs to whatever endpoint is stored,
 * so only these hosts are accepted.
 */
const pushServiceHosts = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Opera, Samsung Internet, Brave
  ".push.services.mozilla.com", // Firefox
  ".push.apple.com", // Safari, iOS and iPadOS Home Screen apps
  ".notify.windows.com", // Edge on Windows
];

export function isPushServiceUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    pushServiceHosts.some((host) =>
      host.startsWith(".") ? url.hostname.endsWith(host) : url.hostname === host,
    )
  );
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** The browser's keys must be a real P-256 point and a 16-byte secret, or every push fails. */
async function assertValidKeys(p256dh: string, auth: string) {
  try {
    if (base64UrlToBytes(auth).length !== 16) throw new Error("auth");
    await crypto.subtle.importKey(
      "raw",
      base64UrlToBytes(p256dh),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
  } catch {
    throw new HttpError(400, "Invalid subscription keys");
  }
}

export async function registerPushSubscription(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  if (!vapidKeys(env)) throw new HttpError(503, "Browser notifications aren't set up");
  const { endpoint, keys, oldEndpoint } = await parseJson(request, pushSubscriptionSchema);
  if (!isPushServiceUrl(endpoint)) throw new HttpError(400, "Unsupported push service");
  await assertValidKeys(keys.p256dh, keys.auth);

  const now = new Date().toISOString();
  const statements = [
    // A browser has one endpoint, so registering it again (even signed in as someone
    // else) moves it to this user: holding the endpoint is holding the browser.
    env.DB.prepare(
      `insert into "pushSubscription" ("id", "userId", "endpoint", "p256dh", "auth", "createdAt", "updatedAt")
       values (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       on conflict ("endpoint") do update set
         "userId" = excluded."userId", "p256dh" = excluded."p256dh", "auth" = excluded."auth",
         "updatedAt" = excluded."updatedAt"`,
    ).bind(crypto.randomUUID(), user.id, endpoint, keys.p256dh, keys.auth, now),
    env.DB.prepare(
      `delete from "pushSubscription" where "userId" = ?1 and "id" not in (
         select "id" from "pushSubscription" where "userId" = ?1
         order by "updatedAt" desc limit ?2)`,
    ).bind(user.id, MAX_SUBSCRIPTIONS_PER_USER),
  ];
  // The browser replaced its subscription; only the owner's old one can be removed.
  if (oldEndpoint && oldEndpoint !== endpoint) {
    statements.unshift(
      env.DB.prepare(`delete from "pushSubscription" where "endpoint" = ? and "userId" = ?`).bind(
        oldEndpoint,
        user.id,
      ),
    );
  }
  await env.DB.batch(statements);
  return new Response(null, { status: 204 });
}

export async function removePushSubscription(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const { endpoint } = await parseJson(request, removePushSubscriptionSchema);
  // Someone else's endpoint deletes nothing, and the answer is the same either way.
  await env.DB.prepare(`delete from "pushSubscription" where "endpoint" = ? and "userId" = ?`)
    .bind(endpoint, user.id)
    .run();
  return new Response(null, { status: 204 });
}

export async function getNotificationPreferences(request: Request, env: Env, auth: Auth) {
  const user = await requireUser(auth, request);
  const row = await env.DB.prepare(
    `select "messages", "invitations", "roomActivity" from "notificationPreference" where "userId" = ?`,
  )
    .bind(user.id)
    .first<Record<keyof NotificationPreferences, number>>();
  const preferences: NotificationPreferences = {
    messages: Boolean(row?.messages ?? 1),
    invitations: Boolean(row?.invitations ?? 1),
    roomActivity: Boolean(row?.roomActivity ?? 1),
  };
  return json(preferences);
}

export async function putNotificationPreferences(request: Request, env: Env, auth: Auth) {
  assertSameOrigin(request, env);
  const user = await requireUser(auth, request);
  const preferences = await parseJson(request, notificationPreferencesSchema);
  await env.DB.prepare(
    `insert into "notificationPreference" ("userId", "messages", "invitations", "roomActivity", "updatedAt")
     values (?1, ?2, ?3, ?4, ?5)
     on conflict ("userId") do update set
       "messages" = excluded."messages", "invitations" = excluded."invitations",
       "roomActivity" = excluded."roomActivity", "updatedAt" = excluded."updatedAt"`,
  )
    .bind(
      user.id,
      Number(preferences.messages),
      Number(preferences.invitations),
      Number(preferences.roomActivity),
      new Date().toISOString(),
    )
    .run();
  return json(preferences);
}
