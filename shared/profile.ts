import { z } from "zod";

import { defaultLanguage, languageCodes, type LanguageCode } from "./languages.ts";

/*
 * Profile fields stored on Better Auth's `user` table, plus the Zod schemas
 * that guard every write to them. Shared so the client validates forms with
 * the same rules the Worker enforces.
 */

export const profileFieldDefinitions = {
  displayName: { type: "string", required: true, input: true } as const,
  preferredLanguage: {
    type: [...languageCodes] as LanguageCode[],
    required: false as const,
    defaultValue: defaultLanguage,
    input: true as const,
  },
  avatarUrl: { type: "string", required: false, input: false } as const,
};

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(60, "Keep it under 60 characters.");

export const languageSchema = z.enum(languageCodes);

export const emailSchema = z.email("Enter a valid email address.").max(254).toLowerCase();

export const PASSWORD_BREACHED =
  "This password has appeared in a data breach. Choose a different one.";

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.");

export const signUpSchema = z.object({
  name: displayNameSchema,
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  preferredLanguage: languageSchema.optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema,
    preferredLanguage: languageSchema,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const updateLanguageSchema = z.object({ preferredLanguage: languageSchema }).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** The profile shape the API returns. */
export interface Profile {
  id: string;
  email: string;
  displayName: string;
  preferredLanguage: LanguageCode;
  avatarUrl: string | null;
  createdAt: string;
}
