import { z } from "zod";

/*
 * Browser push: what the client sends to manage its subscription and preferences.
 * See worker/push.ts for delivery and public/sw.js for the receiving end.
 */

/** Unpadded base64url, as PushSubscription.toJSON() gives keys. */
const base64Url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, "Expected base64url");

export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    // A P-256 public key (65 bytes) and a 16-byte secret.
    p256dh: base64Url.min(86).max(88),
    auth: base64Url.min(22).max(24),
  }),
  /** Set by the service worker when the browser replaced a subscription. */
  oldEndpoint: z.url().max(2048).optional(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const removePushSubscriptionSchema = z.object({ endpoint: z.url().max(2048) });

export const notificationPreferencesSchema = z
  .object({
    messages: z.boolean(),
    invitations: z.boolean(),
    roomActivity: z.boolean(),
  })
  .strict();

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** What the service worker shows. Built on the server, in the recipient's language. */
export interface PushPayload {
  title: string;
  body: string;
  /** A same-origin path to open on click. */
  url: string;
  /** Notifications with the same tag replace each other (one per room). */
  tag: string;
}
