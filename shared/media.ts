import { z } from "zod";

/*
 * Media rules shared by the client (to fail fast) and the Worker (which
 * enforces them). Each purpose lists what it accepts; voice messages or
 * documents later are new entries here plus a renderer on the client.
 */

export const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type ImageType = (typeof imageTypes)[number];

const MB = 1024 * 1024;

export const mediaRules = {
  avatar: { contentTypes: imageTypes, maxBytes: 5 * MB },
  roomAvatar: { contentTypes: imageTypes, maxBytes: 5 * MB },
  attachment: { contentTypes: imageTypes, maxBytes: 15 * MB },
} as const;

export type MediaPurpose = keyof typeof mediaRules;

/** Why a file can't be used for a purpose, or null when it can. */
export function mediaProblem(purpose: MediaPurpose, contentType: string, size: number) {
  const rules = mediaRules[purpose];
  if (!(rules.contentTypes as readonly string[]).includes(contentType)) {
    return "Use a JPEG, PNG, WebP or GIF image.";
  }
  if (size <= 0) return "That file is empty.";
  if (size > rules.maxBytes) return `Keep images under ${rules.maxBytes / MB} MB.`;
  return null;
}

export const uploadRequestSchema = z
  .object({
    contentType: z.string().max(100),
    size: z.number().int().positive(),
  })
  .strict();

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

/** Where and how to upload. The token proves the upload was authorized and names its object. */
export interface UploadTarget {
  token: string;
  url: string;
  /** Send exactly these headers with the PUT; they're part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

export const uploadTokenSchema = z.string().min(1).max(2048);

/** Pixel size, measured by the client and used only to reserve space while loading. */
export const dimensionSchema = z.number().int().min(1).max(20_000);

export const completeUploadSchema = z.object({ token: uploadTokenSchema }).strict();

export const attachmentInputSchema = z
  .object({
    token: uploadTokenSchema,
    width: dimensionSchema.optional(),
    height: dimensionSchema.optional(),
  })
  .strict();

export interface Attachment {
  id: string;
  kind: "image";
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Authenticated, same-origin URL; members only. */
  url: string;
}
