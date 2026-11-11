import type { Auth } from "./auth.ts";
import { HttpError } from "./http.ts";
import { isTrustedOrigin } from "./origins.ts";

/**
 * Resolves the signed-in user from the session cookie. The user id always comes
 * from here, never from the request body or URL.
 */
export async function requireUser(auth: Auth, request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "Not signed in");
  return session.user;
}

/**
 * For writes to the user row: the session cookie cache still holds the old values, so
 * re-read the session from D1 and send the refreshed cache cookie with the response.
 */
export async function withFreshSession(auth: Auth, request: Request, response: Response) {
  const { headers } = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
    returnHeaders: true,
  });
  for (const cookie of headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** Rejects state-changing requests whose Origin isn't ours (defence in depth over SameSite). */
export function assertSameOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  if (origin && !isTrustedOrigin(origin, env)) {
    throw new HttpError(403, "Cross-origin request rejected");
  }
}

/** Per-user cap on costly writes (messages, uploads, rooms, invitations). See WRITE_LIMITER. */
export async function assertWithinRateLimit(env: Env, userId: string): Promise<void> {
  const { success } = await env.WRITE_LIMITER.limit({ key: userId });
  if (!success) throw new HttpError(429, "Too many requests. Wait a moment and try again.");
}

/** Characters a user may send per UTC day. Caps translation spend (~$0.04/user/day worst case). */
export const DAILY_CHARACTER_BUDGET = 50_000;

/** Adds `characters` to today's usage, or throws 429 if that would pass the budget. Atomic. */
export async function chargeDailyBudget(
  env: Env,
  userId: string,
  characters: number,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `insert into "dailyUsage" ("userId", "day", "characters")
     select ?1, ?2, ?3 where ?3 <= ?4
     on conflict ("userId", "day") do update set "characters" = "characters" + excluded."characters"
       where "characters" + excluded."characters" <= ?4
     returning "characters"`,
  )
    .bind(userId, day, characters, DAILY_CHARACTER_BUDGET)
    .first();
  if (!row) throw new HttpError(429, "Daily message limit reached. Try again tomorrow.");
}
