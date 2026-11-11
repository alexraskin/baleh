/*
 * Baleh service worker: browser push notifications only. It caches nothing, so no
 * conversation ever lands in a cache. Payloads come from worker/push.ts and name the
 * sender and room, never the message.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only paths on this origin are opened; anything else falls back to the rooms list. */
function safePath(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/rooms", self.location.origin);
    if (url.origin === self.location.origin) return url.pathname + url.search;
  } catch {
    // Malformed: fall through.
  }
  return "/rooms";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: show the generic notification below.
  }
  const title = typeof data.title === "string" ? data.title : "Baleh";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      // A new message in the same room replaces the old notification and alerts again.
      renotify: typeof data.tag === "string",
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const target = new URL(path, self.location.origin).href;
      // Prefer a tab already showing the page, then any Baleh tab.
      const existing =
        windows.find((client) => client.url === target) ||
        windows.find((client) => client.focused) ||
        windows[0];
      if (existing) {
        await existing.focus();
        // The app navigates in place (src/lib/push.ts), keeping its state.
        existing.postMessage({ type: "navigate", url: path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});

/** The browser replaced the subscription (expiry, key rotation): tell Baleh the new one. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let subscription = event.newSubscription;
      if (!subscription) {
        const config = await (await fetch("/api/config")).json();
        if (!config.vapidPublicKey) return;
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: config.vapidPublicKey,
        });
      }
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...subscription.toJSON(),
          ...(old && { oldEndpoint: old.endpoint }),
        }),
      });
    })(),
  );
});
