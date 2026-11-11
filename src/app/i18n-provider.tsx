import { useEffect, useMemo, useState, type ReactNode } from "react";

import { directionOf, isLanguageCode } from "@/config/i18n";
import { authClient } from "@/lib/auth-client";
import { createI18n, I18nContext, LANGUAGE_STORAGE_KEY, storedLanguage } from "@/lib/i18n";

/**
 * The interface language: the signed-in account's language, otherwise the one
 * picked on the sign-in pages, otherwise the browser's. Sets `lang` and `dir` on
 * <html> so the whole layout mirrors for Persian.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const [chosen, setChosen] = useState(storedLanguage);
  const account = session.data?.user.preferredLanguage;
  const language = isLanguageCode(account) ? account : chosen;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = directionOf(language);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Not remembered across visits; the account or browser language still applies.
    }
  }, [language]);

  const value = useMemo(() => createI18n(language, setChosen), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
