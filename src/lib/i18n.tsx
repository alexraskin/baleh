import { createContext, Fragment, useContext, type ReactNode } from "react";

import {
  defaultLanguage,
  directionOf,
  isLanguageCode,
  type LanguageCode,
  type TextDirection,
} from "@/config/i18n";
import { ar, arErrors } from "@/locales/ar";
import { de, deErrors } from "@/locales/de";
import { en, enErrors, type Catalog, type MessageKey, type Plural } from "@/locales/en";
import { fa, faErrors } from "@/locales/fa";

import { formattersFor, type Formatters } from "./format";

const catalogs: Record<LanguageCode, { messages: Catalog; errors: Record<string, string> }> = {
  en: { messages: en, errors: enErrors },
  fa: { messages: fa, errors: faErrors },
  ar: { messages: ar, errors: arErrors },
  de: { messages: de, errors: deErrors },
};

/** Remembers the interface language for signed-out pages; index.html reads it too. */
export const LANGUAGE_STORAGE_KEY = "baleh.language";

type Vars = Record<string, string | number>;

export interface I18n {
  language: LanguageCode;
  dir: TextDirection;
  /** BCP 47 locale for Intl, keeping the browser's region when it matches. */
  locale: string;
  /** A message, with `{placeholders}` filled. Text values are bidi-isolated, numbers localized. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** Like `t`, but values may be elements (e.g. a bold name). */
  rich: (key: MessageKey, vars: Record<string, ReactNode>) => ReactNode;
  /** An English error message from the API, validation or the browser, in this language. */
  error: (message: string) => string;
  format: Formatters;
  /** Changes the language for signed-out pages; a signed-in account's language wins. */
  setLanguage: (language: LanguageCode) => void;
}

export const I18nContext = createContext<I18n | null>(null);

export function storedLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    // Storage blocked: fall through to the browser's languages.
  }
  for (const tag of navigator.languages) {
    const code = tag.split("-")[0]?.toLowerCase();
    if (isLanguageCode(code)) return code;
  }
  return defaultLanguage;
}

/** Wraps text in first-strong isolates so a name or email can't reorder the sentence around it. */
function isolate(text: string) {
  return `⁨${text}⁩`;
}

export function createI18n(
  language: LanguageCode,
  setLanguage: (language: LanguageCode) => void,
): I18n {
  const locale =
    navigator.languages.find((tag) => tag.split("-")[0]?.toLowerCase() === language) ?? language;
  const format = formattersFor(locale, directionOf(language));
  const { messages, errors } = catalogs[language];
  const plural = new Intl.PluralRules(locale);

  function template(key: MessageKey, count: unknown) {
    const entry = messages[key] ?? en[key];
    if (typeof entry === "string") return entry;
    return entry[plural.select(Number(count ?? 0)) as keyof Plural] ?? entry.other;
  }

  return {
    language,
    dir: directionOf(language),
    locale,
    format,
    setLanguage,
    t: (key, vars) =>
      template(key, vars?.count).replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = vars?.[name];
        if (value === undefined) return match;
        return typeof value === "number" ? format.number(value) : isolate(value);
      }),
    rich: (key, vars) =>
      template(key, vars.count)
        .split(/\{(\w+)\}/)
        .map((part, index) =>
          index % 2 === 0 ? part : <Fragment key={index}>{vars[part] ?? `{${part}}`}</Fragment>,
        ),
    error: (message) => errors[message] ?? message,
  };
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error("useI18n called outside I18nProvider");
  return i18n;
}
