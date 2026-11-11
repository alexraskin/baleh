import type { DeliveryStatus, MessageTranslation } from "@shared/messages.ts";

import type { LanguageCode } from "@/config/i18n";

/*
 * Client-side view models. API contracts live in `shared/`; these cover what
 * the API doesn't serve yet. Keep them free of persistence details.
 */

export type Id = string;

export interface UserSummary {
  id: Id;
  displayName: string;
  preferredLanguage: LanguageCode;
  avatarUrl?: string;
}

/** A message as the bubble renders it: confirmed, or still on its way. */
export interface MessageView {
  /** Message id, or the client id while pending. */
  key: Id;
  senderId: Id | null;
  senderName: string;
  /** The original, exactly as sent. */
  text: string;
  language: LanguageCode;
  /** Present when the original isn't in the viewer's language. */
  translation?: MessageTranslation;
  /** Images, as stored, or the local preview while one is uploading. */
  images: { src: string; width: number | null; height: number | null }[];
  /** Upload progress from 0 to 1 while sending an image. */
  progress?: number;
  /** Why a send failed, when known. */
  error?: string;
  createdAt: string;
  status: "sent" | "sending" | "failed";
  /** Ticks for your own sent messages. */
  delivery?: DeliveryStatus;
  /** Set once deleted: by its sender, or by a room owner or admin. */
  deleted?: "by-sender" | "by-moderator";
  /** The viewer may delete it: their own message, or they moderate the room. */
  deletable?: boolean;
  /** The message this one replies to. */
  replyTo?: QuotedMessage;
}

/** A replied-to message, as the quote above a reply (or the composer) shows it. */
export interface QuotedMessage {
  id: Id;
  senderName: string;
  /** In the viewer's language when a translation is at hand, else the original. */
  text: string;
  language: LanguageCode;
  hasImage: boolean;
  deleted: boolean;
}
