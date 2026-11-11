import { z } from "zod";

import type { LanguageCode } from "./languages.ts";
import { emailSchema } from "./profile.ts";

/*
 * Room and invitation contracts: the Zod schemas that guard every write, and
 * the shapes the API returns. Shared so forms validate with the Worker's rules.
 */

export const roomRoles = ["owner", "admin", "member"] as const;

export type RoomRole = (typeof roomRoles)[number];

export const roomNameSchema = z
  .string()
  .trim()
  .min(1, "Give the room a name.")
  .max(80, "Keep it under 80 characters.");

export const createRoomSchema = z.object({ name: roomNameSchema }).strict();

export const updateRoomSchema = z.object({ name: roomNameSchema }).strict();

/** Owners and admins can promote members to admin; only owners can demote. */
export const updateMemberSchema = z.object({ role: z.enum(["admin", "member"]) }).strict();

export const createInvitationSchema = z.object({ email: emailSchema }).strict();

/** Invitation tokens travel in the body, never the path, so they stay out of request logs. */
export const invitationTokenSchema = z.object({ token: z.string().min(1).max(256) }).strict();

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Invitations stay valid for a week. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RoomSummary {
  id: string;
  name: string;
  role: RoomRole;
  memberCount: number;
  /** Authenticated, members-only URL, or null when the room has no picture. */
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  preferredLanguage: LanguageCode;
  role: RoomRole;
  joinedAt: string;
  /** Cursor of the newest message this member has received, or null if none yet. */
  deliveredThrough: string | null;
  /** Cursor of the newest message this member has read, or null if none yet. */
  readThrough: string | null;
}

export interface RoomDetail extends RoomSummary {
  members: RoomMember[];
}

/** A pending invitation as the room's owner sees it. */
export interface SentInvitation {
  id: string;
  email: string;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

/** Returned once, when an invitation is created; the link can't be recovered later. */
export interface CreatedInvitation extends SentInvitation {
  inviteUrl: string;
}

/** A pending invitation as the invitee sees it. */
export interface ReceivedInvitation {
  id: string;
  roomId: string;
  roomName: string;
  inviterName: string | null;
  expiresAt: string;
  createdAt: string;
}
