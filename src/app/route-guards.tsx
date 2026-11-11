import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { FullPageSpinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { useSafeNext } from "@/lib/use-safe-next";

/**
 * Renders child routes only for signed-in users; otherwise sends them to /login.
 * Also drops the signed-out user's cached data: here, not in the sign-out handlers,
 * because better-auth keeps the old session until its refetch lands, and clearing
 * while the app is still mounted refetches everything without a cookie (401s).
 */
export function RequireAuth() {
  const { data: session, isPending, error } = authClient.useSession();
  const location = useLocation();
  const queryClient = useQueryClient();
  // Only a 401 means signed out; a network error (503 from auth-client) is not, so
  // wait for better-auth's next refetch (focus, back online) instead of logging out.
  const unreachable = !session && !!error && error.status !== 401;
  const signedOut = !isPending && !session && !unreachable;

  useEffect(() => {
    if (signedOut) queryClient.clear();
  }, [signedOut, queryClient]);

  if (isPending || unreachable) return <FullPageSpinner />;
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

/**
 * Keeps signed-in users away from the login and registration screens. No spinner
 * while the session loads: better-auth sets isPending on every refetch while
 * signed out (each tab focus), which would unmount the form and wipe its input.
 */
export function RedirectIfAuthenticated() {
  const { data: session } = authClient.useSession();
  const next = useSafeNext();

  if (session) return <Navigate to={next} replace />;
  return <Outlet />;
}
