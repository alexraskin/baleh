const CHECK_INTERVAL_MS = 5 * 60_000;

function currentEntry() {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.src).pathname : null;
}

async function deployedEntry() {
  const response = await fetch("/", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  const html = await response.text();
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
}

/** Don't throw away a half-typed message. */
function hasUnsentText() {
  return [
    ...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input"),
  ].some((field) => field.type !== "hidden" && field.value.trim() !== "");
}

/**
 * Installed PWAs stay open for days, so a deploy (new language, fixes) never loads.
 * When the app comes back to the foreground, compare the hashed entry script with the
 * deployed index.html and reload if it changed.
 */
export function initAutoUpdate() {
  const running = currentEntry();
  if (!running) return;
  let lastCheck = Date.now();
  let stale = false;

  const check = async () => {
    if (!stale && Date.now() - lastCheck >= CHECK_INTERVAL_MS) {
      lastCheck = Date.now();
      const deployed = await deployedEntry().catch(() => null);
      stale = deployed !== null && deployed !== running;
    }
    if (stale && !hasUnsentText()) location.reload();
  };

  document.addEventListener("visibilitychange", () => {
    // Reload in the background when leaving, or on return if nothing is being typed.
    void check();
  });
}
