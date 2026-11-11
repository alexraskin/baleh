// Set the interface language before first paint so Persian doesn't flash in LTR.
// The app keeps these in step (src/lib/i18n.tsx). A file, not inline, so the CSP
// (public/_headers) needs no 'unsafe-inline' for scripts.
try {
  if (localStorage.getItem("baleh.language") === "fa") {
    document.documentElement.lang = "fa";
    document.documentElement.dir = "rtl";
  }
  // Theme too (src/lib/theme.ts), so dark mode doesn't flash white.
  var theme = localStorage.getItem("baleh.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
