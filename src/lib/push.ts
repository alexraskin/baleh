import { apiFetch } from "./api";

/*
 * Browser side of push notifications: the service worker (public/sw.js) and this
 * browser's subscription. Permission is only ever asked from a button press.
 */

export type PushSupport = "supported" | "unsupported" | "needs-install";

function isStandalone() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isAppleMobile() {
  // iPadOS reports itself as a Mac; touch gives it away.
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

/** iOS and iPadOS only offer push to web apps added to the Home Screen. */
export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    return "supported";
  }
  return isAppleMobile() && !isStandalone() ? "needs-install" : "unsupported";
}

/** Same-site paths only, as sent by the service worker on notification click. */
export function isSafePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

/**
 * Registers the service worker, and lets it move an open tab to a notification's page
 * without a reload.
 */
export function registerServiceWorker(navigate: (path: string) => void) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    console.warn("Service worker registration failed", error);
  });
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (data?.type === "navigate" && isSafePath(data.url)) navigate(data.url);
  });
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

async function existingSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Whether this browser is currently subscribed. */
export async function isSubscribed(): Promise<boolean> {
  if (pushSupport() !== "supported" || Notification.permission !== "granted") return false;
  return (await existingSubscription()) !== null;
}

/** Subscribes with the server's current key, replacing a subscription made with an old one. */
async function subscribe(vapidPublicKey: string) {
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await apiFetch("/push/subscriptions", { method: "POST", json: subscription.toJSON() });
}

/** Who turned push on in this browser, so another account signing in doesn't inherit it. */
const PUSH_USER_KEY = "baleh.pushUser";

function rememberPushUser(userId: string | null) {
  try {
    if (userId) localStorage.setItem(PUSH_USER_KEY, userId);
    else localStorage.removeItem(PUSH_USER_KEY);
  } catch {
    // Storage blocked: sync below then leaves the subscription alone.
  }
}

function pushUser() {
  try {
    return localStorage.getItem(PUSH_USER_KEY);
  } catch {
    return null;
  }
}

/** Asks for permission (call from a click) and subscribes. Returns the permission. */
export async function enablePush(
  vapidPublicKey: string,
  userId: string,
): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    await subscribe(vapidPublicKey);
    rememberPushUser(userId);
  }
  return permission;
}

/** Unsubscribes this browser, here and on the server. */
export async function disablePush() {
  if (pushSupport() !== "supported") return;
  const subscription = await existingSubscription();
  if (!subscription) return;
  try {
    await apiFetch("/push/subscriptions", {
      method: "DELETE",
      json: { endpoint: subscription.endpoint },
    });
  } finally {
    // Even if the server didn't hear, a dead endpoint is removed on the next push.
    await subscription.unsubscribe();
    rememberPushUser(null);
  }
}

/**
 * On each signed-in visit: re-sends this browser's subscription, picking up a replaced
 * endpoint. A subscription someone else turned on here is dropped, not handed to whoever
 * signed in. Never asks for permission, and never re-subscribes: Safari only allows
 * pushManager.subscribe() from a user gesture, so unsubscribing here to swap keys would
 * silently turn push off on iOS. A key change is picked up by toggling it in settings.
 */
export async function syncPush(vapidPublicKey: string | null, userId: string) {
  if (!vapidPublicKey || !(await isSubscribed())) return;
  const subscription = await existingSubscription();
  if (!subscription) return;
  const owner = pushUser();
  if (owner !== null && owner !== userId) {
    await subscription.unsubscribe();
  } else if (owner === userId && sameKey(subscription, base64UrlToBytes(vapidPublicKey))) {
    await apiFetch("/push/subscriptions", { method: "POST", json: subscription.toJSON() });
  }
}
