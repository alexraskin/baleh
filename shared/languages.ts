/** Languages the product supports. Shared by the client and the Worker. */
// TODO: support every language the translation model supports (M2M100 in worker/translation.ts
// covers ~100). Each new code also needs an entry in src/config/i18n.ts (dir) and UI strings.
export const languageCodes = ["en", "fa", "ar", "de"] as const;

export type LanguageCode = (typeof languageCodes)[number];

export const defaultLanguage: LanguageCode = "en";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (languageCodes as readonly string[]).includes(value);
}
