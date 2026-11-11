import { useState } from "react";

import { useAppConfig } from "@/features/profile/queries";

import { TurnstileWidget } from "./turnstile-widget";

/**
 * Cloudflare Turnstile for auth forms, when the server has it on. Render `widget` in the
 * form, pass `fetchOptions` to the authClient call, and `reset()` after every attempt:
 * a token is good for one verification only.
 */
export function useTurnstile() {
  const siteKey = useAppConfig().data?.turnstileSiteKey ?? null;
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  return {
    widget: siteKey && <TurnstileWidget key={round} siteKey={siteKey} onToken={setToken} />,
    fetchOptions: token ? { headers: { "x-captcha-response": token } } : undefined,
    reset: () => setRound((r) => r + 1),
  };
}

/** Better Auth's captcha plugin rejections (missing or failed token). */
export function isCaptchaError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "MISSING_RESPONSE" || error?.code === "VERIFICATION_FAILED";
}
