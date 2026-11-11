/** Per-browser colour theme. index.html applies it before first paint too. */
export const THEME_STORAGE_KEY = "baleh.theme";

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

export function storedTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage blocked: follow the system.
  }
  return "system";
}

export function resolvedTheme(): "light" | "dark" {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  return darkQuery.matches ? "dark" : "light";
}

/** Keeps the browser chrome (address bar, PWA title bar) matching the page. */
function syncThemeColor() {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(document.body).backgroundColor);
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: still applies for this page view.
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  syncThemeColor();
}

/** Call once at startup; index.html has already set `data-theme`. */
export function initTheme() {
  darkQuery.addEventListener("change", syncThemeColor);
  syncThemeColor();
}
