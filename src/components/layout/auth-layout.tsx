import { Check, ChevronDown, Globe, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router";

import { Logo } from "@/components/brand/logo";
import { useMenu } from "@/components/ui/use-menu";
import { languageCodes, languages } from "@/config/i18n";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { resolvedTheme, setTheme } from "@/lib/theme";

export function AuthLayout() {
  const { t } = useI18n();

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="absolute end-3 top-3 flex items-center gap-1">
        <ThemeToggle />
        <LanguageMenu />
      </div>
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="text-sm text-text-muted">{t("brand.tagline")}</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}

/** Flips light/dark for this browser; Settings also offers "follow the system". */
function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setCurrent] = useState(resolvedTheme);
  const next = theme === "dark" ? "light" : "dark";
  const label = t(next === "dark" ? "common.switchToDark" : "common.switchToLight");
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(next);
        setCurrent(next);
      }}
      className="inline-flex size-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/** Signed out, the language is a per-browser choice. Signed in, it's the account's (Settings). */
function LanguageMenu() {
  const { t, language, setLanguage } = useI18n();
  const { data: session } = authClient.useSession();
  const { open, close, container, trigger, menu } = useMenu();
  if (session) return null;

  return (
    <div {...container} className="relative">
      <button
        {...trigger}
        aria-label={`${t("common.language")}: ${languages[language].nativeLabel}`}
        title={t("common.language")}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Globe className="size-4" aria-hidden="true" />
        <span lang={language}>{languages[language].nativeLabel}</span>
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          {...menu}
          className="absolute end-0 top-full z-20 mt-2 w-44 rounded-2xl border border-border bg-surface p-1.5 shadow-soft"
        >
          {languageCodes.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === language}
              lang={code}
              onClick={() => {
                setLanguage(code);
                close();
              }}
              className="flex h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-sm text-text hover:bg-surface-2 aria-checked:font-medium"
            >
              {languages[code].nativeLabel}
              {code === language && <Check className="size-4 text-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
