import { authClient } from "@/lib/auth-client";
import type { UserSummary } from "@/types/models";

/**
 * The signed-in user from the Better Auth session. Only call beneath
 * `RequireAuth`, which guarantees a session exists.
 */
export function useCurrentUser(): UserSummary {
  const { data } = authClient.useSession();
  if (!data) throw new Error("useCurrentUser called without a session");

  const { user } = data;
  return {
    id: user.id,
    displayName: user.displayName,
    preferredLanguage: user.preferredLanguage ?? "en",
    avatarUrl: user.avatarUrl ?? undefined,
  };
}
