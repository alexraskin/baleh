import { z } from "zod";

import type { LanguageCode } from "./languages.ts";
import { attachmentInputSchema, type Attachment } from "./media.ts";

/*
 * Message contracts and the WebSocket protocol, shared by the client and the
 * Worker. The socket carries live events only; D1 is the source of truth and
 * clients recover anything they missed through the history endpoint.
 */

export const MESSAGE_MAX_LENGTH = 4000;

export const messageTextSchema = z
  .string()
  .trim()
  .min(1, "Write a message first.")
  .max(MESSAGE_MAX_LENGTH, `Keep messages under ${MESSAGE_MAX_LENGTH} characters.`);

export const createMessageSchema = z
  .object({
    /** Optional when there's an attachment (a caption). */
    text: z
      .string()
      .trim()
      .max(MESSAGE_MAX_LENGTH, `Keep messages under ${MESSAGE_MAX_LENGTH} characters.`)
      .default(""),
    /** Client-generated id that makes retries idempotent and matches optimistic messages. */
    clientId: z.uuid(),
    /** An uploaded image: the token from its upload, plus its measured size. */
    attachment: attachmentInputSchema.optional(),
    /** An earlier message in the same room that this one replies to. */
    replyToId: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((value) => value.text || value.attachment, {
    message: "Write a message first.",
    path: ["text"],
  });

export type CreateMessageInput = z.input<typeof createMessageSchema>;

export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_PAGE_SIZE = 100;

export const historyQuerySchema = z
  .object({
    /** Messages strictly older than this message id (paging back through history). */
    before: z.string().min(1).max(64).optional(),
    /** Messages strictly newer than this message id (catching up after a reconnect). */
    after: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(HISTORY_MAX_PAGE_SIZE).default(HISTORY_PAGE_SIZE),
  })
  .refine((query) => !(query.before && query.after), "Use either before or after, not both.");

export interface Message {
  id: string;
  roomId: string;
  /** Null when the sender's account was deleted. */
  senderId: string | null;
  senderName: string | null;
  text: string;
  language: LanguageCode;
  clientId: string | null;
  createdAt: string;
  /** One per member language other than the original's. The original is never changed. */
  translations: MessageTranslation[];
  attachments: Attachment[];
  /** Set when the message was deleted; text, translations and attachments are then empty. */
  deletedAt: string | null;
  /** Who deleted it: the sender, or a room owner or admin. */
  deletedBy: string | null;
  /** The message this one replies to, as a short preview. */
  replyTo: ReplyPreview | null;
}

/** Enough of a quoted message to show above a reply, without loading it. */
export interface ReplyPreview {
  id: string;
  senderId: string | null;
  senderName: string | null;
  /** The original text, cut to REPLY_PREVIEW_LENGTH. Empty once deleted. */
  text: string;
  language: LanguageCode;
  hasImage: boolean;
  deleted: boolean;
}

export const REPLY_PREVIEW_LENGTH = 200;

export type TranslationStatus = "pending" | "done" | "failed";

export interface MessageTranslation {
  language: LanguageCode;
  status: TranslationStatus;
  /** Set once status is "done". */
  text: string | null;
}

/** A page of history, oldest first. */
export interface MessagePage {
  messages: Message[];
  /** More messages exist beyond this page in the direction requested. */
  hasMore: boolean;
}

// Read receipts -------------------------------------------------------------

/**
 * A message's position in the timeline as one sortable string. Receipt
 * watermarks store these; createdAt is fixed-width ISO 8601, so plain string
 * comparison follows (createdAt, id) order.
 */
export function messageCursor(message: { createdAt: string; id: string }): string {
  return `${message.createdAt} ${message.id}`;
}

export type DeliveryStatus = "sent" | "delivered" | "read";

interface ReceiptWatermarks {
  userId: string;
  joinedAt: string;
  deliveredThrough: string | null;
  readThrough: string | null;
}

/**
 * A sent message's tick state, WhatsApp style: delivered or read once every
 * recipient has. Recipients are the current members, other than the sender,
 * who had joined by the time it was sent.
 */
export function deliveryStatus(
  message: { createdAt: string; id: string; senderId: string | null },
  members: ReceiptWatermarks[],
): DeliveryStatus {
  const cursor = messageCursor(message);
  const recipients = members.filter(
    (member) => member.userId !== message.senderId && member.joinedAt <= message.createdAt,
  );
  if (recipients.length === 0) return "sent";
  if (recipients.every((member) => (member.readThrough ?? "") >= cursor)) return "read";
  if (recipients.every((member) => (member.deliveredThrough ?? "") >= cursor)) return "delivered";
  return "sent";
}

export const receiptSchema = z
  .object({
    /** Newest message the client has received. */
    delivered: z.string().min(1).max(64).optional(),
    /** Newest message the user has seen on screen. Implies delivered. */
    read: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((value) => value.delivered || value.read, "Nothing to acknowledge.");

export type ReceiptInput = z.infer<typeof receiptSchema>;

/** One recipient's state for a message, for "Message info". */
export interface MessageReceipt {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

// WebSocket protocol ------------------------------------------------------

export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("typing"), typing: z.boolean() }).strict(),
  /** Whether the room is on screen: hidden tabs still get push notifications. */
  z.object({ type: z.literal("visibility"), visible: z.boolean() }).strict(),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

export interface PresenceUser {
  userId: string;
  displayName: string;
}

export type ServerEvent =
  /** Sent once on connect: who's online right now. */
  | { type: "ready"; online: PresenceUser[] }
  | { type: "message"; message: Message }
  | { type: "typing"; userId: string; displayName: string; typing: boolean }
  | { type: "presence"; online: PresenceUser[] }
  | { type: "message-deleted"; messageId: string; deletedAt: string; deletedBy: string }
  /** A translation finished or failed. */
  | { type: "translation"; messageId: string; translation: MessageTranslation }
  /**
   * Sent on a user's own socket (/api/ws), not a room's: something in a room they belong
   * to (or just left) changed, so refetch it. No roomId means every room.
   */
  | { type: "room-changed"; roomId?: string }
  /** A room got a new message: its new activity time, which sorts the room list. */
  | { type: "room-activity"; roomId: string; updatedAt: string }
  /** The user's received invitations changed (and with them, their notifications). */
  | { type: "invitations-changed" }
  /** The user's notifications changed: a new one, or some were read. */
  | { type: "notifications-changed" }
  /** The user's own profile changed, maybe from another tab or device. */
  | { type: "profile-changed" }
  /** A member's receipt watermarks moved forward. */
  | {
      type: "receipts";
      userId: string;
      deliveredThrough: string | null;
      readThrough: string | null;
    };

/** Text the server answers to a "ping" frame, without waking a hibernating room. */
export const PING = "ping";
export const PONG = "pong";

/** How long a typing indicator lasts without a refresh from the typist. */
export const TYPING_TIMEOUT_MS = 6000;
