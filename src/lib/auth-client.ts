import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { profileFieldDefinitions } from "@shared/profile.ts";

const ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * iOS WebKit can stall a request after the page returns from the background (e.g. a
 * password manager sheet): it hangs for about a minute, then fails. Give each attempt
 * 10s, retry once, and turn a final failure into a 503 so forms show an ordinary error
 * instead of staying on "Signing in…". The request body is a JSON string, so it is safe
 * to resend; a Turnstile token unused by the stalled attempt is still valid.
 */
async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      if (attempt === 1) {
        return Response.json({ message: "Network error. Please try again." }, { status: 503 });
      }
    }
  }
}

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: { customFetchImpl: resilientFetch },
  plugins: [inferAdditionalFields({ user: profileFieldDefinitions }), twoFactorClient()],
});

export type SessionUser = typeof authClient.$Infer.Session.user;
