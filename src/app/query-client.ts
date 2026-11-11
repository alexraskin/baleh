import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

/** Session expired or revoked elsewhere: refetch it so RequireAuth sends us to /login. */
function onError(error: Error) {
  if (error instanceof ApiError && error.status === 401) authClient.$store.notify("$sessionSignal");
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Client errors won't fix themselves on retry.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
