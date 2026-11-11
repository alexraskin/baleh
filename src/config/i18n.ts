import {
  defaultLanguage,
  isLanguageCode,
  languageCodes,
  type LanguageCode,
} from "@shared/languages.ts";

export { defaultLanguage, isLanguageCode, languageCodes, type LanguageCode };

export const languages = {
  en: { nativeLabel: "English", dir: "ltr" },
  fa: { nativeLabel: "فارسی", dir: "rtl" },
  ar: { nativeLabel: "العربية", dir: "rtl" },
  de: { nativeLabel: "Deutsch", dir: "ltr" },
} as const satisfies Record<LanguageCode, { nativeLabel: string; dir: string }>;

export type TextDirection = (typeof languages)[LanguageCode]["dir"];

export function directionOf(language: LanguageCode): TextDirection {
  return languages[language].dir;
}
